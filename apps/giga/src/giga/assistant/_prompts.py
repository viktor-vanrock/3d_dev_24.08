"""Загрузчик системного промпта роутера из `assistant/prompts/*.md` — тот же
паттерн, что `giga.branches._prompts`/`giga.slicer_ai._prompts` (правило зоны
AI: «Промпты — это код»)."""

from __future__ import annotations

from functools import cache
from pathlib import Path

_PROMPTS_DIR = Path(__file__).parent / "prompts"


@cache
def load_router_system_prompt() -> str:
    return (_PROMPTS_DIR / "router.system.md").read_text(encoding="utf-8").strip()
