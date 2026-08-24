"""Агент наполнения календаря релизов принтеров (MF-644, эпик MF-32).

Пайплайн источник→сырьё→канон (`docs/epics/domain.model.md` § 3): RSS-фид
вендор-ньюсрума (`fetch.py`) → LLM-экстрактор свободного текста статьи в JSON
(`extract.py`) → матчинг на `vendors`/`machines` и идемпотентный upsert в
`release_events` (`db.py`) → CLI-оркестратор с логом прогона (`run.py`).
"""

from __future__ import annotations
