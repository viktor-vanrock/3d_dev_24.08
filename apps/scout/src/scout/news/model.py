"""Structured model adapters with an explicit capability boundary."""

from __future__ import annotations

import json
import os
import subprocess
import threading
from dataclasses import dataclass
from typing import Protocol

import httpx


@dataclass(frozen=True)
class LocalModelConfig:
    role: str
    base_url: str
    model: str
    prompt_version: str
    max_tokens: int
    thinking: bool = False


@dataclass(frozen=True)
class GrokModelConfig:
    role: str
    executable: str
    model: str
    model_version: str
    prompt_version: str
    max_turns: int = 1


class StructuredJsonModel(Protocol):
    config: LocalModelConfig | GrokModelConfig

    def close(self) -> None: ...

    def complete(self, *, system: str, payload: dict, schema: dict) -> dict: ...


class LocalJsonModel:
    def __init__(self, config: LocalModelConfig, timeout_seconds: float = 180) -> None:
        self.config = config
        self._client = httpx.Client(timeout=timeout_seconds)

    def close(self) -> None:
        self._client.close()

    def complete(self, *, system: str, payload: dict, schema: dict) -> dict:
        request: dict = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            "temperature": 0,
            "max_tokens": self.config.max_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": f"feed_news_{self.config.role}",
                    "strict": True,
                    "schema": schema,
                },
            },
        }
        if not self.config.thinking:
            request["chat_template_kwargs"] = {"enable_thinking": False}
        for attempt in range(2):
            response = self._client.post(
                f"{self.config.base_url.rstrip('/')}/v1/chat/completions",
                json=request,
            )
            response.raise_for_status()
            try:
                envelope = response.json()
                content = envelope["choices"][0]["message"]["content"]
                result = json.loads(content)
            except (json.JSONDecodeError, KeyError, TypeError):
                if attempt == 0:
                    request["chat_template_kwargs"] = {"enable_thinking": False}
                    continue
                raise
            if not isinstance(result, dict):
                raise ValueError("local model returned a non-object JSON value")
            return result
        raise AssertionError("unreachable local model retry loop")


class GrokJsonModel:
    """Run the subscribed Grok CLI without exposing host or publish capabilities.

    The subprocess receives only the minimum environment needed for the authenticated
    runtime. In particular, feed/API publish secrets present in a systemd unit are not
    inherited. The moderation prompt is the only input and no Grok tools are enabled.
    """

    _ENV_ALLOWLIST = {
        "HOME",
        "LANG",
        "LC_ALL",
        "LOGNAME",
        "PATH",
        "TERM",
        "TMPDIR",
        "USER",
    }

    def __init__(
        self,
        config: GrokModelConfig,
        *,
        timeout_seconds: float = 300,
        environ: dict[str, str] | None = None,
    ) -> None:
        self.config = config
        self.timeout_seconds = timeout_seconds
        source_env = os.environ if environ is None else environ
        self._env = {key: source_env[key] for key in self._ENV_ALLOWLIST if key in source_env}
        self._lock = threading.Lock()

    def close(self) -> None:
        return None

    def complete(self, *, system: str, payload: dict, schema: dict) -> dict:
        prompt = f"INPUT:\n{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}"
        system_prompt = (
            f"{system.rstrip()}\n\n"
            "Return only the JSON object constrained by the supplied schema."
        )
        command = [
            self.config.executable,
            "--single",
            prompt,
            "--system-prompt-override",
            system_prompt,
            "--verbatim",
            "--model",
            self.config.model,
            "--output-format",
            "json",
            "--json-schema",
            json.dumps(schema, ensure_ascii=False, separators=(",", ":")),
            "--permission-mode",
            "dontAsk",
            "--no-plan",
            "--tools",
            "",
            "--no-subagents",
            "--no-memory",
            "--disable-web-search",
            "--max-turns",
            str(self.config.max_turns),
        ]
        for attempt in range(2):
            # One subscribed Grok moderation run at a time, even when brands are processed
            # concurrently by the local stages.
            with self._lock:
                completed = subprocess.run(
                    command,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout_seconds,
                    env=self._env,
                )
            if completed.returncode != 0:
                message = completed.stderr.strip() or completed.stdout.strip()
                raise RuntimeError(f"Grok moderation runtime failed: {message[:500]}")
            try:
                result = self._parse_output(completed.stdout)
            except (json.JSONDecodeError, ValueError):
                if attempt == 0:
                    continue
                raise
            if not isinstance(result, dict):
                raise ValueError("Grok returned a non-object JSON value")
            return result
        raise AssertionError("unreachable Grok retry loop")

    @staticmethod
    def _parse_output(output: str) -> dict:
        text = output.strip()
        if not text:
            raise ValueError("Grok returned empty output")
        decoded = json.loads(text)
        if isinstance(decoded, dict):
            for field in ("structuredOutput", "structured_output", "result", "text"):
                nested = decoded.get(field)
                if isinstance(nested, dict):
                    return nested
                if isinstance(nested, str):
                    parsed = json.loads(nested)
                    if isinstance(parsed, dict):
                        return parsed
        if not isinstance(decoded, dict):
            raise ValueError("Grok output envelope is not an object")
        return decoded
