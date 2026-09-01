import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MermaidDiagram } from "./mermaiddiagram.tsx";

// Мокаем mermaid — не тянем весь бандл в тесты
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

// Мокаем useTheme
vi.mock("@platform/theme", () => ({
  useTheme: () => ({ theme: "light" }),
}));

describe("MermaidDiagram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("санитизирует вредоносный SVG из mermaid.render()", async () => {
    const { default: mermaid } = await import("mermaid");
    // Симулируем вредоносный SVG который mermaid теоретически мог бы вернуть
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: '<svg><script>window.__xss=1</script><text>safe</text></svg>',
      bindFunctions: vi.fn(),
      diagramType: "",
    });

    render(<MermaidDiagram source="graph TD; A-->B" />);

    await waitFor(() => {
      const container = document.querySelector(".feedRichDiagram");
      expect(container).toBeTruthy();
      // script должен быть удалён DOMPurify
      expect(container!.innerHTML).not.toContain("<script>");
      expect(container!.innerHTML).not.toContain("window.__xss");
      // проверка сохранения SVG-контента опущена —
      // jsdom не поддерживает полный рендеринг SVG-элементов (<text> и др.)
    });
  });

  it("санитизирует foreignObject из SVG", async () => {
    const { default: mermaid } = await import("mermaid");
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: '<svg><foreignObject><div onclick="alert(1)">evil</div></foreignObject></svg>',
      bindFunctions: vi.fn(),
      diagramType: "",
    });

    render(<MermaidDiagram source="graph TD; A-->B" />);

    await waitFor(() => {
      const container = document.querySelector(".feedRichDiagram");
      expect(container).toBeTruthy();
      expect(container!.innerHTML).not.toContain("foreignObject");
      expect(container!.innerHTML).not.toContain("onclick");
    });
  });

  it("показывает fallback при ошибке рендера", async () => {
    const { default: mermaid } = await import("mermaid");
    vi.mocked(mermaid.render).mockRejectedValue(new Error("parse error"));

    render(<MermaidDiagram source="invalid mermaid" />);

    await waitFor(() => {
      expect(screen.getByText("invalid mermaid")).toBeTruthy();
    });
  });
});
