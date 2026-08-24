"""Юнит-тесты `giga.branches.comfyui_client` — httpx.get/post monkeypatch'нуты,
без реальной сети/Tailscale (тот же приём, что `test_assistant_hyperpc_client.py`)."""

from __future__ import annotations

import httpx
import pytest

from giga.branches import comfyui_client as cc


class _FakeResponse:
    def __init__(self, status_code=200, json_body=None, content=b"", text=""):
        self.status_code = status_code
        self._json_body = json_body if json_body is not None else {}
        self.content = content
        self.text = text or str(self._json_body)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("bad status", request=None, response=self)

    def json(self):
        return self._json_body


def _config(**overrides) -> cc.ComfyUIConfig:
    base = dict(
        base_url="http://comfyui:8188",
        timeout_seconds=5.0,
        max_retries=1,
        retry_backoff_seconds=0.0,
        poll_interval_seconds=0.0,
        poll_timeout_seconds=1.0,
        export_tz_offset_hours=3.0,
    )
    base.update(overrides)
    return cc.ComfyUIConfig(**base)


def test_load_config_none_without_url(monkeypatch):
    monkeypatch.delenv("COMFYUI_URL", raising=False)
    assert cc.load_config() is None


def test_load_config_reads_env(monkeypatch):
    monkeypatch.setenv("COMFYUI_URL", "http://100.74.48.83:8188/")
    config = cc.load_config()
    assert config is not None
    assert config.base_url == "http://100.74.48.83:8188"


def test_submit_prompt_returns_prompt_id(monkeypatch):
    captured = {}

    def _post(url, json, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return _FakeResponse(json_body={"prompt_id": "abc-123", "node_errors": {}})

    monkeypatch.setattr(httpx, "post", _post)
    prompt_id = cc.submit_prompt(_config(), {"1": {"class_type": "LoadImage"}})

    assert prompt_id == "abc-123"
    assert captured["url"] == "http://comfyui:8188/prompt"
    assert "client_id" in captured["json"]


def test_submit_prompt_400_is_not_retryable(monkeypatch):
    calls = {"n": 0}

    def _post(url, json, timeout=None):
        calls["n"] += 1
        return _FakeResponse(status_code=400, text="value_smaller_than_min")

    monkeypatch.setattr(httpx, "post", _post)

    with pytest.raises(cc.ComfyUIInvalidResponseError):
        cc.submit_prompt(_config(), {})
    assert calls["n"] == 1  # не ретраится — граф не станет валиднее


def test_submit_prompt_node_errors_raises(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "post",
        lambda url, json, timeout=None: _FakeResponse(
            json_body={"prompt_id": "x", "node_errors": {"104": {"errors": ["bad"]}}}
        ),
    )
    with pytest.raises(cc.ComfyUIInvalidResponseError):
        cc.submit_prompt(_config(), {})


def test_submit_prompt_timeout_is_retryable(monkeypatch):
    calls = {"n": 0}

    def _post(url, json, timeout=None):
        calls["n"] += 1
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(httpx, "post", _post)
    with pytest.raises(cc.ComfyUITimeoutError):
        cc.submit_prompt(_config(max_retries=2), {})
    assert calls["n"] == 3


def test_upload_image_never_trusts_caller_filename(monkeypatch):
    captured = {}

    def _post(url, files=None, data=None, timeout=None):
        captured["files"] = files
        return _FakeResponse(json_body={"name": "giga_abcdef.png", "subfolder": ""})

    monkeypatch.setattr(httpx, "post", _post)
    name = cc.upload_image(_config(), b"\x89PNG", "image/png")

    assert name == "giga_abcdef.png"
    uploaded_filename = captured["files"]["image"][0]
    assert uploaded_filename != "../../etc/passwd"
    assert "/" not in uploaded_filename and ".." not in uploaded_filename


def test_wait_for_completion_success(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, timeout=None, params=None: _FakeResponse(
            json_body={
                "abc": {"status": {"completed": True, "status_str": "success"}, "outputs": {}}
            }
        ),
    )
    entry = cc.wait_for_completion(_config(), "abc")
    assert entry["status"]["status_str"] == "success"


def test_wait_for_completion_provider_error_raises(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, timeout=None, params=None: _FakeResponse(
            json_body={"abc": {"status": {"completed": True, "status_str": "error"}}}
        ),
    )
    with pytest.raises(cc.ComfyUIInvalidResponseError):
        cc.wait_for_completion(_config(), "abc")


def test_wait_for_completion_timeout_raises(monkeypatch):
    monkeypatch.setattr(
        httpx, "get", lambda url, timeout=None, params=None: _FakeResponse(json_body={})
    )
    with pytest.raises(cc.ComfyUITimeoutError):
        cc.wait_for_completion(_config(poll_timeout_seconds=0.01), "abc")


def test_fetch_view_404_returns_none(monkeypatch):
    monkeypatch.setattr(
        httpx, "get", lambda url, timeout=None, params=None: _FakeResponse(status_code=404)
    )
    assert cc.fetch_view(_config(), "missing.glb") is None


def test_locate_export_rejects_unsafe_prefix():
    with pytest.raises(cc.ComfyUIError):
        cc.locate_export(
            _config(),
            filename_prefix="../../etc/passwd",
            file_format="glb",
            submitted_at=0.0,
            completed_at=1.0,
        )


def test_locate_export_finds_calibrated_offset_hit(monkeypatch):
    # Смоук-тест MF-2001: сервер пишет файл в MSK (UTC+3), окно — время job'а
    # ±margin. Подставляем реальный ожидаемый таймстемп на калиброванном смещении.
    from datetime import UTC, datetime, timedelta

    submitted_at = 1_700_000_000.0
    completed_at = submitted_at + 5.0
    hit_dt = datetime.fromtimestamp(submitted_at, tz=UTC) + timedelta(hours=3, seconds=2)
    hit_name = f"giga123_{hit_dt.strftime('%Y%m%d_%H%M%S')}.glb"

    def _get(url, timeout=None, params=None):
        if params.get("filename") == hit_name:
            return _FakeResponse(content=b"glTFhit")
        return _FakeResponse(status_code=404)

    monkeypatch.setattr(httpx, "get", _get)
    content = cc.locate_export(
        _config(),
        filename_prefix="giga123",
        file_format="glb",
        submitted_at=submitted_at,
        completed_at=completed_at,
    )
    assert content == b"glTFhit"


def test_locate_export_raises_when_never_found(monkeypatch):
    monkeypatch.setattr(
        httpx, "get", lambda url, timeout=None, params=None: _FakeResponse(status_code=404)
    )
    with pytest.raises(cc.ComfyUIOutputNotFoundError):
        cc.locate_export(
            _config(),
            filename_prefix="giga123",
            file_format="glb",
            submitted_at=1_700_000_000.0,
            completed_at=1_700_000_005.0,
        )


def test_extract_saved_images_reads_history_outputs():
    history_entry = {
        "outputs": {
            "10": {"images": [{"filename": "z_00001.png", "subfolder": "", "type": "output"}]}
        }
    }
    assert cc.extract_saved_images(history_entry, "10") == [("z_00001.png", "")]


def test_extract_saved_images_empty_when_node_missing():
    assert cc.extract_saved_images({"outputs": {}}, "10") == []
    assert cc.extract_saved_images({}, "10") == []


def test_fetch_view_includes_subfolder_when_present(monkeypatch):
    captured = {}

    def _get(url, timeout=None, params=None):
        captured["params"] = params
        return _FakeResponse(content=b"data")

    monkeypatch.setattr(httpx, "get", _get)
    cc.fetch_view(_config(), "z_00001.png", subfolder="2026-07-28")
    assert captured["params"]["subfolder"] == "2026-07-28"


def test_wait_for_completion_detects_oom(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, timeout=None, params=None: _FakeResponse(
            json_body={
                "abc": {
                    "status": {
                        "completed": True,
                        "status_str": "error",
                        "messages": [
                            [
                                "execution_error",
                                {"exception_message": "CUDA out of memory. Tried to allocate 2GB"},
                            ]
                        ],
                    }
                }
            }
        ),
    )
    with pytest.raises(cc.ComfyUIResourceExhaustedError):
        cc.wait_for_completion(_config(), "abc")


def test_submit_and_wait_with_retry_retries_once_on_oom(monkeypatch):
    prompt_ids = iter(["p1", "p2"])
    monkeypatch.setattr(cc, "submit_prompt", lambda config, workflow: next(prompt_ids))

    calls = {"n": 0}

    def _wait(config, prompt_id, on_tick=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise cc.ComfyUIResourceExhaustedError("OOM")
        return {"prompt_id": prompt_id}

    monkeypatch.setattr(cc, "wait_for_completion", _wait)

    entry = cc.submit_and_wait_with_retry(
        _config(), {}, max_oom_retries=1, retry_backoff_seconds=0.0
    )

    assert entry == {"prompt_id": "p2"}
    assert calls["n"] == 2


def test_submit_and_wait_with_retry_raises_after_exhausting_retries(monkeypatch):
    monkeypatch.setattr(cc, "submit_prompt", lambda config, workflow: "p")
    monkeypatch.setattr(
        cc,
        "wait_for_completion",
        lambda config, prompt_id, on_tick=None: (_ for _ in ()).throw(
            cc.ComfyUIResourceExhaustedError("OOM")
        ),
    )
    with pytest.raises(cc.ComfyUIResourceExhaustedError):
        cc.submit_and_wait_with_retry(_config(), {}, max_oom_retries=1, retry_backoff_seconds=0.0)


def test_submit_and_wait_with_retry_does_not_retry_other_errors(monkeypatch):
    calls = {"n": 0}

    def _submit(config, workflow):
        calls["n"] += 1
        raise cc.ComfyUIInvalidResponseError("граф отклонён")

    monkeypatch.setattr(cc, "submit_prompt", _submit)
    with pytest.raises(cc.ComfyUIInvalidResponseError):
        cc.submit_and_wait_with_retry(_config(), {}, max_oom_retries=2, retry_backoff_seconds=0.0)
    assert calls["n"] == 1
