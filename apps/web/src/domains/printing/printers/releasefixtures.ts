// Фикстура календаря новинок `/printers/releases` (MF-833, docs/design/printers.md §1/§2).
// Блокер зафиксирован в самой карточке: `GET /releases` отвечает гостю 401 (nav.sections.md §4),
// раздел «Принтеры» не выкатывается, пока это не снято отдельной карточкой Fullstack — до тех пор
// экран рисуется поверх фикстуры, тем же приёмом, что `fixtures.ts:listPrintersFixture`.
//
// `machineId`, когда не null, ссылается на `PrinterRecord.id` из `fixtures.ts` — только тогда
// карточка релиза кликабельна (printers.md §1: «тап неактивен, если каталожной карточки ещё нет»).

export type ReleaseStatus = "announced" | "preorder" | "shipping";

export interface PrinterRelease {
  id: string;
  date: string; // ISO date, "YYYY-MM-DD"
  status: ReleaseStatus;
  vendor: string;
  model: string;
  machineId: string | null;
}

const RELEASES: PrinterRelease[] = [
  // Прошедшее (уже "выпускается") — уходит под «Раньше» на экране календаря.
  { id: "rel.k2-plus", date: "2024-11-01", status: "shipping", vendor: "Creality", model: "K2 Plus", machineId: "creality.k2-plus" },
  { id: "rel.saturn4-ultra", date: "2024-08-01", status: "shipping", vendor: "Elegoo", model: "Saturn 4 Ultra", machineId: "elegoo.saturn4-ultra" },
  { id: "rel.k1-max", date: "2024-01-15", status: "shipping", vendor: "Creality", model: "K1 Max", machineId: "creality.k1-max" },
  // Ближайшее будущее — экран открывается на первом из этих месяцев.
  { id: "rel.vulcan-one", date: "2026-09-01", status: "announced", vendor: "Vulcan", model: "One", machineId: "vulcan.one" },
  { id: "rel.nebula-zero", date: "2026-09-20", status: "announced", vendor: "Nebula", model: "Zero", machineId: "nebula.zero" },
  { id: "rel.snapmaker-j2", date: "2026-10-05", status: "preorder", vendor: "Snapmaker", model: "J2", machineId: null },
  { id: "rel.bambulab-h3", date: "2026-11-12", status: "preorder", vendor: "Bambu Lab", model: "H3", machineId: null },
];

// `GET /releases` живёт за тем же блокером, что `GET /machines`/`GET /vendors` (nav.sections.md
// §4) — imитируем сетевой контракт (Promise), подключение реального fetch — правка тела этой
// функции, вёрстка не трогается (тот же приём, что listPrintersFixture).
export async function listReleasesFixture(): Promise<PrinterRelease[]> {
  return RELEASES;
}
