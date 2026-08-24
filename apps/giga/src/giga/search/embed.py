"""Обёртка над GigaChat Embeddings API для RU-текста (MF-348, Фаза 1 нейропоиска).

Модель и размерность зафиксированы здесь константами, а не выводятся из
ответа API: `EMBEDDING_MODEL`/`EMBEDDING_DIM` — контракт для Data (MF-1014,
колонка `vector(N)` в pgvector) и для `apps/api` (гибридный поиск зовёт этот
же `/embed` для эмбеддинга запроса, см. `docs/epics/neural.search.md`).
Ответ API валидируется на совпадение размерности с `EMBEDDING_DIM` — если
Sber тихо поменяет модель/размерность, вызов падает явной ошибкой, а не
молча кладёт вектор другой длины в БД (pgvector-колонка фиксированной
размерности такое всё равно отклонит, но раньше и понятнее — на этом слое).

Батч: GigaChat Embeddings принимает список текстов одним HTTP-вызовом —
дешевле, чем звать API на каждый текст поштучно (CLAUDE.md § «СТОИМОСТЬ»).
Режем на чанки по `_MAX_BATCH_SIZE`, чтобы не упереться в лимит размера
запроса провайдера; таймауты/ретраи — уже в SDK (`GigaChat(timeout=...)`,
декоратор `_with_retry` на `.embeddings()`), здесь их не дублируем.

Нормализация: L2-норма каждого вектора перед возвратом — косинусное
сходство нормированных векторов сводится к скалярному произведению
(дешевле для ORDER BY в pgvector), и сравнение не зависит от масштаба,
который модель может менять между версиями/чанками батча.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from gigachat.exceptions import GigaChatException

if TYPE_CHECKING:
    from gigachat import GigaChat

EMBEDDING_MODEL = "Embeddings"
# Размерность модели GigaChat "Embeddings":
# https://developers.sber.ru/docs/ru/gigachat/models/embeddings
EMBEDDING_DIM = 1024

_MAX_BATCH_SIZE = 64


class EmbeddingError(Exception):
    """Ошибка провайдера или контракта размерности — ловится HTTP-слоем как 502."""


def embed_texts(client: GigaChat, texts: list[str]) -> list[list[float]]:
    """Возвращает L2-нормированные векторы длины `EMBEDDING_DIM`, по одному на текст.

    Порядок результата совпадает с порядком `texts` независимо от порядка,
    в котором провайдер вернул элементы батча. Пустой список -> пустой
    список без обращения к API (не ошибка — пустой ввод не наш случай).
    """
    if not texts:
        return []

    result: list[list[float]] = []
    for start in range(0, len(texts), _MAX_BATCH_SIZE):
        batch = texts[start : start + _MAX_BATCH_SIZE]
        result.extend(_embed_batch(client, batch))
    return result


def _embed_batch(client: GigaChat, batch: list[str]) -> list[list[float]]:
    try:
        response = client.embeddings(batch, model=EMBEDDING_MODEL)
    except GigaChatException as exc:
        raise EmbeddingError(f"GigaChat: {exc}") from exc

    if len(response.data) != len(batch):
        raise EmbeddingError(
            f"GigaChat вернул {len(response.data)} векторов на {len(batch)} текстов"
        )

    ordered = sorted(response.data, key=lambda item: item.index)
    return [_normalize(_validated(item.embedding)) for item in ordered]


def _validated(vector: list[float]) -> list[float]:
    if len(vector) != EMBEDDING_DIM:
        raise EmbeddingError(
            f"GigaChat вернул вектор размерности {len(vector)}, ожидалось {EMBEDDING_DIM}"
        )
    return vector


def _normalize(vector: list[float]) -> list[float]:
    norm = sum(x * x for x in vector) ** 0.5
    if norm == 0.0:
        return vector
    return [x / norm for x in vector]
