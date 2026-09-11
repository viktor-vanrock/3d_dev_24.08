import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parkAddResumePath, saveParkAddResume, takeParkAddResume } from "./addresume.ts";

describe("park add deep-link resume", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it("preserves every query parameter across an external login", () => {
    saveParkAddResume("?code=ABC123&model=bambu-x1&campaign=qr");

    const resume = takeParkAddResume();
    expect(resume).toEqual({ path: "/park/add", params: { code: "ABC123", model: "bambu-x1", campaign: "qr" } });
    expect(parkAddResumePath(resume!)).toBe("/park/add?code=ABC123&model=bambu-x1&campaign=qr");
    expect(takeParkAddResume()).toBeNull();
  });
});
