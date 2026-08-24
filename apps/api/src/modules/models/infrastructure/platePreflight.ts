import type { BedGeometry, PlatePreflightCode, PlatePreflightResult } from "@portal/contracts/jobs/slicer-plate";

// Server preflight (MF-1986, docs/design/slicer.editor.md §4.3/§11 п.3) — финальный gate перед
// созданием job. Client preflight (canvas) — "Предварительная проверка", эта функция —
// единственная, что реально разрешает слайсинг (§4.3: "Только server preflight разрешает
// слайсинг").
//
// Явная граница v1: footprint КАЖДОГО инстанса приближается общим `models.bbox` пиненной
// модели (все инстансы одной job уже обязаны ссылаться на один `model_id`, решение MF-1981
// "Явная граница v1"). Per-artifact bbox (разные STL внутри одного проекта могут отличаться
// геометрией) здесь не резолвится — это требует парсинга самой геометрии (STL/3MF), отдельный
// Mesh/geometry-контур, явно исключённый из объёма этой карточки ("не проектировать
// Mesh-сторону"). Когда `bbox` модели неизвестен (ещё не посчитан пайплайном конвертации),
// preflight честно возвращает `unsupported_geometry` по всем инстансам, а не выдумывает нули.

/** v1: фиксированный отступ безопасности вокруг footprint (docs/epics/slicer.profiles.md пока
 * не определяет канонический ключ clearance в params — расширение схемы вне объёма карточки). */
export const DEFAULT_PLATE_CLEARANCE_MM = 5;

export interface PlatePreflightInstanceInput {
  instance_id: string;
  x_mm: number;
  y_mm: number;
  rotation_z_deg: number;
  scale: number;
}

interface Point {
  x: number;
  y: number;
}

interface Rect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function rotatedFootprintAabb(instance: PlatePreflightInstanceInput, footprint: { x: number; y: number }): Rect {
  const halfX = (footprint.x * instance.scale) / 2;
  const halfY = (footprint.y * instance.scale) / 2;
  const theta = (instance.rotation_z_deg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const corners: Point[] = [
    { x: -halfX, y: -halfY },
    { x: halfX, y: -halfY },
    { x: halfX, y: halfY },
    { x: -halfX, y: halfY },
  ].map((p) => ({ x: instance.x_mm + p.x * cos - p.y * sin, y: instance.y_mm + p.x * sin + p.y * cos }));
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxY: Math.max(...corners.map((p) => p.y)),
  };
}

function rectOverlaps(a: Rect, b: Rect, marginMm = 0): boolean {
  return a.minX - marginMm < b.maxX && a.maxX + marginMm > b.minX && a.minY - marginMm < b.maxY && a.maxY + marginMm > b.minY;
}

// origin: center — bed центрирован на (0,0); front_left/explicit — bed начинается в (0,0) и
// растёт в +x/+y. `explicit` в §11 не несёт отдельной точки origin в минимальном payload —
// v1 не различает его от front_left (см. header-комментарий про явные границы).
function bedRectBounds(bed: BedGeometry): Rect {
  const width = bed.width_mm ?? 0;
  const depth = bed.depth_mm ?? 0;
  if (bed.origin === "center") {
    return { minX: -width / 2, maxX: width / 2, minY: -depth / 2, maxY: depth / 2 };
  }
  return { minX: 0, maxX: width, minY: 0, maxY: depth };
}

function pointInPolygon(point: Point, polygon: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const intersects = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function corners(rect: Rect): Point[] {
  return [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
}

function isInsideBed(footprint: Rect, bed: BedGeometry): boolean {
  if (bed.shape === "rect") {
    const bounds = bedRectBounds(bed);
    return footprint.minX >= bounds.minX && footprint.maxX <= bounds.maxX && footprint.minY >= bounds.minY && footprint.maxY <= bounds.maxY;
  }
  if (bed.shape === "circle") {
    const radius = (bed.diameter_mm ?? 0) / 2;
    return corners(footprint).every((p) => Math.hypot(p.x, p.y) <= radius);
  }
  const polygon = bed.points_mm ?? [];
  return corners(footprint).every((p) => pointInPolygon(p, polygon));
}

function overlapsExcludedZone(footprint: Rect, bed: BedGeometry): boolean {
  for (const zone of bed.excluded_zones_mm ?? []) {
    const zoneRect: Rect = { minX: zone.x_mm, maxX: zone.x_mm + zone.width_mm, minY: zone.y_mm, maxY: zone.y_mm + zone.depth_mm };
    if (rectOverlaps(footprint, zoneRect)) return true;
  }
  return false;
}

/**
 * `footprintMm`/`heightMm` — `models.bbox` пиненной модели (см. header-комментарий) или `null`,
 * если ещё не посчитан. `clearanceMm` — v1 фиксированный отступ (DEFAULT_PLATE_CLEARANCE_MM).
 */
export function computePlatePreflight(
  bedGeometry: BedGeometry,
  instances: PlatePreflightInstanceInput[],
  footprint: { x: number; y: number; z: number } | null,
  buildVolumeZMm: number,
  clearanceMm: number = DEFAULT_PLATE_CLEARANCE_MM,
): PlatePreflightResult {
  if (!footprint) {
    return {
      ok: false,
      instances: instances.map((instance) => ({ instance_id: instance.instance_id, ok: false, codes: ["unsupported_geometry"] })),
    };
  }

  const aabbs = new Map(instances.map((instance) => [instance.instance_id, rotatedFootprintAabb(instance, footprint)]));

  const result = instances.map((instance) => {
    const codes = new Set<PlatePreflightCode>();
    const footprintRect = aabbs.get(instance.instance_id)!;
    const collidesWith: string[] = [];

    if (!isInsideBed(footprintRect, bedGeometry) || overlapsExcludedZone(footprintRect, bedGeometry)) {
      codes.add("outside_bed");
    }
    if (footprint.z * instance.scale > buildVolumeZMm) {
      codes.add("height_exceeded");
    }
    for (const other of instances) {
      if (other.instance_id === instance.instance_id) continue;
      const otherRect = aabbs.get(other.instance_id)!;
      if (rectOverlaps(footprintRect, otherRect)) {
        codes.add("collision");
        collidesWith.push(other.instance_id);
      } else if (rectOverlaps(footprintRect, otherRect, clearanceMm)) {
        codes.add("clearance_failed");
      }
    }

    return {
      instance_id: instance.instance_id,
      ok: codes.size === 0,
      codes: Array.from(codes),
      ...(collidesWith.length > 0 ? { collides_with: collidesWith } : {}),
    };
  });

  return { ok: result.every((r) => r.ok), instances: result };
}
