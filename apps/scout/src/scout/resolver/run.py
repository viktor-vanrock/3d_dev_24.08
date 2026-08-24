"""Резолвер-CLI/тик (MF-720): клеймит pending `machine_candidates` СВОЕГО
(`scout`) namespace по одному (`db.claim_pending_candidate`, `owner = 'scout'`
+ SKIP LOCKED — namespace-изоляция MF-1517, см. `db.py` докстринг) и для
каждого — blocking (машины того же вендора) → matching (`matching.py`) →
merge-решение (`decide.py`) → запись (insert/update канона или просто статус
кандидата) в одной транзакции. Каждый клейм и переход статуса пишет
audit-событие `machine_candidate.audit.v1` (`audit.py`).

Отдельный тик, не часть `worker.run_once` — тот же выбор, что уже сделан для
`slicer_profiles` (см. `sources/run_slicer_profiles.py`: у источников и
резолвера разная частота уместности, источники обходят вендор-сайты, резолвер
обрабатывает уже накопленную очередь и может гонять чаще/по требованию).
Systemd-таймер под этот тик — заявка Ops (см. `apps/scout/deploy/`), вне
объёма этой карты (см. её «Объём»: сам конвейер, не эксплуатация).

Запуск (dev-стенд): `uv run scout-resolver-agent`. `--dry-run` — посчитать
решения, ничего не писать (в т.ч. не клеймит: работает по read-only снапшоту
pending-строк, `vendors` не создаёт побочным эффектом — см. `db.find_vendor_id`).
`--limit N` — обработать не больше N кандидатов за прогон.
env: `DATABASE_URL` (обязателен, если не `--dry-run`).
"""

from __future__ import annotations

import argparse
import logging
import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import psycopg

from .. import db
from . import audit
from . import specs as specs_mod
from .decide import Decision, decide
from .hashing import content_hash
from .matching import MachineRow, best_match, plausibility_score
from .normalize import extract_vendor_and_model, resolve_vendor

logger = logging.getLogger("scout.resolver")

Outcome = str  # "merged_update" | "merged_insert" | "matched" | "rejected"

_ACTION_TO_OUTCOME = {
    "update": "merged_update",
    "insert": "merged_insert",
    "matched": "matched",
    "rejected": "rejected",
}

_OUTCOME_TO_STATUS = {
    "merged_update": "merged",
    "merged_insert": "merged",
    "matched": "matched",
    "rejected": "rejected",
}


@dataclass(frozen=True)
class Evaluation:
    decision: Decision
    vendor_id: str | None
    vendor_slug: str | None
    model_raw: str | None
    specs: dict
    dup_machine: MachineRow | None


def _evaluate(
    conn: psycopg.Connection,
    candidate: db.PendingCandidate,
    *,
    vendor_lookup: Callable[[psycopg.Connection, str, str], str | None],
) -> Evaluation:
    """Чистая часть конвейера (blocking→matching→decide), общая для реального
    прогона и `--dry-run` — только вызов `vendor_lookup` различает их
    (`get_or_create_vendor` пишет, `find_vendor_id` только читает)."""
    extracted = extract_vendor_and_model(candidate.raw)
    if extracted is None:
        return Evaluation(Decision("rejected", 0.0, None), None, None, None, {}, None)
    vendor_raw, model_raw = extracted

    resolved_vendor = resolve_vendor(vendor_raw)
    if resolved_vendor is None:
        return Evaluation(Decision("rejected", 0.05, None), None, None, model_raw, {}, None)
    vendor_slug, vendor_name = resolved_vendor

    candidate_specs = specs_mod.extract_specs(candidate.raw)
    vendor_id = vendor_lookup(conn, vendor_slug, vendor_name)
    block = db.fetch_machines_for_vendor(conn, vendor_id) if vendor_id is not None else []
    match = best_match(model_raw, block)
    dup_score, dup_machine = (match[1], match[0]) if match is not None else (0.0, None)
    plausibility = plausibility_score(vendor_slug, model_raw, candidate_specs)

    decision = decide(dup_score, dup_machine.id if dup_machine else None, plausibility)
    return Evaluation(decision, vendor_id, vendor_slug, model_raw, candidate_specs, dup_machine)


def _provenance_entry(candidate: db.PendingCandidate, confidence: float, ts: str) -> dict[str, Any]:
    return {
        "source": candidate.source,
        "source_url": candidate.source_url,
        "ts": ts,
        "confidence": round(confidence, 2),
    }


def resolve_candidate(conn: psycopg.Connection, candidate: db.PendingCandidate) -> Outcome:
    """Один кандидат: полный blocking→matching→merge конвейер + запись решения.
    Сбой одного кандидата (см. `run_once`) не должен ронять остальные — тот же
    принцип, что `sources/*` уже применяют на уровне вендора/карточки."""
    ts = datetime.now(UTC).isoformat()
    ev = _evaluate(conn, candidate, vendor_lookup=db.get_or_create_vendor)
    decision = ev.decision

    matched_machine_id = decision.matched_machine_id
    if decision.action == "update":
        _apply_update(conn, ev.dup_machine, ev.model_raw, candidate, decision, ts)
    elif decision.action == "insert":
        matched_machine_id = _apply_insert(conn, ev, candidate, decision, ts)

    status = "merged" if decision.action in ("update", "insert") else decision.action
    db.mark_candidate_resolved(
        conn,
        candidate.id,
        status=status,
        matched_machine_id=matched_machine_id,
        confidence=decision.confidence,
    )
    return _ACTION_TO_OUTCOME[decision.action]


def _apply_update(
    conn: psycopg.Connection,
    machine: MachineRow,
    model_raw: str,
    candidate: db.PendingCandidate,
    decision: Decision,
    ts: str,
) -> None:
    """Дубль-матч — не трогаем `model`/`specs` канона (см. `db.add_machine_alias`
    докстринг), только добавляем алиас, если текст кандидата реально новый."""
    normalized_existing = {a.strip().lower() for a in (machine.model, *machine.aliases)}
    if model_raw.strip().lower() in normalized_existing:
        return  # кандидат текстуально совпадает с уже известным именем/алиасом — нечего добавлять
    db.add_machine_alias(
        conn,
        machine.id,
        model_raw,
        field_provenance_patch={"aliases": _provenance_entry(candidate, decision.confidence, ts)},
    )


def _apply_insert(
    conn: psycopg.Connection,
    ev: Evaluation,
    candidate: db.PendingCandidate,
    decision: Decision,
    ts: str,
) -> str:
    kind = specs_mod.derive_kind(ev.specs)
    chash = content_hash(ev.vendor_slug, ev.model_raw, ev.specs)
    entry = _provenance_entry(candidate, decision.confidence, ts)
    field_provenance = {"model": entry, "specs": entry, "kind": entry}
    return db.insert_machine(
        conn,
        vendor_id=ev.vendor_id,
        model=ev.model_raw,
        kind=kind,
        specs=ev.specs,
        content_hash=chash,
        field_provenance=field_provenance,
    )


def run_once(conn: psycopg.Connection, *, limit: int | None = None) -> dict[str, int]:
    """Клеймит и резолвит по одному, пока очередь/лимит не кончится. Сбой
    одного кандидата помечает его `rejected` в отдельной короткой транзакции
    (не оставляет `pending` — иначе следующая итерация того же прогона
    заклеймит ЕГО ЖЕ (`claim_pending_candidate` берёт по `order by created_at, id`)
    и зациклится на одной и той же падающей строке вместо прогресса по очереди).

    Каждый заклеймленный кандидат пишет audit-события `machine_candidate.audit.v1`
    (MF-1517, `audit.py`): `claim_acquired` сразу после клейма, затем
    `status_transition` (успех или ошибка резолва) — оба под одним
    `correlation_id`, чтобы причинно связанные события можно было склеить."""
    counters = {"merged_update": 0, "merged_insert": 0, "matched": 0, "rejected": 0}
    processed = 0
    while limit is None or processed < limit:
        candidate = db.claim_pending_candidate(conn)
        if candidate is None:
            break
        correlation_id = audit.new_correlation_id()
        idempotency_key = f"{candidate.source}:{candidate.external_ref}"
        audit.emit(
            "claim_acquired",
            candidate_id=candidate.id,
            source=candidate.source,
            correlation_id=correlation_id,
            idempotency_key=idempotency_key,
        )
        try:
            outcome = resolve_candidate(conn, candidate)
            conn.commit()
            audit.emit(
                "status_transition",
                candidate_id=candidate.id,
                source=candidate.source,
                correlation_id=correlation_id,
                idempotency_key=idempotency_key,
                from_status="pending",
                to_status=_OUTCOME_TO_STATUS[outcome],
                reason=outcome,
            )
        except Exception as exc:
            conn.rollback()
            logger.exception("кандидат %s: резолв упал, помечаю rejected", candidate.id)
            audit.emit(
                "error",
                candidate_id=candidate.id,
                source=candidate.source,
                correlation_id=correlation_id,
                idempotency_key=idempotency_key,
                reason=repr(exc),
            )
            try:
                db.mark_candidate_resolved(
                    conn, candidate.id, status="rejected", matched_machine_id=None, confidence=0.0
                )
                conn.commit()
                outcome = "rejected"
                audit.emit(
                    "status_transition",
                    candidate_id=candidate.id,
                    source=candidate.source,
                    correlation_id=correlation_id,
                    idempotency_key=idempotency_key,
                    from_status="pending",
                    to_status="rejected",
                    reason="resolve_error",
                )
            except Exception:
                conn.rollback()
                logger.exception(
                    "кандидат %s: не удалось пометить rejected — прерываю прогон", candidate.id
                )
                break
        counters[outcome] += 1
        processed += 1
    return counters


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    args = _parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.warning("DATABASE_URL не сконфигурирован — прогон пропущен")
        return

    conn = psycopg.connect(database_url)
    try:
        if args.dry_run:
            _run_dry(conn, limit=args.limit)
            return
        counters = run_once(conn, limit=args.limit)
        logger.info("резолвер: %s", counters)
    finally:
        conn.close()


_PENDING_QUERY = """
    select id, source, source_url, external_ref, raw
      from machine_candidates
     where status = 'pending' and owner = 'scout'
     order by created_at, id
"""


def _run_dry(conn: psycopg.Connection, *, limit: int | None) -> None:
    """Read-only превью: те же blocking/matching/decide на снапшоте pending-строк
    СВОЕГО namespace (тот же `owner = 'scout'` guard, что `db.claim_pending_candidate` —
    см. докстринг модуля, «Ручной API review обязан применять тот же namespace
    guard, что и его резолвер»), без клейма (`for update`) и без записи —
    безопасно гонять на живой БД."""
    with conn.cursor() as cur:
        if limit is not None:
            cur.execute(_PENDING_QUERY + " limit %s", (limit,))
        else:
            cur.execute(_PENDING_QUERY)
        rows = cur.fetchall()
    conn.rollback()

    counters = {"merged_update": 0, "merged_insert": 0, "matched": 0, "rejected": 0}
    for row in rows:
        candidate = db.PendingCandidate(
            id=str(row[0]), source=row[1], source_url=row[2], external_ref=row[3], raw=row[4]
        )
        ev = _evaluate(
            conn, candidate, vendor_lookup=lambda c, slug, _n: db.find_vendor_id(c, slug)
        )
        outcome = _ACTION_TO_OUTCOME[ev.decision.action]
        counters[outcome] += 1
        logger.info(
            "[dry-run] %s -> %s (confidence=%.2f)",
            ev.model_raw,
            ev.decision.action,
            ev.decision.confidence,
        )
    logger.info("[dry-run] итого: %s", counters)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Резолвер machine_candidates → machines")
    parser.add_argument("--dry-run", action="store_true", help="посчитать решения, не писать в БД")
    parser.add_argument("--limit", type=int, default=None, help="не больше N кандидатов за прогон")
    return parser.parse_args()


if __name__ == "__main__":
    main()
