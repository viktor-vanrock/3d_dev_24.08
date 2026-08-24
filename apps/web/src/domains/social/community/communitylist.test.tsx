import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CommunitiesScreen } from "./communitylist.tsx";

vi.mock("@platform/nav/homeheader.tsx", () => ({ HomeHeader: () => <header /> }));
vi.mock("@shared/ui/aurorabg.tsx", () => ({ AuroraBackground: () => null }));
vi.mock("@platform/overlay", () => ({
  useOverlay: () => ({ modal: vi.fn(), toast: vi.fn() }),
}));
vi.mock("@platform/sound", () => ({
  useInteractionSound: () => ({ tick: vi.fn(), toggle: vi.fn(), cta: vi.fn() }),
}));

const user = { id: "user-1", username: "maker", display_name: null, avatar_url: null, handle_confirmed: true, role: "user" as const };

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommunitiesScreen (MF-1756)", () => {
  it("скрывает явно сгенерированный числовой хвост, сохраняя человекочитаемое имя", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          items: [
            {
              id: "community-1",
              slug: "qa-generated",
              name: "QA Q&A 1783729958632",
              kind: "custom",
              description: null,
              cover_image_url: null,
              visibility: "public",
              status: "active",
              created_by: "user-1",
              created_at: "2026-07-16T10:00:00Z",
              member_count: 1,
              thread_count: 1,
              viewer_role: "owner",
            },
          ],
          next_cursor: null,
        }),
      ),
    );

    render(<CommunitiesScreen user={user} section="home" onSectionChange={() => {}} />);

    expect(screen.getByRole("heading", { name: "Опыт мастерских, собранный по делу" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Как устроен форум" })).toBeTruthy();
    expect(await screen.findByText("QA Q&A")).toBeTruthy();
    expect(screen.queryByText("QA Q&A 1783729958632")).toBeNull();
  });
});
