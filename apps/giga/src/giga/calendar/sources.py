"""Источники календаря релизов (MF-644, `docs/epics/domain.model.md` § 2).

Один источник = RSS/Atom-фид вендор-ньюсрума, не сырая вёрстка страницы:
вендоры публикуют фид специально для машинного чтения, это легальнее
произвольного HTML-скрейпинга (см. эпик MF-32 § «Юридика/ToS источников») и
переживает редизайн сайта. Текст статьи внутри фида всё равно свободный —
LLM-экстрактор (`extract.py`) работает как задумано пайплайном.

`vendor_slug`/`vendor_name` соответствуют канону `vendors` (см. `VENDOR_ALIASES`
в `apps/api/scripts/import-machines-bootstrap.ts`) — те же вендоры, тот же
slug, календарь и каталог станков ссылаются на одну строку `vendors`.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Source:
    id: str
    vendor_slug: str
    vendor_name: str
    feed_url: str


SOURCES: list[Source] = [
    Source(
        id="prusa-blog",
        vendor_slug="prusa-research",
        vendor_name="Prusa Research",
        feed_url="https://blog.prusa3d.com/feed/",
    ),
]


def get_source(source_id: str) -> Source | None:
    return next((s for s in SOURCES if s.id == source_id), None)
