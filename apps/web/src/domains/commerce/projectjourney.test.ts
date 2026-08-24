import { describe, expect, it } from "vitest";
import { manufacturingModeFor } from "./projectjourney.tsx";

const base = { craft: "3d_printing", source_format: "3mf" as const, tags: [] as string[] };

describe("manufacturingModeFor", () => {
  it("различает обычную, AMS, SLA и CNC-технологию", () => {
    expect(manufacturingModeFor(base, null)).toBe("fdm");
    expect(manufacturingModeFor({ ...base, tags: ["AMS", "многоцвет"] }, null)).toBe("ams");
    expect(manufacturingModeFor({ ...base, tags: ["SLA", "смола"] }, null)).toBe("sla");
    expect(manufacturingModeFor({ ...base, craft: "cnc", source_format: "gcode" }, null)).toBe("cnc");
  });

  it("реальный build guide важнее эвристики тегов", () => {
    expect(
      manufacturingModeFor(base, {
        id: "g1",
        version: 1,
        steps: [
          {
            id: "s1",
            position: 0,
            title: "Собрать",
            body: null,
            mesh_id: null,
            mesh_object_ref: null,
            parts: [],
            tools: [],
            photos: [],
          },
        ],
      }),
    ).toBe("assembly");
  });
});
