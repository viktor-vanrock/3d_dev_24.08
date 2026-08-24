from __future__ import annotations

import logging
from uuid import uuid4

from portal_queue_lifecycle import (
    ClaimedJob,
    QueueLifecycle,
    QueueWorkerRunner,
    RunOutcome,
    ShutdownController,
    metrics_sink_from_env,
)

from .branches import GenerationError, GenerationJob, get_executor
from .config import WorkerConfig, load_s3_config, load_worker_config
from .generation_lifecycle import (
    GenerationFailure,
    GenerationPayload,
    GenerationProgressWriter,
    GenerationRepository,
    GenerationSuccess,
    PsycopgTransactionManager,
)
from .storage import ObjectStore, artifact_key, preview_key

logger = logging.getLogger("giga.lifecycle_worker")


def _wait_disabled(reason: str) -> None:
    logger.warning("generation worker is disabled: %s", reason)
    shutdown = ShutdownController(grace_seconds=0)
    with shutdown.install_signal_handlers():
        shutdown.wait()


def execute_generation(
    database_url: str,
    store: ObjectStore,
    job: ClaimedJob[GenerationPayload],
) -> GenerationSuccess:
    payload = job.payload
    generation_job = GenerationJob(
        id=payload.generation_id,
        branch=payload.branch,
        prompt=payload.prompt,
        params=payload.params,
    )
    progress = GenerationProgressWriter(database_url, job.token)
    result = get_executor(generation_job.branch)(generation_job, progress.report)
    artifact = artifact_key(generation_job.id, result.artifact_ext)
    store.upload_bytes(artifact, result.artifact_bytes, result.artifact_content_type)
    preview = None
    if result.preview_bytes is not None:
        preview = preview_key(generation_job.id, result.preview_ext or "bin")
        store.upload_bytes(
            preview,
            result.preview_bytes,
            result.preview_content_type or "application/octet-stream",
        )
    return GenerationSuccess(artifact, preview)


def classify_generation_failure(
    error: Exception,
    _job: ClaimedJob[GenerationPayload],
) -> GenerationFailure:
    if isinstance(error, GenerationError):
        logger.warning("generation provider failure: %s", error)
        return GenerationFailure(str(error)[:500], retryable=False)
    logger.exception("generation execution failure", exc_info=error)
    # Preserve the current worker contract: execution/provider failures become
    # terminal error; attempts are used for crash/expired-lease recovery.
    return GenerationFailure("generation execution failed", retryable=False)


def run_loop() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config = load_worker_config()
    if config is None:
        _wait_disabled("DATABASE_URL is not configured")
        return
    if not config.lifecycle_enabled:
        _wait_disabled("GIGA_LIFECYCLE_ENABLED is not set to 1")
        return
    s3_config = load_s3_config()
    if s3_config is None:
        _wait_disabled("S3 credentials are missing")
        return
    _run_enabled(config, ObjectStore(s3_config))


def _run_enabled(config: WorkerConfig, store: ObjectStore) -> None:
    shutdown = ShutdownController(config.shutdown_grace_seconds)
    metrics = metrics_sink_from_env("giga-generation")
    lifecycle = QueueLifecycle(
        queue="giga-generation",
        transactions=PsycopgTransactionManager(config.database_url),
        repository=GenerationRepository(max_attempts=config.max_attempts),
        metrics=metrics,
    )
    runner = QueueWorkerRunner(
        lifecycle,
        owner_id=f"giga-{uuid4()}",
        lease_seconds=config.lease_seconds,
        heartbeat_interval_seconds=config.heartbeat_interval_seconds,
        shutdown=shutdown,
    )
    with shutdown.install_signal_handlers():
        while not shutdown.requested:
            outcome = runner.run_once(
                lambda job: execute_generation(config.database_url, store, job),
                classify_generation_failure,
            )
            if outcome in {RunOutcome.IDLE, RunOutcome.STOPPED}:
                shutdown.wait(config.poll_interval_seconds)
            elif outcome is RunOutcome.DRAIN_EXPIRED:
                return
            snapshot = lifecycle.collect_metrics()
            logger.info(
                "generation queue metrics outcome=%s depth=%d oldest_age_seconds=%.3f "
                "expired_leases=%d counters=%s",
                outcome.value,
                snapshot.waiting_depth,
                snapshot.oldest_waiting_age_seconds,
                snapshot.expired_leases,
                metrics.counters(),
            )
