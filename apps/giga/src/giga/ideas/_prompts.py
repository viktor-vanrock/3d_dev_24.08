"""Загрузчик системного промпта обогащения идеи из `prompts/*.md`.

Паттерн — `giga.guides._prompts`/`giga.catalog._prompts`: промпт живёт файлом
в репо («промпты — это код»), правки видны в диффе отдельно от кода экстрактора.
"""

from __future__ import annotations

from functools import cache
from pathlib import Path

_PROMPTS_DIR = Path(__file__).parent / "prompts"


@cache
def load_enrich_prompt() -> str:
    return (_PROMPTS_DIR / "enrich.system.md").read_text(encoding="utf-8").strip()
