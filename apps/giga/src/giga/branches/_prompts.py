"""Загрузчик системных промптов веток генерации из `branches/prompts/*.md`.

Промпты — файлы в репо (правило зоны AI: «Промпты — это код»), не строковые
константы посреди логики ветки — правки промпта видно в диффе отдельно от
кода исполнителя, ревьюятся как обычный текст.
"""

from __future__ import annotations

from functools import cache
from pathlib import Path

_PROMPTS_DIR = Path(__file__).parent / "prompts"


@cache
def load_system_prompt(name: str) -> str:
    """Читает `branches/prompts/{name}.system.md`, кэширует в памяти процесса."""
    return (_PROMPTS_DIR / f"{name}.system.md").read_text(encoding="utf-8").strip()
