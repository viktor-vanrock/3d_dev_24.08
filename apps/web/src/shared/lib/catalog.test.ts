import { describe, expect, it, vi } from "vitest";
import { fetchPopularMachines } from "./catalog.ts";

describe("fetchPopularMachines", () => {
  it("сообщает об ошибке, если каталог недоступен целиком", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(fetchPopularMachines()).rejects.toThrow("popular machines unavailable");
  });

  it("возвращает пустой список для доступного, но пока пустого каталога", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ machines: [] }), { status: 200 })));

    await expect(fetchPopularMachines()).resolves.toEqual([]);
  });
});
