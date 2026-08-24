from __future__ import annotations

import logging

import psycopg
from portal_queue_lifecycle import (
    ClaimedJob,
    QueueLifecycle,
    QueueWorkerRunner,
    RunOutcome,
    ShutdownController,
    metrics_sink_from_env,
)

from . import profiles
from .config import (
    HyperpcConfig,
    WorkerConfig,
    load_hyperpc_config,
    load_s3_config,
    load_worker_config,
)
from .content import PostgresModelContentProvider, build_s3_client
from .hyperpc_client import HyperpcClient, HyperpcError
from .index_lease import (
    EmbeddingWriter,
    IndexedHashReader,
    PostgresEmbeddingWriter,
    PostgresIndexRepository,
)
from .lifecycle import (
    PsycopgTransactionManager,
    SearchFailure,
    SearchPayload,
    SearchRepository,
    SearchSuccess,
)
from .render import RenderError
from .worker import (
    EmbeddingClient,
    IndexingError,
    ModelContentProvider,
    _embed_text,
    _embed_view,
)

logger = logging.getLogger("portal_search.lifecycle_worker")


def execute_index(
    job: ClaimedJob[SearchPayload],
    *,
    hyperpc: EmbeddingClient,
    content: ModelContentProvider,
    indexed_hashes: IndexedHashReader,
    writer: EmbeddingWriter,
) -> SearchSuccess:
    payload = job.payload
    if (
        indexed_hashes.get_indexed_text_sha256(
            payload.model_id,
            payload.embedding_model,
            payload.embedding_version,
        )
        == payload.text_sha256
    ):
        return SearchSuccess(payload.content_generation)

    if profiles.is_view_profile(payload.embedding_model):
        embedding = _embed_view(payload, content, hyperpc)
    else:
        embedding = _embed_text(payload, content, hyperpc)
    if embedding is not None:
        writer.write(
            model_id=payload.model_id,
            embedding_model=payload.embedding_model,
            embedding_version=payload.embedding_version,
            dim=payload.dim,
            embedding=embedding,
            text_sha256=payload.text_sha256,
            source_generation=payload.content_generation,
        )
    return SearchSuccess(payload.content_generation)


def classify_index_failure(
    error: Exception,
    job: ClaimedJob[SearchPayload],
) -> SearchFailure:
    if isinstance(error, (IndexingError, RenderError, HyperpcError)):
        logger.warning("search index failure: %s", error)
    else:
        logger.exception("unexpected search index failure", exc_info=error)
    return SearchFailure(
        str(error)[:500],
        content_generation=job.payload.content_generation,
        retryable=True,
    )


def run_loop() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config = load_worker_config()
    if config is None or not config.lifecycle_enabled:
        logger.warning("Search lifecycle is disabled; fail-closed without claiming jobs")
        _wait_until_signal()
        return
    hyperpc_config = load_hyperpc_config()
    s3_config = load_s3_config()
    if hyperpc_config is None or s3_config is None:
        logger.error("Search lifecycle enabled but HYPERPC/S3 configuration is missing")
        disabled = ShutdownController(grace_seconds=0)
        with disabled.install_signal_handlers():
            disabled.wait()
        return
    s3_client = build_s3_client(s3_config)
    with (
        psycopg.connect(config.database_url, autocommit=True) as content_connection,
        psycopg.connect(config.database_url) as writer_connection,
    ):
        _run_enabled(
            config,
            hyperpc_config,
            PostgresModelContentProvider(
                content_connection,
                s3_client,
                s3_config.bucket_models,
            ),
            PostgresIndexRepository(content_connection),
            PostgresEmbeddingWriter(writer_connection),
        )


def _wait_until_signal() -> None:
    disabled = ShutdownController(grace_seconds=0)
    with disabled.install_signal_handlers():
        disabled.wait()


def _run_enabled(
    config: WorkerConfig,
    hyperpc_config: HyperpcConfig,
    content: ModelContentProvider,
    indexed_hashes: IndexedHashReader,
    writer: EmbeddingWriter,
) -> None:
    shutdown = ShutdownController(config.shutdown_grace_seconds)
    metrics = metrics_sink_from_env("search-index")
    lifecycle = QueueLifecycle(
        queue="search-index",
        transactions=PsycopgTransactionManager(config.database_url),
        repository=SearchRepository(max_attempts=config.max_attempts),
        metrics=metrics,
    )
    runner = QueueWorkerRunner(
        lifecycle,
        owner_id=config.worker_id,
        lease_seconds=config.lease_seconds,
        heartbeat_interval_seconds=config.heartbeat_interval_seconds,
        shutdown=shutdown,
    )
    with shutdown.install_signal_handlers():
        while not shutdown.requested:
            with HyperpcClient(hyperpc_config) as hyperpc:
                outcome = runner.run_once(
                    lambda job: execute_index(
                        job,
                        hyperpc=hyperpc,
                        content=content,
                        indexed_hashes=indexed_hashes,
                        writer=writer,
                    ),
                    classify_index_failure,
                )
            if outcome in {RunOutcome.IDLE, RunOutcome.STOPPED}:
                shutdown.wait(config.poll_interval_seconds)
            elif outcome is RunOutcome.DRAIN_EXPIRED:
                return
            snapshot = lifecycle.collect_metrics()
            logger.info(
                "search queue metrics outcome=%s depth=%d oldest_age_seconds=%.3f "
                "expired_leases=%d counters=%s",
                outcome.value,
                snapshot.waiting_depth,
                snapshot.oldest_waiting_age_seconds,
                snapshot.expired_leases,
                metrics.counters(),
            )
