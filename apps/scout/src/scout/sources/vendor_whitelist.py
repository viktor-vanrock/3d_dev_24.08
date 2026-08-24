"""Источник кандидатов «официальные страницы вендоров» (whitelist, MF-623).

Один вендор = `VendorProfile`: страница каталога (листинг) + regex, находящий
на ней ссылки на карточки товара. Карточка товара разбирается не парсингом
вёрстки (у современных SPA-каталогов классы — сгенерированные
styled-components хэши, меняются с каждым билдом фронта вендора), а через
`<script type="application/ld+json">` со schema.org `Product` — тот же
структурированный контракт, который вендор уже поддерживает для поисковиков
(проверено вручную на живом prusa3d.com 2026-07-09: карточка отдаёт валидный
`Product` с `name`/`description`/`image`/`offers`).

robots.txt уважаем безусловно: перед каждым фетчем (листинг и любая карточка)
проверяем `robots.txt` домена под нашим User-Agent (`urllib.robotparser`) —
запрет/недоступность правила трактуем консервативно (нет файла → разрешено,
файл есть и запрещает → пропускаем страницу, в обход не идём).

`content_hash` — sha256 стабильного (сортированные ключи) JSON карточки:
идемпотентный ре-ингест увидит реальное изменение (новая цена/описание), а
не шум порядка полей — см. `scout.db.upsert_machine_candidate`.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import date
from urllib.parse import urljoin
from urllib.robotparser import RobotFileParser

import httpx
import psycopg

from .. import db

SOURCE_ID = "vendor_whitelist"

_TIMEOUT_SECONDS = 15.0
_USER_AGENT = "Mozilla/5.0 (compatible; 3mf-tech-scout-agent/1.0; +https://3mf.tech)"
_DEFAULT_LIMIT = 50

logger = logging.getLogger("scout.sources.vendor_whitelist")


@dataclass(frozen=True)
class VendorProfile:
    vendor_slug: str
    vendor_name: str
    listing_url: str
    product_link_re: re.Pattern[str]
    jsonld_id: str = "product-jsonld"


# Prusa Research: листинг — SSR-страница категории (ссылки /product/<slug>/
# уже в исходной разметке, без выполнения JS), карточка товара несёт
# schema.org Product в script#product-jsonld. Единственная запись фазы 1 —
# тот же объём, что giga/calendar/sources.py стартовал с одного источника
# (blog.prusa3d.com); расширение списка — не в этой карте.
VENDOR_PROFILES: list[VendorProfile] = [
    VendorProfile(
        vendor_slug="prusa-research",
        vendor_name="Prusa Research",
        listing_url="https://www.prusa3d.com/en/3d-printers/",
        product_link_re=re.compile(r'href="(/product/[a-z0-9-]+/)"'),
    ),
]


@dataclass(frozen=True)
class ScrapedCandidate:
    external_ref: str
    source_url: str
    raw: dict
    # Оф. страницы товара обычно не несут дату анонса (это скорее для
    # блог/новостных источников, см. giga/calendar) — None здесь штатный
    # случай, release_events пишется только когда парсер-профиль его нашёл.
    announced_at: date | None


class RobotsDisallowed(Exception):
    """robots.txt домена запрещает нашему User-Agent эту страницу."""


def _robots_allowed(url: str) -> bool:
    target = httpx.URL(url)
    robots_url = f"{target.scheme}://{target.host}/robots.txt"
    parser = RobotFileParser()
    try:
        response = httpx.get(
            robots_url, timeout=_TIMEOUT_SECONDS, headers={"User-Agent": _USER_AGENT}
        )
        if response.status_code >= 400:
            return True  # нет robots.txt на домене — по умолчанию разрешено
        parser.parse(response.text.splitlines())
    except httpx.HTTPError:
        return True  # транзиентный сбой fetch robots.txt не должен блокировать прогон
    return parser.can_fetch(_USER_AGENT, url)


def _fetch(url: str) -> str:
    if not _robots_allowed(url):
        raise RobotsDisallowed(url)
    response = httpx.get(
        url, timeout=_TIMEOUT_SECONDS, headers={"User-Agent": _USER_AGENT}, follow_redirects=True
    )
    response.raise_for_status()
    return response.text


def discover_product_urls(profile: VendorProfile, html: str) -> list[str]:
    """Уникальные абсолютные URL карточек товара из HTML листинга, в порядке появления."""
    seen: dict[str, None] = {}
    for match in profile.product_link_re.finditer(html):
        seen[urljoin(profile.listing_url, match.group(1))] = None
    return list(seen)


def parse_product(profile: VendorProfile, url: str, html: str) -> ScrapedCandidate | None:
    """Разбирает карточку товара из schema.org Product JSON-LD.

    None — блок отсутствует или не парсится (карточка вне каталога станков,
    вендор поменял разметку и т.п.) — сбой одной карточки не должен ронять
    остальные, см. `scan_profile`.
    """
    pattern = re.compile(
        rf'<script type="application/ld\+json" id="{re.escape(profile.jsonld_id)}">(.*?)</script>',
        re.S,
    )
    match = pattern.search(html)
    if match is None:
        logger.warning(
            "%s: %s не содержит JSON-LD '%s' — пропуск", profile.vendor_slug, url, profile.jsonld_id
        )
        return None
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        logger.warning("%s: %s — битый JSON-LD: %s", profile.vendor_slug, url, exc)
        return None

    name = data.get("name")
    if not name:
        return None

    raw = {
        "vendor_slug": profile.vendor_slug,
        "vendor_name": profile.vendor_name,
        "model_name": name,
        "description": data.get("description"),
        "image": data.get("image"),
        "offers": data.get("offers"),
        "url": url,
    }
    return ScrapedCandidate(external_ref=url, source_url=url, raw=raw, announced_at=None)


def content_hash(raw: dict) -> bytes:
    canonical = json.dumps(raw, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).digest()


def scan_profile(profile: VendorProfile, *, limit: int = _DEFAULT_LIMIT) -> list[ScrapedCandidate]:
    """Один прогон одного вендора: листинг → до `limit` карточек → кандидаты.

    Сбой листинга (сеть/robots) отменяет весь вендор; сбой отдельной карточки
    — только её, остальные карточки всё равно обрабатываются (best-effort на
    уровне товара, тот же принцип, что giga.calendar.run._run на уровне статьи).
    """
    try:
        listing_html = _fetch(profile.listing_url)
    except RobotsDisallowed:
        logger.warning(
            "%s: листинг %s запрещён robots.txt — пропуск вендора",
            profile.vendor_slug,
            profile.listing_url,
        )
        return []
    except httpx.HTTPError as exc:
        logger.error(
            "%s: листинг %s не загрузился: %s", profile.vendor_slug, profile.listing_url, exc
        )
        return []

    candidates: list[ScrapedCandidate] = []
    for url in discover_product_urls(profile, listing_html)[:limit]:
        try:
            html = _fetch(url)
        except RobotsDisallowed:
            logger.warning(
                "%s: карточка %s запрещена robots.txt — пропуск", profile.vendor_slug, url
            )
            continue
        except httpx.HTTPError as exc:
            logger.warning("%s: карточка %s не загрузилась: %s", profile.vendor_slug, url, exc)
            continue

        candidate = parse_product(profile, url, html)
        if candidate is not None:
            candidates.append(candidate)
    return candidates


def ingest_profile(
    conn: psycopg.Connection, profile: VendorProfile, *, limit: int = _DEFAULT_LIMIT
) -> dict[str, int]:
    """Прогон одного вендора с записью в БД. Возвращает счётчики прогона —
    та же форма лога, что `giga.calendar.run._run`."""
    counters = {"found": 0, "inserted": 0, "updated": 0, "unchanged": 0, "events": 0}
    for candidate in scan_profile(profile, limit=limit):
        counters["found"] += 1
        outcome = db.upsert_machine_candidate(
            conn,
            source=SOURCE_ID,
            source_url=candidate.source_url,
            external_ref=candidate.external_ref,
            raw=candidate.raw,
            content_hash=content_hash(candidate.raw),
        )
        counters[outcome] += 1

        if candidate.announced_at is not None:
            vendor_id = db.get_or_create_vendor(conn, profile.vendor_slug, profile.vendor_name)
            db.upsert_release_event(
                conn,
                vendor_id=vendor_id,
                model_name=candidate.raw["model_name"],
                status="announced",
                dates={
                    "announced_at": candidate.announced_at.isoformat(),
                    "preorder_at": None,
                    "ship_at": None,
                    "eol_at": None,
                },
                source_url=candidate.source_url,
            )
            counters["events"] += 1
    return counters
