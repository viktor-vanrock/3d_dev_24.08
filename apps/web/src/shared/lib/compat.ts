import type { UserPrinter } from "./activation.ts";

// Заглушка движка совместимости (MF-33 ещё не построен — ни у MarketModel, ни у
// UserPrinter сейчас нет полей размеров/сопла, чтобы сравнивать по-настоящему).
// Модуль «совместимо с вашим {принтер}» (Фаза 3, MF-438) собран на реальном каталоге
// уже сейчас — эта функция единственное место, которое придётся заменить, когда
// приедут реальные данные MF-33; бейдж/фильтр вокруг неё переверстывать не нужно.
// Параметр сужен до используемого поля (craft), а не полного MarketModel — снимает
// cross-domain зависимость home→commerce ради одного string-поля (Этап 4.0).
export function isCompatible(model: { craft: string }, _printer: UserPrinter): boolean {
  return model.craft === "3d_printing";
}
