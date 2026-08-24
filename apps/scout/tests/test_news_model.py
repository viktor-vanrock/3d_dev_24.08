from __future__ import annotations

import json
import subprocess

from scout.news.model import GrokJsonModel, GrokModelConfig, LocalJsonModel, LocalModelConfig


class _LocalResponse:
    def __init__(self, content: str) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {"choices": [{"message": {"content": self.content}}]}


class _LocalClient:
    def __init__(self, contents: list[str]) -> None:
        self.contents = contents
        self.calls = 0
        self.requests: list[dict] = []

    def post(self, url: str, *, json: dict) -> _LocalResponse:
        del url
        self.requests.append(json.copy())
        response = _LocalResponse(self.contents[self.calls])
        self.calls += 1
        return response


def test_grok_adapter_does_not_inherit_publish_secrets_or_enable_tools():
    calls: list[tuple[list[str], dict]] = []

    def fake_run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        calls.append((command, kwargs))
        return subprocess.CompletedProcess(command, 0, stdout='{"decision":"accept"}', stderr="")

    model = GrokJsonModel(
        GrokModelConfig("moderator", "grok", "grok-4.5", "grok-4.5", "moderator.v2"),
        environ={
            "HOME": "/runtime-home",
            "PATH": "/usr/bin",
            "FEED_INGEST_API_KEY": "must-not-leak",
            "DATABASE_URL": "must-not-leak",
            "XAI_API_KEY": "must-not-leak",
        },
    )
    original = subprocess.run
    subprocess.run = fake_run
    try:
        result = model.complete(
            system="moderate",
            payload={"candidate": "safe"},
            schema={"type": "object"},
        )
    finally:
        subprocess.run = original

    assert result == {"decision": "accept"}
    command, kwargs = calls[0]
    assert "--disable-web-search" in command
    assert command[command.index("--tools") + 1] == ""
    assert "--no-subagents" in command
    assert kwargs["env"] == {"HOME": "/runtime-home", "PATH": "/usr/bin"}
    assert "must-not-leak" not in json.dumps(command)


def test_grok_adapter_accepts_structured_output_envelope():
    assert GrokJsonModel._parse_output('{"structured_output":{"decision":"reject"}}') == {
        "decision": "reject"
    }


def test_grok_adapter_decodes_cli_string_result_envelope():
    output = '{"result":"{\\"decision\\":\\"accept\\"}","session_id":"safe-id"}'

    assert GrokJsonModel._parse_output(output) == {"decision": "accept"}


def test_grok_adapter_prefers_live_cli_camel_case_structured_output():
    output = (
        '{"text":"{\\"decision\\":\\"reject\\"}",'
        '"structuredOutput":{"decision":"accept"}}'
    )

    assert GrokJsonModel._parse_output(output) == {"decision": "accept"}


def test_local_adapter_retries_one_truncated_json_response():
    model = LocalJsonModel(
        LocalModelConfig("composer", "http://local", "qwen", "v2", 100, thinking=True)
    )
    model._client.close()
    client = _LocalClient(["{", '{"title":"accepted"}'])
    model._client = client

    result = model.complete(system="compose", payload={}, schema={"type": "object"})

    assert result == {"title": "accepted"}
    assert client.calls == 2
    assert "chat_template_kwargs" not in client.requests[0]
    assert client.requests[1]["chat_template_kwargs"] == {"enable_thinking": False}


def test_grok_adapter_retries_one_truncated_json_response():
    outputs = iter(["{", '{"decision":"accept"}'])

    def fake_run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        return subprocess.CompletedProcess(command, 0, stdout=next(outputs), stderr="")

    model = GrokJsonModel(
        GrokModelConfig("moderator", "grok", "grok-4.5", "grok-4.5", "moderator.v2")
    )
    original = subprocess.run
    subprocess.run = fake_run
    try:
        result = model.complete(system="moderate", payload={}, schema={"type": "object"})
    finally:
        subprocess.run = original

    assert result == {"decision": "accept"}
