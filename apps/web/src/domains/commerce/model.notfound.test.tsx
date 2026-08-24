import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverlayProvider } from "@platform/overlay";
import { ThemeProvider } from "@platform/theme";
import { ModelScreen } from "./model.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ModelScreen — отсутствующий проект", () => {
  it("показывает empty-state без запросов дерева и истории", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(null, { status: 404 });
      }),
    );

    render(
      <ThemeProvider>
        <OverlayProvider>
          <ModelScreen user={null} section="market" onSectionChange={() => {}} id="missing" />
        </OverlayProvider>
      </ThemeProvider>,
    );

    await screen.findByText("Проект не найден");

    expect(requests.filter((url) => url.includes("/models/missing"))).toEqual([expect.stringContaining("/models/missing")]);
  });
});
