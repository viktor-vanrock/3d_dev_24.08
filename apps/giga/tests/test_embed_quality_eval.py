"""Eval MF-348: критерий приёмки — близкие по смыслу RU-запросы должны получать
меньшее косинусное расстояние, чем несвязанные.

Двух режима:

- `test_close_pairs_score_lower_cosine_distance_than_unrelated` — гоняется всегда,
  в т.ч. без `GIGACHAT_CREDENTIALS` (CI/локально). Реального эмбеддинга GigaChat
  здесь нет (see `docs/architecture/readme.md` "живём без ключа"), поэтому вместо
  реальной модели подставлен детерминированный псевдо-эмбеддинг на основе того же
  лексического прокси, что и `golden/relevance_scoring.py` (`stems`/hashing в
  вектор фиксированной длины). Это НЕ метрика качества модели GigaChat — это
  регрессионный якорь на код `giga.search.embed` (нормализация/сборка батча/порядок)
  через ту же самую cosine-геометрию, которую увидит реальный вызов.
- `test_real_gigachat_close_pairs_score_lower_cosine_distance` — пропускается
  (`skipif`), если `GIGACHAT_CREDENTIALS` не задан. На VDS/окружении с реальными
  кредами (Ops) прогоняется по-настоящему и подтверждает критерий приёмки карточки
  на живой модели, не на прокси.
"""

from __future__ import annotations

import os

import pytest
from golden.relevance_scoring import stems

from giga import gigachat_client
from giga.search import embed as search_embed

# 5 пар: (запрос А, запрос Б, ожидание — "близко" или "далеко").
# Прокси-режим лексический (см. docstring модуля) — "close"-пары намеренно
# делят словарь (перефразировка), а не только смысл (синонимы без общих слов
# лексический прокси в принципе не различит от несвязанного текста; это
# ограничение прокси, а не баг — реальная семантика проверяется вторым тестом
# на живой модели).
_PAIRS = [
    ("дракон для рабочего стола", "статуэтка дракона на рабочий стол", "close"),
    ("подставка для телефона на стол", "подставка под смартфон на рабочий стол", "close"),
    ("шестерёнка для 3d принтера", "запасная шестерёнка для 3d принтера", "close"),
    ("дракон для рабочего стола", "рецепт борща на зиму", "far"),
    ("подставка для телефона на стол", "чехол для косплей доспехов", "far"),
]


def _hash_stem_vector(text: str, dim: int = search_embed.EMBEDDING_DIM) -> list[float]:
    """Детерминированный псевдо-эмбеддинг: хэшируем каждый стебель в координату вектора.

    Не несёт семантики GigaChat — только проверяет, что `embed_texts` (батч,
    нормализация, сборка по .index) корректно доносит cosine-геометрию входа
    до выходных векторов.
    """
    vector = [0.0] * dim
    for stem, count in stems(text).items():
        vector[hash(stem) % dim] += float(count)
    return vector


class _FakeEmbeddingItem:
    def __init__(self, index: int, vector: list[float]):
        self.index = index
        self.embedding = vector


class _FakeEmbeddingsResponse:
    def __init__(self, items):
        self.data = items


class _FakeStemHashClient:
    """Фейковый GigaChat-клиент: эмбеддинг = хэш-вектор стеблей текста."""

    def embeddings(self, texts, model):
        vectors = [_hash_stem_vector(t) for t in texts]
        return _FakeEmbeddingsResponse(
            [_FakeEmbeddingItem(i, v) for i, v in enumerate(vectors)]
        )


def _cosine_distance(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    return 1.0 - dot  # векторы уже L2-нормированы в embed_texts


def _run_eval(client) -> None:
    close_distances: list[float] = []
    far_distances: list[float] = []
    for text_a, text_b, kind in _PAIRS:
        vec_a, vec_b = search_embed.embed_texts(client, [text_a, text_b])
        distance = _cosine_distance(vec_a, vec_b)
        (close_distances if kind == "close" else far_distances).append(distance)
        print(f"\nMF-348 '{text_a}' vs '{text_b}' ({kind}) — cosine distance={distance:.3f}")

    assert close_distances, "нет пар 'close' в golden-наборе"
    assert far_distances, "нет пар 'far' в golden-наборе"
    assert max(close_distances) < min(far_distances), (
        f"близкие пары должны иметь меньшее косинусное расстояние: "
        f"max(close)={max(close_distances):.3f} min(far)={min(far_distances):.3f}"
    )


def test_close_pairs_score_lower_cosine_distance_than_unrelated():
    _run_eval(_FakeStemHashClient())


@pytest.mark.skipif(
    not os.getenv("GIGACHAT_CREDENTIALS"),
    reason="нужны реальные GIGACHAT_CREDENTIALS — прогон на VDS/окружении с кредами",
)
def test_real_gigachat_close_pairs_score_lower_cosine_distance():
    client = gigachat_client.load_client()
    assert client is not None
    _run_eval(client)
