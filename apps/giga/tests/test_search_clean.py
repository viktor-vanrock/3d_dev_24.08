"""Тесты очистки markdown перед эмбеддингом (MF-503).

Критерий приёмки — в индексе нет `#`, `*`, `](`, код-фенсов; ссылки/картинки
дают текст/alt, не URL/синтаксис.
"""

from __future__ import annotations

import pytest

from giga.search.clean import strip_markdown

MARKDOWN_SAMPLE = """# Дракон для стола

Печатается **без поддержек**, материал *PLA*.

- Высота 12см
- Цвет: любой

1. Слой 0.2мм
2. Заполнение 15%

| Параметр | Значение |
|---|---|
| Слой | 0.2мм |
| Заполнение | 15% |

Профиль: [моя страница](https://example.com/me) и превью
![дракон в анфас](https://example.com/img.png).

Материал `PLA+` подходит лучше всего.

```python
print("не индексировать")
```

> Автор рекомендует холодную печать.

---

Автолинк без текста: <https://example.com/track>

~~устарело~~ актуально
"""


def test_strips_markdown_syntax_tokens():
    cleaned = strip_markdown(MARKDOWN_SAMPLE)
    for token in ("#", "*", "](", "```", "~~", "|", ">"):
        assert token not in cleaned, f"{token!r} просочился в индекс: {cleaned!r}"


def test_keeps_heading_and_paragraph_text():
    cleaned = strip_markdown(MARKDOWN_SAMPLE)
    assert "Дракон для стола" in cleaned
    assert "без поддержек" in cleaned
    assert "PLA" in cleaned


def test_keeps_list_and_table_content():
    cleaned = strip_markdown(MARKDOWN_SAMPLE)
    assert "Высота 12см" in cleaned
    assert "Заполнение" in cleaned
    assert "15%" in cleaned


def test_link_text_kept_url_dropped():
    cleaned = strip_markdown(MARKDOWN_SAMPLE)
    assert "моя страница" in cleaned
    assert "example.com" not in cleaned


def test_image_alt_kept_url_dropped():
    cleaned = strip_markdown(MARKDOWN_SAMPLE)
    assert "дракон в анфас" in cleaned
    assert "img.png" not in cleaned


def test_bare_autolink_dropped_entirely():
    cleaned = strip_markdown(MARKDOWN_SAMPLE)
    assert "track" not in cleaned


def test_inline_code_kept_without_backticks():
    cleaned = strip_markdown(MARKDOWN_SAMPLE)
    assert "PLA+" in cleaned
    assert "`" not in cleaned


def test_code_fence_content_dropped():
    cleaned = strip_markdown(MARKDOWN_SAMPLE)
    assert "не индексировать" not in cleaned
    assert "print" not in cleaned


def test_blockquote_text_kept():
    cleaned = strip_markdown(MARKDOWN_SAMPLE)
    assert "холодную печать" in cleaned


def test_strikethrough_text_kept_without_markers():
    cleaned = strip_markdown(MARKDOWN_SAMPLE)
    assert "устарело" in cleaned


@pytest.mark.parametrize("empty", ["", "   ", "\n\n", None])
def test_empty_or_none_returns_empty_string(empty):
    assert strip_markdown(empty) == ""


def test_plain_text_without_markdown_passes_through_unchanged_content():
    plain = "Обычное описание без разметки, просто предложение."
    assert strip_markdown(plain) == plain


def test_raw_html_tags_and_attributes_not_indexed():
    cleaned = strip_markdown(
        'Текст с <script>alert(1)</script> и <b onclick="x()">жирным</b>.'
    )
    assert "<script>" not in cleaned
    assert "onclick" not in cleaned
    assert "<b" not in cleaned
    # Текст между тегами — просто текст описания, остаётся.
    assert "Текст с" in cleaned
    assert "жирным" in cleaned


def test_headings_of_all_levels_stripped():
    for level in range(1, 7):
        cleaned = strip_markdown(f"{'#' * level} Заголовок уровня {level}")
        assert cleaned == f"Заголовок уровня {level}"


def test_nested_emphasis_inside_link_text_kept():
    cleaned = strip_markdown("Смотри [**важную** страницу](https://example.com)")
    assert "важную" in cleaned
    assert "страницу" in cleaned
    assert "example.com" not in cleaned
