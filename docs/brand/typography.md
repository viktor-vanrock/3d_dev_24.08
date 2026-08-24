# Типографика Sber AI — SB Sans Display / SB Sans Text

← [readme.md](readme.md) · Источник: гайд Sber AI, с. «Типографика. На печати / Макет / На экранах».

Два семейства: **SB Sans Display** (заголовки) и **SB Sans Text** (тело, подзаголовки,
интерфейс). Оба — фирменные шрифты Сбера: легко читаются в крупном и мелком размере,
дружелюбный открытый характер, широкая линейка начертаний, хорошо адаптируются к носителям.

## SB Sans Display — заголовки

- Начертания: **Light / Regular / Semibold**.
- **Semibold** — основное для заголовков. **Light** — только в очень крупных заголовках.
- Печать: от **14 pt**. Экран: от **16 pt**.

Дисплейная шкала (размер / интерлиньяж, на экранах):

| Размер/LH | Начертание |
|---|---|
| 128 / 128 | Semibold · Light |
| 72 / 76 | Semibold · Light |
| 60 / 66 | Semibold · Light |
| 48 / 54 | Semibold |
| 40 / 48 | Semibold |
| 32 / 40 | Semibold |
| 28 / 34 | Semibold |
| 24 / 30 | Semibold |
| 20 / 26 | Semibold |
| 18 / 24 | Semibold |
| 16 / 20 | Semibold |

## SB Sans Text — тело, подзаголовки, интерфейс

Начертания: **Regular / Medium / Semibold**. Линейка Text подходит для мелкого текста (9–18 pt).

**Lead Text** (крупный вводный):

| Размер/LH | Начертания |
|---|---|
| 28 / 38 | Semibold · Regular |
| 24 / 32 | Semibold · Regular |
| 20 / 28 | Semibold · Regular |

**Paragraph Text** (основной):

| Размер/LH | Начертания |
|---|---|
| 18 / 26 | Semibold · Regular |
| 16 / 24 | Semibold · Regular |
| 14 / 20 | Semibold · Regular |

**Caption / Legal:**

| Размер/LH | Начертание |
|---|---|
| 12 / 16 | Caption Medium |
| 10 / 14 | Legal Medium |

**Interface (мобильные интерфейсы, SB Sans Text Semibold):**

| Размер/LH | Начертание |
|---|---|
| 18 / 22 | Interface Semibold |
| 16 / 20 | Interface Semibold |
| 14 / 18 | Interface Semibold |

## Макет и вёрстка

- **Гармония и контраст.** Много воздуха, гармоничная композиция текстовых блоков, свободный
  подход к вёрстке, контрасты в сочетании начертаний.
- Настроение вёрстки: **динамика, спонтанность, неожиданность**.

## Реконсиляция с порталом

✅ **Решено (2026-07-18, оператор).** Портал использовал **Unbounded** (дисплей, `--font-display`)
+ Inter/Golos Text (UI); официальный шрифт Sber AI — **SB Sans Display / SB Sans Text**. Портал
переключён: `--ref-font-display`/`--ref-font-sans` (`apps/web/src/theme/tokens.css`) теперь
ссылаются на `--font-brand-display`/`--font-brand-text` (self-hosted SB Sans). Google Fonts
Unbounded (preconnect/link в `apps/web/index.html`) убран. Шкала кеглей и градация Semibold/Light
выше применима как система размеров.

## Файлы шрифтов в репозитории

**Полный кит** (все начертания, TTF · OTF · WEB) — `docs/brand/assets/fonts/`:
- `SBSansDisplay_v1_002/` — Thin/Light/Regular/Medium/SemiBold/Bold.
- `SBSansText_v1_003/` — Text + Cond/Comp/Caps/Heavy/Italic (полное семейство).

**Веб-рантайм** (self-hosted woff2, отдаются с `/brand/fonts/`) — `apps/web/public/brand/fonts/`:
Display Light/Regular/Medium/SemiBold/Bold + Text Light/Regular/Medium/Semibold/Bold.

`@font-face` и токены — `apps/web/src/theme/brand.fonts.css` (импортится в `main.tsx`).
Глобальный UI переключён: `--font-display`/`--font-sans` (tokens.css) резолвятся в
`--font-brand-display`/`--font-brand-text`. Точечно (в обход алиасов) можно взять напрямую:

```css
font-family: var(--font-brand-display);  /* "SB Sans Display" */
font-family: var(--font-brand-text);     /* "SB Sans Text"   */
```

Маппинг начертаний: Light 300 · Regular 400 · Medium 500 · SemiBold 600 · Bold 700 — весь код
UI использует только эти пять весов, пробелов относительно self-hosted кита не найдено.

Self-hosted вместо Google Fonts CDN (Unbounded) — плюс к устойчивости в РФ и офлайн-PWA.

**Известный пробел:** курсив (`font-style: italic`) встречается в ряде мест интерфейса
(например `.issueCommentDeleted`, `.markdownBody em`, `.modelDescription[data-empty]`), а
self-hosted кит содержит только normal-начертания — браузер рисует синтетический (наклонённый)
курсив вместо начертания из кита. Не блокер (деградация плавная), но если понадобится настоящий
italic — в `docs/brand/assets/fonts/SBSansText_v1_003/` есть полное семейство с Italic/Cond/
Comp/Caps/Heavy, можно самохостить недостающие начертания так же, как текущие пять.

**Кириллица.** Проверено по `cmap` всех 10 self-hosted `.woff2` (Display + Text ×5 начертаний):
полный базовый кириллический алфавит (А-Я, а-я, Ё/ё), цифры и типографская пунктуация
(«», —, №-знаки и т.п.) присутствуют во всех начертаниях — пробелов нет.

**Источник/лицензия.** SB Sans — фирменные шрифты Сбера, распространяются Сбером для применения
в экосистемных продуктах. Портал — Sber-экосистемный продукт; кит лежит в приватном рабочем
репозитории `gitverse.ru/plag/portal.ru` для использования агентами и командой.
