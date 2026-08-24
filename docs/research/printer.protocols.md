# Research: рынок принтеров, протоколы, уровни поддержки

**Референс для Ресёрчеров** (какой `connector_type`/`support_level` ставить в карточку) и **Back**
(какие адаптеры писать). Данные — web-research 2025-2026, помеченное `⚠️verify` уточняют Ресёрчеры на
железе/офсайте. Связь: [../epics/printer.support.md](../epics/printer.support.md),
[../architecture/printer.server.md](../architecture/printer.server.md).

## Рынок (sub-$2500, 2025-2026)

- **Bambu Lab #1** (~37%, обогнал Creality в 2025). **Bambu + Creality = 73.7%**; +Anycubic +Elegoo =
  **90.3%**. Prusa — премиум. Китай >90% entry-level. Рынок растёт (+26% за 2025, entry-level быстрее всех).
- **Следствие:** крупнейший бренд (Bambu) закрыт и не-Klipper → строим МУЛЬТИ-протокольно, не только Klipper.

## Матрица брендов → протокол → наш уровень

| Бренд | Прошивка | Протокол интеграции | Klipper-конвертируем? | Наш максимум |
|---|---|---|---|---|
| **Bambu Lab** | проприетарная | **MQTT + FTP** (LAN Dev-mode / Bambu Cloud) | ❌ (закрытый bootloader) | `managed-cloud` |
| **Creality** (новые: K1/K2/Ender V3·KE) | Klipper (Creality OS) | **Moonraker** (community-скрипт на K1) | ✅ | `custom` |
| **Creality** (старые/SE) | Marlin | — (OctoPrint-мост) | частично | `managed-bridge` |
| **Anycubic** (Kobra) | проприетарная/Marlin ⚠️verify | своё облако/APP ⚠️verify | частично | `managed-cloud`/`bridge` |
| **Elegoo** FDM (Neptune 4, Centauri) | **Klipper** | **Moonraker** | ✅ | `custom` |
| **Elegoo** (resin) | своё | — | ❌ | `list` |
| **Prusa** (MK4, Core One, MINI) | Prusa/Buddy | **PrusaLink** (лок.) / **Prusa Connect** (обл.) | ✅ (можно Klipper) | `managed-cloud` / `custom`(конверт.) |
| **FLSun** (V400, T1, SR — дельты) | **Klipper** из коробки | **Moonraker** + KlipperScreen | ✅ | `custom` |
| **Voron** (DIY) | **Klipper** | **Moonraker** | ✅ (уже Klipper) | `custom` |
| **Sovol** (SV07/08) | **Klipper** | **Moonraker** | ✅ | `custom` |
| **Qidi** (X-series) | **Klipper** | **Moonraker** | ✅ | `custom` |
| любой на **OctoPrint** | разная | **OctoPrint REST** | — | `managed-bridge` |

## Топ-модели и стартовый уровень (для БД)

**custom-кандидаты (Klipper+Moonraker — наша прошивка/визуал заходит):**
Creality K1/K1 Max/K2 Pro, Ender-3 V3/V3 KE · Elegoo Neptune 4/4 Plus/Centauri Carbon · FLSun V400/T1/
Super Racer · Voron 2.4/Trident · Sovol SV07/SV08 · Qidi Plus4/Q1 Pro. **← пилот отсюда (Ender-3 V3 KE, FLSun V400).**

**managed-cloud (закрыты, но есть облако/протокол):**
Bambu A1/A1 mini/P1S/X1C/H2D · Prusa MK4/Core One/MINI+ · Anycubic Kobra ⚠️verify.

**list (пока только каталог):** resin (Elegoo Saturn/Mars, Anycubic Photon), старые Marlin без моста.

## Что это значит для продукта

- **Наша кастом-прошивка (custom)** реально применима к ~половине рынка по брендам (Creality-Klipper,
  Elegoo-FDM, FLSun, Voron, Sovol, Qidi) — это БОЛЬШОЙ охват перепрошиваемых. Пилот там же.
- **Bambu (#1) и Prusa** — только `managed` через их облака/протоколы (custom не поставить). Но это #1
  бренд — BambuAdapter обязателен для охвата, даже без нашей прошивки.
- **connector_type в карточке** (Ресёрчерам): `moonraker` | `bambu-mqtt` | `prusa-link` | `octoprint` |
  `vendor-cloud` | `none`. По нему Back выбирает адаптер, Front — доступный уровень.

## Приоритет адаптеров (Back)
1. **Moonraker** (v1) — максимум custom-кандидатов + пилот.
2. **Bambu-MQTT** (v2) — #1 бренд, огромный охват managed.
3. **PrusaLink/Connect** (v2) — премиум-сегмент.
4. **OctoPrint** (v3) — универсальный мост для остального.
5. Duet/RRF, vendor-cloud (Creality/Anycubic) — ниши, позже.

## Открытые вопросы (Ресёрчерам уточнить на офсайтах/железе)
- Anycubic Kobra — какой протокол/облако, есть ли локальный API? `⚠️verify`
- Creality K2 — Moonraker доступен или закрыт сильнее K1? `⚠️verify`
- Elegoo Centauri — полный Moonraker или урезанный? `⚠️verify`
- Bambu H2D/X2D — те же MQTT-топики, что A1/X1? версия протокола `⚠️verify`
