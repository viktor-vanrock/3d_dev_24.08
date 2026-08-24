"""Golden-set экстракции календаря релизов (MF-644).

GigaChat в этом окружении не вызывается (нет `GIGACHAT_CREDENTIALS`, см.
`docs/architecture/readme.md` "живём без ключа") — `ask_text` замокан на
фиксированный ответ, как если бы модель его вернула. Это НЕ метрика качества
самой модели, а регрессионный якорь для кода экстрактора/валидации
(`giga.calendar.extract`): пары (статья, ответ модели) → ожидаемые принятые
события фиксируют контракт, ловят регрессии при правках промпта/парсера.
Когда кредам появятся — тот же набор прогоняется с реальным `ask_text`,
формат кейсов не меняется.

Статьи — реальные, взяты со `blog.prusa3d.com/feed/` (вендор-ньюсрум,
источник MF-644) и `elegoo.com/blogs/news` 2026-07-09, тексты сокращены до
сути для читаемости кейса.
"""

from __future__ import annotations

from dataclasses import dataclass

from giga.calendar.fetch import Article

_PUBLISHED_2026_07_03 = "2026-07-03T09:46:16+00:00"


@dataclass(frozen=True)
class GoldenCase:
    name: str
    article: Article
    model_response: str
    expected_model_names: list[str]


CASES: list[GoldenCase] = [
    GoldenCase(
        name="prusa_indx_founders_edition_shipping",
        article=Article(
            source_id="prusa-blog",
            vendor_slug="prusa-research",
            vendor_name="Prusa Research",
            title="State of INDX – July 2026 Update: Founder's Edition Shipping + What's Next",
            url="https://blog.prusa3d.com/indx_july_2026_update_137377/",
            published_at=None,
            text=(
                "The Bondtech INDX Founder's Edition is out in the wild - huge congrats to our "
                "friends from Bondtech! With that milestone behind us, we're moving to the next "
                "phase: shipping the standard INDX Conversion Kit for CORE One/+."
            ),
        ),
        model_response="""```json
{
  "events": [
    {
      "model_name": "INDX Founder's Edition",
      "status": "shipping",
      "announced_at": null,
      "preorder_at": null,
      "ship_at": "2026-07-03",
      "eol_at": null,
      "confidence": 0.8,
      "is_release_event": true
    }
  ]
}
```""",
        expected_model_names=["INDX Founder's Edition"],
    ),
    GoldenCase(
        name="elegoo_trade_show_booth_is_not_a_release",
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
{"events": []}
```""",
        expected_model_names=[],
    ),
    GoldenCase(
        name="elegoo_firmware_update_notice_is_not_a_release",
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
{
  "events": [
    {
      "model_name": "Centauri Carbon",
      "status": "shipping",
      "announced_at": null,
      "preorder_at": null,
      "ship_at": null,
      "eol_at": null,
      "confidence": 0.2,
      "is_release_event": false
    }
  ]
}
```""",
        expected_model_names=[],
    ),
]
