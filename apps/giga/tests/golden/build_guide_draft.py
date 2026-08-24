"""Golden-set черновика гайда сборки (MF-1007).

GigaChat в этом окружении не вызывается (нет `GIGACHAT_CREDENTIALS`, см.
`docs/architecture/readme.md` "живём без ключа") — `ask_text` замокан на
фиксированный ответ, как если бы модель его вернула. Это НЕ метрика качества
самой модели, а регрессионный якорь для кода экстрактора/валидации
(`giga.guides.draft`): пары (инструкция, ответ модели) → ожидаемые принятые
шаги фиксируют контракт, ловят регрессии при правках промпта/парсера. Когда
кредам появятся — тот же набор прогоняется с реальным `ask_text`, формат
кейсов не меняется.

Основной кейс — реальная секция сборки узла Voron 2.4 (motion system,
общедоступная документация проекта, docs.vorondesign.com), критерий карточки
"≥5 осмысленных шагов на русском" покрывается напрямую.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GoldenCase:
    name: str
    instructions_text: str
    model_response: str
    expected_titles: list[str]
    expected_min_steps: int


CASES = [
    GoldenCase(
        name="voron_2_4_gantry_assembly",
        instructions_text=(
            "Motion System Assembly.\n"
            "1. Attach the two linear rails to the X gantry plate using M3x8 socket "
            "head screws, four per rail.\n"
            "2. Press the LM8UU linear bearings into the printed bearing blocks, then "
            "slide them onto the X and Z smooth rods.\n"
            "3. Mount the X-axis stepper motor (LDO-42STH40-1684MAC) to the left "
            "gantry plate with M3x25 screws and route the motor cable along the "
            "gantry.\n"
            "4. Install the GT2 20-tooth pulley on the stepper shaft, leaving a "
            "0.5mm gap to the bearing, and tighten the grub screw.\n"
            "5. Thread the GT2 belt around the idler pulleys and the stepper pulley, "
            "then tension it so it produces a consistent pluck tone.\n"
            "6. Attach the toolhead carriage to the gantry using the linear rail "
            "carriages and M3x10 screws.\n"
        ),
        model_response="""```json
{
  "steps": [
    {
      "title": "Установить линейные рельсы на плиту гантри",
      "body": "Прикрутите рельсы к плите X-гантри винтами M3x8, по четыре на рельсу.",
      "parts": ["линейная рельса", "M3x8 винт"]
    },
    {
      "title": "Запрессовать линейные подшипники",
      "body": "Запрессуйте подшипники LM8UU в блоки, наденьте на стержни X и Z.",
      "parts": ["LM8UU линейный подшипник", "гладкий стержень"]
    },
    {
      "title": "Установить шаговый двигатель оси X",
      "body": "Закрепите двигатель LDO-42STH40-1684MAC винтами M3x25, проложите кабель.",
      "parts": ["LDO-42STH40-1684MAC шаговый двигатель", "M3x25 винт"]
    },
    {
      "title": "Установить шкив GT2 на вал двигателя",
      "body": "Наденьте шкив GT2 на вал, оставив зазор 0.5мм, затяните стопорный винт.",
      "parts": ["GT2 20-зубый шкив"]
    },
    {
      "title": "Натянуть ремень GT2",
      "body": "Проведите ремень вокруг роликов и шкива, натяните до ровного тона при щипке.",
      "parts": ["GT2 ремень"]
    },
    {
      "title": "Закрепить каретку тулхеда на гантри",
      "body": "Прикрепите каретку тулхеда к гантри через каретки линейных рельс винтами M3x10.",
      "parts": ["M3x10 винт"]
    }
  ]
}
```""",
        expected_titles=[
            "Установить линейные рельсы на плиту гантри",
            "Запрессовать линейные подшипники",
            "Установить шаговый двигатель оси X",
            "Установить шкив GT2 на вал двигателя",
            "Натянуть ремень GT2",
            "Закрепить каретку тулхеда на гантри",
        ],
        expected_min_steps=5,
    ),
    GoldenCase(
        name="marketing_text_is_not_an_instruction",
        instructions_text=(
            "Наш новый принтер печатает быстрее и тише конкурентов! Закажите сейчас "
            "со скидкой 20% до конца месяца."
        ),
        model_response="""```json
{"steps": []}
```""",
        expected_titles=[],
        expected_min_steps=0,
    ),
]
