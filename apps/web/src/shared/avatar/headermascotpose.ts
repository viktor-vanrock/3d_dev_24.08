// Персонаж живёт в правом верхнем углу, поэтому его нейтральная точка внимания —
// содержимое страницы слева-внизу. Курсор добавляет небольшое отклонение, но не может
// развернуть маскота наружу, к правому краю.
export const HEADER_MASCOT_REST_POINTER = Object.freeze({ x: -0.62, y: 0.52 });

export function headerMascotRotationForPointer(pointerX: number, pointerY: number): { x: number; y: number } {
  return {
    x: pointerY * 0.12,
    y: pointerX * 0.42 - 0.08,
  };
}

export function headerMascotPointerForCursor(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const cursorX = (clientX / Math.max(viewportWidth, 1)) * 2 - 1;
  const cursorY = (clientY / Math.max(viewportHeight, 1)) * 2 - 1;
  return {
    x: HEADER_MASCOT_REST_POINTER.x + cursorX * 0.24,
    y: HEADER_MASCOT_REST_POINTER.y + cursorY * 0.2,
  };
}
