// Мелкие presentational-хелперы страницы модели (MF-911: вынесены из model.tsx, чтобы файл не
// разрастался) — иконки и форматтеры, используемые только на этой странице.

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

// `models.bbox` реально пишется как `{min:[x,y,z], max:[x,y,z], size:[x,y,z], unit:"mm"}`
// (apps/mesh/src/mesh/convert.py::_bbox_from_extent) — не плоский `{x,y,z}`. Плоскую форму тоже
// принимаем (легаси-строки/будущие писатели), но `size` — источник истины для реальных данных.
export function modelBboxSizeMm(bbox: unknown): { x: number; y: number; z: number } | null {
  if (!bbox || typeof bbox !== "object") return null;
  const record = bbox as Record<string, unknown>;
  if (typeof record.x === "number" && typeof record.y === "number" && typeof record.z === "number") {
    return { x: record.x, y: record.y, z: record.z };
  }
  const size = record.size;
  if (Array.isArray(size) && size.length === 3 && size.every((n) => typeof n === "number")) {
    const [x, y, z] = size as [number, number, number];
    return { x, y, z };
  }
  return null;
}

export function formatBbox(bbox: unknown): string | null {
  const size = modelBboxSizeMm(bbox);
  return size ? `${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} мм` : null;
}

export function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="18" cy="5" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="19" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.3 10.6 15.7 6.4M8.3 13.4l7.4 4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// Line-глиф «ветка/копия» (docs/design/projects.page.md §11.4) — единственное «почти-git»
// слово в UI, термин закреплён эпиком/доменом как принятое имя действия у мейкеров.
export function ForkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="7" cy="6" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="7" cy="18" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 8.4V15.6M9 10.2c1.7-1.5 4.3-1.5 6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
