// Геометрия плиты стола (MF-1094, «Веб-слайсер: редактор стола»). Чистые функции без DOM/three —
// авто-раскладка (shelf-packing) + коллизии/выход за границы (SAT для повёрнутых прямоугольников).
// Bed-space: 0,0 — центр стола, ось X — ширина, ось Y — глубина, единицы — мм (те же, что
// models.bbox.size и user_printers.build_volume, apps/mesh/src/mesh/convert.py).

export interface BedSize {
  width: number;
  depth: number;
}

export interface Footprint {
  width: number;
  depth: number;
}

export interface Placement {
  id: string;
  modelId: string;
  x: number;
  y: number;
  rotationDeg: number;
  footprint: Footprint;
}

export interface PlacementStatus {
  id: string;
  collides: boolean;
  outOfBounds: boolean;
}

interface Point {
  x: number;
  y: number;
}

// Углы повёрнутого прямоугольника placement в bed-space (по часовой, начиная с "верхнего левого"
// в локальных координатах до поворота).
export function rectCorners(placement: Pick<Placement, "x" | "y" | "rotationDeg" | "footprint">): Point[] {
  const hw = placement.footprint.width / 2;
  const hd = placement.footprint.depth / 2;
  const rad = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const local: Point[] = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ];
  return local.map((p) => ({
    x: placement.x + p.x * cos - p.y * sin,
    y: placement.y + p.x * sin + p.y * cos,
  }));
}

function edgeAxes(corners: Point[]): Point[] {
  const axes: Point[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    const edge = { x: b.x - a.x, y: b.y - a.y };
    const len = Math.hypot(edge.x, edge.y) || 1;
    // Нормаль к ребру — единственные различающие оси для пары прямоугольников (SAT).
    axes.push({ x: -edge.y / len, y: edge.x / len });
  }
  return axes;
}

function project(corners: Point[], axis: Point): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const corner of corners) {
    const dot = corner.x * axis.x + corner.y * axis.y;
    min = Math.min(min, dot);
    max = Math.max(max, dot);
  }
  return { min, max };
}

/** Separating Axis Theorem для двух (возможно повёрнутых) прямоугольников — точная проверка
 * пересечения, не приближение через AABB (drag на произвольный угол — частый случай). */
export function rectsOverlap(
  a: Pick<Placement, "x" | "y" | "rotationDeg" | "footprint">,
  b: Pick<Placement, "x" | "y" | "rotationDeg" | "footprint">,
  marginMm = 0,
): boolean {
  const cornersA = rectCorners(a);
  const cornersB = rectCorners(b);
  const axes = [...edgeAxes(cornersA), ...edgeAxes(cornersB)];
  for (const axis of axes) {
    const pa = project(cornersA, axis);
    const pb = project(cornersB, axis);
    if (pa.max + marginMm <= pb.min || pb.max + marginMm <= pa.min) return false;
  }
  return true;
}

/** Все 4 угла placement лежат внутри прямоугольника стола (центрированного в 0,0), с отступом. */
export function isWithinBed(
  placement: Pick<Placement, "x" | "y" | "rotationDeg" | "footprint">,
  bed: BedSize,
  marginMm = 0,
): boolean {
  const halfW = bed.width / 2 - marginMm;
  const halfD = bed.depth / 2 - marginMm;
  return rectCorners(placement).every((c) => c.x >= -halfW && c.x <= halfW && c.y >= -halfD && c.y <= halfD);
}

const BED_EDGE_MARGIN_MM = 2;

export function computeStatuses(placements: Placement[], bed: BedSize): PlacementStatus[] {
  return placements.map((placement, index) => {
    const outOfBounds = !isWithinBed(placement, bed, BED_EDGE_MARGIN_MM);
    const collides = placements.some((other, otherIndex) => otherIndex !== index && rectsOverlap(placement, other));
    return { id: placement.id, collides, outOfBounds };
  });
}

export interface ArrangeItem {
  id: string;
  modelId: string;
  footprint: Footprint;
}

export interface ArrangeResult {
  placements: Placement[];
  /** id тех, что физически не влезли на стол ни при каком next-fit shelf-размещении —
   * остаются на столе с status.outOfBounds=true, юзер решает вручную (уменьшить кол-во/модель). */
  overflowIds: string[];
}

const ARRANGE_GAP_MM = 4;

/** Next-fit shelf packing: без поворота (совпадает с тем, как реально ляжет на стол принтера —
 * авто-поворот под лучший fit это отдельная эвристика, не в MVP-скоупе карточки), сортировка по
 * убыванию площади footprint — крупные детали первыми, мелкие лучше добивают остаток полки. */
export function autoArrange(bed: BedSize, items: ArrangeItem[], marginMm = BED_EDGE_MARGIN_MM): ArrangeResult {
  const usableWidth = bed.width - marginMm * 2;
  const usableDepth = bed.depth - marginMm * 2;
  const sorted = [...items].sort((a, b) => b.footprint.width * b.footprint.depth - a.footprint.width * a.footprint.depth);

  const placements: Placement[] = [];
  const overflowIds: string[] = [];
  const onlyItem = sorted[0];
  if (sorted.length === 1 && onlyItem) {
    if (onlyItem.footprint.width > usableWidth || onlyItem.footprint.depth > usableDepth) {
      return { placements, overflowIds: [onlyItem.id] };
    }
    // Одиночную деталь человек ожидает увидеть в центре стола. Помимо более понятной сцены,
    // это оставляет Orca максимум симметричного запаса под skirt/brim/supports.
    return {
      placements: [{
        id: onlyItem.id,
        modelId: onlyItem.modelId,
        x: 0,
        y: 0,
        rotationDeg: 0,
        footprint: onlyItem.footprint,
      }],
      overflowIds,
    };
  }
  let cursorX = 0;
  let cursorY = 0;
  let rowDepth = 0;

  for (const item of sorted) {
    const { width, depth } = item.footprint;
    if (width > usableWidth || depth > usableDepth) {
      overflowIds.push(item.id);
      continue;
    }
    if (cursorX + width > usableWidth) {
      cursorX = 0;
      cursorY += rowDepth + ARRANGE_GAP_MM;
      rowDepth = 0;
    }
    if (cursorY + depth > usableDepth) {
      overflowIds.push(item.id);
      continue;
    }
    placements.push({
      id: item.id,
      modelId: item.modelId,
      x: cursorX + width / 2 - usableWidth / 2,
      y: cursorY + depth / 2 - usableDepth / 2,
      rotationDeg: 0,
      footprint: item.footprint,
    });
    cursorX += width + ARRANGE_GAP_MM;
    rowDepth = Math.max(rowDepth, depth);
  }

  return { placements, overflowIds };
}
