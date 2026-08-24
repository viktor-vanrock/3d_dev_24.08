"""Тесты `giga.branches.zimage_client` — httpx/comfyui_client замокан на
уровне модуля, тот же приём, что `test_comfyui_client.py`/
`test_branches_trellis.py`, без реальной сети/ComfyUI."""

from __future__ import annotations

import httpx
import pytest

from giga.branches import comfyui_client as cc
from giga.branches import zimage_client as zc
from giga.branches.base import GenerationError


class _FakeResponse:
    def __init__(self, status_code=200, json_body=None):
        self.status_code = status_code
        self._json_body = json_body if json_body is not None else {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("bad status", request=None, response=self)

    def json(self):
        return self._json_body


def _comfyui_config(**overrides) -> cc.ComfyUIConfig:
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


def _zimage_config(**overrides) -> zc.ZImageConfig:
    base = dict(
        comfyui=_comfyui_config(),
        unet_name="z_image_turbo_int8.safetensors",
        clip_name="lumina2_clip.safetensors",
        vae_name="ae.safetensors",
    )
    base.update(overrides)
    return zc.ZImageConfig(**base)


def test_load_config_none_without_comfyui_url(monkeypatch):
    monkeypatch.delenv("COMFYUI_URL", raising=False)
    monkeypatch.setenv("ZIMAGE_UNET_NAME", "x")
    monkeypatch.setenv("ZIMAGE_CLIP_NAME", "y")
    monkeypatch.setenv("ZIMAGE_VAE_NAME", "z")
    assert zc.load_config() is None


def test_load_config_none_without_weight_names(monkeypatch):
    monkeypatch.setenv("COMFYUI_URL", "http://100.74.48.83:8188")
    monkeypatch.delenv("ZIMAGE_UNET_NAME", raising=False)
    monkeypatch.delenv("ZIMAGE_CLIP_NAME", raising=False)
    monkeypatch.delenv("ZIMAGE_VAE_NAME", raising=False)
    assert zc.load_config() is None


def test_load_config_reads_env(monkeypatch):
    monkeypatch.setenv("COMFYUI_URL", "http://100.74.48.83:8188")
    monkeypatch.setenv("ZIMAGE_UNET_NAME", "unet.safetensors")
    monkeypatch.setenv("ZIMAGE_CLIP_NAME", "clip.safetensors")
    monkeypatch.setenv("ZIMAGE_VAE_NAME", "vae.safetensors")
    config = zc.load_config()
    assert config is not None
    assert config.unet_name == "unet.safetensors"
    assert config.comfyui.base_url == "http://100.74.48.83:8188"


def test_weights_available_true_when_filename_listed(monkeypatch):
    config = _zimage_config()

    def _get(url, timeout=None):
        assert url.endswith("/object_info/UNETLoader")
        return _FakeResponse(
            json_body={
                "UNETLoader": {
                    "input": {"required": {"unet_name": [["other.safetensors", config.unet_name]]}}
                }
            }
        )

    monkeypatch.setattr(httpx, "get", _get)
    assert zc.weights_available(config) is True


def test_weights_available_false_when_not_listed(monkeypatch):
    config = _zimage_config()
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, timeout=None: _FakeResponse(
            json_body={
                "UNETLoader": {"input": {"required": {"unet_name": [["other.safetensors"]]}}}
            }
        ),
    )
    assert zc.weights_available(config) is False


def test_weights_available_false_on_network_error(monkeypatch):
    config = _zimage_config()

    def _get(url, timeout=None):
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(httpx, "get", _get)
    assert zc.weights_available(config) is False


def test_weights_available_false_on_malformed_response(monkeypatch):
    config = _zimage_config()
    monkeypatch.setattr(httpx, "get", lambda url, timeout=None: _FakeResponse(json_body={}))
    assert zc.weights_available(config) is False


def test_generate_image_happy_path(monkeypatch):
    config = _zimage_config()

    captured = {}

    def _fake_submit_and_wait(comfyui_config, workflow, *, on_tick=None, **kwargs):
        captured["workflow"] = workflow
        return {"outputs": {"10": {"images": [{"filename": "z_1.png", "subfolder": ""}]}}}

    monkeypatch.setattr(cc, "submit_and_wait_with_retry", _fake_submit_and_wait)
    monkeypatch.setattr(
        cc, "fetch_view", lambda comfyui_config, filename, subfolder="": b"\x89PNGdata"
    )

    result = zc.generate_image(config, "дракон-брелок, вид спереди", seed=42, filename_prefix="zg1")

    assert result == b"\x89PNGdata"
    ksampler = captured["workflow"]["8"]["inputs"]
    assert ksampler["seed"] == 42
    assert ksampler["steps"] == zc.ZIMAGE_STEPS
    assert ksampler["cfg"] == zc.ZIMAGE_CFG
    assert ksampler["sampler_name"] == zc.ZIMAGE_SAMPLER_NAME
    assert captured["workflow"]["6"]["inputs"]["shift"] == zc.ZIMAGE_MODEL_SHIFT
    assert captured["workflow"]["2"]["inputs"]["type"] == "lumina2"


def test_generate_image_raises_generation_error_when_no_output(monkeypatch):
    config = _zimage_config()
    monkeypatch.setattr(
        cc, "submit_and_wait_with_retry", lambda *a, **kw: {"outputs": {"10": {"images": []}}}
    )
    with pytest.raises(GenerationError, match="zimage"):
        zc.generate_image(config, "prompt", seed=1, filename_prefix="p")


def test_generate_image_wraps_comfyui_error(monkeypatch):
    config = _zimage_config()

    def _raise(*a, **kw):
        raise cc.ComfyUIInvalidResponseError("граф отклонён")

    monkeypatch.setattr(cc, "submit_and_wait_with_retry", _raise)
    with pytest.raises(GenerationError, match="граф отклонён"):
        zc.generate_image(config, "prompt", seed=1, filename_prefix="p")
