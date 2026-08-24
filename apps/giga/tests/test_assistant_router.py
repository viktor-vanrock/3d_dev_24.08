"""Юнит-тесты `giga.assistant.router.route_message` — HYPERPC полностью
замокан (`hyperpc_client.chat_structured` monkeypatch'нут), без сети."""

from __future__ import annotations

from giga.assistant import hyperpc_client as hp
from giga.assistant import router
from giga.assistant.evidence import Evidence
from giga.assistant.schemas import (
    AssistantAnswer,
    AssistantClarification,
    AssistantError,
    AssistantGenerationOffer,
)

_CONFIG = hp.HyperpcConfig(
    structured_url="http://hyperpc:1236",
    fast_url=None,
    timeout_seconds=5.0,
    max_retries=1,
    retry_backoff_seconds=0.0,
)

_EVIDENCE = [
    Evidence(model_id="model-1", title="Дракон для стола", snippet="статуэтка дракона", score=0.8),
    Evidence(model_id="model-2", title="Брелок дракончик", snippet="маленький брелок", score=0.5),
]


def test_no_hyperpc_config_is_honest_no_op_with_real_citations():
    result = router.route_message(None, "найди дракона", _EVIDENCE)
    assert isinstance(result, AssistantAnswer)
    assert [c.model_id for c in result.citations] == ["model-1", "model-2"]
    assert result.note is not None


def test_no_hyperpc_config_without_evidence_is_still_honest():
    result = router.route_message(None, "найди дракона", [])
    assert isinstance(result, AssistantAnswer)
    assert result.citations == []


def test_answer_only_cites_ids_present_in_evidence(monkeypatch):
    monkeypatch.setattr(
        hp,
        "chat_structured",
        lambda *a, **k: '{"kind": "answer", "text": "Вот что нашлось", '
        '"citation_ids": ["model-1", "model-999-not-real"]}',
    )
    result = router.route_message(_CONFIG, "найди дракона", _EVIDENCE)
    assert isinstance(result, AssistantAnswer)
    assert [c.model_id for c in result.citations] == ["model-1"]
    assert result.citations[0].title == "Дракон для стола"  # наш title, не модельный


def test_clarification_is_single_question(monkeypatch):
    monkeypatch.setattr(
        hp,
        "chat_structured",
        lambda *a, **k: '{"kind": "clarification", "question": "Какой размер нужен?", '
        '"reason": "не указан масштаб"}',
    )
    result = router.route_message(_CONFIG, "хочу дракона", _EVIDENCE)
    assert isinstance(result, AssistantClarification)
    assert result.question == "Какой размер нужен?"


def test_generation_offer_never_triggers_a_job(monkeypatch):
    monkeypatch.setattr(
        hp,
        "chat_structured",
        lambda *a, **k: '{"kind": "generation_offer", "branch": "openscad", '
        '"prompt_summary": "подставка под телефон"}',
    )
    result = router.route_message(_CONFIG, "сделай подставку", _EVIDENCE)
    assert isinstance(result, AssistantGenerationOffer)
    assert result.branch == "openscad"
    # route_message ничего не пишет в generations/БД — сама сигнатура функции
    # не принимает generations-конн, а значит физически не может создать job.


def test_generation_offer_accepts_trellis_branch(monkeypatch):
    monkeypatch.setattr(
        hp,
        "chat_structured",
        lambda *a, **k: '{"kind": "generation_offer", "branch": "trellis", '
        '"prompt_summary": "фигурка дракона"}',
    )
    result = router.route_message(_CONFIG, "сделай 3d фигурку дракона", _EVIDENCE)
    assert isinstance(result, AssistantGenerationOffer)
    assert result.branch == "trellis"


def test_generation_offer_rejects_unknown_branch(monkeypatch):
    monkeypatch.setattr(
        hp,
        "chat_structured",
        lambda *a, **k: '{"kind": "generation_offer", "branch": "sculptgen", '
        '"prompt_summary": "3d модель"}',
    )
    result = router.route_message(_CONFIG, "сгенерируй 3d", _EVIDENCE)
    assert isinstance(result, AssistantError)
    assert result.code == "invalid_output"
    assert result.retryable is False


def test_malformed_json_is_invalid_output_not_retryable(monkeypatch):
    monkeypatch.setattr(hp, "chat_structured", lambda *a, **k: "извините, не могу помочь")
    result = router.route_message(_CONFIG, "что угодно", _EVIDENCE)
    assert isinstance(result, AssistantError)
    assert result.code == "invalid_output"
    assert result.retryable is False


def test_timeout_is_stable_retryable_error(monkeypatch):
    def _raise(*a, **k):
        raise hp.HyperpcTimeoutError("нет ответа за 3 попытки")

    monkeypatch.setattr(hp, "chat_structured", _raise)
    result = router.route_message(_CONFIG, "что угодно", _EVIDENCE)
    assert isinstance(result, AssistantError)
    assert result.code == "provider_timeout"
    assert result.retryable is True


def test_provider_error_is_stable_result_not_an_exception(monkeypatch):
    def _raise(*a, **k):
        raise hp.HyperpcInvalidResponseError("HYPERPC вернул пустой content")

    monkeypatch.setattr(hp, "chat_structured", _raise)
    result = router.route_message(_CONFIG, "что угодно", _EVIDENCE)
    assert isinstance(result, AssistantError)
    assert result.code == "provider_error"


def _fake_catalog_search(query: str, limit: int) -> list[Evidence]:
    return [Evidence(model_id="model-3", title="Дракон XL", snippet="огромный дракон", score=0.9)]


def test_tool_call_executes_catalog_search_then_answers_with_merged_evidence(monkeypatch):
    responses = [
        '{"kind": "tool_call", "skill": "catalog_search", "args": {"query": "дракон побольше"}}',
        '{"kind": "answer", "text": "Нашлась модель побольше", "citation_ids": ["model-3"]}',
    ]
    calls: list[str] = []

    def _fake_chat(config, system_prompt, user_prompt, **kwargs):
        calls.append(user_prompt)
        return responses[len(calls) - 1]

    monkeypatch.setattr(hp, "chat_structured", _fake_chat)
    tool_calls: list[str] = []
    result = router.route_message(
        _CONFIG,
        "хочу дракона побольше",
        _EVIDENCE,
        catalog_search=_fake_catalog_search,
        on_tool_call=tool_calls.append,
    )

    assert isinstance(result, AssistantAnswer)
    assert [c.model_id for c in result.citations] == ["model-3"]
    assert tool_calls == ["catalog_search"]
    assert len(calls) == 2
    assert '"tool_call_used": true' in calls[1]


def test_tool_call_without_catalog_search_injected_is_rejected(monkeypatch):
    """`catalog_search=None` (дефолт) исключает skill из меню — если модель
    всё равно попытается его вызвать, оркестратор отбрасывает попытку, а не
    падает/исполняет что-то без реального executor'а."""
    monkeypatch.setattr(
        hp,
        "chat_structured",
        lambda *a, **k: '{"kind": "tool_call", "skill": "catalog_search", "args": {"query": "x"}}',
    )
    result = router.route_message(_CONFIG, "хочу дракона побольше", _EVIDENCE)
    assert isinstance(result, AssistantError)
    assert result.code == "invalid_output"


def test_tool_call_on_mutating_skill_is_rejected(monkeypatch):
    """`generation_offer` (mutating=True) не исполняем как `tool_call` ни при
    каких обстоятельствах — approval flow (MF-2046): единственный путь к
    мутации — терминальный kind, не скрытый вызов инструмента."""
    monkeypatch.setattr(
        hp,
        "chat_structured",
        lambda *a, **k: '{"kind": "tool_call", "skill": "generation_offer", '
        '"args": {"branch": "openscad", "prompt_summary": "x"}}',
    )
    result = router.route_message(
        _CONFIG, "сделай что-нибудь", _EVIDENCE, catalog_search=_fake_catalog_search
    )
    assert isinstance(result, AssistantError)
    assert result.code == "invalid_output"


def test_tool_call_on_unknown_skill_is_rejected(monkeypatch):
    monkeypatch.setattr(
        hp,
        "chat_structured",
        lambda *a, **k: '{"kind": "tool_call", "skill": "delete_everything", "args": {}}',
    )
    result = router.route_message(
        _CONFIG, "что угодно", _EVIDENCE, catalog_search=_fake_catalog_search
    )
    assert isinstance(result, AssistantError)
    assert result.code == "invalid_output"


def test_tool_call_with_invalid_args_is_rejected(monkeypatch):
    monkeypatch.setattr(
        hp,
        "chat_structured",
        lambda *a, **k: '{"kind": "tool_call", "skill": "catalog_search", "args": {}}',
    )
    result = router.route_message(
        _CONFIG, "что угодно", _EVIDENCE, catalog_search=_fake_catalog_search
    )
    assert isinstance(result, AssistantError)
    assert result.code == "invalid_output"


def test_second_tool_call_attempt_is_rejected_not_looped(monkeypatch):
    call_count = {"n": 0}

    def _fake_chat(config, system_prompt, user_prompt, **kwargs):
        call_count["n"] += 1
        return '{"kind": "tool_call", "skill": "catalog_search", "args": {"query": "ещё"}}'

    monkeypatch.setattr(hp, "chat_structured", _fake_chat)
    result = router.route_message(
        _CONFIG, "хочу дракона", _EVIDENCE, catalog_search=_fake_catalog_search
    )
    assert isinstance(result, AssistantError)
    assert result.code == "invalid_output"
    assert call_count["n"] == 2  # ровно два вызова HYPERPC — не зацикливается


def test_generation_offer_is_rejected_in_page_mode(monkeypatch):
    monkeypatch.setattr(
        hp,
        "chat_structured",
        lambda *a, **k: '{"kind": "generation_offer", "branch": "openscad", '
        '"prompt_summary": "подставка"}',
    )
    result = router.route_message(_CONFIG, "сделай подставку", _EVIDENCE, mode="page")
    assert isinstance(result, AssistantError)
    assert result.code == "invalid_output"
