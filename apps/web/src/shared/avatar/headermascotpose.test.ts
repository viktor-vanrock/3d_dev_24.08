import { describe, expect, it } from "vitest";
import {
  HEADER_MASCOT_REST_POINTER,
  headerMascotPointerForCursor,
  headerMascotRotationForPointer,
} from "./headermascotpose.ts";

describe("поза персонажа в шапке", () => {
  it("по умолчанию направляет взгляд влево-вниз", () => {
    expect(HEADER_MASCOT_REST_POINTER.x).toBeLessThan(0);
    expect(HEADER_MASCOT_REST_POINTER.y).toBeGreaterThan(0);
  });

  it("реагирует на курсор, но остаётся направленным внутрь страницы", () => {
    const atAvatar = headerMascotPointerForCursor(1680, 0, 1680, 828);
    const atContent = headerMascotPointerForCursor(0, 828, 1680, 828);

    expect(atAvatar.x).toBeLessThan(0);
    expect(atAvatar.y).toBeGreaterThan(0);
    expect(atContent.x).toBeLessThan(atAvatar.x);
    expect(atContent.y).toBeGreaterThan(atAvatar.y);
  });

  it("первый 3D-кадр сразу получает ту же позу, к которой стремится анимация", () => {
    const rotation = headerMascotRotationForPointer(
      HEADER_MASCOT_REST_POINTER.x,
      HEADER_MASCOT_REST_POINTER.y,
    );

    expect(rotation.y).toBeLessThan(0);
    expect(rotation.x).toBeGreaterThan(0);
  });
});
