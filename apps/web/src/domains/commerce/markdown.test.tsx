// @vitest-environment jsdom
//
// DOMPurify's mXSS/namespace defenses rely on DOM parsing behavior happy-dom (this repo's
// default test environment) doesn't fully replicate — under happy-dom DOMPurify silently
// no-ops instead of stripping (verified: even a bare DOMPurify.sanitize("<script>") call
// passes through unstripped). jsdom is DOMPurify's own supported/tested environment, so this
// one security-critical file opts into it per-file rather than changing the global default.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MarkdownBody, MarkdownEditor, renderMarkdown } from "./markdown.tsx";
import { DescriptionImageError, uploadDescriptionImage } from "./models.ts";
import { apiAssetUrl } from "@shared/api";

vi.mock("./models.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./models.ts")>();
  return { ...actual, uploadDescriptionImage: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.mocked(uploadDescriptionImage).mockReset();
});

// Приёмочный контракт §3.4/§5 п.6 projects.multiformat.md: raw HTML/<script>/атрибуты-обработчики/
// javascript:-URL вырезаются ВСЕГДА — XSS через описание невозможен.
describe("renderMarkdown — XSS-непробиваемость (приёмочное)", () => {
  it("strips <script> tags entirely", () => {
    const html = renderMarkdown("hello <script>alert(1)</script> world");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  it("strips onerror/onclick event-handler attributes", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">text');
    expect(html).not.toContain("onerror");
  });

  it("strips javascript: URLs in links", () => {
    const html = renderMarkdown("[click me](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("strips iframe/object/embed raw HTML", () => {
    const html = renderMarkdown('<iframe src="https://evil.example"></iframe>');
    expect(html).not.toContain("<iframe");
  });

  it("keeps allowlisted GFM elements", () => {
    const html = renderMarkdown("# Заголовок\n\n**жирный** и *курсив*, `код`, и [ссылка](https://example.com)");
    expect(html).toContain("<h1>");
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
    expect(html).toContain("<code>");
    expect(html).toContain('href="https://example.com"');
  });

  it("renders GFM tables and fenced code blocks", () => {
    const html = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```");
    expect(html).toContain("<table>");
    expect(html).toContain("<pre>");
  });
});

// §3.2/§3.4: только свои картинки (роль description_image) — внешние хотлинки не рендерятся.
describe("renderMarkdown — внешние хотлинки картинок", () => {
  it("strips foreign-origin images entirely", () => {
    const html = renderMarkdown("![alt](https://evil.example/tracker.png)", "https://api.3mf.tech");
    expect(html).not.toContain("<img");
  });

  it("keeps own-origin (relative) images", () => {
    const html = renderMarkdown("![alt](/assets/description-images/abc.png)", "https://api.3mf.tech");
    expect(html).toContain("<img");
  });
});

describe("MarkdownBody", () => {
  it("renders nothing for empty/whitespace-only source", () => {
    const { container } = render(<MarkdownBody source="   " />);
    expect(container.innerHTML).toBe("");
  });

  it("renders sanitized markdown for real content", () => {
    const { container } = render(<MarkdownBody source="**bold**" />);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });
});

// §3.2, MF-716: кнопка «картинка» подключена к POST /models/:id/description-images.
describe("MarkdownEditor — картинка описания", () => {
  function pngFile(name = "photo.png") {
    return new File(["fake-bytes"], name, { type: "image/png" });
  }

  it("disables the image button when no modelId is available yet", () => {
    render(<MarkdownEditor id="d" value="" onChange={() => {}} />);
    expect((screen.getByTitle(/Сначала сохраните проект/) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uploads the picked file and inserts a markdown image link at the cursor", async () => {
    vi.mocked(uploadDescriptionImage).mockResolvedValue({
      id: "f1",
      url: "/models/m1/description-images/f1",
    });
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor id="d" value="" onChange={onChange} modelId="m1" />);

    const imageButton = screen.getByTitle("Картинка") as HTMLButtonElement;
    expect(imageButton.disabled).toBe(false);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [pngFile()] } });

    await waitFor(() => expect(uploadDescriptionImage).toHaveBeenCalledWith("m1", expect.any(File)));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(`![photo](${apiAssetUrl("/models/m1/description-images/f1")})`),
    );
  });

  it("shows an inline error and leaves the value untouched when the upload fails", async () => {
    vi.mocked(uploadDescriptionImage).mockRejectedValue(new DescriptionImageError("UNSUPPORTED_IMAGE_FORMAT"));
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor id="d" value="" onChange={onChange} modelId="m1" />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [pngFile()] } });

    await screen.findByText("Формат не поддерживается. Загрузите PNG, JPEG, GIF или WebP.");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("MarkdownEditor — компактный режим обращения MF-1753", () => {
  it("скрывает preview, объясняет лимит словами и связывает tooltip с иконками", () => {
    render(
      <MarkdownEditor
        id="d"
        value=""
        onChange={() => {}}
        showPreview={false}
        helperText="Описание — до 50 КБ. Картинки к обращению пока нельзя прикрепить."
      />,
    );

    expect(screen.queryByText("Предпросмотр")).toBeNull();
    expect(screen.queryByText("0/50 КБ")).toBeNull();
    expect(screen.getByText("Описание — до 50 КБ. Картинки к обращению пока нельзя прикрепить.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Добавить ссылку" }).getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByRole("button", { name: "1. — нумерованный список" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Описание (необязательно)" }).getAttribute("aria-describedby")).toBe("d-help");
  });
});
