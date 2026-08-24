import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ProjectFiles,
  formatFileSize,
  groupFilesByRole,
  humanizeRepoUrl,
  shouldShowProjectFiles,
} from "./projectfiles.tsx";
import type { ProjectFile, RepoTreeEntry } from "./models.ts";

afterEach(() => cleanup());

let fileIdCounter = 0;
function file(role: string, format: string | null, size = 1024): ProjectFile {
  fileIdCounter += 1;
  return { id: `f${fileIdCounter}`, role, format, size_bytes: size, original_filename: null };
}

// Инвариант §3.2: блок дремлет, пока у публикации только печатная база (source [+ canonical_3mf]),
// и «зажигается» при артефакте вне неё (ЧПУ/чертёж/плата/код).
describe("shouldShowProjectFiles", () => {
  it("stays dormant for a typical print model", () => {
    expect(shouldShowProjectFiles([])).toBe(false);
    expect(shouldShowProjectFiles([file("source", "stl")])).toBe(false);
    expect(shouldShowProjectFiles([file("source", "stl"), file("canonical_3mf", "3mf")])).toBe(false);
  });

  it("appears once a non-print artifact is present", () => {
    expect(shouldShowProjectFiles([file("source", "stl"), file("cnc_program", "nc")])).toBe(true);
    expect(shouldShowProjectFiles([file("code_archive", "zip")])).toBe(true);
    expect(shouldShowProjectFiles([file("gerber", "zip")])).toBe(true);
  });

  it("ignores API service roles (aux/description_image) — they never wake the block", () => {
    expect(shouldShowProjectFiles([file("source", "stl"), file("aux", "txt")])).toBe(false);
    expect(shouldShowProjectFiles([file("source", "stl"), file("description_image", "png")])).toBe(false);
  });
});

// §3.2: порядок групп «по полезности потребителю» — готовое к печати, исходник, ремесло-специфичные,
// код последним. Служебные роли отфильтрованы.
describe("groupFilesByRole", () => {
  it("orders groups by usefulness and drops non-artifact roles", () => {
    const groups = groupFilesByRole([
      file("code_archive", "zip"),
      file("source", "step"),
      file("cnc_program", "nc"),
      file("canonical_3mf", "3mf"),
      file("description_image", "png"),
    ]);
    expect(groups.map((g) => g.role)).toEqual(["canonical_3mf", "source", "cnc_program", "code_archive"]);
    expect(groups[0]!.label).toBe("Готово к печати (3MF)");
    expect(groups[3]!.label).toBe("Код");
  });
});

describe("formatFileSize", () => {
  it("uses КБ under a megabyte and МБ above", () => {
    expect(formatFileSize(120 * 1024)).toBe("120 КБ");
    expect(formatFileSize(2.4 * 1024 * 1024)).toBe("2.4 МБ");
  });
});

describe("ProjectFiles", () => {
  it("renders nothing for a print-only model (dormant)", () => {
    const { container } = render(
      <ProjectFiles files={[file("source", "stl"), file("canonical_3mf", "3mf")]} onDownload={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders role groups and downloads as-is for a multi-artifact project", () => {
    const onDownload = vi.fn();
    render(
      <ProjectFiles
        files={[file("source", "step"), file("cnc_program", "nc", 120 * 1024)]}
        onDownload={onDownload}
      />,
    );
    expect(screen.getByText("Исходник")).toBeTruthy();
    expect(screen.getByText("Программа ЧПУ")).toBeTruthy();
    expect(screen.getByText("NC")).toBeTruthy();
    expect(screen.getByText("120 КБ")).toBeTruthy();

    const buttons = screen.getAllByRole("button", { name: "Скачать" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  // Дельта §4.2 projects.multiformat.md: repo_url — независимый триггер группы «Код»,
  // не всей роль-разбивки (печатная модель с одним лишь repo_url не «просыпается» как мульти-артефактная).
  it("shows only the «Код» group for a print-only model with just a repo_url", () => {
    render(
      <ProjectFiles
        files={[file("source", "stl"), file("canonical_3mf", "3mf")]}
        repoUrl="https://gitverse.ru/plag/portal.ru"
        onDownload={() => {}}
      />,
    );
    expect(screen.getByText("Код")).toBeTruthy();
    expect(screen.getByText("gitverse.ru/plag/portal.ru")).toBeTruthy();
    expect(screen.queryByText("Исходник")).toBeNull();
    expect(screen.queryByText("Готово к печати (3MF)")).toBeNull();
  });

  it("renders nothing when there are no files and no repo_url", () => {
    const { container } = render(<ProjectFiles files={[]} onDownload={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("puts the repo row first in an existing «Код» group with a code_archive attachment", () => {
    render(
      <ProjectFiles
        files={[file("source", "stl"), file("code_archive", "zip", 240 * 1024)]}
        repoUrl="https://gitverse.ru/plag/portal.ru"
        onDownload={() => {}}
      />,
    );
    const codeGroupLabels = screen.getAllByText("Код");
    expect(codeGroupLabels).toHaveLength(1);
    expect(screen.getByText("gitverse.ru/plag/portal.ru")).toBeTruthy();
    expect(screen.getByText("Открыть")).toBeTruthy();
    expect(screen.getByText("ZIP")).toBeTruthy();
  });

  it("renders the «download all» action only when provided", () => {
    const onDownloadAll = vi.fn();
    render(
      <ProjectFiles
        files={[file("source", "step"), file("cnc_program", "nc")]}
        onDownload={() => {}}
        onDownloadAll={onDownloadAll}
      />,
    );
    fireEvent.click(screen.getByText("Скачать весь проект"));
    expect(onDownloadAll).toHaveBeenCalledTimes(1);
  });
});

function treeEntry(path: string, size = 1024): RepoTreeEntry {
  return { path, size_bytes: size };
}

// Дельта эпика «Проект = git» (docs/design/projects.page.md §11.2): дерево репо заменяет
// плоские роль-группы, когда модель уже смигрирована (`tree.source === 'git'`).
describe("ProjectFiles — git tree (§11.2)", () => {
  it("renders real repo paths/names grouped by craft-folder instead of role groups", () => {
    render(
      <ProjectFiles
        files={[file("source", "step"), file("cnc_program", "nc", 120 * 1024)]}
        tree={{ source: "git", entries: [treeEntry("README.md"), treeEntry("print/clock.step"), treeEntry("cad/mill.nc", 120 * 1024)] }}
        onDownload={() => {}}
      />,
    );
    // README.md сам файлом не рисуется (§10.3 — уже показан как описание вверху).
    expect(screen.queryByText("README.md")).toBeNull();
    expect(screen.getByText("clock.step")).toBeTruthy();
    expect(screen.getByText("mill.nc")).toBeTruthy();
    expect(screen.getByText("Печать")).toBeTruthy();
    expect(screen.getByText("Чертежи")).toBeTruthy();
  });

  it("dispatches download by resolved role, not by path", () => {
    const onDownloadByRole = vi.fn();
    render(
      <ProjectFiles
        files={[file("source", "step"), file("cnc_program", "nc", 120 * 1024)]}
        tree={{ source: "git", entries: [treeEntry("print/clock.step"), treeEntry("cad/mill.nc", 120 * 1024)] }}
        onDownload={() => {}}
        onDownloadByRole={onDownloadByRole}
      />,
    );
    fireEvent.click(screen.getByText("clock.step").closest(".projectFileRow")!.querySelector("button")!);
    expect(onDownloadByRole).toHaveBeenCalledWith("source");
  });

  it("collapses nested folders by default and expands them on tap", () => {
    render(
      <ProjectFiles
        files={[file("source", "step"), file("code_archive", "zip")]}
        tree={{
          source: "git",
          entries: [treeEntry("print/clock.step"), treeEntry("print/parts/gear.step"), treeEntry("code/firmware.zip")],
        }}
        onDownload={() => {}}
      />,
    );
    expect(screen.getByText("clock.step")).toBeTruthy();
    expect(screen.queryByText("gear.step")).toBeNull();
    fireEvent.click(screen.getByText("parts"));
    expect(screen.getByText("gear.step")).toBeTruthy();
  });

  it("omits the download action when a file's role can't be resolved (multi-file folder, size mismatch)", () => {
    render(
      <ProjectFiles
        files={[file("cnc_program", "nc", 10), file("drawing", "dxf", 20)]}
        tree={{ source: "git", entries: [treeEntry("cad/a.nc", 999), treeEntry("cad/b.dxf", 998)] }}
        onDownload={() => {}}
      />,
    );
    const row = screen.getByText("a.nc").closest(".projectFileRow")!;
    expect(row.querySelector("button")).toBeNull();
  });

  it("falls back to the old role-grouped view when the model isn't migrated yet", () => {
    render(
      <ProjectFiles
        files={[file("source", "step"), file("cnc_program", "nc", 120 * 1024)]}
        tree={{ source: "fallback", entries: [treeEntry("models/x/source.step")] }}
        onDownload={() => {}}
      />,
    );
    expect(screen.getByText("Исходник")).toBeTruthy();
    expect(screen.getByText("Программа ЧПУ")).toBeTruthy();
  });
});

describe("humanizeRepoUrl", () => {
  it("strips the scheme and keeps host/path", () => {
    expect(humanizeRepoUrl("https://gitverse.ru/plag/portal.ru")).toBe("gitverse.ru/plag/portal.ru");
  });

  it("truncates a long path to the last two segments", () => {
    expect(humanizeRepoUrl("https://github.com/org/team/deep/repo")).toBe("github.com/deep/repo");
  });

  it("falls back to the raw string for an unparseable URL", () => {
    expect(humanizeRepoUrl("not a url")).toBe("not a url");
  });
});
