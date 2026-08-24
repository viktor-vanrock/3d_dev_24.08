# Шаблон git-репо принтера (custom-прошивка, MF-934)

← [docs/epics/printer.support.md](../docs/epics/printer.support.md) (директива, способ доставки
«в»: «Git-проект принтера») · [docs/architecture/printer.server.md](../docs/architecture/printer.server.md)
(серверный слой, контракт `PrinterDriver`) · агент — [apps/device-agent](../apps/device-agent) ·
визуал морды — [apps/web/src/printerface](../apps/web/src/printerface) ·
[docs/design/printer.face.md](../docs/design/printer.face.md).

## Что это

Заготовка, которую **один раз** заводят под новую `custom`-поддерживаемую модель принтера
(команда поддержки конкретной модели, printer.support.md § «Дорожная карта», п.4). Копируется как
основа под модель — не редактируется здесь как «общий» конфиг.

**Не входит:** сборка образа/OS — её делает оператор вручную со своего компа
(printer.support.md § «Кто собирает образ»); конкретная калибровка/тюнинг под физическую модель —
это работа команды поддержки принтера, использующей этот шаблон как отправную точку.

## Что внутри

- `printer.cfg` — Klipper-конфиг с плейсхолдерами (`<...>`) под калибровку модели: шаги/степперы,
  термисторы, размеры стола, home-офсеты. Подключает `macros.cfg`.
- `macros.cfg` — заготовки макросов печати (`START_PRINT`/`END_PRINT`/`PAUSE`/`RESUME`/`CANCEL_PRINT`),
  привязанные к контракту `PrinterDriver` (`startPrint`/`pause`/`resume`/`cancel`,
  `apps/device-agent/src/driver/printerDriver.ts`) — переименовывать команды нельзя, агент их вызывает
  по имени.
- `moonraker.conf` — Moonraker-конфиг с включённым `[authorization]` (агент подключается по
  oneshot-токену, `apps/device-agent/readme.md`) и `[update_manager]`-заготовкой под наш визуал/агент.

## Как адаптировать под новую модель (команда поддержки принтера)

1. Скопировать этот каталог в новый git-репозиторий на GitVerse (по репо на модель,
   printer.support.md: «образы/репо живут в ОТДЕЛЬНЫХ git-репозиториях, НЕ в монорепо portal.ru»).
2. Заполнить плейсхолдеры `printer.cfg` под физическую модель (кинематика, степперы, термисторы,
   размеры стола) — по даташиту/референс-конфигу производителя платы.
3. Прогнать штатную калибровку Klipper (PID, `PRESSURE_ADVANCE`, offsets) на реальном железе —
   значения коммитить в этот же `printer.cfg`, не оставлять плейсхолдерами.
4. Установить наш агент (`apps/device-agent`, enroll-инструкция — `apps/relay/readme.md` §
   «Локальный запуск», установочный скрипт — `apps/api/src/devices/installScript.ts`) и наш визуал
   (`apps/web/src/printerface`) поверх — обе поверхности работают через Moonraker `printer.cfg`/
   `moonraker.conf` этого репо, ничего в них не меняя ради агента/визуала.
5. Испытать связку (Klipper + визуал + агент) на живом принтере до статуса «поддерживаемый».
6. Дать оператору GitVerse-URL готового репо/образа — он проставит его в карточку модели
   (`printers.firmware_repo`, `apps/api/db/schema.sql`) и выставит `firmware_ready=true`. Агенты
   сами это поле не пишут (printer.support.md § «Кто собирает образ»).

## Первый потребитель

Ender-3 V3 KE (пилот, printer.support.md § «Дорожная карта») — первая команда поддержки принтера
копирует этот каталог как основу вместо конфига с нуля.
