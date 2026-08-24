"""Fetch/adapter на источник (MF-644, `docs/epics/domain.model.md` § 3 п.1):
RSS/Atom-фид вендор-ньюсрума → список статей с очищенным от разметки текстом.

Структурный парсер XML (не LLM) — фид уже даёт заголовок/ссылку/дату
структурно, LLM-экстракции (см. `extract.py`) требует только тело статьи,
которое внутри фида остаётся свободным HTML-текстом.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

import httpx

from .sources import Source

_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")
_TIMEOUT_SECONDS = 15.0
_USER_AGENT = "Mozilla/5.0 (compatible; 3mf-tech-calendar-agent/1.0; +https://3mf.tech)"
_ATOM_NS = "{http://www.w3.org/2005/Atom}"
_CONTENT_ENCODED_TAG = "{http://purl.org/rss/1.0/modules/content/}encoded"

_HTML_ENTITIES = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#8217;": "'",
    "&#8216;": "'",
    "&#8211;": "-",
    "&#8212;": "-",
    "&nbsp;": " ",
}


@dataclass(frozen=True)
class Article:
    source_id: str
    vendor_slug: str
    vendor_name: str
    title: str
    url: str
    published_at: datetime | None
    text: str


def strip_html(raw: str) -> str:
    """Грубая очистка HTML-фрагмента фида (заголовок/описание) до текста."""
    without_tags = _TAG_RE.sub(" ", raw)
    for entity, replacement in _HTML_ENTITIES.items():
        without_tags = without_tags.replace(entity, replacement)
    return _WHITESPACE_RE.sub(" ", without_tags).strip()


def fetch_articles(source: Source, *, limit: int = 20) -> list[Article]:
    """Тянет фид источника по сети, отдаёт до `limit` последних статей."""
    response = httpx.get(
        source.feed_url,
        timeout=_TIMEOUT_SECONDS,
        headers={"User-Agent": _USER_AGENT},
        follow_redirects=True,
    )
    response.raise_for_status()
    return parse_feed(source, response.text, limit=limit)


def parse_feed(source: Source, xml_text: str, *, limit: int = 20) -> list[Article]:
    """Разбирает RSS 2.0 (`<item>`) или Atom (`<entry>`) в список статей."""
    root = ElementTree.fromstring(xml_text)
    items = root.findall(".//item")
    if not items:
        items = root.findall(f".//{_ATOM_NS}entry")

    articles: list[Article] = []
    for item in items[:limit]:
        title = _child_text(item, "title") or _child_text(item, f"{_ATOM_NS}title")
        link = _child_text(item, "link") or _atom_link(item)
        if not title or not link:
            continue
        summary = (
            _child_text(item, _CONTENT_ENCODED_TAG)
            or _child_text(item, "description")
            or _child_text(item, f"{_ATOM_NS}summary")
            or ""
        )
        published_raw = _child_text(item, "pubDate") or _child_text(item, f"{_ATOM_NS}published")
        articles.append(
            Article(
                source_id=source.id,
                vendor_slug=source.vendor_slug,
                vendor_name=source.vendor_name,
                title=strip_html(title),
                url=link.strip(),
                published_at=_parse_date(published_raw),
                text=strip_html(summary),
            )
        )
    return articles


def _child_text(item: ElementTree.Element, tag: str) -> str | None:
    el = item.find(tag)
    return el.text if el is not None and el.text else None


def _atom_link(item: ElementTree.Element) -> str | None:
    el = item.find(f"{_ATOM_NS}link")
    return el.get("href") if el is not None else None


def _parse_date(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
