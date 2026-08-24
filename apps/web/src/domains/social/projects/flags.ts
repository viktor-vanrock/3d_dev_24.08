// Флаг новой страницы «Проекты» (MF-524/MF-512, эпик MF-508). Первый визуально новый слайс
// (wide-шапка + hero-карусель, docs/design/projects.page.md) готов — Lead снял гейт (карточка
// MF-512, решение CTO 2026-07-08): дефолт теперь ВКЛ, «Проекты» не прячем за выключенным
// флагом, иначе свежести не видно. `?wide=0` / `VITE_PROJECTS_WIDE=0` — принудительный откат
// на старую витрину (rollback-путь на время, пока остальные слайсы каталога/поиска доезжают).
export function isWideProjectsEnabled(): boolean {
  const override = new URLSearchParams(window.location.search).get("wide");
  if (override === "1") return true;
  if (override === "0") return false;
  return import.meta.env.VITE_PROJECTS_WIDE !== "0";
}
