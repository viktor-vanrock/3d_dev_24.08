import { afterEach, describe, expect, it, vi } from "vitest";
import { createMake } from "./makes.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createMake", () => {
  it("отправляет воспроизводимый результат проекта как multipart", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("include");
      expect(form.get("model_id")).toBe("model-1");
      expect(form.get("machine_id")).toBe("machine-1");
      expect(form.get("material_ids")).toBe("pla-white,pla-orange");
      expect(form.get("caption")).toBe("Готовый светильник");
      expect(form.get("notes")).toBe("Сопло 0.4");
      expect(form.get("printability_rating")).toBe("4");
      expect(form.get("issue_tags")).toBe("stringing");
      expect(form.getAll("photos")).toHaveLength(2);

      return new Response(JSON.stringify({ id: "make-1", model_id: "model-1" }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createMake({
      modelId: "model-1",
      machineId: "machine-1",
      materialIds: ["pla-white", "pla-orange"],
      photos: [
        new File(["front"], "front.jpg", { type: "image/jpeg" }),
        new File(["detail"], "detail.webp", { type: "image/webp" }),
      ],
      caption: "  Готовый светильник  ",
      notes: "  Сопло 0.4  ",
      printabilityRating: 4,
      issueTags: ["stringing"],
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/makes$/);
  });

  it("сохраняет код валидации API для понятной ошибки формы", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "PHOTO_REQUIRED" }), { status: 422 })),
    );

    await expect(
      createMake({
        modelId: "model-1",
        machineId: "machine-1",
        materialIds: ["pla"],
        photos: [],
      }),
    ).resolves.toEqual({ ok: false, error: "PHOTO_REQUIRED" });
  });
});
