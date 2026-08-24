"""Юнит-тесты обёртки над SDK `gigachat` — на фейковом клиенте, без сети/кредов."""

from __future__ import annotations

import base64

import pytest
from gigachat.exceptions import ServerError

from giga import gigachat_client
from giga.branches.base import GenerationError


class _Message:
    def __init__(self, content: str):
        self.content = content


class _Choice:
    def __init__(self, content: str):
        self.message = _Message(content)


class _Completion:
    def __init__(self, content: str, has_choices: bool = True):
        self.choices = [_Choice(content)] if has_choices else []


class _Image:
    def __init__(self, content: str):
        self.content = content


class _FakeClient:
    def __init__(self, chat_response="ok", image_b64=None, raise_on_chat=None, raise_on_image=None):
        self._chat_response = chat_response
        self._image_b64 = image_b64
        self._raise_on_chat = raise_on_chat
        self._raise_on_image = raise_on_image

    def chat(self, chat):
        if self._raise_on_chat:
            raise self._raise_on_chat
        return _Completion(self._chat_response)

    def get_image(self, file_id):
        if self._raise_on_image:
            raise self._raise_on_image
        return _Image(self._image_b64)


def test_load_client_none_without_credentials(monkeypatch):
    monkeypatch.delenv("GIGACHAT_CREDENTIALS", raising=False)
    assert gigachat_client.load_client() is None


def test_load_client_configures_timeout_and_retries(monkeypatch):
    captured = {}

    class _ConfiguredClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setenv("GIGACHAT_CREDENTIALS", "fake")
    monkeypatch.setattr(gigachat_client, "GigaChat", _ConfiguredClient)

    assert isinstance(gigachat_client.load_client(), _ConfiguredClient)
    assert captured == {
        "timeout": gigachat_client.GIGACHAT_TIMEOUT_SECONDS,
        "max_retries": gigachat_client.GIGACHAT_MAX_RETRIES,
        "retry_backoff_factor": gigachat_client.GIGACHAT_RETRY_BACKOFF_SECONDS,
        "retry_on_status_codes": gigachat_client.GIGACHAT_RETRY_STATUS_CODES,
        "verify_ssl_certs": False,
    }


def test_ask_text_returns_message_content():
    client = _FakeClient(chat_response="привет")
    assert gigachat_client.ask_text(client, "system", "user") == "привет"


def test_ask_text_empty_choices_raises():
    client = _FakeClient()
    client.chat = lambda chat: _Completion("x", has_choices=False)
    with pytest.raises(GenerationError):
        gigachat_client.ask_text(client, "system", "user")


def test_ask_text_provider_error_wrapped_as_generation_error():
    client = _FakeClient(raise_on_chat=ServerError("https://gigachat", 500, b"", None))
    with pytest.raises(GenerationError):
        gigachat_client.ask_text(client, "system", "user")


def test_ask_image_extracts_file_id_and_decodes_base64():
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"0" * 16
    b64 = base64.b64encode(png_bytes).decode()
    client = _FakeClient(chat_response='<img src="file-123" fuse="true"/>', image_b64=b64)

    result = gigachat_client.ask_image(client, "system", "нарисуй кота")

    assert result == png_bytes


def test_ask_image_without_img_tag_raises():
    client = _FakeClient(chat_response="извините, не могу нарисовать")
    with pytest.raises(GenerationError):
        gigachat_client.ask_image(client, "system", "нарисуй кота")


def test_ask_image_get_image_provider_error_wrapped():
    client = _FakeClient(
        chat_response='<img src="file-123"/>',
        raise_on_image=ServerError("https://gigachat", 500, b"", None),
    )
    with pytest.raises(GenerationError):
        gigachat_client.ask_image(client, "system", "нарисуй кота")
