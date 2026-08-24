import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FeedPostContextCard } from "./post.tsx";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/feed");
});

describe("FeedPostContextCard", () => {
  it("строит контекст только из саба и автора поста", () => {
    const { container } = render(
      <FeedPostContextCard
        community={{ id: "c1", slug: "voron", name: "Voron", kind: "machine" }}
        author={{ id: "u1", username: "maker", display_name: "Мейкер", avatar_url: null }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Voron" })).toBeTruthy();
    expect(screen.getByText("Официальное сообщество")).toBeTruthy();
    expect(screen.getByText("@maker")).toBeTruthy();
    expect(container.querySelector(".feedPostContextAuthor svg")).toBeTruthy();
    expect(container.querySelector(".feedPostContextAuthor img")).toBeNull();
  });

  // 2026-07-21: "Открыть сообщество" всегда ведёт на страницу /community/:slug — и для
  // официальных сабов тоже (страница сама показывает их посты, вкладка "Новости" в
  // communityscreen.tsx — редиректить мимо неё в ленту не нужно, оператор явно поправил).
  it("«Открыть сообщество» ведёт на страницу сообщества для официального и для custom саба", () => {
    render(
      <FeedPostContextCard
        community={{ id: "c1", slug: "creality", name: "Creality", kind: "vendor" }}
        author={{ id: "u1", username: "plagx", display_name: null, avatar_url: null }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Открыть сообщество/ }));
    expect(window.location.pathname).toBe("/community/creality");
  });
});
