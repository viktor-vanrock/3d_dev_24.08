"""Резолвер-стадия apps/scout (MF-720, эпик MF-32): промоушен `machine_candidates`
в канон `machines` конвейером blocking→matching→merge (`docs/epics/domain.model.md`
§ MF-32).

Blocking — `db.fetch_machines_for_vendor` (индекс `machines_vendor_idx`, тот же
принцип, что GIN по `aliases`/`specs`, — сравниваем кандидата только с
машинами его вендора, не со всем каноном). Matching — `matching.py` (похожесть
имени + аргумент правдоподобия для случая "кандидата ни с чем не сравнить,
это первая запись вендора"). Merge — `decide.py` переводит два скора в решение
insert/update/matched/rejected по порогам ≥0.9/0.6–0.9/<0.6 (MF-720 §
«Merge»), `run.py` применяет решение и пишет провенанс.
"""

from __future__ import annotations
