import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  prepareLoadedModel,
  shouldSendModelCredentials,
} from "./modelscene.ts";

describe("3D asset credentials", () => {
  it("посылает сессию только своему web/API origin", () => {
    expect(shouldSendModelCredentials("/models/m1/preview", "https://dev.3mf.tech", "https://api.dev.3mf.tech")).toBe(true);
    expect(
      shouldSendModelCredentials("https://api.dev.3mf.tech/models/m1/preview", "https://dev.3mf.tech", "https://api.dev.3mf.tech"),
    ).toBe(true);
  });

  it("не прикладывает cookie к открытому CDN с wildcard CORS", () => {
    expect(
      shouldSendModelCredentials(
        "https://cdn.jsdelivr.net/gh/Blue-Design/OttoDIY/model.stl",
        "https://dev.3mf.tech",
        "https://api.dev.3mf.tech",
      ),
    ).toBe(false);
  });
});

describe("3D geometry repair", () => {
  it("восстанавливает нормали TRELLIS GLB и отключает хрупкое отсечение", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0],
        3,
      ),
    );
    const material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    const root = new THREE.Group();
    root.add(mesh);

    expect(prepareLoadedModel(root)).toBe(1);
    expect(geometry.getAttribute("normal")).toBeTruthy();
    expect(material.side).toBe(THREE.DoubleSide);
    expect(mesh.frustumCulled).toBe(false);
  });

  it("отклоняет GLB без пригодных для рендера треугольников", () => {
    expect(() => prepareLoadedModel(new THREE.Group())).toThrow(
      "modelscene: no renderable triangles",
    );
  });
});
