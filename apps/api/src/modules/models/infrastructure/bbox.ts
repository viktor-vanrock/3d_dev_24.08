// `models.bbox` — то, что реально пишет apps/mesh (convert.py::_bbox_from_extent,
// worker.py::_finish_ready): `{min:[x,y,z], max:[x,y,z], size:[x,y,z], unit:"mm"}`, не плоский
// `{x,y,z}`. compat.check (CompatModelInput.bboxMm) и GET /models?compatibility=mine (list.ts)
// оба хотят плоский объект габаритов — общий парсер, чтобы обе стороны не разъезжались.
// Вынесено из profile/activation.ts (MF-1060) в этот модуль, чтобы list.ts мог переиспользовать
// его без импорта из profile/ (не его домен).
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
