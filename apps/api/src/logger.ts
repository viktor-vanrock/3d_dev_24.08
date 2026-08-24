// Минимальный структурный логгер, разделяемый хелперами, которые раньше принимали legacy
// pino-логгер прежнего транспорта. После cutover (7.4) эти хелперы вызываются с Nest/pino-логгером
// (структурно совместим) — им нужен лишь warn/error с pino-сигнатурой `(obj, msg?)`. Держим тип узким,
// чтобы не тянуть транспорт-специфичную зависимость в shared-слой.
export interface Logger {
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}
