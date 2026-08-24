"""`content_hash` для новые записи `machines`, формат-совместимый с
`import-machines-bootstrap.ts::contentHash`/`stableStringify` — тот же sha256
{vendor, model, specs} с ключами, отсортированными на каждом уровне, без
пробелов. Совпадение не гарантировано межу двумя независимыми пайплайнами
(TS источник — SimplyPrint-агрегатор с другим текстом `model`, не тот же
`raw["model"]`, что видит scout из сырых Orca/Prusa профилей) — `content_hash`
здесь в первую очередь даёт резолверу идемпотентность НАД СОБСТВЕННЫМИ
инсертами (`machines_content_hash_uidx`: повторная вставка того же кандидата
не плодит дубль-строку, см. `db.insert_machine`), совпадение с уже
бутстрап-импортированной записью — бонус, не гарантия (дедуп той пары решает
`matching.py` по имени, не хэш).

`_js_number` — JS `JSON.stringify` не различает int/float (`3.0` → `"3"`);
`json.dumps` в Python различает — без этой поправки одинаковые по смыслу specs
(целые миллиметры объёма печати) дали бы разный хэш в двух рантаймах.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def _js_number(value: float | int) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int) or (isinstance(value, float) and value.is_integer()):
        return str(int(value))
    return repr(float(value))


def stable_stringify(value: Any) -> str:
    if isinstance(value, bool) or value is None:
        return json.dumps(value)
    if isinstance(value, (int, float)):
        return _js_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(stable_stringify(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value.keys())
        parts = [f"{json.dumps(k, ensure_ascii=False)}:{stable_stringify(value[k])}" for k in keys]
        return "{" + ",".join(parts) + "}"
    raise TypeError(f"stable_stringify: неподдерживаемый тип {type(value)!r}")


def content_hash(vendor_slug: str, model: str, specs: dict) -> bytes:
    canonical = stable_stringify({"vendor": vendor_slug, "model": model, "specs": specs})
    return hashlib.sha256(canonical.encode("utf-8")).digest()
