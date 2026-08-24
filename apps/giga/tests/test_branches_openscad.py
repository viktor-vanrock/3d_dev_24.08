"""Тесты ветки openscad — OpenRouter замокан (не тратим деньги на провайдера в
тестах, зона-принцип «без ключа живём»), рендер и валидация меша реальные
(нужен системный бинарник `openscad`, см. `apps/giga/CLAUDE.md`/README —
на CI/VDS ставится как apt-пакет).
"""

from __future__ import annotations

import io
import shutil

import pytest

from giga import openrouter_client
from giga.branches.base import GenerationError, GenerationJob
from giga.branches.openscad import run_openscad

_CUBE_SCRIPT = """Вот скрипт:

```openscad
cube([20, 20, 20]);
```
"""

_BROKEN_SCRIPT = """```openscad
cube([20, 20, 20]
```
"""

requires_openscad = pytest.mark.skipif(
    shutil.which("openscad") is None,
    reason="system OpenSCAD binary is required for real render tests",
)


def _job(prompt="кубик 20мм", params=None) -> GenerationJob:
    return GenerationJob(id="gen-1", branch="openscad", prompt=prompt, params=params or {})


def test_run_openscad_without_credentials_raises(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_text_config", lambda: None)
    with pytest.raises(GenerationError, match="OPENROUTER_API_KEY"):
        run_openscad(_job())


def test_run_openscad_without_binary_raises(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_text_config", lambda: object())
    monkeypatch.setattr("giga.branches.openscad.shutil.which", lambda name: None)
    with pytest.raises(GenerationError, match="openscad"):
        run_openscad(_job())


@requires_openscad
def test_run_openscad_success_produces_valid_stl(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_text_config", lambda: object())
    monkeypatch.setattr(
        openrouter_client, "generate_text", lambda config, system, user: _CUBE_SCRIPT
    )

    result = run_openscad(_job())

    assert result.artifact_ext == "stl"
    assert result.artifact_content_type == "model/stl"
    assert result.artifact_bytes
    assert result.preview_bytes is None

    import trimesh

    mesh = trimesh.load(io.BytesIO(result.artifact_bytes), file_type="stl")
    assert not mesh.is_empty
    assert mesh.is_watertight


@requires_openscad
def test_run_openscad_retries_once_after_compile_error(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_text_config", lambda: object())
    responses = iter([_BROKEN_SCRIPT, _CUBE_SCRIPT])
    seen_prompts = []

    def _fake_generate_text(config, system, user):
        seen_prompts.append(user)
        return next(responses)

    monkeypatch.setattr(openrouter_client, "generate_text", _fake_generate_text)

    result = run_openscad(_job())

    assert result.artifact_ext == "stl"
    assert len(seen_prompts) == 2
    assert "Предыдущая попытка" in seen_prompts[1]


@requires_openscad
def test_run_openscad_gives_up_after_second_failure(monkeypatch):
    monkeypatch.setattr(openrouter_client, "load_text_config", lambda: object())
    monkeypatch.setattr(
        openrouter_client, "generate_text", lambda config, system, user: _BROKEN_SCRIPT
    )

    with pytest.raises(GenerationError):
        run_openscad(_job())
