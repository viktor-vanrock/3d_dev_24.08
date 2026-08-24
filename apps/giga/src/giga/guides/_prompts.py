"""Загрузчик системного промпта черновика гайда из `prompts/*.md`.

Паттерн — `giga.catalog._prompts`: промпт живёт файлом в репо («промпты —
это код»), правки видны в диффе отдельно от кода экстрактора.
"""

from __future__ import annotations

from functools import cache
from pathlib import Path

_PROMPTS_DIR = Path(__file__).parent / "prompts"


@cache
def load_draft_prompt() -> str:
    return (_PROMPTS_DIR / "build_draft.system.md").read_text(encoding="utf-8").strip()
