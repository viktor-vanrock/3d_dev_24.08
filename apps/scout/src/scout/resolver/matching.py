"""Matching-стадия: похожесть кандидата на существующие `machines` того же
вендора (`best_match`, блок уже сузила `db.fetch_machines_for_vendor`) и
плаузибилити кандидата как САМОСТОЯТЕЛЬНОЙ новой записи, когда похожего
станка в блоке нет вовсе (`plausibility_score`).

`name_similarity` — не просто `difflib` ratio: голая посимвольная похожесть
путает "новая модель с общим префиксом" ("Creality Ender-3 V3" vs "…V3 KE",
ratio≈0.93) с "тот же станок, шум в заголовке" ("Original Prusa MK4S 3D
Printer" vs "Prusa MK4S", ratio=1.0 после нормализации, но короткие
vendor-whitelist тайтлы с доп. словами вроде "Single-toolhead" разъезжаются
сильнее). Добавлен токен-containment (все токены короткого варианта — подмножество
длинного) как ВТОРОЙ сигнал, взятый с потолком ×0.9 — то есть даже 100%
containment не долетает до порога авто-merge (`decide.AUTO_MERGE_THRESHOLD`,
см. модуль `decide.py`), только поднимает кандидата в matched-диапазон на
ручной ревью вместо ошибочного rejected. Однотокенный containment намеренно
не считается (см. `_MIN_CONTAINMENT_TOKENS`) — одно общее слово вроде бренда
внутри model-строки не сигнал сходства.
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass
from typing import Any

from .normalize import normalize_model_name
from .specs import is_plausible_specs

_MIN_CONTAINMENT_TOKENS = 2
_CONTAINMENT_CAP = 0.9


@dataclass(frozen=True)
class MachineRow:
    id: str
    model: str
    aliases: list[str]


def name_similarity(a: str, b: str) -> float:
    na, nb = normalize_model_name(a), normalize_model_name(b)
    if not na or not nb:
        return 0.0
    char_ratio = difflib.SequenceMatcher(None, na, nb).ratio()

    tokens_a, tokens_b = set(na.split()), set(nb.split())
    smaller, larger = (
        (tokens_a, tokens_b) if len(tokens_a) <= len(tokens_b) else (tokens_b, tokens_a)
    )
    containment = 0.0
    if len(smaller) >= _MIN_CONTAINMENT_TOKENS:
        containment = len(smaller & larger) / len(smaller) * _CONTAINMENT_CAP

    return max(char_ratio, containment)


def best_match(model_name: str, machines: list[MachineRow]) -> tuple[MachineRow, float] | None:
    """Лучшая похожесть кандидата на канон блока — по `model` И по каждому
    `aliases` (алиас может быть точнее исторического текста `model`)."""
    best: tuple[MachineRow, float] | None = None
    for machine in machines:
        candidates_for_names = [machine.model, *machine.aliases]
        score = max(name_similarity(model_name, name) for name in candidates_for_names)
        if best is None or score > best[1]:
            best = (machine, score)
    return best


def plausibility_score(vendor_slug: str | None, model_name: str, specs: dict[str, Any]) -> float:
    """Правдоподобие кандидата как НОВОЙ канонической записи (нет похожей в
    блоке вообще, см. `decide.decide`) — не про похожесть, про качество данных
    самого кандидата: известный вендор + вменяемый объём печати (сам по себе
    уже даёт порог авто-инсерта, +0.4 ниже) + бонусы за инженерную специфику
    (сопло/технология) и описательное (не однословное) имя.

    Вменяемый build_volume — тот же и единственный барьер, которым уже
    руководствовался `import-machines-bootstrap.ts::isPlausible` при прямой
    заливке `machines` (никаких доп. требований к сопуту/названию он не
    предъявлял) — держим резолвер не строже уже одобренного прецедента:
    реальные dev-кандидаты вроде `101Hero`/`3Dator` (только build_volume, без
    nozzle/technology, однословное имя) обязаны пройти в insert, не осесть в
    rejected. Без объёма печати выше 0.6 не поднимается — тот же барьер, что
    `specs.is_plausible_specs` применяет для решения "вообще в канон".
    """
    if vendor_slug is None or not model_name.strip():
        return 0.0

    score = 0.5
    if is_plausible_specs(specs):
        score += 0.4
    if specs.get("nozzle_diameters") or specs.get("machine_tech"):
        score += 0.1
    if len(normalize_model_name(model_name).split()) >= 2:
        score += 0.05
    return max(0.0, min(score, 0.97))
