import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
// eslint-disable-next-line boundaries/element-types -- тест vote.tsx (отложенное shared→platform ребро, см. vote.tsx / MIGRATION.md)
import { OverlayProvider } from "@platform/overlay";
import { ReasonPanel } from "./reasonpanel.tsx";
import { Vote } from "./vote.tsx";

// Vote (docs/design/ideas.md §5, GAP-3) — upvote-only toggle, оптимистичный апдейт+откат,
// disabled-кейсы (своя идея/гость/архив). prefers-reduced-motion=true в тестах — count-up
// становится мгновенной сменой числа, не мешает синхронным ассертам (theme/reducedmotion.ts).
// Vote зовёт useOverlay() безусловно (тихий тост на откат) — рендерим только под OverlayProvider.
function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderVote(el: ReactElement) {
  return render(<OverlayProvider>{el}</OverlayProvider>);
}

beforeEach(() => {
  mockMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Vote", () => {
  it("тап по не голосовавшей — оптимистичный +1, aria-pressed=true, onToggle вызван", async () => {
    const onToggle = vi.fn().mockResolvedValue(true);
    renderVote(<Vote variant="compact" voteCount={10} hasVoted={false} onToggle={onToggle} />);
    const btn = screen.getByRole("button", { name: /сейчас 10 голосов/ });
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(screen.getByText("11")).toBeTruthy();
    });
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });

  it("повторный тап у голосовавшей — отзыв, -1", async () => {
    const onToggle = vi.fn().mockResolvedValue(true);
    renderVote(<Vote variant="compact" voteCount={10} hasVoted onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    await vi.waitFor(() => {
      expect(screen.getByText("9")).toBeTruthy();
    });
  });

  it("отказ onToggle (false) — откат счётчика + тихий тост", async () => {
    const onToggle = vi.fn().mockResolvedValue(false);
    renderVote(<Vote variant="compact" voteCount={10} hasVoted={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    await vi.waitFor(() => {
      expect(screen.getByText("Не удалось. Попробуйте ещё")).toBeTruthy();
    });
    expect(screen.getByText("10")).toBeTruthy();
  });

  it("своя идея (reason=own) — кнопка задизейблена, тап без эффекта", () => {
    const onToggle = vi.fn();
    renderVote(<Vote variant="compact" voteCount={10} hasVoted={false} reason="own" onToggle={onToggle} />);
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("гость (reason=guest) — тап не меняет счётчик, но зовёт onToggle (экран открывает вход)", () => {
    const onToggle = vi.fn();
    renderVote(<Vote variant="compact" voteCount={10} hasVoted={false} reason="guest" onToggle={onToggle} />);
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByText("10")).toBeTruthy();
  });

  it("архив (reason=archived) — счётчик виден, upvote скрыт (нет кнопки)", () => {
    renderVote(<Vote variant="compact" voteCount={301} hasVoted reason="archived" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("301")).toBeTruthy();
  });

  it("large + своя идея — кнопка заменена подписью «Ваша идея», без интерактива", () => {
    renderVote(<Vote variant="large" voteCount={64} hasVoted={false} reason="own" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Ваша идея")).toBeTruthy();
  });

  it("inline — текст кнопки переключается «Проголосовать» ⇄ «Проголосовали»", () => {
    const { rerender } = renderVote(<Vote variant="inline" voteCount={5} hasVoted={false} />);
    expect(screen.getByText("Проголосовать")).toBeTruthy();
    rerender(
      <OverlayProvider>
        <Vote variant="inline" voteCount={6} hasVoted />
      </OverlayProvider>,
    );
    expect(screen.getByText("Проголосовали")).toBeTruthy();
  });
});

describe("ReasonPanel", () => {
  it("рендерится для tone=danger с заголовком и текстом причины", () => {
    render(<ReasonPanel tone="danger" title="Отклонена" reason="Не подходит формату портала" />);
    expect(screen.getByText("Отклонена")).toBeTruthy();
    expect(screen.getByText("Не подходит формату портала")).toBeTruthy();
  });

  it("дубликат (tone=dim) — обязательная ссылка на каноническую идею", () => {
    render(<ReasonPanel tone="dim" title="Дубликат идеи" reason="Уже предложено" canonicalHref="#/issue/canonical-1" />);
    const link = screen.getByRole("link", { name: /Смотреть оригинал/ }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("#/issue/canonical-1");
  });

  it("любой другой тон (ok/warn/null) — панель не рендерится", () => {
    const { container, rerender } = render(<ReasonPanel tone="ok" title="x" reason="y" />);
    expect(container.firstChild).toBeNull();
    rerender(<ReasonPanel tone={null} title="x" reason="y" />);
    expect(container.firstChild).toBeNull();
  });
});
