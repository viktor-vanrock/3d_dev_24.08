"""Ветка openscad (MF-352): текст → OpenSCAD-код → рендер OpenSCAD → валидный меш.

Поток: просим LLM сгенерировать OpenSCAD-код, рендерим его headless-CLI
`openscad` в STL, проверяем результат `trimesh` (непустой/watertight/габарит
стола). Ошибка компиляции или невалидный меш → один авто-ретрай с текстом
ошибки, переданным обратно модели (просим исправить именно её). Вторая
неудача — `GenerationError`, воркер переводит job в `status=error` с логом,
не падает (см. `worker.process_one`).

Текстовый шаг — OpenRouter (`openrouter_client.generate_text`), не GigaChat:
`GIGACHAT_CREDENTIALS` не сконфигурирован ни в проде, ни на dev (тот же
вывод, что уже привёл kzd/hueforge/trellis на OpenRouter для картиночного
шага, см. `openrouter_client.py`) — GigaChat в этом окружении никогда не
работал, а не деградировал.

3MF-упаковка (сборки/цвет/производственные метаданные) — зона Mesh
(`docs/architecture/readme.md`), здесь намеренно отдаём только STL.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import trimesh

from .. import openrouter_client
from ._prompts import load_system_prompt
from .base import NOOP_REPORTER, GenerationError, GenerationJob, GenerationResult, ProgressReporter

_CODE_FENCE_RE = re.compile(r"```(?:openscad|scad)?\s*\n(.*?)```", re.DOTALL)
_RENDER_TIMEOUT_SECONDS = 60
# Печатный габарит настольного принтера — грубая верхняя граница для sanity-check,
# не привязана к конкретной модели принтера каталога (это зона Mesh/каталога).
_MAX_DIMENSION_MM = 400.0


def _extract_scad_code(response: str) -> str:
    match = _CODE_FENCE_RE.search(response)
    code = (match.group(1) if match else response).strip()
    if not code:
        raise GenerationError("GigaChat вернул пустой OpenSCAD-скрипт")
    return code


def _render_stl(scad_code: str, workdir: Path) -> Path:
    scad_path = workdir / "model.scad"
    stl_path = workdir / "model.stl"
    scad_path.write_text(scad_code, encoding="utf-8")
    try:
        result = subprocess.run(
            ["openscad", "-o", str(stl_path), str(scad_path)],
            capture_output=True,
            text=True,
            timeout=_RENDER_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise GenerationError(f"openscad: таймаут рендера ({_RENDER_TIMEOUT_SECONDS}с)") from exc
    if result.returncode != 0 or not stl_path.exists():
        detail = result.stderr.strip() or result.stdout.strip() or "нет вывода"
        raise GenerationError(f"openscad: ошибка компиляции: {detail}")
    return stl_path


def _validate_mesh(stl_path: Path) -> bytes:
    try:
        mesh = trimesh.load(stl_path, force="mesh")
    except Exception as exc:  # noqa: BLE001 — любой сбой парсинга STL = невалидный меш
        raise GenerationError(f"openscad: не удалось прочитать STL: {exc}") from exc
    if mesh.is_empty:
        raise GenerationError("openscad: сгенерированный меш пустой")
    if not mesh.is_watertight:
        raise GenerationError("openscad: меш не watertight (не годится для печати)")
    max_extent = float(mesh.extents.max())
    if max_extent > _MAX_DIMENSION_MM:
        raise GenerationError(
            f"openscad: модель превышает габарит стола "
            f"({max_extent:.1f}мм > {_MAX_DIMENSION_MM:.0f}мм)"
        )
    return stl_path.read_bytes()


def _generate_once(
    config: openrouter_client.OpenRouterConfig,
    prompt: str,
    params: dict,
    previous_error: str | None,
) -> bytes:
    system_prompt = load_system_prompt("openscad")
    user_prompt = f"Запрос: {prompt}\nПараметры (JSON): {json.dumps(params, ensure_ascii=False)}"
    if previous_error:
        user_prompt += f"\n\nПредыдущая попытка не скомпилировалась, ошибка:\n{previous_error}"
    response = openrouter_client.generate_text(config, system_prompt, user_prompt)
    scad_code = _extract_scad_code(response)
    with tempfile.TemporaryDirectory(prefix="giga-openscad-") as tmp:
        stl_path = _render_stl(scad_code, Path(tmp))
        return _validate_mesh(stl_path)


def run_openscad(job: GenerationJob, report: ProgressReporter = NOOP_REPORTER) -> GenerationResult:
    config = openrouter_client.load_text_config()
    if config is None:
        raise GenerationError("OpenRouter не сконфигурирован (OPENROUTER_API_KEY)")
    if shutil.which("openscad") is None:
        raise GenerationError("openscad не найден в PATH — нужна установка на VDS (пакет openscad)")

    try:
        stl_bytes = _generate_once(config, job.prompt, job.params, previous_error=None)
    except GenerationError as first_error:
        stl_bytes = _generate_once(config, job.prompt, job.params, previous_error=str(first_error))

    return GenerationResult(
        artifact_bytes=stl_bytes,
        artifact_ext="stl",
        artifact_content_type="model/stl",
    )
