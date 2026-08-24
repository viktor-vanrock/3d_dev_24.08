"""Eval MF-503: качество поиска на golden-set не деградирует от очистки markdown.

Метод (прокси, см. `golden/relevance_scoring.py` докстринг — реальных
GigaChat-эмбеддингов в окружении нет, Фаза 1-2 нейропоиска не реализована):
MRR (mean reciprocal rank) по 6 запросам/6 документам golden-set, посчитанный
на трёх представлениях одного и того же описания:

- ``baseline`` — сегодняшнее plain-описание (до перехода на markdown);
- ``markdown_raw`` — markdown-сырец БЕЗ очистки (как если бы эмбеддили как есть);
- ``markdown_cleaned`` — вывод `giga.search.clean.strip_markdown` (эта карточка).

Критерий приёмки MF-503 — качество не хуже baseline (тест `test_cleaned_
markdown_matches_baseline_relevance_on_golden_set`). Второй тест —
`test_raw_markdown_leaks_url_noise_that_cleaning_removes` — не про
критерий приёмки этой карточки, а про то, ЗАЧЕМ она нужна: он ловит
конкретный сценарий из `search_relevance.json` (документ `d2-cosplay-armor`
хранит фото с переиспользованным именем файла `дракон_бой_студия.png`) —
сырой markdown протаскивает это слово из URL в текст и делает документ
про доспехи ложно похожим на запрос про дракона; очистка убирает URL и
шум исчезает. MRR по всему golden-set при этом не обязан меняться (в
шести документах ложный сигнал недостаточно силён, чтобы обогнать
настоящий), поэтому риск проверяется прямым сравнением похожести
документа-ловушки на релевантный запрос, а не через ранжирование.
"""

from __future__ import annotations

import json
from pathlib import Path

from golden.relevance_scoring import cosine_similarity, mean_reciprocal_rank, stems

from giga.search.clean import strip_markdown

_GOLDEN_SET_PATH = Path(__file__).parent / "golden" / "search_relevance.json"


def _load_golden_set() -> dict:
    return json.loads(_GOLDEN_SET_PATH.read_text(encoding="utf-8"))


def test_cleaned_markdown_matches_baseline_relevance_on_golden_set():
    golden = _load_golden_set()
    documents = golden["documents"]
    queries = golden["queries"]

    baseline = {d["id"]: d["baseline_plain"] for d in documents}
    markdown_raw = {d["id"]: d["markdown"] for d in documents}
    markdown_cleaned = {d["id"]: strip_markdown(d["markdown"]) for d in documents}

    mrr_baseline = mean_reciprocal_rank(queries, baseline)
    mrr_raw = mean_reciprocal_rank(queries, markdown_raw)
    mrr_cleaned = mean_reciprocal_rank(queries, markdown_cleaned)

    print(
        f"\nMF-503 golden-set MRR — baseline={mrr_baseline:.3f} "
        f"markdown_raw={mrr_raw:.3f} markdown_cleaned={mrr_cleaned:.3f}"
    )

    # Критерий приёмки: очистка не хуже baseline.
    assert mrr_cleaned >= mrr_baseline, (
        f"очистка markdown хуже baseline: cleaned={mrr_cleaned:.3f} baseline={mrr_baseline:.3f}"
    )


def test_raw_markdown_leaks_url_noise_that_cleaning_removes():
    golden = _load_golden_set()
    docs_by_id = {d["id"]: d for d in golden["documents"]}
    query = next(q["text"] for q in golden["queries"] if q["expected_doc"] == "d1-dragon")
    trap_doc = docs_by_id["d2-cosplay-armor"]["markdown"]  # URL leaks "дракон" из имени файла

    query_stems = stems(query)
    raw_score = cosine_similarity(query_stems, stems(trap_doc))
    cleaned_score = cosine_similarity(query_stems, stems(strip_markdown(trap_doc)))

    print(
        f"\nMF-503 контаминация запроса '{query}' документом-ловушкой d2 — "
        f"raw={raw_score:.3f} cleaned={cleaned_score:.3f}"
    )

    assert raw_score > 0, "golden-set перестал воспроизводить утечку — обнови сценарий ловушки"
    assert cleaned_score == 0.0, "очистка должна полностью убрать шум из URL/alt"
