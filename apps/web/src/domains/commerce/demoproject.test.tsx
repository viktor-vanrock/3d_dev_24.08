import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  demoBuildGuideFor,
  demoModelFor,
  demoProjectDownloadsFor,
  demoTreeFor,
  DEMO_PROJECT_ID,
} from "./demoproject.ts";
import { LEROBOT_PROJECT_ID } from "./lerobotproject.ts";
import { apiAssetUrl } from "@shared/api";
import { projectConfigurationsFor } from "./projectconfig.ts";
import { ProjectLaunchpad } from "./projectlaunchpad.tsx";
import { ProjectJourney } from "./projectjourney.tsx";

afterEach(cleanup);

describe("эталонный многокомпонентный проект", () => {
  it("собирает модель, дерево файлов и инструкцию без API", () => {
    const model = demoModelFor(DEMO_PROJECT_ID);
    const guide = demoBuildGuideFor(DEMO_PROJECT_ID);
    const tree = demoTreeFor(DEMO_PROJECT_ID);

    expect(model?.title).toContain("Otto DIY");
    expect(model?.files.map((file) => file.format)).toEqual(expect.arrayContaining(["stl", "stp", "zip"]));
    expect(model?.repo_url).toBe("https://github.com/Blue-Design/OttoDIY");
    expect(guide?.steps).toHaveLength(6);
    expect(tree?.entries.some((entry) => entry.path.endsWith(".ino"))).toBe(true);
  });

  it("показывает отдельно, что напечатать, купить и приготовить из инструментов", () => {
    const model = demoModelFor(DEMO_PROJECT_ID)!;
    const guide = demoBuildGuideFor(DEMO_PROJECT_ID);
    render(<ProjectJourney model={model} guide={guide} />);

    const kit = screen.getByRole("generic", { name: "Комплект проекта" });
    expect(within(kit).getByText("Напечатать")).toBeTruthy();
    expect(within(kit).getByText("Купить")).toBeTruthy();
    expect(within(kit).getByText("Инструменты")).toBeTruthy();
    expect(screen.getAllByText("Микросерво SG90").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4 шт.").length).toBeGreaterThan(0);
    expect(screen.getByText("Загрузить прошивку")).toBeTruthy();
  });

  it("не переписывает внешние pinned-ассеты через API origin", () => {
    const raw = "https://raw.githubusercontent.com/Blue-Design/OttoDIY/example.stl";
    expect(apiAssetUrl(raw)).toBe(raw);
  });

  it("собирает LeRobotDepot как проект-систему с печатью, BOM, кодом и мобильным расширением", () => {
    const model = demoModelFor(LEROBOT_PROJECT_ID);
    const guide = demoBuildGuideFor(LEROBOT_PROJECT_ID);
    const tree = demoTreeFor(LEROBOT_PROJECT_ID);

    expect(model?.title).toContain("LeRobotDepot");
    expect(model?.repo_url).toBe("https://github.com/maximilienroberti/lerobotdepot");
    expect(model?.files.map((file) => file.format)).toEqual(expect.arrayContaining(["stl", "step", "zip"]));
    expect(guide?.steps).toHaveLength(8);
    expect(guide?.steps.some((step) => step.title === "Установить LeRobot")).toBe(true);
    expect(tree?.entries.some((entry) => entry.path.includes("teleoperate.py"))).toBe(true);
    expect(demoProjectDownloadsFor(LEROBOT_PROJECT_ID).canonical_3mf).toContain("SO101%20Assembly.stl");
  });

  it("отделяет выбор конфигурации на лендинге от личной сборки", () => {
    const model = demoModelFor(LEROBOT_PROJECT_ID)!;
    const configurations = projectConfigurationsFor(model);
    const started: string[] = [];

    expect(configurations.map((configuration) => configuration.id)).toEqual([
      "so101-follower",
      "so101-pair",
      "xlerobot",
    ]);
    expect(configurations[0]?.recommended).toBe(true);
    expect(configurations[0]?.requirements.some((requirement) => requirement.value.includes("220 × 220"))).toBe(true);

    render(<ProjectLaunchpad model={model} onStart={(configurationId) => started.push(configurationId)} />);
    screen.getByRole("button", { name: /Начать проект 8 этапов/i }).click();

    expect(started).toEqual(["so101-follower"]);
    expect(screen.getByText("Выберите, что хотите собрать")).toBeTruthy();
    expect(screen.getByText("Leader + follower")).toBeTruthy();
    expect(screen.getByText("Мобильный XLeRobot")).toBeTruthy();
  });
});
