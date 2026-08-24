"""Сборка индексируемого текста модели — 1:1 порт `apps/api/src/models/indexText.ts::
buildModelIndexText` (docs/contracts/model.index.v1.md § «Открыто» п.3: адаптер читает
готовое title+description+tags и собирает документ так же, как продюсер, чтобы не заводить
второй несовпадающий формат текста под ту же identity).

Не самоцель побайтового совпадения с `text_sha256` продюсера (worker.py сверяет job.text_sha256
с уже СОХРАНЁННЫМ хэшем в model_embeddings, не пересчитывает наш текст) — расхождение в порядке
тегов между продюсером и этим модулем не ломает корректность, только чуть чаще шлёт запрос в
HYPERPC, чем строго необходимо (CLAUDE.md § «СТОИМОСТЬ»). Тем не менее совпадение по построению
(включая `order by t.name` — тот же порядок, что `apps/api/src/models/tags.ts::tagsForModels`)
минимизирует эти лишние пересчёты.
"""

from __future__ import annotations

import re

CHARS_PER_TOKEN_ESTIMATE = 2.5
DEFAULT_MAX_INDEX_TOKENS = 3000

_MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_MARKDOWN_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_MARKDOWN_HEADING_RE = re.compile(r"^#{1,6}\s+", re.MULTILINE)
_MARKDOWN_EMPHASIS_RE = re.compile(r"[*_`~]+")
_BLANK_LINES_RE = re.compile(r"\n{3,}")


def _strip_markdown(text: str) -> str:
    text = _MARKDOWN_IMAGE_RE.sub(r"\1", text)
    text = _MARKDOWN_LINK_RE.sub(r"\1", text)
    text = _MARKDOWN_HEADING_RE.sub("", text)
    text = _MARKDOWN_EMPHASIS_RE.sub("", text)
    text = text.replace("\r\n", "\n")
    text = _BLANK_LINES_RE.sub("\n\n", text)
    return text.strip()


def _truncate_to_token_limit(text: str, max_tokens: int) -> str:
    max_chars = int(max_tokens * CHARS_PER_TOKEN_ESTIMATE)
    if len(text) <= max_chars:
        return text
    # Режем по границе слова, чтобы не отдавать в эмбеддинг обрубленный на середине токен.
    cut = text[:max_chars]
    last_space = cut.rfind(" ")
    return (cut[:last_space] if last_space > 0 else cut).strip()


def build_model_index_text(
    title: str,
    description: str | None,
    tags: list[str],
    *,
    max_tokens: int = DEFAULT_MAX_INDEX_TOKENS,
) -> str:
    """Детерминированная сборка: для одного и того же входа всегда один и тот же документ."""
    title_clean = title.strip()
    description_clean = _strip_markdown(description) if description else ""
    tags_clean = [tag.strip() for tag in tags if tag.strip()]

    parts = [part for part in (title_clean, description_clean, ", ".join(tags_clean)) if part]
    document = "\n\n".join(parts)

    return _truncate_to_token_limit(document, max_tokens)
