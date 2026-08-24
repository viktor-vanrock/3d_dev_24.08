"""Справочник дефектов FDM-печати (MF-360, Фаза 1 эпика MF-16).

Каталог живёт как данные (`defects.json`), не как код — то же обоснование, что
CLAUDE.md § «Промпты — это код»: причины/рекомендации меняются по мере
накопления опыта диагностики (правки — PR в JSON, без релиза логики), и тот
же файл подставляется в промпт GigaChat Vision на этапе анализа фото
(MF-361/362), когда он появится, — как system-контекст со списком известных
дефектов, а не захардкоженный текст посреди промпта.

JSON, не YAML: в репозитории нет зависимости на YAML-парсер ни у одного
Python-сервиса (`apps/mesh`, `apps/giga`) — не тащим её ради одного файла,
`json` из стандартной библиотеки полностью покрывает потребность.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources

# Материалы, для которых различаются рекомендации по настройкам (совпадает с
# набором в apps/api — PLA/PETG/ABS/TPU, см. CLAUDE.md зоны). "general" — не
# материал, а ключ рекомендаций, общих для всех материалов сразу.
KNOWN_MATERIALS = frozenset({"PLA", "PETG", "ABS", "TPU"})


@dataclass(frozen=True)
class DefectInfo:
    """Один тип дефекта: признаки на фото, вероятные причины, рекомендации по настройкам.

    `recommendations` — по материалу (PLA/PETG/ABS/TPU) и/или `"general"` для
    советов, не зависящих от материала; дефект может нести и то, и другое.
    """

    id: str
    name_ru: str
    symptoms: list[str]
    materials: list[str]
    causes: list[str]
    recommendations: dict[str, list[str]]

    def recommendations_for(self, material: str | None) -> list[str]:
        """Рекомендации для конкретного материала + общие, в этом порядке.

        Материал не указан или не описан для дефекта отдельно -> только
        `"general"` (может быть пустым списком, если дефект целиком
        завязан на материал, например warping не описывает PLA/TPU).
        """
        specific = self.recommendations.get(material, []) if material else []
        general = self.recommendations.get("general", [])
        return [*specific, *general]


@lru_cache(maxsize=1)
def load_defects() -> tuple[DefectInfo, ...]:
    """Загружает каталог из `defects.json`, упакованного вместе с кодом.

    Кэш на процесс — файл неизменен между запросами, перечитывать на каждый
    вызов эндпоинта незачем (CLAUDE.md § «СТОИМОСТЬ» тот же принцип: не
    делай на запрос то, что можно сделать один раз).
    """
    raw = resources.files(__package__).joinpath("defects.json").read_text(encoding="utf-8")
    entries = json.loads(raw)
    return tuple(
        DefectInfo(
            id=entry["id"],
            name_ru=entry["name_ru"],
            symptoms=entry["symptoms"],
            materials=entry["materials"],
            causes=entry["causes"],
            recommendations=entry["recommendations"],
        )
        for entry in entries
    )


def get_defect(defect_id: str) -> DefectInfo | None:
    """Один дефект по id, `None` если такого нет в каталоге."""
    for defect in load_defects():
        if defect.id == defect_id:
            return defect
    return None
