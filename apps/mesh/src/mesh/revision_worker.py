from __future__ import annotations

import hashlib
import logging
import tempfile
from pathlib import Path
from uuid import uuid4

import psycopg
import trimesh
from portal_queue_lifecycle import (
    ClaimedJob,
    QueueLifecycle,
    QueueWorkerRunner,
    RunOutcome,
    ShutdownController,
    metrics_sink_from_env,
)

from . import metrics
from .config import WorkerConfig, load_s3_config, load_worker_config
from .conversion_queue import (
    MeshAssetPublication,
    MeshConversionFailure,
    MeshConversionPayload,
    MeshConversionRepository,
    MeshConversionSuccess,
    PsycopgTransactionManager,
    promote_next_uploaded_revision,
)
from .convert import ConversionError, convert_to_3mf, passthrough_3mf
from .derivatives import export_stl
from .errors import RejectCode, RejectionError
from .part_preview import generate_part_previews, list_part_ids
from .preview import export_mobile_glb, generate_previews
from .storage import (
    ObjectStore,
    canonical_3mf_key,
    mobile_preview_glb_key,
    part_id_slug,
    part_preview_glb_key,
    part_thumbnail_webp_key,
    preview_glb_key,
    stl_derivative_key,
    thumbnail_webp_key,
)

logger = logging.getLogger("mesh.revision_worker")


def _sha256(path: Path) -> bytes:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.digest()


def convert_revision(
    store: ObjectStore,
    job: ClaimedJob[MeshConversionPayload],
) -> MeshConversionSuccess:
    payload = job.payload
    if payload.source_format == "step":
        raise ConversionError("STEP is not supported by the conversion worker")
    if payload.source_s3_key is None:
        raise ConversionError("revision source blob is missing")

    with tempfile.TemporaryDirectory(prefix=f"mesh-{payload.revision_id}-") as temporary:
        directory = Path(temporary)
        source = directory / f"source.{payload.source_format}"
        store.download(payload.source_s3_key, source)
        canonical = directory / "canonical_3mf.3mf"
        if payload.source_format == "3mf":
            result = passthrough_3mf(source, canonical)
        elif payload.source_format in {"stl", "obj"}:
            result = convert_to_3mf(source, canonical)
        else:
            raise ConversionError(f"unsupported source format: {payload.source_format}")
        repaired = any(not report.before.is_clean for report in result.reports)
        metrics.record_success(result.duration_ms, repaired, result.memory_peak_bytes)

        assets: list[MeshAssetPublication] = []
        _upload_asset(
            store,
            result.path,
            canonical_3mf_key(payload.model_id, payload.revision_id),
            "canonical_3mf",
            "model/3mf",
            assets,
        )
        _best_effort_previews(store, payload, result.path, directory, assets)
        _best_effort_part_previews(store, payload, result.path, directory)
        _best_effort_stl(store, payload, result.path, directory, assets)
        return MeshConversionSuccess(bbox=dict(result.bbox), assets=tuple(assets))


def classify_failure(
    error: Exception,
    _job: ClaimedJob[MeshConversionPayload],
) -> MeshConversionFailure:
    if isinstance(error, RejectionError):
        metrics.record_rejection(error.code)
        return MeshConversionFailure(error.code.value, str(error)[:500], retryable=False)
    if isinstance(error, ConversionError):
        metrics.record_rejection(RejectCode.PARSE_ERROR)
        return MeshConversionFailure("conversion_rejected", str(error)[:500], retryable=False)
    logger.exception("temporary Mesh conversion failure", exc_info=error)
    return MeshConversionFailure(
        "temporary_conversion_error",
        "temporary conversion infrastructure error",
        retryable=True,
    )


def _upload_asset(
    store: ObjectStore,
    path: Path,
    key: str,
    role: str,
    mime_type: str,
    assets: list[MeshAssetPublication],
) -> None:
    store.upload(path, key, content_type=mime_type)
    assets.append(
        MeshAssetPublication(
            role=role,
            s3_key=key,
            size_bytes=path.stat().st_size,
            checksum=_sha256(path),
            mime_type=mime_type,
            original_filename=path.name,
        )
    )


def _best_effort_previews(
    store: ObjectStore,
    payload: MeshConversionPayload,
    canonical: Path,
    directory: Path,
    assets: list[MeshAssetPublication],
) -> None:
    try:
        assets.extend(generate_revision_previews(store, payload, canonical, directory))
    except Exception as error:  # noqa: BLE001 - optional assets never fail canonical output
        logger.warning("revision %s preview generation failed: %s", payload.revision_id, error)


def generate_revision_previews(
    store: ObjectStore,
    payload: MeshConversionPayload,
    canonical: Path,
    directory: Path,
) -> tuple[MeshAssetPublication, ...]:
    """Generate the three revision-scoped preview assets or raise."""

    mesh = trimesh.load(canonical, force="mesh")
    if not isinstance(mesh, trimesh.Trimesh) or mesh.faces.shape[0] == 0:
        raise ConversionError("canonical 3MF has no preview geometry")
    glb = directory / "preview.glb"
    thumbnail = directory / "thumb.webp"
    mobile = directory / "preview.mobile.glb"
    generate_previews(mesh, glb, thumbnail)
    export_mobile_glb(mesh, mobile)
    assets: list[MeshAssetPublication] = []
    _upload_asset(
        store,
        glb,
        preview_glb_key(payload.model_id, payload.revision_id),
        "preview",
        "model/gltf-binary",
        assets,
    )
    _upload_asset(
        store,
        thumbnail,
        thumbnail_webp_key(payload.model_id, payload.revision_id),
        "thumbnail",
        "image/webp",
        assets,
    )
    _upload_asset(
        store,
        mobile,
        mobile_preview_glb_key(payload.model_id, payload.revision_id),
        "mobile_preview",
        "model/gltf-binary",
        assets,
    )
    return tuple(assets)


def _best_effort_part_previews(
    store: ObjectStore,
    payload: MeshConversionPayload,
    canonical: Path,
    directory: Path,
) -> None:
    try:
        part_ids = list_part_ids(canonical)
        if len(part_ids) <= 1:
            return
        for part_id in part_ids:
            glb = directory / f"part-{part_id_slug(part_id)}.glb"
            thumbnail = directory / f"part-{part_id_slug(part_id)}.webp"
            generate_part_previews(canonical, part_id, glb, thumbnail)
            store.upload(
                glb,
                part_preview_glb_key(payload.model_id, payload.revision_id, part_id),
                content_type="model/gltf-binary",
            )
            store.upload(
                thumbnail,
                part_thumbnail_webp_key(payload.model_id, payload.revision_id, part_id),
                content_type="image/webp",
            )
    except Exception as error:  # noqa: BLE001 - optional assets never fail canonical output
        logger.warning("revision %s part previews failed: %s", payload.revision_id, error)


def _best_effort_stl(
    store: ObjectStore,
    payload: MeshConversionPayload,
    canonical: Path,
    directory: Path,
    assets: list[MeshAssetPublication],
) -> None:
    try:
        derivative = directory / "stl_derivative.stl"
        export_stl(canonical, derivative)
        _upload_asset(
            store,
            derivative,
            stl_derivative_key(payload.model_id, payload.revision_id),
            "stl_derivative",
            "model/stl",
            assets,
        )
    except Exception as error:  # noqa: BLE001 - optional assets never fail canonical output
        logger.warning("revision %s STL derivative failed: %s", payload.revision_id, error)


def run_loop() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    config = load_worker_config()
    s3_config = load_s3_config()
    if config is None or s3_config is None or not config.revision_worker_enabled:
        logger.warning(
            "Mesh revision worker disabled: require DATABASE_URL, S3 credentials, "
            "and MESH_REVISION_WORKER_ENABLED=1"
        )
        disabled = ShutdownController(grace_seconds=0)
        with disabled.install_signal_handlers():
            disabled.wait()
        return
    _run_enabled(config, ObjectStore(s3_config))


def _run_enabled(config: WorkerConfig, store: ObjectStore) -> None:
    shutdown = ShutdownController(config.shutdown_grace_seconds)
    repository = MeshConversionRepository(max_attempts=config.max_attempts)
    queue_metrics = metrics_sink_from_env("mesh-conversion")
    lifecycle = QueueLifecycle(
        queue="mesh-conversion",
        transactions=PsycopgTransactionManager(config.database_url),
        repository=repository,
        metrics=queue_metrics,
    )
    runner = QueueWorkerRunner(
        lifecycle,
        owner_id=f"mesh-{uuid4()}",
        lease_seconds=config.lease_seconds,
        heartbeat_interval_seconds=config.heartbeat_interval_seconds,
        shutdown=shutdown,
    )
    with shutdown.install_signal_handlers():
        while not shutdown.requested:
            with psycopg.connect(config.database_url) as connection:
                _ = promote_next_uploaded_revision(connection)
            outcome = runner.run_once(
                lambda job: convert_revision(store, job),
                classify_failure,
            )
            if outcome in {RunOutcome.IDLE, RunOutcome.STOPPED}:
                shutdown.wait(config.poll_interval_seconds)
            elif outcome is RunOutcome.DRAIN_EXPIRED:
                return
            snapshot = lifecycle.collect_metrics()
            log = logger.debug if outcome is RunOutcome.IDLE else logger.info
            log(
                "mesh queue metrics outcome=%s depth=%d oldest_age_seconds=%.3f "
                "expired_leases=%d counters=%s",
                outcome.value,
                snapshot.waiting_depth,
                snapshot.oldest_waiting_age_seconds,
                snapshot.expired_leases,
                queue_metrics.counters(),
            )
