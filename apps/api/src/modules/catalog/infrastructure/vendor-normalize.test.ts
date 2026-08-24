import { describe, expect, it } from "vitest";
import { resolveVendorName } from "./vendor-normalize.ts";

describe("resolveVendorName", () => {
  it("collapses known casing/spelling variants to the same slug", () => {
    expect(resolveVendorName("BBL")).toEqual({ slug: "bambu-lab", name: "Bambu Lab" });
    expect(resolveVendorName("Sovol").slug).toBe("sovol");
    expect(resolveVendorName("Sovol 3D").slug).toBe("sovol");
  });

  it("falls back to slugify for unknown vendors, unifying case", () => {
    expect(resolveVendorName("SOVOL").slug).toBe("sovol");
    expect(resolveVendorName("Some New Vendor Inc.")).toEqual({
      slug: "some-new-vendor-inc",
      name: "Some New Vendor Inc.",
    });
  });

  it("falls back to a stable hash slug when raw has no latin/digit chars", () => {
    const a = resolveVendorName("Тест");
    const b = resolveVendorName("Тест");
    expect(a.slug).toBe(b.slug);
    expect(a.slug).toMatch(/^vendor-[0-9a-f]{8}$/);
    expect(a.name).toBe("Тест");
  });
});
