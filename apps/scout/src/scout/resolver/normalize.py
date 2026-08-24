"""Вендор/модель — извлечение из разношёрстных `raw` (4 живых shape на dev:
`slicer_profile`/`vendor_whitelist` из кода этого приложения плюс
`cura-definitions`/`sovol3d-store`, уже в `machine_candidates`, без кода-источника
в этом репо — резолвер обязан пережёвывать любой pending-кандидат, не только
свои собственные, отсюда generic-дистпатч по ключам, а не source-specific парсер)
и нормализация для сравнения/слага.

`_VENDOR_ALIASES` — тот же список брендов, что уже канонизировал bootstrap-импорт
`apps/api/scripts/import-machines-bootstrap.ts` (`VENDOR_ALIASES`/`SKIP_VENDORS`),
осознанно продублирован (Python/TS не шарят код) под те же slug — иначе резолвер
заведёт вендора-дублёра ("sovol-3d" рядом с уже существующим "sovol") вместо
переиспользования строки `vendors`, которую тот прогон уже создал в dev.
Ключи схлопнуты через `_alias_key` (только `[a-z0-9]`), чтобы одной записью
поймать наблюдаемые на dev варианты регистра/пробелов ("SOVOL"/"sovol3d"/
"Sovol 3D" → один слаг), не разводя алиас-таблицу на каждый вариант вручную.
"""

from __future__ import annotations

import re

_SKIP_VENDORS = {"custom"}  # заглушки generic-прошивок (Generic Klipper/Marlin/…), не бренд

_VENDOR_ALIASES: dict[str, tuple[str, str]] = {
    "bbl": ("bambu-lab", "Bambu Lab"),
    "prusa": ("prusa-research", "Prusa Research"),
    "prusa3d": ("prusa-research", "Prusa Research"),
    "prusaresearch": ("prusa-research", "Prusa Research"),
    "creality3d": ("creality", "Creality"),
    "sovol": ("sovol", "Sovol"),
    "sovol3d": ("sovol", "Sovol"),
    "ultimaker": ("ultimaker", "Ultimaker"),
    "ultimakerbv": ("ultimaker", "Ultimaker"),
    "foldertech": ("folger-tech", "Folger Tech"),
    "flyingbear": ("flyingbear", "FlyingBear"),
    "ratrig": ("ratrig", "RatRig"),
    "qiditechnology": ("qidi-tech", "Qidi Tech"),
    "qidi": ("qidi-tech", "Qidi Tech"),
}

_NOISE_TOKENS = {"original", "3d", "printer", "printers"}


def _alias_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug


def resolve_vendor(raw_vendor: str | None) -> tuple[str, str] | None:
    """(slug, каноническое_имя) для строки вендора из `raw`; `None` — заглушка
    (`Custom`) или пустая строка, кандидат непригоден (см. `matching.plausibility_score`)."""
    if not raw_vendor or not raw_vendor.strip():
        return None
    key = _alias_key(raw_vendor)
    if key in _SKIP_VENDORS:
        return None
    alias = _VENDOR_ALIASES.get(key)
    if alias is not None:
        return alias
    slug = slugify(raw_vendor)
    if not slug:
        return None
    return slug, raw_vendor.strip()


def normalize_model_name(text: str) -> str:
    """Нижний регистр, пунктуация → пробел, шумовые токены ("3D Printer" суффикс
    маркетинговых тайтлов вендор-страниц) вырезаны — приводит `"Original Prusa
    MK4S 3D Printer"` и канонический `"Prusa MK4S"` к сравнимому `"prusa mk4s"`."""
    lowered = re.sub(r"[^a-z0-9]+", " ", text.lower())
    tokens = [t for t in lowered.split() if t not in _NOISE_TOKENS]
    return " ".join(tokens)


def extract_vendor_and_model(raw: dict) -> tuple[str, str] | None:
    """(сырой вендор, сырая модель) из кандидата любого известного на dev shape.

    `None` — раз в raw нет ни одной из известных пар ключей, разбирать нечего
    (мусорный/будущий формат источника) — кандидат уйдёт в rejected, не упадёт
    резолвер целиком (тот же принцип "сбой одной карточки не роняет прогон",
    что уже применяют `sources/*`).
    """
    vendor = raw.get("vendor") or raw.get("vendor_name")
    model = raw.get("model") or raw.get("model_name")
    if not vendor or not model:
        return None
    vendor, model = str(vendor).strip(), str(model).strip()
    if not vendor or not model:
        return None
    return vendor, model
