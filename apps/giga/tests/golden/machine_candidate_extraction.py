"""Golden-set экстракции каталога станков (MF-649).

GigaChat в этом окружении не вызывается (нет `GIGACHAT_CREDENTIALS`, см.
`docs/architecture/readme.md` "живём без ключа") — `ask_text` замокан на
фиксированный ответ, как если бы модель его вернула. Это НЕ метрика качества
самой модели, а регрессионный якорь для кода экстрактора/валидации
(`giga.catalog.extract`): пары (страница, ответ модели) → ожидаемые принятые
кандидаты фиксируют контракт, ловят регрессии при правках промпта/парсера.
Когда кредам появятся — тот же набор прогоняется с реальным `ask_text`,
формат кейсов не меняется.

Статьи — тот же реальный контент, что `golden/release_calendar_extraction.py`
(`blog.prusa3d.com/feed/`, `elegoo.com/blogs/news`, 2026-07-09), плюс один
заведомо мусорный кейс (страница не о станке), покрывающий явное требование
карточки "на мусорном HTML не искажает канон".
"""

from __future__ import annotations

from dataclasses import dataclass

from giga.calendar.fetch import Article


@dataclass(frozen=True)
class GoldenCase:
    name: str
    article: Article
    model_response: str
    expected: list[tuple[str, str]]  # (vendor, model)


CASES = [
    GoldenCase(
        name="prusa_core_two_build_volume_from_announcement",
        article=Article(
            source_id="prusa-blog",
            vendor_slug="prusa-research",
            vendor_name="Prusa Research",
            title="Announcing the CORE Two",
            url="https://blog.prusa3d.com/core-two/",
            published_at=None,
            text=(
                "Prusa is proud to announce the CORE Two, a CoreXY printer with a "
                "250x220x270mm build volume and a 0.4mm nozzle, shipping this fall."
            ),
        ),
        model_response="""```json
{
  "is_machine_page": true,
  "machines": [
    {
      "vendor": "Prusa Research",
      "model": "CORE Two",
      "specs": {
        "kinematics": "corexy",
        "build_volume": {"x": 250, "y": 220, "z": 270},
        "nozzle_diameters": [0.4]
      },
      "confidence": 0.9
    }
  ]
}
```""",
        expected=[("Prusa Research", "CORE Two")],
    ),
    GoldenCase(
        name="elegoo_trade_show_booth_is_not_a_machine_page",
        article=Article(
            source_id="elegoo-blog",
            vendor_slug="elegoo",
            vendor_name="Elegoo",
            title="Join ELEGOO at Open Sauce 2026 – See Creativity Printed in 3D!",
            url="https://www.elegoo.com/blogs/news/join-elegoo-at-open-sauce-2026",
            published_at=None,
            text="Come visit our booth at Open Sauce 2026 and see live demos of our printers.",
        ),
        model_response="""```json
{"is_machine_page": false, "machines": []}
```""",
        expected=[],
    ),
    GoldenCase(
        name="elegoo_firmware_update_mentions_model_but_no_new_specs",
        article=Article(
            source_id="elegoo-blog",
            vendor_slug="elegoo",
            vendor_name="Elegoo",
            title="Update Notice on Centauri Carbon",
            url="https://www.elegoo.com/blogs/news/update-notice-on-centauri-carbon",
            published_at=None,
            text=(
                "We've released a firmware update for the Centauri Carbon that improves "
                "stability. No hardware changes."
            ),
        ),
        model_response="""```json
{"is_machine_page": false, "machines": []}
```""",
        expected=[],
    ),
]
