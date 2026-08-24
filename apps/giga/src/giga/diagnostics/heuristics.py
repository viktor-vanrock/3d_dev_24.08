"""Черновой матчинг описания на каталог дефектов — заглушка для контракта (MF-360).

Реальный анализ фото через GigaChat Vision — отдельный шаг (MF-361/362, ещё не
реализован). Здесь — детерминированный keyword-матчинг по тексту описания,
нужный ровно затем, чтобы контракт `/diagnostics` можно было спроектировать и
проверить на валидных данных ДО того, как Vision-вызов появится: когда MF-362
придёт, он заменит `match_defects` внутри `main.create_diagnosis`, не меняя
форму ответа (`DiagnosisResponse` в `schemas.py`).

Не LLM-вызов — обычная сортировка по числу совпавших слов, без обращения к
GigaChat (CLAUDE.md § «СТОИМОСТЬ»: не зовём модель там, где хватает правила).
"""

from __future__ import annotations

import re

from .catalog import DefectInfo, load_defects

_WORD_RE = re.compile(r"[а-яёa-z0-9]+", re.IGNORECASE)

# Верхняя граница числа кандидатов в ответе — описание почти всегда указывает
# на 1-2 наиболее вероятных дефекта, длинный список менее полезен пользователю.
MAX_MATCHES = 3


def _tokenize(text: str) -> set[str]:
    # Слова короче 3 букв (предлоги/союзы "не", "по", "и" ...) отбрасываем —
    # иначе они "совпадают" почти с любым дефектом и матчинг превращается в шум.
    return {token.lower() for token in _WORD_RE.findall(text) if len(token) >= 3}


def _defect_tokens(defect: DefectInfo) -> set[str]:
    haystack = " ".join([defect.name_ru, *defect.symptoms, *defect.causes])
    return _tokenize(haystack)


def match_defects(description: str) -> list[DefectInfo]:
    """Дефекты, чьи признаки/причины пересекаются по словам с описанием.

    Пустое описание -> пустой список (нет сигнала для матчинга). Порядок —
    по убыванию числа совпавших токенов, не более `MAX_MATCHES`.
    """
    query_tokens = _tokenize(description)
    if not query_tokens:
        return []

    scored = [
        (len(query_tokens & _defect_tokens(defect)), defect) for defect in load_defects()
    ]
    scored = [(score, defect) for score, defect in scored if score > 0]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [defect for _score, defect in scored[:MAX_MATCHES]]
