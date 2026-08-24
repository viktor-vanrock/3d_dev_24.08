"""Снимает markdown-разметку с `models.description` перед эмбеддингом.

Парсим тем же GFM-подмножеством, что описано в
`docs/design/projects.multiformat.md` §3.4 (заголовки, списки, таблицы,
код, ссылки/картинки, цитаты, зачёркивание, автолинки) — рендерер и
индексатор должны понимать разметку одинаково, иначе "снимаем разметку"
для поиска и "рендерим разметку" для страницы разъедутся.

Решения, не очевидные из кода:
- Содержимое блоков кода (```...```) отбрасывается целиком, а не только
  ограждение — код не естественный язык и только шумит в эмбеддинге
  описания. Инлайн-код (`x`) — короткие идентификаторы (материалы,
  профили печати) часто несут смысл для поиска, оставляем текст без
  обратных кавычек.
- У ссылок/картинок в индекс идёт видимый текст/alt, URL отбрасывается.
  Автолинк без текста (`<https://...>`) — текст равен самому URL,
  такой "текст" для семантики бесполезен, тоже отбрасывается.
- Raw HTML (`html_inline`/`html_block` токены) не транслируется в индекс
  вовсе — описание не исполняется и не должно попадать в индекс как
  разметка; безопасность рендера (санитайзер на клиенте) — отдельный
  контракт (projects.multiformat.md §3.4), здесь просто не место для тегов.
"""

from __future__ import annotations

import re

from markdown_it import MarkdownIt
from markdown_it.token import Token
from mdit_py_plugins.gfm import gfm_plugin

_MD = MarkdownIt("commonmark").use(gfm_plugin)

_WHITESPACE_RE = re.compile(r"\s+")

_TEXT_LIKE_TYPES = frozenset({"text", "code_inline"})
_BREAK_TYPES = frozenset({"softbreak", "hardbreak"})


def strip_markdown(text: str) -> str:
    """Возвращает текст без markdown-синтаксиса, готовый к эмбеддингу.

    Пустой/пробельный вход → пустая строка (пустое описание — не ошибка).
    """
    if not text or not text.strip():
        return ""

    chunks: list[str] = []
    for token in _MD.parse(text):
        if token.type != "inline" or not token.children:
            continue
        chunk = _inline_text(token.children).strip()
        if chunk:
            chunks.append(chunk)

    return _WHITESPACE_RE.sub(" ", " ".join(chunks)).strip()


def _inline_text(children: list[Token]) -> str:
    """Склеивает текст инлайн-токенов одного блока (абзаца/ячейки/заголовка).

    Ссылки собираются в отдельный буфер, чтобы отличить автолинк
    (текст == href, отбрасывается) от осмысленного текста ссылки.
    """
    parts: list[str] = []
    link_href: str | None = None
    link_buf: list[str] | None = None

    def emit(value: str) -> None:
        if link_buf is not None:
            link_buf.append(value)
        else:
            parts.append(value)

    for child in children:
        if child.type == "link_open":
            link_href = (child.attrGet("href") or "").strip()
            link_buf = []
        elif child.type == "link_close":
            link_text = "".join(link_buf or "").strip()
            if link_text and link_text != link_href:
                parts.append(link_text)
            link_href, link_buf = None, None
        elif child.type == "image":
            emit(child.content or "")
        elif child.type in _TEXT_LIKE_TYPES:
            emit(child.content)
        elif child.type in _BREAK_TYPES:
            emit(" ")
        # strong_open/close, em_open/close, s_open/close, html_inline и т.п. —
        # не несут собственного текста (или намеренно не индексируются), пропуск.

    return "".join(parts)
