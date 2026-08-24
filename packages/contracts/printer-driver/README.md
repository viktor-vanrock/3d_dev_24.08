# Шов `printer-driver` — контракт драйвера принтера

Единый интерфейс `PrinterDriver`: `getState() · subscribeTelemetry() · sendCommand() · uploadFile() ·
camera()`. Реализации — адаптеры по протоколу принтера: `packages/moonraker-adapter` (готов), далее
bambu/prusa/octoprint. Новый бренд = новый адаптер-пакет, ядро (relay/agent/api) НЕ трогается.
Владелец контракта — Bridge. Текущий канон интерфейса — `apps/device-agent/src/driver/printerDriver.ts`
(перенести определение сюда при первом мульти-адаптере).
