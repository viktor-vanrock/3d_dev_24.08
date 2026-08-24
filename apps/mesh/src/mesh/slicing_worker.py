from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

import psycopg
from portal_queue_lifecycle import (
    ClaimedJob,
    QueueLifecycle,
    QueueWorkerRunner,
    RunOutcome,
    ShutdownController,
    metrics_sink_from_env,
)

from .config import WorkerConfig, load_s3_config, load_worker_config
from .slice_trust import (
    SLICE_TRUST_CONTRACT_VERSION,
    SliceTrustError,
    Verifier,
    build_slice_trust_material,
    sign_slice_trust_material,
    trust_observation,
    verify_slice_trust_material,
)
from .slicer_engine import (
    SlicerEngineConfig,
    SlicingError,
    UnsupportedSlicerError,
    load_orca_engine_config,
    load_slicer_engine_config,
)
from .slicer_preflight import PlateLayoutError, PreflightError, UnsupportedToolheadError
from .slicing_lifecycle import (
    PsycopgTransactionManager,
    SliceJobFailure,
    SliceJobPayload,
    SliceJobRepository,
    SliceJobSuccess,
)
from .slicing_queue import (
    _find_account_cache_hit,
    _orca_startup_health_check,
    _resolve_slicer_engine,
    _run_orca_plate_job,
    _run_prusaslicer_job,
    _slice_trust_startup_health_check,
)
from .snapmaker_u1_profile import load_orca_profiles_dir
from .storage import ObjectStore

logger = logging.getLogger("mesh.slicing_worker")


def _wait_disabled(reason: str) -> None:
    logger.warning("slicing worker is disabled: %s", reason)
    shutdown = ShutdownController(grace_seconds=0)
    with shutdown.install_signal_handlers():
        shutdown.wait()


def execute_slice_job(
    database_url: str,
    store: ObjectStore,
    engine_config: SlicerEngineConfig,
    job: ClaimedJob[SliceJobPayload],
    *,
    orca_engine_config: SlicerEngineConfig | None,
    orca_profiles_dir: Path | None,
    signer: Callable[[str], tuple[str, str]] | None,
    verifier: Verifier | None,
) -> SliceJobSuccess:
    payload = job.payload
    if payload.slice_trust_contract_version != SLICE_TRUST_CONTRACT_VERSION:
        raise SliceTrustError(
            "SLICE_TRUST_VERSION_UNSUPPORTED",
            "slice job has no supported slice-trust.v1 contract version",
        )
    trust_material = build_slice_trust_material(payload.slice_trust_material)
    if payload.requested_by != trust_material["account_id"]:
        raise SliceTrustError("SLICE_TRUST_CONFLICT", "job owner differs from signed account")
    requested_by = payload.requested_by
    if requested_by is None:
        raise SlicingError("slice job owner is required for account-scoped storage")
    slice_key = bytes.fromhex(trust_material["slice_key"])

    with psycopg.connect(database_url) as connection:
        cache_hit = _find_account_cache_hit(
            connection,
            slice_key,
            requested_by,
            trust_material=trust_material,
            verifier=verifier,
        )
        if cache_hit is not None:
            logger.info(
                "slice_trust %s",
                trust_observation(trust_material, "signature_verified", payload.job_id),
            )
            return SliceJobSuccess(
                gcode_s3_key=str(cache_hit["gcode_s3_key"]),
                size_bytes=int(cache_hit["size_bytes"]),
                slice_key=slice_key,
                metrics=dict(cache_hit["metrics"] or {}),
                signed_trust=cache_hit["signed_trust"],
                preview_manifest_s3_key=None,
                requested_by=requested_by,
                model_id=payload.model_id,
                cache_hit=True,
            )

        if signer is None or verifier is None:
            raise SliceTrustError(
                "SLICE_TRUST_SIGNATURE_INVALID",
                "slice trust signer/verifier is not configured",
            )
        signed_trust = sign_slice_trust_material(trust_material, signer)
        verify_slice_trust_material(trust_material, signed_trust, verifier)
        engine = _resolve_slicer_engine(connection, payload.profile_id)
        if engine == "orcaslicer" and payload.layout is not None:
            connection.commit()
            gcode_key, size_bytes, metrics, manifest_key = _run_orca_plate_job(
                store,
                orca_engine_config,
                orca_profiles_dir,
                payload.layout,
                payload.intent or {},
                requested_by,
                slice_key,
            )
        else:
            gcode_key, size_bytes, metrics, manifest_key = _run_prusaslicer_job(
                connection,
                store,
                engine_config,
                payload.model_id,
                payload.profile_id,
                payload.filament_profile_id,
                requested_by,
                slice_key,
            )
    logger.info("slice_trust %s", trust_observation(trust_material, "accepted", payload.job_id))
    return SliceJobSuccess(
        gcode_s3_key=gcode_key,
        size_bytes=size_bytes,
        slice_key=slice_key,
        metrics=metrics,
        signed_trust=signed_trust,
        preview_manifest_s3_key=manifest_key,
        requested_by=requested_by,
        model_id=payload.model_id,
        cache_hit=False,
    )


def classify_slice_failure(
    error: Exception,
    _job: ClaimedJob[SliceJobPayload],
) -> SliceJobFailure:
    if isinstance(error, SliceTrustError):
        return SliceJobFailure(error.code, error.code, False)
    if isinstance(error, UnsupportedToolheadError):
        detail = f"UNSUPPORTED_TOOLHEAD: {','.join(error.instance_ids)}"
        return SliceJobFailure(detail, "UNSUPPORTED_TOOLHEAD", False)
    if isinstance(error, PlateLayoutError):
        details = "; ".join(f"{item.instance_id}:{item.code}" for item in error.violations)
        return SliceJobFailure(
            f"LAYOUT_PREFLIGHT_FAILED: {details}",
            "LAYOUT_PREFLIGHT_FAILED",
            False,
        )
    if isinstance(error, PreflightError):
        return SliceJobFailure(error.code, error.code, False)
    if isinstance(error, (UnsupportedSlicerError, SlicingError)):
        return SliceJobFailure(str(error)[:500], None, True)
    logger.exception("unexpected slicing failure", exc_info=error)
    return SliceJobFailure("internal slicing error", "internal_error", True)


def run_slice_loop() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config = load_worker_config()
    if config is None:
        _wait_disabled("DATABASE_URL is not configured")
        return
    if not config.slice_lifecycle_enabled:
        _wait_disabled("MESH_SLICE_LIFECYCLE_ENABLED is not set to 1")
        return
    s3_config = load_s3_config()
    engine_config = load_slicer_engine_config()
    signer, verifier = _slice_trust_startup_health_check()
    if s3_config is None or engine_config is None or signer is None or verifier is None:
        _wait_disabled("required S3, engine, or trust configuration is missing")
        return
    orca_engine_config, orca_profiles_dir = _orca_startup_health_check(
        load_orca_engine_config(),
        load_orca_profiles_dir(),
    )
    _run_enabled(
        config,
        ObjectStore(s3_config),
        engine_config,
        orca_engine_config,
        orca_profiles_dir,
        signer,
        verifier,
    )


def _run_enabled(
    config: WorkerConfig,
    store: ObjectStore,
    engine_config: SlicerEngineConfig,
    orca_engine_config: SlicerEngineConfig | None,
    orca_profiles_dir: Path | None,
    signer: Callable[[str], tuple[str, str]],
    verifier: Verifier,
) -> None:
    shutdown = ShutdownController(config.slice_shutdown_grace_seconds)
    metrics = metrics_sink_from_env("mesh-slicing")
    lifecycle = QueueLifecycle(
        queue="mesh-slicing",
        transactions=PsycopgTransactionManager(config.database_url),
        repository=SliceJobRepository(max_attempts=config.slice_max_attempts),
        metrics=metrics,
    )
    runner = QueueWorkerRunner(
        lifecycle,
        owner_id=f"mesh-slice-{uuid4()}",
        lease_seconds=config.slice_lease_seconds,
        heartbeat_interval_seconds=config.slice_heartbeat_interval_seconds,
        shutdown=shutdown,
    )
    with shutdown.install_signal_handlers():
        while not shutdown.requested:
            outcome = runner.run_once(
                lambda job: execute_slice_job(
                    config.database_url,
                    store,
                    engine_config,
                    job,
                    orca_engine_config=orca_engine_config,
                    orca_profiles_dir=orca_profiles_dir,
                    signer=signer,
                    verifier=verifier,
                ),
                classify_slice_failure,
            )
            if outcome in {RunOutcome.IDLE, RunOutcome.STOPPED}:
                shutdown.wait(config.poll_interval_seconds)
            elif outcome is RunOutcome.DRAIN_EXPIRED:
                return
            snapshot = lifecycle.collect_metrics()
            logger.info(
                "slice queue metrics outcome=%s depth=%d oldest_age_seconds=%.3f "
                "expired_leases=%d counters=%s",
                outcome.value,
                snapshot.waiting_depth,
                snapshot.oldest_waiting_age_seconds,
                snapshot.expired_leases,
                metrics.counters(),
            )
