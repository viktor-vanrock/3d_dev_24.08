"""Тесты ветки trellis — OpenRouter и ComfyUI замокан на уровне
`openrouter_client.generate_image`/`comfyui_client.*` (тот же приём, что
`test_branches_kzd.py`/`test_branches_openscad.py`), без реальной сети."""

from __future__ import annotations

import io

import pytest
import trimesh

from giga import openrouter_client
from giga.branches import comfyui_client, zimage_client
from giga.branches.base import GenerationError, GenerationJob
from giga.branches.trellis import run_trellis


def _job(prompt="дракон-брелок", params=None) -> GenerationJob:
    return GenerationJob(
        id="11111111-2222-3333-4444-555555555555",
        branch="trellis",
        prompt=prompt,
        params=params or {},
    )


def _watertight_glb() -> bytes:
    return trimesh.creation.box(extents=(1.0, 1.0, 1.0)).export(file_type="glb")


def _non_watertight_glb() -> bytes:
    box = trimesh.creation.box(extents=(1.0, 1.0, 1.0))
    box.faces = box.faces[:-1]  # выкидываем одну грань — меш больше не watertight
    box.remove_unreferenced_vertices()
    return box.export(file_type="glb")


def _patch_pipeline(monkeypatch, glb_bytes: bytes) -> None:
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())
    monkeypatch.setattr(openrouter_client, "generate_image", lambda config, prompt: b"\x89PNGfake")
    monkeypatch.setenv("COMFYUI_URL", "http://100.74.48.83:8188")
    monkeypatch.setattr(comfyui_client, "upload_image", lambda config, content, ct: "giga_abc.png")
    monkeypatch.setattr(comfyui_client, "submit_prompt", lambda config, workflow: "prompt-1")
    monkeypatch.setattr(
        comfyui_client, "wait_for_completion", lambda config, prompt_id, on_tick=None: {}
    )
    monkeypatch.setattr(
        comfyui_client,
        "locate_export",
        lambda config, **kwargs: glb_bytes,
    )


def test_run_trellis_without_openrouter_key_raises(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_config", lambda: None)
    with pytest.raises(GenerationError, match="OPENROUTER_API_KEY"):
        run_trellis(_job())


def test_run_trellis_without_comfyui_url_raises(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())
    monkeypatch.setattr(openrouter_client, "generate_image", lambda config, prompt: b"\x89PNGfake")
    monkeypatch.delenv("COMFYUI_URL", raising=False)
    with pytest.raises(GenerationError, match="COMFYUI_URL"):
        run_trellis(_job())


def test_run_trellis_degrades_gracefully_when_side_views_fail(monkeypatch):
    """Front обязателен, back/left — best-effort: сбой одного из них не
    должен ронять весь job, граф просто соберётся из меньшего числа ракурсов."""
    _patch_pipeline(monkeypatch, _watertight_glb())

    calls = {"n": 0}

    def _flaky_generate(config, prompt):
        calls["n"] += 1
        if "Вид сбоку" in prompt:
            raise GenerationError("OpenRouter: 500 upstream")
        return b"\x89PNGfake"

    monkeypatch.setattr(openrouter_client, "generate_image", _flaky_generate)

    uploaded_names: list[str] = []
    monkeypatch.setattr(
        comfyui_client,
        "upload_image",
        lambda config, content, ct: uploaded_names.append(content) or "giga_abc.png",
    )

    result = run_trellis(_job())

    assert result.artifact_ext == "stl"
    # front + back успели, left — упал и пропущен: два upload, не три.
    assert len(uploaded_names) == 2


def test_run_trellis_raises_when_front_view_fails(monkeypatch):
    """Front — единственный обязательный ракурс, без него нечего собирать."""
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())
    monkeypatch.setenv("COMFYUI_URL", "http://100.74.48.83:8188")

    def _always_fail(config, prompt):
        raise GenerationError("OpenRouter: 500 upstream")

    monkeypatch.setattr(openrouter_client, "generate_image", _always_fail)

    with pytest.raises(GenerationError, match="вид спереди"):
        run_trellis(_job())


def test_run_trellis_watertight_mesh_yields_printable_stl(monkeypatch):
    _patch_pipeline(monkeypatch, _watertight_glb())

    result = run_trellis(_job(params={"target_size_mm": 50}))

    assert result.artifact_ext == "stl"
    assert result.artifact_content_type == "model/stl"
    mesh = trimesh.load(io.BytesIO(result.artifact_bytes), file_type="stl", force="mesh")
    assert mesh.is_watertight
    assert abs(float(mesh.extents.max()) - 50) < 1e-6

    assert result.preview_ext == "glb"
    assert result.preview_content_type == "model/gltf-binary"


def test_run_trellis_non_watertight_mesh_is_honest_preview_only(monkeypatch):
    _patch_pipeline(monkeypatch, _non_watertight_glb())

    result = run_trellis(_job())

    assert result.artifact_ext == "glb"
    assert result.artifact_content_type == "model/gltf-binary"
    assert result.preview_bytes is None  # артефакт уже и есть превью, не дублируем


def test_run_trellis_rejects_non_glb_bytes(monkeypatch):
    _patch_pipeline(monkeypatch, b"not a glb file at all")
    with pytest.raises(GenerationError, match="GLB"):
        run_trellis(_job())


def test_run_trellis_clamps_target_size_to_bounds(monkeypatch):
    _patch_pipeline(monkeypatch, _watertight_glb())

    result = run_trellis(_job(params={"target_size_mm": 99999}))
    mesh = trimesh.load(io.BytesIO(result.artifact_bytes), file_type="stl", force="mesh")
    assert abs(float(mesh.extents.max()) - 300.0) < 1e-6  # верхняя граница


def test_run_trellis_ignores_bogus_target_size_param(monkeypatch):
    _patch_pipeline(monkeypatch, _watertight_glb())

    result = run_trellis(_job(params={"target_size_mm": "не число"}))
    mesh = trimesh.load(io.BytesIO(result.artifact_bytes), file_type="stl", force="mesh")
    assert abs(float(mesh.extents.max()) - 80.0) < 1e-6  # дефолт


def test_run_trellis_reports_phases_including_ticks_during_wait(monkeypatch):
    _patch_pipeline(monkeypatch, _watertight_glb())

    # wait_for_completion зовёт on_tick сама (MF-2001) — переопределяем мок так, чтобы
    # он реально вызвал колбэк пару раз, как настоящий поллинг-цикл comfyui_client.
    def _fake_wait(config, prompt_id, on_tick=None):
        if on_tick is not None:
            on_tick(1.0)
            on_tick(2.0)
        return {}

    monkeypatch.setattr(comfyui_client, "wait_for_completion", _fake_wait)

    reported: list[tuple] = []

    def _report(phase, progress, *, eta_seconds=None):
        reported.append((phase, progress, eta_seconds))

    run_trellis(_job(), _report)

    # Тот же словарь фаз, что packages/contracts/http/assistant.ts::RUN_PHASES
    # (queued/loading/draft/geometry/validation/export) — trellis не использует
    # queued/draft (queued — уровень generations.status, не внутренняя фаза).
    phases = [p for p, _prog, _eta in reported]
    assert phases == [
        "loading",
        "loading",
        "loading",
        "geometry",
        "geometry",
        "validation",
        "export",
    ]
    # geometry-тики монотонно растут по progress, пока идёт ожидание
    geometry_progress = [prog for phase, prog, _eta in reported if phase == "geometry"]
    assert geometry_progress[1] >= geometry_progress[0]
    assert reported[0] == ("loading", 5, 240)
    assert reported[1] == ("loading", 15, 150)


def test_run_trellis_propagates_comfyui_error(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_config", lambda: object())
    monkeypatch.setattr(openrouter_client, "generate_image", lambda config, prompt: b"\x89PNGfake")
    monkeypatch.setenv("COMFYUI_URL", "http://100.74.48.83:8188")
    monkeypatch.setattr(comfyui_client, "upload_image", lambda config, content, ct: "giga_abc.png")

    def _raise(config, workflow):
        raise comfyui_client.ComfyUIInvalidResponseError("граф отклонён")

    monkeypatch.setattr(comfyui_client, "submit_prompt", _raise)

    with pytest.raises(GenerationError, match="граф отклонён"):
        run_trellis(_job())


def _patch_zimage_ready(monkeypatch, generate_image) -> None:
    monkeypatch.setattr(zimage_client, "load_config", lambda: object())
    monkeypatch.setattr(zimage_client, "weights_available", lambda config: True)
    monkeypatch.setattr(zimage_client, "generate_image", generate_image)


def test_run_trellis_prefers_zimage_over_openrouter(monkeypatch):
    """Z-Image-Turbo (self-hosted) — предпочтительный провайдер (MF-2067,
    cost); OpenRouter не должен звонить, если zimage готов и справляется."""
    _patch_pipeline(monkeypatch, _watertight_glb())

    or_calls = {"n": 0}
    monkeypatch.setattr(
        openrouter_client,
        "generate_image",
        lambda config, prompt: or_calls.__setitem__("n", or_calls["n"] + 1) or b"\x89PNGfake",
    )
    _patch_zimage_ready(
        monkeypatch, lambda config, prompt, *, seed, filename_prefix: b"\x89PNGzimage"
    )

    result = run_trellis(_job())

    assert result.artifact_ext == "stl"
    assert or_calls["n"] == 0  # zimage покрыл все три ракурса — OpenRouter не звался


def test_run_trellis_falls_back_to_openrouter_when_zimage_not_ready(monkeypatch):
    """Веса Z-Image ещё не докачаны (`weights_available` честно False) —
    деградация на OpenRouter, не попытка вызвать zimage вслепую."""
    _patch_pipeline(monkeypatch, _watertight_glb())
    monkeypatch.setattr(zimage_client, "load_config", lambda: object())
    monkeypatch.setattr(zimage_client, "weights_available", lambda config: False)

    def _should_not_be_called(*args, **kwargs):
        raise AssertionError("zimage.generate_image не должен зваться без weights_available")

    monkeypatch.setattr(zimage_client, "generate_image", _should_not_be_called)

    result = run_trellis(_job())
    assert result.artifact_ext == "stl"


def test_run_trellis_degrades_to_openrouter_when_zimage_call_fails(monkeypatch):
    """Z-Image готов по `weights_available`, но конкретный вызов графа упал —
    честная деградация на OpenRouter для этого ракурса, не пропуск/крах."""
    _patch_pipeline(monkeypatch, _watertight_glb())

    or_calls = {"n": 0}
    monkeypatch.setattr(
        openrouter_client,
        "generate_image",
        lambda config, prompt: or_calls.__setitem__("n", or_calls["n"] + 1) or b"\x89PNGfake",
    )

    def _zimage_fails(config, prompt, *, seed, filename_prefix):
        raise GenerationError("zimage: ComfyUI граф отклонён")

    _patch_zimage_ready(monkeypatch, _zimage_fails)

    result = run_trellis(_job())

    assert result.artifact_ext == "stl"
    assert or_calls["n"] == 3  # front+back+left — все три деградировали на OpenRouter


def test_run_trellis_retries_multiview_workflow_once_on_oom(monkeypatch):
    """TRELLIS.2-этап (не только view-генерация) тоже получает bounded OOM
    retry — карточка MF-2067: делёж RTX 3090 #2 между Z-Image-Turbo и
    TRELLIS.2."""
    _patch_pipeline(monkeypatch, _watertight_glb())
    monkeypatch.setattr(comfyui_client, "COMFYUI_OOM_RETRY_BACKOFF_SECONDS", 0.0)

    calls = {"n": 0}

    def _flaky_wait(config, prompt_id, on_tick=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise comfyui_client.ComfyUIResourceExhaustedError("OOM")
        return {}

    monkeypatch.setattr(comfyui_client, "wait_for_completion", _flaky_wait)

    result = run_trellis(_job())

    assert result.artifact_ext == "stl"
    assert calls["n"] == 2  # первая попытка — OOM, вторая — успех
