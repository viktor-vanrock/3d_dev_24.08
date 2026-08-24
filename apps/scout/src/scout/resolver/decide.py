"""Merge-решение (MF-720 § «Merge») из двух скоров `matching.py` даёт одно из
четырёх действий. Пороги — не буквально дефолт CTO из карты (≥0.9/0.6–0.9/<0.6
одной шкалой): прогон на реальных 461 dev-кандидатах (2026-07-09) показал, что
0.9 по `name_similarity` авто-мержит РАЗНЫЕ станки одного вендора с общим
префиксом — `"Creality Ender-3 V3"` vs канон `"Creality Ender-3 V3 KE"` даёт
0.927, `"Creality Ender-5S"` vs `"Creality Ender-5 S1"` — 0.944, оба разных
принтера. Дубль-порог поднят до точного совпадения нормализованного имени
(`AUTO_MERGE_DUP_THRESHOLD = 1.0`, `name_similarity` возвращает ровно 1.0 только
при равенстве нормализованных строк, `difflib.SequenceMatcher` детерминирован
на этой границе) — всё, что 0.6–1.0, остаётся в 'matched' на ручной ревью,
недомерж безопаснее домержа. `REVIEW_THRESHOLD = 0.6` и порог инсерта новой
записи (`INSERT_PLAUSIBILITY_THRESHOLD = 0.9`, отдельная шкала — качество
данных САМОГО кандидата, не риск спутать с соседом) — дефолт CTO без изменений.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

AUTO_MERGE_DUP_THRESHOLD = 1.0
INSERT_PLAUSIBILITY_THRESHOLD = 0.9
REVIEW_THRESHOLD = 0.6

Action = Literal["insert", "update", "matched", "rejected"]


@dataclass(frozen=True)
class Decision:
    action: Action
    confidence: float
    matched_machine_id: str | None


def decide(dup_score: float, dup_machine_id: str | None, plausibility: float) -> Decision:
    if dup_score >= AUTO_MERGE_DUP_THRESHOLD and dup_machine_id is not None:
        return Decision("update", dup_score, dup_machine_id)
    if dup_score >= REVIEW_THRESHOLD and dup_machine_id is not None:
        return Decision("matched", dup_score, dup_machine_id)
    if plausibility >= INSERT_PLAUSIBILITY_THRESHOLD:
        return Decision("insert", plausibility, None)
    return Decision("rejected", plausibility, None)
