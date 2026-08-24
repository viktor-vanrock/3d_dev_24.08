"""RAG + clarification runner для приватных assistant-чатов (MF-2000, эпик MF-1996).

Поток: bounded evidence из поиска по каталогу → `router.route_message` решает
одно из `answer`/`clarification`/`generation_offer`/`error` (`schemas.py`).
Очередь `assistant_runs` забирает `lifecycle_worker.py`: общий lifecycle даёт
lease/heartbeat/attempts/reclaim/fencing, а доменная маршрутизация остаётся в
этом пакете.
"""

from __future__ import annotations
