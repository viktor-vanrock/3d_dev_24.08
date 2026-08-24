import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { buildHistoryEvents, commitEventLabel, RepoHistory } from "./repohistory.tsx";
import type { RepoHistoryCommit } from "./models.ts";

afterEach(() => cleanup());

function commit(subject: string, authoredAt = "2026-07-01T00:00:00Z"): RepoHistoryCommit {
  return { sha: `${subject}-${authoredAt}`, author_name: "masha", author_email: "masha@example.com", authored_at: authoredAt, subject };
}

// Словарь событий v1 (docs/design/projects.page.md §11.3) — Back отдаёт raw git subject,
// Front переводит по известным паттернам сообщений (commitFile/commitReadme, git/repo.ts).
describe("commitEventLabel", () => {
  it("translates file add/remove commits", () => {
    expect(commitEventLabel("feat: add print/clock.stl")).toBe("Добавлен файл clock.stl");
    expect(commitEventLabel("chore: remove print/clock.stl")).toBe("Удалён файл clock.stl");
  });

  it("translates the README commit", () => {
    expect(commitEventLabel("docs: update README")).toBe("Обновлено описание");
  });

  it("falls back to the raw subject for an unrecognized message shape", () => {
    expect(commitEventLabel("weird: message")).toBe("weird: message");
  });
});

describe("buildHistoryEvents", () => {
  it("labels the oldest commit as project creation regardless of its literal subject", () => {
    const events = buildHistoryEvents([
      commit("docs: update README", "2026-07-03T00:00:00Z"),
      commit("feat: add print/clock.stl", "2026-07-01T00:00:00Z"),
    ]);
    expect(events[0]!.label).toBe("Обновлено описание");
    expect(events[1]!.label).toBe("Проект создан");
  });
});

const OWNER = {
  id: "00000000-0000-0000-0000-000000000001",
  username: "masha",
  display_name: "Маша",
  avatar_config: null,
  avatar_snapshots: null,
};

describe("RepoHistory", () => {
  it("renders nothing when there are no commits", () => {
    const { container } = render(<RepoHistory commits={[]} owner={OWNER} relativeDate={() => "3 дня назад"} />);
    expect(container.innerHTML).toBe("");
  });

  it("stays collapsed by default, showing only the trigger row", () => {
    render(
      <RepoHistory
        commits={[commit("feat: add print/clock.stl")]}
        owner={OWNER}
        relativeDate={() => "3 дня назад"}
      />,
    );
    expect(screen.getByText("История")).toBeTruthy();
    expect(screen.getByText("обновлено 3 дня назад")).toBeTruthy();
    expect(screen.queryByText("Проект создан")).toBeNull();
  });

  it("expands to show the human-readable journal on tap", () => {
    const { container } = render(
      <RepoHistory
        commits={[commit("docs: update README", "2026-07-03T00:00:00Z"), commit("feat: add print/clock.stl", "2026-07-01T00:00:00Z")]}
        owner={OWNER}
        relativeDate={() => "3 дня назад"}
      />,
    );
    fireEvent.click(screen.getByText("История"));
    expect(screen.getByText("Обновлено описание")).toBeTruthy();
    expect(screen.getByText("Проект создан")).toBeTruthy();
    expect(screen.getAllByText("@masha")).toHaveLength(2);
    expect(container.querySelectorAll(".repoHistoryRow svg")).toHaveLength(2);
    expect(container.querySelector(".repoHistoryRow img")).toBeNull();
  });
});
