# Moonraker `telemetry.v1`

Нормализованный срез агента для Ender-3 V3 KE и FLSun V400. Все поля могут быть
`null`, если объект/датчик отсутствует; агент не подставляет значения от другой
модели. `observedAt` — UTC wall clock, `seq` — монотонная последовательность
агента и единственный порядок событий при коррекции часов.

| Поле | Единицы | Moonraker source | Nullable |
|---|---|---|---|
| `state` | enum | `print_stats.state` | нет |
| `progress` | 0..1 | `virtual_sdcard.progress` | да |
| `nozzle.currentC/targetC` | °C | `extruder.temperature/target` | да |
| `bed.currentC/targetC` | °C | `heater_bed.temperature/target` | да |
| `chamber.currentC/targetC` | °C | `chamber.temperature/target` | да |
| `fanPercent` | 0..100 | `fan.speed × 100` | да |
| `error` | UTF-8 code/message | `print_stats.message` or `error` | да |
| `job.id/fileName` | string | normalized snapshot (`print_stats.filename`) | да |

`telemetry.v1` — additive envelope; горячий `device_state` остаётся отдельным
последним снэпшотом. История не обязана принимать каждый температурный тик:
`TelemetryCoalescer` выпускает не более одного кадра за интервал (по умолчанию
1 s), но немедленно сохраняет переходы состояния и ошибки. При relay
backpressure pending-кадр заменяется последним, а переходы не заменяются.

В текущем wire heartbeat старые `progress`/`metrics` сохраняются для обратной
совместимости. Полный envelope можно включать аддитивным полем после согласования
с владельцами Relay и Data; неизвестные поля старые агенты должны игнорировать.
