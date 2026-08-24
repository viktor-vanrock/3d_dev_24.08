from __future__ import annotations

import logging
import time
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

from . import hyperpc_client, router
from .config import AssistantWorkerConfig, load_assistant_worker_config
from .evidence import Evidence, EvidenceProvider, fetch_evidence
from .lifecycle import (
    AssistantFailure,
    AssistantPayload,
    AssistantRepository,
    AssistantSuccess,
    PsycopgTransactionManager,
)
from .schemas import AssistantGenerationOffer, AssistantResult
from .skills import DEFAULT_SCOPES, AssistantMode

logger = logging.getLogger("giga.assistant.lifecycle_worker")
_audit_logger = logging.getLogger("giga.assistant.audit")
_DEFAULT_MODE: AssistantMode = "global"


def _log_run_completed(run: AssistantPayload, result: AssistantResult, started: float) -> None:
    fields = {
        "event": "assistant.run.completed.v1",
        "run_id": run.run_id,
        "thread_id": run.thread_id,
        "account_id": run.user_id,
        "result_type": result.kind,
        "latency_ms": round((time.monotonic() - started) * 1000),
    }
    if isinstance(result, AssistantGenerationOffer):
        fields["offer_id"] = run.run_id
        fields["branch"] = result.branch
    _audit_logger.info("assistant.run.completed.v1", extra=fields)


def _log_tool_call(run: AssistantPayload, skill: str) -> None:
    _audit_logger.info(
        "assistant.tool_call.v1",
        extra={
            "event": "assistant.tool_call.v1",
            "run_id": run.run_id,
            "thread_id": run.thread_id,
            "account_id": run.user_id,
            "skill": skill,
        },
    )


def _make_catalog_search(
    connection: psycopg.Connection,
    evidence_provider: EvidenceProvider,
) -> router.CatalogSearchFn:
    def _search(query: str, limit: int) -> list[Evidence]:
        return evidence_provider(connection, query, limit)

    return _search


def _wait_disabled(reason: str) -> None:
    logger.warning("assistant worker is disabled: %s", reason)
    shutdown = ShutdownController(grace_seconds=0)
    with shutdown.install_signal_handlers():
        shutdown.wait()


def execute_assistant(
    database_url: str,
    hyperpc_config: hyperpc_client.HyperpcConfig | None,
    config: AssistantWorkerConfig,
    job: ClaimedJob[AssistantPayload],
    evidence_provider: EvidenceProvider = fetch_evidence,
) -> AssistantSuccess:
    payload = job.payload
    started = time.monotonic()
    with psycopg.connect(database_url) as connection:
        evidence = evidence_provider(connection, payload.message, config.evidence_limit)
        result = router.route_message(
            hyperpc_config,
            payload.message,
            evidence,
            max_response_tokens=config.max_response_tokens,
            mode=_DEFAULT_MODE,
            scopes=DEFAULT_SCOPES,
            catalog_search=_make_catalog_search(connection, evidence_provider),
            on_tool_call=lambda skill: _log_tool_call(payload, skill),
        )
    result_payload = result.model_dump()
    if isinstance(result, AssistantGenerationOffer):
        result_payload["offer_id"] = payload.run_id
    _log_run_completed(payload, result, started)
    return AssistantSuccess(result_payload)


def classify_assistant_failure(
    error: Exception,
    _job: ClaimedJob[AssistantPayload],
) -> AssistantFailure:
    logger.exception("assistant worker failure", exc_info=error)
    # Provider timeouts and invalid provider responses are normal AssistantResult(kind=error)
    # values. Exceptions here are worker failures and keep the existing terminal policy.
    return AssistantFailure("assistant worker failed", retryable=False)


def run_loop() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config = load_assistant_worker_config()
    if config is None:
        _wait_disabled("DATABASE_URL is not configured")
        return
    if not config.lifecycle_enabled:
        _wait_disabled("ASSISTANT_LIFECYCLE_ENABLED is not set to 1")
        return
    _run_enabled(config, hyperpc_client.load_config())


def _run_enabled(
    config: AssistantWorkerConfig,
    hyperpc_config: hyperpc_client.HyperpcConfig | None,
) -> None:
    shutdown = ShutdownController(config.shutdown_grace_seconds)
    metrics = metrics_sink_from_env("giga-assistant")
    lifecycle = QueueLifecycle(
        queue="giga-assistant",
        transactions=PsycopgTransactionManager(config.database_url),
        repository=AssistantRepository(max_attempts=config.max_attempts),
        metrics=metrics,
    )
    runner = QueueWorkerRunner(
        lifecycle,
        owner_id=f"assistant-{uuid4()}",
        lease_seconds=int(config.lease_seconds),
        heartbeat_interval_seconds=config.heartbeat_interval_seconds,
        shutdown=shutdown,
    )
    with shutdown.install_signal_handlers():
        while not shutdown.requested:
            outcome = runner.run_once(
                lambda job: execute_assistant(
                    config.database_url,
                    hyperpc_config,
                    config,
                    job,
                ),
                classify_assistant_failure,
            )
            if outcome in {RunOutcome.IDLE, RunOutcome.STOPPED}:
                shutdown.wait(config.poll_interval_seconds)
            elif outcome is RunOutcome.DRAIN_EXPIRED:
                return
            snapshot = lifecycle.collect_metrics()
            logger.info(
                "assistant queue metrics outcome=%s depth=%d oldest_age_seconds=%.3f "
                "expired_leases=%d counters=%s",
                outcome.value,
                snapshot.waiting_depth,
                snapshot.oldest_waiting_age_seconds,
                snapshot.expired_leases,
                metrics.counters(),
            )
