"""Агент-парсер каталога станков на свободном HTML (MF-649, декомпозиция MF-406).

Пайплайн источник→сырьё (`docs/epics/domain.model.md` § «Каталог станков»):
переиспользует RSS-фиды вендор-ньюсрумов из `giga.calendar` (`fetch.py`/
`sources.py` — тот же текст статьи, что уже гоняется через LLM-экстрактор
календаря релизов, здесь прогоняется через второй, специализированный на
характеристиках станка промпт) → LLM-экстрактор в JSON по канонической схеме
станка (`extract.py`) → идемпотентный upsert в `machine_candidates` (`db.py`,
тот же контракт unique(source, external_ref)+content_hash, что
`apps/api/src/catalog/ingest/run.ts::runIngest`) → CLI-оркестратор с
аудит-логом в `ingest_runs` (`run.py`).

Почему прямая запись в Postgres, а не HTTP-вызов из TS-адаптера в giga:
`apps/api` и `apps/giga` интегрируются только через общий `DATABASE_URL`, без
HTTP-прокси между сервисами (см. `apps/api/src/generations/contract.ts` —
тот же паттерн для generations/mesh); giga и так уже пишет `release_events`
напрямую (`giga.calendar.db`). `machine_candidates`/`ingest_runs` — те же
таблицы, тот же контракт идемпотентности, что использует TS-адаптер, разница
только в языке писателя.
"""

from __future__ import annotations
