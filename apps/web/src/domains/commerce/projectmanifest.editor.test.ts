import { beforeEach, describe, expect, it } from "vitest";
import { PROJECT_CODE_CONTRACT_VERSION } from "./projectmanifest.constants.ts";
import {
  ProjectHeadConflictError,
  SOARM_BASE_HEAD,
  mergeManifestPreservingExtensions,
  readDemoManifest,
  resetDemoManifest,
  saveDemoManifest,
  soarmFollowerBuildGuide,
} from "./projectmanifest.editor.ts";

describe("project manifest editor", () => {
  beforeEach(() => resetDemoManifest());

  it("сохраняет неизвестные x-* поля при изменении известных данных", () => {
    const original = {
      project: { title: "Before", "x-vendor": { color: "violet" } },
      "x-agent": { score: 0.98 },
    };
    const result = mergeManifestPreservingExtensions(original, { project: { title: "After" } as typeof original.project });
    expect(result.project.title).toBe("After");
    expect(result.project["x-vendor"]).toEqual({ color: "violet" });
    expect(result["x-agent"]).toEqual({ score: 0.98 });
  });

  it("отклоняет сохранение поверх более новой head-ревизии", () => {
    const first = readDemoManifest();
    saveDemoManifest({
      contract_version: PROJECT_CODE_CONTRACT_VERSION,
      base_head_sha: first.head_sha,
      manifest: first.manifest,
      commit_message: "Первое изменение",
    });
    expect(() =>
      saveDemoManifest({
        contract_version: PROJECT_CODE_CONTRACT_VERSION,
        base_head_sha: first.head_sha,
        manifest: first.manifest,
        commit_message: "Устаревшее изменение",
      }),
    ).toThrow(ProjectHeadConflictError);
  });

  it("строит follower-маршрут из реальных pinned-артефактов и команд LeRobot", () => {
    const guide = soarmFollowerBuildGuide();
    const gauges = guide.steps.find((step) => step.id === "print-gauges");
    const setup = guide.steps.find((step) => step.id === "configure-servos");
    const calibration = guide.steps.find((step) => step.id === "calibrate");

    expect(guide.version).toBe(5);
    expect(guide.steps).toHaveLength(11);
    expect(gauges?.artifacts?.map((artifact) => artifact.path)).toEqual([
      "STL/Gauges/Gauge_0.STL",
      "STL/Gauges/Gauge_tight_1.STL",
    ]);
    expect(gauges?.artifacts?.every((artifact) => artifact.url.includes(SOARM_BASE_HEAD))).toBe(true);
    expect(setup?.commands?.[0]?.code).toContain("lerobot-setup-motors");
    expect(setup?.warnings?.join(" ")).toContain("EEPROM");
    expect(calibration?.commands?.[0]?.code).toContain("lerobot-calibrate");
  });
});
