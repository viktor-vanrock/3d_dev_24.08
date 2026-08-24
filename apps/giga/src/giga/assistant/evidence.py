"""Bounded evidence-провайдер для `router.py` — реальные каталожные `model_id`.

MF-1998 («Запустить hybrid search и индексатор моделей», тот же исполнитель,
стадия 3 эпика MF-1996, на момент этого модуля ещё `todo`) — владелец настоящего
гибридного (full-text + `models.embedding vector(1024)` + HYPERPC `:8189`
rerank) поиска. `router.py` от конкретной реализации поиска не зависит —
принимает любой `EvidenceProvider` с этой сигнатурой; пока MF-1998 не готов,
`fetch_evidence` ниже — честный лексический fallback: `pg_trgm`-похожесть по
`title`/`description`, только `status='ready'` (публичный каталог — приватные/
не готовые модели чужого юзера не текут в evidence чата). Тот же принцип
деградации, что «GET /models?q… деградирует до trigram при сбое AI»
(CLAUDE.md зоны AI / докстринг MF-1996): нет вектора — есть хотя бы точные
совпадения по словам, не пусто и не выдумано.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import psycopg


@dataclass(frozen=True)
class Evidence:
    model_id: str
    title: str
    snippet: str
    score: float
    source_url: str | None = None


class EvidenceProvider(Protocol):
    def __call__(self, query: str, limit: int) -> list[Evidence]: ...


_SNIPPET_MAX_CHARS = 280


def _snippet(description: str | None, title: str) -> str:
    text = (description or "").strip()
    if not text:
        return title
    return text[:_SNIPPET_MAX_CHARS].strip()


def fetch_evidence(conn: psycopg.Connection, query: str, limit: int) -> list[Evidence]:
    """Лексический fallback: `pg_trgm` similarity по `title`||`description`,
    ограничено `status='ready'` (публичный каталог, MF-459). `limit` — тот же
    бюджет, что `AssistantRunRequest.evidence_limit` (bounded, не "весь каталог").

    Пустой/пробельный `query` → пустая evidence, не бросаем и не гадаем — router
    сам решает, как отвечать без каталожных данных (см. `router.route_message`).
    """
    stripped = query.strip()
    if not stripped or limit <= 0:
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, title, description,
                   greatest(
                       similarity(title, %(q)s),
                       similarity(coalesce(description, ''), %(q)s)
                   ) as score
              from models
             where status = 'ready'
               and (title %% %(q)s or coalesce(description, '') %% %(q)s)
             order by score desc, created_at desc
             limit %(limit)s
            """,
            {"q": stripped, "limit": limit},
        )
        rows = cur.fetchall()
    return [
        Evidence(
            model_id=str(row[0]),
            title=row[1],
            snippet=_snippet(row[2], row[1]),
            score=float(row[3]),
        )
        for row in rows
    ]
