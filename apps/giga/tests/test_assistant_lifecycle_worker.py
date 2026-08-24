from contextlib import nullcontext
from datetime import UTC, datetime
from pathlib import Path

from portal_queue_lifecycle import ClaimedJob, ClaimToken

from giga.assistant import router
from giga.assistant.config import load_assistant_worker_config
from giga.assistant.evidence import Evidence
from giga.assistant.lifecycle import AssistantPayload
from giga.assistant.lifecycle_worker import classify_assistant_failure, execute_assistant
from giga.assistant.schemas import AssistantGenerationOffer


def test_assistant_entrypoint_has_no_legacy_queue_fallback() -> None:
    root = Path(__file__).resolve().parents[1]
    pyproject = (root / "pyproject.toml").read_text(encoding="utf-8")
    source = (root / "src/giga/assistant/lifecycle_worker.py").read_text(encoding="utf-8")

    assert 'giga-assistant-worker = "giga.assistant.lifecycle_worker:run_loop"' in pyproject
    assert "QueueWorkerRunner(" in source
    assert "AssistantRepository(" in source
    assert "run_legacy_loop" not in source
    assert "_wait_disabled(" in source
    assert not (root / "src/giga/assistant/worker.py").exists()


def test_execute_assistant_stamps_offer_and_wires_catalog_audit(monkeypatch, caplog) -> None:
    config = load_assistant_worker_config_from_values()
    connection = object()
    captured: dict[str, object] = {}

    def evidence_provider(_connection, _query, _limit):
        return [Evidence(model_id="model-1", title="Dragon", snippet="Figure", score=0.8)]

    def route_message(
        _hyperpc_config,
        _message,
        _evidence,
        *,
        catalog_search,
        on_tool_call,
        **_kwargs,
    ):
        captured["models"] = [item.model_id for item in catalog_search("dragon", 3)]
        on_tool_call("catalog_search")
        return AssistantGenerationOffer(branch="openscad", prompt_summary="Phone stand")

    monkeypatch.setattr(
        "giga.assistant.lifecycle_worker.psycopg.connect",
        lambda _url: nullcontext(connection),
    )
    monkeypatch.setattr(router, "route_message", route_message)
    job = ClaimedJob(
        token=ClaimToken("run-42", "owner-1", 1),
        payload=AssistantPayload("run-42", "thread-1", "user-1", "make a stand"),
        attempts=1,
        lease_expires_at=datetime.now(UTC),
    )

    with caplog.at_level("INFO", logger="giga.assistant.audit"):
        result = execute_assistant(
            "postgres://unused",
            None,
            config,
            job,
            evidence_provider,
        )

    assert result.result["offer_id"] == "run-42"
    assert captured["models"] == ["model-1"]
    assert {getattr(record, "event", None) for record in caplog.records} == {
        "assistant.tool_call.v1",
        "assistant.run.completed.v1",
    }


def load_assistant_worker_config_from_values():
    from giga.assistant.config import AssistantWorkerConfig

    return AssistantWorkerConfig(
        database_url="postgres://unused",
        poll_interval_seconds=0.1,
        lease_seconds=90,
        heartbeat_interval_seconds=10,
        shutdown_grace_seconds=30,
        max_attempts=3,
        evidence_limit=6,
        max_response_tokens=800,
        lifecycle_enabled=True,
    )


def test_assistant_lifecycle_requires_explicit_enable(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgres://portal:portal@localhost:5432/portal")
    monkeypatch.setenv("ASSISTANT_LIFECYCLE_ENABLED", "1")

    config = load_assistant_worker_config()

    assert config is not None
    assert config.lifecycle_enabled is True
    assert config.max_attempts == 3
    assert config.heartbeat_interval_seconds <= config.lease_seconds / 3


def test_worker_exceptions_keep_existing_terminal_error_policy() -> None:
    failure = classify_assistant_failure(
        RuntimeError("boom"),
        None,  # type: ignore[arg-type]
    )

    assert failure.error == "assistant worker failed"
    assert failure.retryable is False
