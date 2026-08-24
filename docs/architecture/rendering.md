# SSAA Рендер превью-миниатюр

← [docs/architecture/readme.md](readme.md)

Миниатюра модели в каталоге — это webp-ассет со статичным силуэтом объекта на прозрачном фоне (см. [model.preview.md](../design/model.preview.md)). Конвейер рендера (чистый Python-растеризатор без OpenGL) реализован в `apps/mesh/src/mesh/preview.py`.

## Компонента 1: GLB-ассет вьюера

Decimated меш для орбитального просмотра (three.js `GLTFLoader`):
- **Цель децимации:** ~150k треугольников (`PREVIEW_TARGET_FACES`, [preview.py:34](../../apps/mesh/src/mesh/preview.py#L34))
- **Жёсткий потолок веса:** ≤5 МБ (`PREVIEW_MAX_BYTES`, [preview.py:37](../../apps/mesh/src/mesh/preview.py#L37))
- **Алгоритм:** quadric decimation (из trimesh), с двоичным поиском при превышении лимита ([preview.py:117–138](../../apps/mesh/src/mesh/preview.py#L117-L138))

## Компонента 2: webp-миниатюра каталога (SSAA-конвейер)

### Разрешение и проекция

- **Выходное разрешение:** 512px квадрат (`THUMBNAIL_SIZE`, [preview.py:40](../../apps/mesh/src/mesh/preview.py#L40))
- **Проекция:** ортографическая из 3/4-ракурса
  - Азимут: 35° (вокруг Z) ([preview.py:59](../../apps/mesh/src/mesh/preview.py#L59))
  - Элевация: 25° над горизонтом ([preview.py:60](../../apps/mesh/src/mesh/preview.py#L60))
  - Матрица поворота: [preview.py:141–151](../../apps/mesh/src/mesh/preview.py#L141-L151)
- **Компоновка:** модель центрируется и вписывается в кадр с 10% полем по краям ([preview.py:168–178](../../apps/mesh/src/mesh/preview.py#L168-L178))

### SSAA (суперсэмплинг) и даунскейл

**Проблема:** растеризатор с бинарной альфой даёт «лесенку» на контуре силуэта.

**Решение:** рендерим в `SSAA`× больше (2×, итого 1024px), затем даунскейлим box-фильтром через предумноженную альфу:

- **SSAA фактор:** 2× ([preview.py:47](../../apps/mesh/src/mesh/preview.py#L47)) — компромисс качество/CPU. Растеризатор линеен по числу граней, не по пикселям, поэтому реальный оверхед меньше теоретического (~4×).
- **Даунскейл с корректной альфой:** функция `_downsample_rgba` ([preview.py:268–295](../../apps/mesh/src/mesh/preview.py#L268-L295))
  - Усредняем **предумноженный** цвет: `RGB × alpha`
  - Затем восстанавливаем непредумноженный RGB делением на среднюю альфу
  - Так фоновые пиксели (alpha=0) не вносят тёмный цвет в контур — только «разбавляют» альфу, давая гладкий полупрозрачный край

### Z-буфер и порядок отрисовки

- **Z-буфер:** двумерный массив (size, size), инициализируется `-∞` ([preview.py:191](../../apps/mesh/src/mesh/preview.py#L191))
- **Глубина:** view-координата Z (больше = ближе к камере), сравнение `depth > zbuf` перед закраской ([preview.py:252–253](../../apps/mesh/src/mesh/preview.py#L252-L253))
- **Порядок граней:** итеративный по всем треугольникам меша ([preview.py:198–209](../../apps/mesh/src/mesh/preview.py#L198-L209)); z-тест гарантирует правильный порядок стыков

### Диффузное освещение

- **Модель:** диффузное (Ламбертов) затенение по нормали грани
- **Источник света:** из-за плеча камеры, вектор `[0.3, 0.4, 1.0]` нормализуется ([preview.py:185–186](../../apps/mesh/src/mesh/preview.py#L185-L186))
- **Интенсивность:** `ambient + (1 − ambient) × max(normal·light, 0)`
  - Ambient = 0.35 ([preview.py:197](../../apps/mesh/src/mesh/preview.py#L197))
  - Базовая яркость ~35%, отражение света ~65%
- **Материал:** матовый нейтральный, albedo `rgb(200, 200, 200)` ([preview.py:57](../../apps/mesh/src/mesh/preview.py#L57)) — совпадает с дефолтом конвертера, чтобы миниатюра и слайсер выглядели заодно
- **Вычисление:** [preview.py:257–258](../../apps/mesh/src/mesh/preview.py#L257-L258)

### Контракт выхода: RGBA, прозрачный фон

- **Формат:** RGBA, 8 бит на канал ([preview.py:189, 211](../../apps/mesh/src/mesh/preview.py#L189))
- **Фон:** строго прозрачный `(0, 0, 0, 0)` ([preview.py:54](../../apps/mesh/src/mesh/preview.py#L54))
  - Никакой заливки под токен темы; тёмный фон и тень рисует CSS слоя презентации ([model.preview.md](../design/model.preview.md))
  - Это приёмочный инвариант: наличие непрозрачного фона в пикселях сломает слоёный стек каталога
- **Итоговое кодирование:** webp lossless=false, quality=90, method=4 ([preview.py:315](../../apps/mesh/src/mesh/preview.py#L315))

## Headless и CPU-ограничение (VDS без GPU)

**Растеризатор — чистый Python-цикл** ([preview.py:198–209](../../apps/mesh/src/mesh/preview.py#L198-L209)):
- Никаких зависимостей на OpenGL/GPU/драйверы
- Работает на headless VDS (systemd-воркер без дисплея)
- Линеен по числу граней, а не по пикселям → растёт медленно, но требует децимации плотных мешей

**Децимация для миниатюры:** `THUMBNAIL_MAX_FACES = 40_000` ([preview.py:51](../../apps/mesh/src/mesh/preview.py#L51)) — орбитальный вид не требует полного полигонажа, визуально на 512px-миниатюре разницы не видно.

## Обработка ошибок

- **`PreviewError`** — исключение для любого сбоя (децимация, GLB-экспорт, растеризация, webp-кодирование)
- **Гарантия модели:** генерация превью НЕ должна валить конвертацию. Воркер ловит исключение и оставляет модель `ready` без превью; фронт падает на fallback-постер ([preview.py:17–18](../../apps/mesh/src/mesh/preview.py#L17-L18), см. [marketplace.md](../design/marketplace.md) §12)

## Точка входа

**`generate_previews(mesh, glb_path, thumbnail_path)`** ([preview.py:321–329](../../apps/mesh/src/mesh/preview.py#L321-L329)) — генерирует оба ассета (GLB + webp) из распарсенной геометрии, кидает `PreviewError` при любом сбое.

---

**Смотри также:**
- [docs/design/model.preview.md](../design/model.preview.md) — контракт webp-фотки с фронтом, слоёный CSS-стек каталога
- [docs/design/marketplace.md](../design/marketplace.md) § 1.13 п.15 — fallback-цепочка вьюера и приёмочный контракт
- [docs/epics/marketplace.md](../epics/marketplace.md) § 1 п.3–4 — архрешение на ассеты и их роли
