import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AvatarBubble, deterministicAvatarConfig } from "./avatar.tsx";

afterEach(cleanup);

describe("mascot-only identity", () => {
  it("строит стабильного персонажа для legacy-пользователя без фото", () => {
    expect(deterministicAvatarConfig("maker-42")).toEqual(deterministicAvatarConfig("maker-42"));
    expect(deterministicAvatarConfig("maker-42")).not.toEqual(deterministicAvatarConfig("maker-43"));
  });

  it("использует серверный портрет без круглой подложки", () => {
    const { container } = render(
      <AvatarBubble
        config={deterministicAvatarConfig("maker")}
        snapshots={{ front: "/avatars/u1/snapshots/2/front/hash.png", left: null, right: null }}
        size={48}
        facing="front"
      />,
    );
    const portrait = container.querySelector("img");
    expect(portrait?.getAttribute("src")).toContain("/avatars/u1/snapshots/2/front/hash.png");
    expect(portrait?.getAttribute("style")).not.toContain("border-radius");
  });

  it("не читает снимок текущего аккаунта для удалённого пользователя без manifest", () => {
    localStorage.setItem(
      "portal.avatar.snapshots",
      JSON.stringify({ front: "data:image/png;base64,current-user", left: null, right: null }),
    );
    const { container } = render(
      <AvatarBubble
        config={deterministicAvatarConfig("remote-maker")}
        snapshots={null}
        size={40}
        facing="front"
      />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });
});
