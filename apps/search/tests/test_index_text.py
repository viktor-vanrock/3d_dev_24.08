"""Порт `apps/api/src/models/indexText.test.ts` — проверяет, что Python-сборка документа
(`index_text.build_model_index_text`) совпадает по поведению с продюсерской (TS) версией."""

from __future__ import annotations

from portal_search.index_text import DEFAULT_MAX_INDEX_TOKENS, build_model_index_text


def test_concatenates_title_description_and_tags():
    text = build_model_index_text(
        "Statuette Дракончик", "Милый дракончик для стола", ["дракон", "фэнтези"]
    )
    assert "Statuette Дракончик" in text
    assert "Милый дракончик для стола" in text
    assert "дракон, фэнтези" in text


def test_deterministic_for_same_input():
    args = ("A", "B", ["c", "d"])
    assert build_model_index_text(*args) == build_model_index_text(*args)


def test_handles_empty_or_none_description_without_stray_whitespace():
    assert build_model_index_text("Just a title", None, []) == "Just a title"
    assert build_model_index_text("Just a title", "", []) == "Just a title"


def test_drops_empty_or_blank_tags():
    text = build_model_index_text("T", None, ["", "  ", "real"])
    assert text == "T\n\nreal"


def test_strips_markdown_image_link_and_heading_syntax():
    text = build_model_index_text(
        "T", "# Заголовок\n\nСмотри ![alt](https://x/1.png) и [ссылку](https://x)", []
    )
    assert "![" not in text
    assert "](" not in text
    assert "#" not in text
    assert "Заголовок" in text
    assert "Смотри alt и ссылку" in text


def test_truncates_long_document_on_word_boundary():
    long_description = "слово " * 10_000
    text = build_model_index_text("T", long_description, [])

    max_chars = DEFAULT_MAX_INDEX_TOKENS * 2.5
    assert len(text) <= max_chars
    assert text.endswith("слово") or text.endswith("T")


def test_respects_custom_max_tokens():
    long_description = "слово " * 1000
    text = build_model_index_text("T", long_description, [], max_tokens=10)
    assert len(text) <= int(10 * 2.5) + len("T\n\n")


def test_normalizes_description_whitespace():
    text = build_model_index_text("T", "line1\r\nline2\n\n\n\nline3", [])
    assert text == "T\n\nline1\nline2\n\nline3"
