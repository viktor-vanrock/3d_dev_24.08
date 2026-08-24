"""Scout-эмиттер контракта `machine_candidate.audit.v1` (MF-1517,
docs/epics/domain.model.md § «Ownership contract `machine_candidates` v1» →
«Audit и наблюдаемость»). Transport в v1 — структурированный audit-log через
стандартный `logging` (не новая шина, не БД-таблица); единая доставка и
одинаковая сериализация для ОБЕИХ сторон шва (Catalog + Scout) — отдельная
карта MF-1518. Этот модуль пишет только Scout-события (`owner` фиксирован
`'scout'` — этот эмиттер поднят исключительно в Scout-резолвере, чужие
namespace сюда структурно не попадают: см. `db.claim_pending_candidate`).

Поля события — ровно контракт из домен-документа: `event_id`, `occurred_at`,
`candidate_id`, `namespace`, `owner`, `source`, `from_status`, `to_status`,
`actor`, `reason`, `correlation_id`, `idempotency_key`. Для отсутствующего
перехода (`claim_acquired`) `from_status`/`to_status` допускаются `null` —
тот же принцип, что в домен-документе.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Literal

logger = logging.getLogger("scout.audit")

EVENT_VERSION = "machine_candidate.audit.v1"
OWNER = "scout"
NAMESPACE = "scout.v1"

AuditKind = Literal[
    "ingested", "claim_acquired", "claim_rejected", "status_transition", "released", "error"
]


def new_correlation_id() -> str:
    """Один correlation_id на один кандидат (claim → resolve → status_transition
    делят его), чтобы причинно связанные события можно было склеить в логе."""
    return str(uuid.uuid4())


def emit(
    kind: AuditKind,
    *,
    candidate_id: str | None,
    source: str | None,
    correlation_id: str,
    from_status: str | None = None,
    to_status: str | None = None,
    reason: str | None = None,
    idempotency_key: str | None = None,
    actor: str = "scout-resolver",
) -> None:
    event = {
        "event": EVENT_VERSION,
        "kind": kind,
        "event_id": str(uuid.uuid4()),
        "occurred_at": datetime.now(UTC).isoformat(),
        "candidate_id": candidate_id,
        "namespace": NAMESPACE,
        "owner": OWNER,
        "source": source,
        "from_status": from_status,
        "to_status": to_status,
        "actor": actor,
        "reason": reason,
        "correlation_id": correlation_id,
        "idempotency_key": idempotency_key,
    }
    # Само тело лог-сообщения — JSON-строка (структурированный audit-log, не
    # логфомат с `%`-плейсхолдерами): не завязано на `record.args`-протокол
    # `logging` (единственный dict-аргумент там имеет особую семантику
    # %-мэппинга), парсер лога получает готовый объект без угадывания формата.
    logger.info(json.dumps(event, ensure_ascii=False))
