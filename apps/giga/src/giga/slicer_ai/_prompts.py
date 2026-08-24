"""Загрузчик системного промпта AI-дельт из `slicer_ai/prompts/*.md` — тот же
паттерн, что `giga.branches._prompts` (правило зоны AI: «Промпты — это код»)."""

from __future__ import annotations

from functools import cache
from pathlib import Path

_PROMPTS_DIR = Path(__file__).parent / "prompts"


@cache
def load_delta_system_prompt() -> str:
    return (_PROMPTS_DIR / "delta.system.md").read_text(encoding="utf-8").strip()
