# CI: headless OrcaSlicer/PrusaSlicer/Cura (MF-1918, MF-413 фаза 3 шаг 2)

Провижининг трёх слайсеров на CI-раннере GitVerse (`ubuntu-latest`, голый образ) в
headless-режиме (без X11/DISPLAY) — блокер CI-валидации реальным импортом
экспортёров профилей (`apps/mesh/src/mesh/slicer_profile_export.py`, MF-413).
Реализовано в `.gitverse/workflows/ci.yaml`, job `python`, шаг «Провижининг
headless-слайсеров», условие `matrix.app == 'mesh'` (не тратит время giga/scout).

## Пинованные версии (зафиксировано в паспорте MF-1918, 2026-07-18)

| Слайсер | Версия | Источник | Headless-режим |
|---|---|---|---|
| PrusaSlicer | `2.7.2+dfsg-1build2` | apt, Ubuntu 24.04 `universe` (`prusa-slicer`) | Нативно без DISPLAY — CLI не требует wx/GTK-инициализации для `--load`/`--export-*` |
| OrcaSlicer | `v2.4.2` (`OrcaSlicer_Linux_AppImage_Ubuntu2404_V2.4.2.AppImage`, sha256 `d12fb8c8eac1aecd2dfb6377acd48f994f8fa439ed5292fa532dd82880f029fd`) | GitHub-релиз `OrcaSlicer/OrcaSlicer` | `--appimage-extract` (без FUSE) + `apt install libopengl0 libglu1-mesa libwebkit2gtk-4.1-0` — без этих трёх пакетов бинарь падает с "missing host OpenGL/WebKitGTK runtime" даже для `--help` |
| Cura | `5.13.0` (`UltiMaker-Cura-5.13.0-linux-X64.AppImage`, sha256 `100f068127b2598167f00ba4db0e0699ded45adf97bbab2d22ff171a1e1ecc40`) | GitHub-релиз `Ultimaker/Cura` | `--appimage-extract` + патч `AppRun.env`: `QT_QPA_PLATFORM=xcb` → `offscreen` (иначе падает "could not connect to display") |

**PrusaSlicer официально не публикует Linux-бинарь на GitHub releases**
(только `.exe`/`.dmg`/`.zip` с исходниками) — проверено на `version_2.9.6` и
9 предыдущих релизах. Единственные подтверждённые Linux-пути — Ubuntu
`universe` apt-пакет (используется здесь) или Flathub
`com.prusa3d.PrusaSlicer`. Версия apt-пакета жёстко не пинуется (`apt-get
install prusa-slicer` без `=версия`) — мирроры `noble-updates` ротируют
build-суффикс, а сама версия для профильной семантики Orca/Prusa-экспортёра
не критична (в отличие от Cura, см. ниже). Фактическая версия логируется в
каждом прогоне CI.

## Контракт с потребителем (`apps/mesh`)

`apps/mesh/scripts/smoke_3mf.py::_validate_with_slicer` уже читает
`MESH_PRUSA_SLICER_BIN`/`MESH_ORCA_SLICER_BIN` (написано Mesh заранее, до
этой карточки, см. `apps/mesh/readme.md` § «Локальный запуск») и вызывает
`<binary> --info <файл>` — CI-шаг провижининга экспортирует оба через
`$GITHUB_ENV`, так что этот smoke-хук перестаёт быть no-op'ом. Проверено
живьём в этой карточке: `uv run python scripts/smoke_3mf.py` с обоими env
даёт `exit=0` и реальный `--info` вывод (`manifold = yes`, `number_of_facets
= 12`, ...) для сгенерированного `box.3mf`, `СМОУК OK`; `ruff check .` и
`pytest` (221 тест) зелёные с тем же окружением.

`MESH_CURA_BIN` тоже экспортируется (путь до `AppRun`), но `smoke_3mf.py` его
пока не читает — Cura ещё не подключена ни к одному живому CI-гейту, см.
«Открытый гэп» ниже.

**Добавлено (MF-1974, 2026-07-19, Mesh):** CI-шаг провижининга дополнительно
экспортирует `MESH_ORCA_PROFILES_DIR=/tmp/orca-appimage/resources/profiles` —
тот же извлечённый бандл несёт реальные вендорские `machine`/`process`/
`filament` профили (не только сам бинарь). Источник канонического профиля
Snapmaker U1 (`apps/mesh/src/mesh/snapmaker_u1_profile.py`) и живых тестов
`apps/mesh/tests/test_snapmaker_u1_*.py` — см. `docs/epics/slicer.profiles.md`
§ «Snapmaker U1 — реальный Orca-профиль и headless-слайс».

## Проверено живым импортом в этой карточке (не только `--help`)

- **PrusaSlicer**: собран `.ini`-бандл через `build_prusa_bundle` (тот же код,
  что и продовый экспортёр), `prusa-slicer --load bundle.ini --export-gcode
  cube.stl --output out.gcode` без DISPLAY — `exit=0`, g-code реально
  сгенерирован (112 КБ).
- **OrcaSlicer**: собран `.orca_printer`-бандл (`printer.json`/
  `process.json`/`filament.json`) через `build_orca_bundle`, загружен
  `--load-settings "printer.json;process.json" --load-filaments
  filament.json` — CLI реально распарсил все три файла (лог: `loaded machine
  config`/`loaded process config`/`loaded filament ...`), но затем упал с
  **`run 2652: process not compatible with printer`** (`return -17`). Это не
  баг провижининга — CLI делает настоящую семантическую проверку
  compatible-linkage между `process.json` и `printer.json`, которую
  `build_orca_bundle` сейчас не заполняет (нет поля вроде
  `compatible_printers`/связывающего id). **Заведено как находка для Mesh** —
  сама карточка MF-1918 её не чинит (зона `apps/mesh`, не Ops), см.
  комментарий в MF-1918 и `docs/epics/slicer.profiles.md` § «Не сделано».
- **Cura**: собран `.curaprofile` через `build_cura_bundle` — файл валиден
  как zip/INI (`ConfigParser` читает секции `[general]`/`[metadata]`/
  `[values]`), но **реальный импорт через Uranium (`UM.Settings.
  InstanceContainer.deserialize`) не выполнен** — попытка импортировать
  бандловый Python-модуль Cura AppImage напрямую из системного `python3.12`
  (тот же minor, что и во фризе) **падает сегментацией** (native-расширения
  AppImage собраны под другой ABI/libc-профиль, простой `PYTHONPATH`-трюк не
  работает). Cura-бинарь как таковой headless запускается чисто (`AppRun
  --help` после offscreen-патча — `exit=0`, без Qt-краша), это и есть предмет
  «Готово когда» этой карточки. Полноценный headless-парсинг `.curaprofile`
  через Uranium — отдельная инженерная задача (либо гонять внутри самого
  AppImage-фриза через его собственный bootstrap, а не системный python,
  либо иной подход), не входит в MF-1918.

## Открытый гэп (не эта карточка, следующий шаг MF-413 фазы 3)

1. **OrcaSlicer compatible-linkage** — `build_orca_bundle` должен проставлять
   поле, которое OrcaSlicer использует для привязки `process`→`printer`
   (сейчас `compatible 0` при реальном импорте). Без этого реальный-импорт CI
   гейт для Orca будет красным на любой связке.
2. **Cura real-import** — нужен рабочий способ прогнать `.curaprofile` через
   Uranium headless (не системный python, не просто `AppRun --help`); также
   калибровка `setting_version` (сейчас `CURA_SETTING_VERSION_PLACEHOLDER=25`
   в экспортёре) под реальную Cura 5.13.0.
3. **Полный ≥50 принтеров × 3 материала прогон** (MF-413 «Готово когда» шага
   2) — эта карточка даёт только доступность бинарей и smoke на одной связке;
   список реальных связок и сам гейт (пока не блокирующий merge) — по-прежнему
   не сделаны, следующая карточка Mesh/Test.

**Обновление (MF-1988, 2026-07-19, Ops):** тот же пиненный `v2.4.2`
(sha256 из таблицы выше, скачан и сверен живьём) развёрнут persistent на
dev-VM в `/home/plag/opt/orcaslicer-v2.4.2/orca-appimage` (не `/tmp` — должен
переживать reboot) и подключён к `portal.mesh-slice-worker-dev.service` через
`SLICER_ORCA_BINARY_PATH=.../AppRun` и `MESH_ORCA_PROFILES_DIR=.../resources/profiles`
(см. `apps/mesh/deploy/portal.mesh-slice-worker-dev.service`). Воркер теперь
проверяет исполняемость бинаря и резолвит `Snapmaker U1`-профиль ОДИН РАЗ при
старте (`slicing_queue._orca_startup_health_check`) — misconfiguration видна в
логе сразу, не только на первой живой job'е. Живой прогон на этой карточке:
`resolve_snapmaker_u1_profile` против развёрнутого бандла даёт тот же
build_volume (270×270×270мм), `slice_with_orca_cli` на реальном
`gauge_loose.STL` (SO-ARM100 fixture) реально режет toolpath (`print_time≈670с`,
`filament≈4.81г`) за <1с. Полный E2E через `slice_jobs` (queued→processing→ready)
блокирован на MF-1986 (Back, `layout`-колонка ещё не смержена в схему dev БД на
момент этой карточки) — как только колонка появится, легаси-путь этого воркера
уже готов её принять без дополнительного Ops-шага.

**Обновление (MF-1919, 2026-07-18, Mesh):** пункт 1 закрыт —
`build_orca_bundle` проставляет `compatible_printers`, см.
`docs/epics/slicer.profiles.md` § «Живая проверка реальным бинарём».

**Обновление (MF-1920, 2026-07-18, Mesh):** пункты 2 и 3 закрыты. Cura
real-import сделан НЕ через Uranium (тупик — headless Nuitka-фриз AppImage не
даёт исполнить произвольный Python, системный python3.12 сегфолтит на ABI),
а через прямой вызов `CuraEngine` (отдельный CLI слайсер-бэкенд того же
AppImage) с полным резолвом дефолтов `fdmprinter.def.json`/
`fdmextruder.def.json`; `setting_version=25` (текущий placeholder экспортёра)
эмпирически не блокирует реальный слайс — калибровка точного значения
остаётся открытой, но не блокером. Список связок (Creality, 50 реальных
machine-пресетов × 3 материала = 150) и сам CI-гейт
(`.gitverse/workflows/ci.yaml`, `matrix.app == mesh`, ПОСЛЕ этого шага
провижининга) — сделаны и блокируют merge. Подробности, метод Orca-валидации
и известные ограничения —
`docs/epics/slicer.profiles.md` § «CI-гейт реальным импортом ≥50×3 связок».

## Как переиспользовать провижининг локально

```sh
# PrusaSlicer
sudo apt-get install -y prusa-slicer
unset DISPLAY  # не обязателен, CLI и так не трогает X11

# OrcaSlicer (пример версии/sha256 — см. таблицу выше)
curl -fL -o /tmp/orcaslicer.AppImage "$ORCA_URL"
echo "$ORCA_SHA256  /tmp/orcaslicer.AppImage" | sha256sum -c -
chmod +x /tmp/orcaslicer.AppImage
sudo apt-get install -y libopengl0 libglu1-mesa libwebkit2gtk-4.1-0
(cd /tmp && ./orcaslicer.AppImage --appimage-extract && mv squashfs-root orca-appimage)

# Cura
curl -fL -o /tmp/cura.AppImage "$CURA_URL"
echo "$CURA_SHA256  /tmp/cura.AppImage" | sha256sum -c -
chmod +x /tmp/cura.AppImage
(cd /tmp && ./cura.AppImage --appimage-extract && mv squashfs-root cura-appimage)
sed -i 's/^QT_QPA_PLATFORM=xcb$/QT_QPA_PLATFORM=offscreen/' /tmp/cura-appimage/AppRun.env
```
