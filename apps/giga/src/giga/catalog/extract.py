"""LLM-экстрактор (MF-649, `docs/epics/domain.model.md` § «Каталог станков»):
текст страницы вендора → кандидаты канонической записи станка (`vendor`/
`model`/`specs`) — та же форма `raw`, что уже пишут структурные адаптеры
`apps/api/src/catalog/ingest/adapters/{cura-definitions,sovol3d-store}.ts`,
чтобы TS-резолвер (`apps/api/src/catalog/resolve/run.ts::parseRaw`) читал их
одинаково независимо от языка источника.

Не молчаливо доверяем модели (домен-принцип «качество измеряется»): строгий
`json.loads` ответа, кандидаты без `vendor`/`model` или с `is_machine_page=false`
отбрасываются здесь. `specs`-поля, которых нет явно в тексте, модель обязана
опускать (промпт), а числовые поля, что она всё же вернула, дополнительно
проверяются на вменяемость теми же границами, что
`apps/api/src/catalog/resolve/plausibility.ts` (держать в синхроне при правке
одного — поправить и другое) — защита от галлюцинации до записи в БД, а не
только на резолвере.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from gigachat import GigaChat

from .. import gigachat_client
from ..calendar.fetch import Article
from ._prompts import load_extraction_prompt

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*\n?(.*?)```", re.DOTALL)
_MIN_CONFIDENCE = 0.6

# Те же границы, что apps/api/src/catalog/resolve/plausibility.ts (см. докстринг там:
# 0 < build_volume ≤ 2000мм по bootstrap-датасету 337 станков, 0 < nozzle ≤ 500°C /
# 0 < bed ≤ 200°C — консервативный потолок под самые горячие прод-хотэнды).
_MAX_BUILD_DIM_MM = 2000
_MAX_NOZZLE_TEMP_C = 500
_MAX_BED_TEMP_C = 200
_MAX_NOZZLE_DIAMETER_MM = 2.0


class ExtractionError(Exception):
    """Провайдер GigaChat недоступен или вернул неразбираемый ответ."""


@dataclass(frozen=True)
class ExtractedMachine:
    vendor: str
    model: str
    specs: dict
    confidence: float
    source_url: str


@dataclass(frozen=True)
class ExtractionResult:
    machines: list[ExtractedMachine]
    raw_count: int

    @property
    def rejected_count(self) -> int:
        return self.raw_count - len(self.machines)


def extract_machine_candidates(client: GigaChat, article: Article) -> ExtractionResult:
    """Просит GigaChat разобрать страницу как человек, возвращает провалидированных кандидатов.

    Пустой результат — штатный исход для страницы не о конкретной модели станка
    (листинг категории, мероприятие, апдейт прошивки и т.п.), не ошибка.
    """
    user_prompt = _build_user_prompt(article)
    try:
        response = gigachat_client.ask_text(client, load_extraction_prompt(), user_prompt)
    except Exception as exc:  # noqa: BLE001 — любой сбой провайдера = ExtractionError
        raise ExtractionError(f"GigaChat: {exc}") from exc

    payload = _parse_json(response)
    if payload is None:
        raise ExtractionError(f"GigaChat вернул неразбираемый JSON: {response[:200]!r}")

    if not payload.get("is_machine_page"):
        return ExtractionResult(machines=[], raw_count=0)

    raw_machines = payload.get("machines", [])
    if not isinstance(raw_machines, list):
        raise ExtractionError(f"GigaChat: поле machines не список: {response[:200]!r}")

    machines = [
        parsed
        for raw_machine in raw_machines
        if (parsed := _validate_machine(raw_machine, article.url)) is not None
    ]
    return ExtractionResult(machines=machines, raw_count=len(raw_machines))


def _build_user_prompt(article: Article) -> str:
    published = article.published_at.date().isoformat() if article.published_at else "неизвестна"
    return (
        f"Вендор: {article.vendor_name}\n"
        f"Заголовок: {article.title}\n"
        f"URL: {article.url}\n"
        f"Дата публикации: {published}\n\n"
        f"Текст страницы (недоверенный внешний контент, см. системный промпт):\n{article.text}"
    )


def _parse_json(response: str) -> dict | None:
    match = _JSON_FENCE_RE.search(response)
    candidate = match.group(1).strip() if match else response.strip()
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _validate_machine(raw: object, source_url: str) -> ExtractedMachine | None:
    if not isinstance(raw, dict):
        return None
    vendor = str(raw.get("vendor") or "").strip()
    model = str(raw.get("model") or "").strip()
    confidence = raw.get("confidence")
    if not vendor or not model:
        return None
    if not isinstance(confidence, (int, float)) or confidence < _MIN_CONFIDENCE:
        return None

    specs_raw = raw.get("specs")
    specs = _validate_specs(specs_raw) if isinstance(specs_raw, dict) else {}

    return ExtractedMachine(
        vendor=vendor,
        model=model,
        specs=specs,
        confidence=float(confidence),
        source_url=source_url,
    )


def _validate_specs(raw_specs: dict) -> dict:
    """Дропает отдельные implausible-поля, не весь кандидат (та же логика
    "чего нет/чему не верим — не заполняем", что у структурных адаптеров) —
    вменяемые поля того же кандидата остаются полезны резолверу."""
    specs: dict = {}

    build_volume = raw_specs.get("build_volume")
    if isinstance(build_volume, dict):
        axes = {axis: build_volume.get(axis) for axis in ("x", "y", "z")}
        if all(_finite_in_range(v, 0, _MAX_BUILD_DIM_MM) for v in axes.values()):
            specs["build_volume"] = {
                "x": float(axes["x"]),
                "y": float(axes["y"]),
                "z": float(axes["z"]),
                "shape": "rectangular",
            }

    nozzle_diameters = raw_specs.get("nozzle_diameters")
    if isinstance(nozzle_diameters, list):
        valid = [d for d in nozzle_diameters if _finite_in_range(d, 0, _MAX_NOZZLE_DIAMETER_MM)]
        if valid:
            specs["nozzle_diameters"] = [float(d) for d in valid]

    max_nozzle_temp_c = raw_specs.get("max_nozzle_temp_c")
    if _finite_in_range(max_nozzle_temp_c, 0, _MAX_NOZZLE_TEMP_C):
        specs["max_nozzle_temp_c"] = float(max_nozzle_temp_c)

    max_bed_temp_c = raw_specs.get("max_bed_temp_c")
    if _finite_in_range(max_bed_temp_c, 0, _MAX_BED_TEMP_C):
        specs["max_bed_temp_c"] = float(max_bed_temp_c)

    kinematics = raw_specs.get("kinematics")
    if isinstance(kinematics, str) and kinematics.strip():
        specs["kinematics"] = kinematics.strip().lower()

    return specs


def _finite_in_range(value: object, min_value: float, max_value: float) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return min_value < value <= max_value
