"""Postgres-доступ к `machine_candidates`/`material_candidates`/`vendors`/
`release_events`/`machines` (владелец схемы — apps/api, см. apps/api/src/db/schema.ts).
psycopg напрямую, без ORM — тот же паттерн, что apps/giga/src/giga/calendar/db.py
(apps/scout не шарит Python-пакет с apps/giga — каждое приложение изолировано своим
`uv sync`, поэтому копия функций, а не импорт).

Верхняя часть файла — продюсер-функции источников (`sources/*`), без клейма
очереди. Нижняя часть (`--- Резолвер ---`) — резолвер-стадия (MF-720):
`claim_pending_candidate` клеймит ОДНУ pending-строку СВОЕГО (`scout`)
namespace `for update skip locked`; вызывающий код (`resolver/run.py::run_once`)
пишет финальное решение и коммитит в ТОЙ ЖЕ транзакции сразу после клейма.
Промежуточного `status='processing'` в схеме нет (enum `machine_candidates.status`
его не содержит) — клейм+запись решения одной транзакцией без отдельного
processing-состояния и есть защита от двойной обработки при гипотетическом
параллельном запуске (сейчас резолвер — один процесс по таймеру, но паттерн
клейма тот же, что `mesh.worker._claim_pending`/`giga.db.claim_queued`, на
случай будущего масштабирования).

Namespace-изоляция (MF-1517, `machine_candidate_ownership.v1`,
docs/epics/domain.model.md § «Ownership contract `machine_candidates` v1»):
`machine_candidates` — общая с `apps/api/src/catalog` очередь, `owner`/
`source_family` — аддитивные колонки (MF-1514), проставляемые Postgres-триггером
`machine_candidates_set_ownership_trigger` по `source` при ingest. Scout клеймит
только `owner = 'scout'` — Catalog-owned (`cura-definitions`/`sovol3d-store`/
`giga-free-html`) и ещё не размеченные строки для этого резолвера не существуют.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import psycopg
from psycopg.types.json import Jsonb

from .resolver.matching import MachineRow

UpsertOutcome = Literal["inserted", "updated", "unchanged"]

_DATE_FIELDS = ("announced_at", "preorder_at", "ship_at", "eol_at")


def upsert_machine_candidate(
    conn: psycopg.Connection,
    *,
    source: str,
    source_url: str | None,
    external_ref: str,
    raw: dict,
    content_hash: bytes,
) -> UpsertOutcome:
    """Идемпотентный ре-ингест по `unique(source, external_ref)` (уже в схеме).

    Хэш не изменился → строка не трогается вовсе (не только `raw`: резолвер
    мог уже проставить `status`/`matched_machine_id` — повторный прогон
    источника не должен откатывать его работу). `xmax = 0` в RETURNING —
    стандартный способ psycopg/postgres отличить INSERT от UPDATE у одного
    `ON CONFLICT ... DO UPDATE`.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into machine_candidates (source, source_url, external_ref, raw, content_hash)
            values (%s, %s, %s, %s, %s)
            on conflict (source, external_ref) do update
               set source_url = excluded.source_url,
                   raw = excluded.raw,
                   content_hash = excluded.content_hash,
                   updated_at = now()
             where machine_candidates.content_hash is distinct from excluded.content_hash
            returning (xmax = 0) as inserted
            """,
            (source, source_url, external_ref, Jsonb(raw), content_hash),
        )
        row = cur.fetchone()
    conn.commit()
    if row is None:
        return "unchanged"
    return "inserted" if row[0] else "updated"


def upsert_material_candidate(
    conn: psycopg.Connection,
    *,
    source: str,
    source_url: str | None,
    external_ref: str,
    raw: dict,
    content_hash: bytes,
) -> UpsertOutcome:
    """`material_candidates` — тот же идемпотентный паттерн, что
    `upsert_machine_candidate` (тоже `unique(source, external_ref)`, тоже
    no-op при неизменном `content_hash` — не откатывает работу резолвера)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into material_candidates (source, source_url, external_ref, raw, content_hash)
            values (%s, %s, %s, %s, %s)
            on conflict (source, external_ref) do update
               set source_url = excluded.source_url,
                   raw = excluded.raw,
                   content_hash = excluded.content_hash,
                   updated_at = now()
             where material_candidates.content_hash is distinct from excluded.content_hash
            returning (xmax = 0) as inserted
            """,
            (source, source_url, external_ref, Jsonb(raw), content_hash),
        )
        row = cur.fetchone()
    conn.commit()
    if row is None:
        return "unchanged"
    return "inserted" if row[0] else "updated"


def get_or_create_vendor(conn: psycopg.Connection, slug: str, name: str) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into vendors (slug, name) values (%s, %s)
            on conflict (slug) do update set name = excluded.name
            returning id
            """,
            (slug, name),
        )
        row = cur.fetchone()
    conn.commit()
    return str(row[0])


def upsert_release_event(
    conn: psycopg.Connection,
    *,
    vendor_id: str,
    model_name: str,
    status: str,
    dates: dict[str, str | None],
    source_url: str,
) -> UpsertOutcome:
    """Естественный ключ `(vendor_id, model_name, status)` — в схеме нет
    unique-констрейнта под дедуп (MF-644), дедуп на уровне агента, тот же
    паттерн, что `giga.calendar.db.upsert_release_event`. `machine_id` здесь
    всегда `null`: матчинг на канон `machines` — резолвер-стадия, вне этой карты.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, announced_at, preorder_at, ship_at, eol_at, source_url
              from release_events
             where vendor_id = %s and model_name = %s and status = %s
            """,
            (vendor_id, model_name, status),
        )
        existing = cur.fetchone()

        if existing is None:
            cur.execute(
                """
                insert into release_events
                    (vendor_id, model_name, status,
                     announced_at, preorder_at, ship_at, eol_at, source_url)
                values (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    vendor_id,
                    model_name,
                    status,
                    dates.get("announced_at"),
                    dates.get("preorder_at"),
                    dates.get("ship_at"),
                    dates.get("eol_at"),
                    source_url,
                ),
            )
            conn.commit()
            return "inserted"

        event_id, *existing_date_values = existing[:5]
        existing_source_url = existing[5]
        existing_dates = {
            field: value.isoformat() if value else None
            for field, value in zip(_DATE_FIELDS, existing_date_values, strict=True)
        }
        # Новые даты дополняют, но не затирают уже известные (см. giga.calendar.db).
        merged_dates = {
            field: dates.get(field) or existing_dates[field] for field in _DATE_FIELDS
        }
        unchanged = merged_dates == existing_dates and source_url == existing_source_url
        if unchanged:
            return "unchanged"

        cur.execute(
            """
            update release_events
               set announced_at = %s, preorder_at = %s, ship_at = %s, eol_at = %s,
                   source_url = %s, updated_at = now()
             where id = %s
            """,
            (
                merged_dates["announced_at"],
                merged_dates["preorder_at"],
                merged_dates["ship_at"],
                merged_dates["eol_at"],
                source_url,
                event_id,
            ),
        )
    conn.commit()
    return "updated"


# --- Слайсер-профили (MF-411, шаг 2 эпика MF-34) ----------------------------


def upsert_slicer_profile_candidate(
    conn: psycopg.Connection,
    *,
    source: str,
    source_url: str | None,
    external_ref: str,
    raw: dict,
    content_hash: bytes,
) -> UpsertOutcome:
    """`slicer_profile_candidates` — очередь-аудит СЫРОГО содержимого источника
    до нормализации (см. миграция `20260710160000_slicer_profiles.sql`). Тот же
    идемпотентный паттерн `unique(source, external_ref)`, что
    `upsert_machine_candidate`/`upsert_material_candidate`."""
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into slicer_profile_candidates
                (source, source_url, external_ref, raw, content_hash)
            values (%s, %s, %s, %s, %s)
            on conflict (source, external_ref) do update
               set source_url = excluded.source_url,
                   raw = excluded.raw,
                   content_hash = excluded.content_hash,
                   updated_at = now()
             where slicer_profile_candidates.content_hash is distinct from excluded.content_hash
            returning (xmax = 0) as inserted
            """,
            (source, source_url, external_ref, Jsonb(raw), content_hash),
        )
        row = cur.fetchone()
    conn.commit()
    if row is None:
        return "unchanged"
    return "inserted" if row[0] else "updated"


def mark_slicer_profile_candidate_merged(
    conn: psycopg.Connection, *, source: str, external_ref: str, profile_id: str
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            update slicer_profile_candidates
               set status = 'merged', matched_profile_id = %s, confidence = 1.0, updated_at = now()
             where source = %s and external_ref = %s
            """,
            (profile_id, source, external_ref),
        )
    conn.commit()


def upsert_slicer_profile(
    conn: psycopg.Connection,
    *,
    profile_class: str,
    slicer: str,
    setting_id: str | None,
    name: str,
    params: dict,
    source_name: str,
    source_url: str | None,
    source_ref: str | None,
    license: str,
    confidence: float,
    content_hash: bytes,
    extrapolated_from_id: str | None = None,
    extrapolation_reason: str | None = None,
) -> str:
    """Идемпотентный upsert канона `slicer_profiles`. Прямая (не через
    ревью/матчинг) промоушен-стратегия — в отличие от `machine_candidates`
    (там реальная неоднозначность: один станок под разными именами у разных
    источников), профиль-из-OrcaSlicer при `confidence=1.0` САМ является
    источником истины, матчить не с чем.

    Конфликт-таргет — `(slicer, setting_id)`, когда источник даёт глобальный id
    (все инстанцируемые OrcaSlicer-профили). Абстрактные базовые профили
    (`instantiation=false`, напр. `fdm_process_common`) идентификатора не имеют —
    для них конфликт-таргет `content_hash` (тот же паттерн, что `machines`,
    MF-405): у разных вендоров он часто побайтово идентичен, и это осознанно
    сливается в одну каноническую строку (не дубли одного и того же дефолта).

    `inherits_id` этим вызовом НЕ проставляется — резолвится отдельным проходом
    `link_slicer_profile_inherits` после того как все строки прогона вставлены
    (порядок вставки внутри вендора не гарантированно топологический).

    `extrapolated_from_id`/`extrapolation_reason` — путь «нет готового базового,
    экстраполировано от родственного материала» (эпик MF-34 § RU-специфика,
    `slicer_print_profiles_ru.py`); `None`/`None` для обычного прямого импорта
    (`confidence=1.0`, источник сам есть истина)."""
    with conn.cursor() as cur:
        if setting_id is not None:
            cur.execute(
                """
                insert into slicer_profiles
                    (profile_class, slicer, setting_id, name, params, source_name,
                     source_url, source_ref, license, confidence, content_hash,
                     extrapolated_from_id, extrapolation_reason)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (slicer, setting_id) where setting_id is not null do update
                   set name = excluded.name,
                       params = excluded.params,
                       source_url = excluded.source_url,
                       source_ref = excluded.source_ref,
                       content_hash = excluded.content_hash,
                       extrapolated_from_id = excluded.extrapolated_from_id,
                       extrapolation_reason = excluded.extrapolation_reason,
                       updated_at = now()
                returning id
                """,
                (
                    profile_class, slicer, setting_id, name, Jsonb(params), source_name,
                    source_url, source_ref, license, confidence, content_hash,
                    extrapolated_from_id, extrapolation_reason,
                ),
            )
        else:
            cur.execute(
                """
                insert into slicer_profiles
                    (profile_class, slicer, setting_id, name, params, source_name,
                     source_url, source_ref, license, confidence, content_hash,
                     extrapolated_from_id, extrapolation_reason)
                values (%s, %s, null, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (content_hash) where content_hash is not null do update
                   set extrapolated_from_id = excluded.extrapolated_from_id,
                       extrapolation_reason = excluded.extrapolation_reason,
                       updated_at = now()
                returning id
                """,
                (
                    profile_class, slicer, name, Jsonb(params), source_name,
                    source_url, source_ref, license, confidence, content_hash,
                    extrapolated_from_id, extrapolation_reason,
                ),
            )
        row = cur.fetchone()
    conn.commit()
    return str(row[0])


def link_slicer_profile_inherits(
    conn: psycopg.Connection,
    occurrences: list[tuple[str, str, str, str, str, str | None]],
) -> int:
    """Второй проход: проставляет `inherits_id` по имени родителя, который сам
    парсер-агент резолвит внутри одного (slicer, vendor, profile_class) —
    каждый вендор в OrcaSlicer несёт свою полную копию цепочки наследования
    (см. докстринг `slicer_print_profiles`), поэтому родителя достаточно искать
    среди occurrences ЭТОГО же прогона, без похода в БД за именем.

    `occurrences`: `(profile_id, slicer, vendor, profile_class, name, inherits_name)`.
    Возвращает число обновлённых строк."""
    by_name = {
        (slicer, vendor, cls, name): pid for pid, slicer, vendor, cls, name, _ in occurrences
    }
    linked = 0
    with conn.cursor() as cur:
        for profile_id, slicer, vendor, profile_class, _name, inherits_name in occurrences:
            if not inherits_name:
                continue
            parent_id = by_name.get((slicer, vendor, profile_class, inherits_name))
            if parent_id is None or parent_id == profile_id:
                continue
            cur.execute(
                """
                update slicer_profiles
                   set inherits_id = %s, updated_at = now()
                 where id = %s and inherits_id is distinct from %s
                """,
                (parent_id, profile_id, parent_id),
            )
            linked += cur.rowcount
    conn.commit()
    return linked


def find_slicer_profile_by_name(
    conn: psycopg.Connection, *, slicer: str, profile_class: str, name: str
) -> tuple[str, dict] | None:
    """Резолвит `(id, params)` канонического профиля по точному имени —
    единственный якорь для `slicer_print_profiles_ru.py` (RU-вендоры без
    живого внешнего источника: нет бандла, который можно распарсить, только
    ссылка на уже загруженный generic-профиль, напр. `'Generic PLA'` у
    OrcaSlicer/BBL). `None`, если профиль ещё не загружен (источник Step 2/3
    не прогнан) — вызывающий код должен пропустить запись, а не гадать."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, params from slicer_profiles
             where slicer = %s and profile_class = %s and name = %s
             order by created_at
             limit 1
            """,
            (slicer, profile_class, name),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return str(row[0]), row[1]


def _deep_merge_params(base: dict, override: dict) -> dict:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_params(merged[key], value)
        else:
            merged[key] = value
    return merged


def resolve_slicer_profile_params(
    conn: psycopg.Connection, profile_id: str, *, max_depth: int = 32
) -> dict:
    """Мёржит цепочку `inherits_id` (родитель → дочерний переопределяет) в одно
    самодостаточное дерево `params` — нужно там, где потребитель хочет
    значения профиля БЕЗ похода вверх по цепочке самому (напр. seed RU-
    экстраполяции — единственный якорь у RU-профиля не имеет собственной
    `inherits_id`-цепочки, значит должен унести с собой уже смёрдженные
    значения generic-родителя). НЕ резолвер экспорта MF-412/413 — тот читает
    `slicer_profiles` целиком под API/CI-валидацию, это локальный helper под
    единичный lookup.

    `max_depth` — защита от цикла за пределами прямого self-reference (DB-check
    `slicer_profiles_no_self_inherit` ловит только `parent = self`, полный цикл
    через 2+ записи не ловится констрейнтом, см. docs/epics/slicer.profiles.md
    § «Открытые вопросы» #2)."""
    chain: list[dict] = []
    seen: set[str] = set()
    current_id: str | None = profile_id
    with conn.cursor() as cur:
        depth = 0
        while current_id is not None and depth < max_depth and current_id not in seen:
            seen.add(current_id)
            cur.execute(
                "select params, inherits_id from slicer_profiles where id = %s", (current_id,)
            )
            row = cur.fetchone()
            if row is None:
                break
            params, inherits_id = row
            chain.append(params or {})
            current_id = str(inherits_id) if inherits_id else None
            depth += 1
    merged: dict = {}
    for params in reversed(chain):
        merged = _deep_merge_params(merged, params)
    return merged


# --- Резолвер ---------------------------------------------------------------


@dataclass(frozen=True)
class PendingCandidate:
    id: str
    source: str
    source_url: str | None
    external_ref: str
    raw: dict


def claim_pending_candidate(conn: psycopg.Connection) -> PendingCandidate | None:
    """Клеймит одну `status='pending'` строку СВОЕГО (`scout`) namespace (см.
    докстринг модуля и `machine_candidate_ownership.v1`,
    docs/epics/domain.model.md § «Ownership contract») — `None`, если очередь
    пуста. `owner = 'scout'` — единственный predicate claim/filter, тот же
    столбец и тот же порядок, что partial-индекс
    `machine_candidates_ownership_status_idx (owner, source_family, status,
    created_at, id) where status = 'pending'` (MF-1514); `owner` проставляется
    триггером `machine_candidates_set_ownership_trigger` по `source` при
    ingest, здесь не пересчитывается. Catalog-owned (`cura-definitions`/
    `sovol3d-store`/`giga-free-html`) и ещё не размеченные (`owner is null`,
    `source_owner_unmapped`) строки этим predicate структурно не проходят —
    Scout их не клеймит, не меняет `status`/`matched_machine_id`, не трогает
    `machines`. Не коммитит: вызывающий код держит транзакцию открытой до
    записи финального решения, чтобы лок не отпускался раньше времени."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, source, source_url, external_ref, raw
              from machine_candidates
             where status = 'pending' and owner = 'scout'
             order by created_at, id
             for update skip locked
             limit 1
            """
        )
        row = cur.fetchone()
    if row is None:
        conn.rollback()
        return None
    return PendingCandidate(
        id=str(row[0]), source=row[1], source_url=row[2], external_ref=row[3], raw=row[4]
    )


def find_vendor_id(conn: psycopg.Connection, slug: str) -> str | None:
    """Read-only поиск вендора по слагу — используется резолвер-`--dry-run`
    (см. `resolver/run.py::_run_dry`), чтобы превью не создавало строки
    `vendors` побочным эффектом (в отличие от `get_or_create_vendor`)."""
    with conn.cursor() as cur:
        cur.execute("select id from vendors where slug = %s", (slug,))
        row = cur.fetchone()
    return str(row[0]) if row else None


def fetch_machines_for_vendor(conn: psycopg.Connection, vendor_id: str) -> list[MachineRow]:
    """Blocking-стадия: сужает сравнение кандидата с каноном до машин ОДНОГО
    вендора (индекс `machines_vendor_idx`) — не N×M со всем `machines`."""
    with conn.cursor() as cur:
        cur.execute(
            "select id, model, aliases from machines where vendor_id = %s order by created_at",
            (vendor_id,),
        )
        rows = cur.fetchall()
    return [MachineRow(id=str(r[0]), model=r[1], aliases=list(r[2] or [])) for r in rows]


def insert_machine(
    conn: psycopg.Connection,
    *,
    vendor_id: str,
    model: str,
    kind: str,
    specs: dict,
    content_hash: bytes,
    field_provenance: dict,
) -> str:
    """Промоушен кандидата без похожего в каноне (см. `resolver.decide`). Тот же
    `on conflict (content_hash)` идемпотентности, что `import-machines-bootstrap.ts`
    (`machines_content_hash_uidx`) — повторный резолв того же (vendor, model,
    specs) возвращает id уже существующей строки, не плодит дубль."""
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into machines
                (craft, kind, vendor_id, model, specs, integration, source,
                 verified, field_provenance, status, content_hash)
            values
                ('3d_printing', %s, %s, %s, %s, 'none', 'community',
                 false, %s, 'active', %s)
            on conflict (content_hash) where content_hash is not null do update
               set updated_at = machines.updated_at
            returning id
            """,
            (kind, vendor_id, model, Jsonb(specs), Jsonb(field_provenance), content_hash),
        )
        row = cur.fetchone()
    return str(row[0])


def add_machine_alias(
    conn: psycopg.Connection, machine_id: str, alias: str, field_provenance_patch: dict
) -> None:
    """Не-разрушающее дополнение дубль-матча (см. `resolver.decide` action='update'):
    только добавляет `alias`/провенанс, никогда не трогает существующие `model`/
    `specs` — резолвер доверяет уже выверенным каноническим данным больше, чем
    свежесосканенному кандидату (см. MF-720 § «Merge», field_provenance пишется
    на каждое обновлённое поле, не молчаливая перезапись)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            update machines
               set aliases = array_append(aliases, %s),
                   field_provenance = field_provenance || %s::jsonb,
                   updated_at = now()
             where id = %s
            """,
            (alias, Jsonb(field_provenance_patch), machine_id),
        )


def mark_candidate_resolved(
    conn: psycopg.Connection,
    candidate_id: str,
    *,
    status: str,
    matched_machine_id: str | None,
    confidence: float,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            update machine_candidates
               set status = %s, matched_machine_id = %s, confidence = %s, updated_at = now()
             where id = %s
            """,
            (status, matched_machine_id, round(confidence, 2), candidate_id),
        )
