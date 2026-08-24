import { describe, expect, it } from "vitest";
import { DescriptionTooLongError, MAX_DESCRIPTION_BYTES, MAX_DESCRIPTION_IMAGES, TooManyDescriptionImagesError, validateDescription } from "./description.ts";

describe("validateDescription", () => {
  it("accepts a short description with a few images", () => {
    const description = "# Title\n" + "![alt](https://x/1.png)\n".repeat(3);
    expect(() => validateDescription(description)).not.toThrow();
  });

  it("rejects a description over the byte limit", () => {
    const description = "x".repeat(MAX_DESCRIPTION_BYTES + 1);
    expect(() => validateDescription(description)).toThrow(DescriptionTooLongError);
  });

  it("counts UTF-8 bytes, not JS string length", () => {
    // Каждый кириллический символ — 2 байта в UTF-8; строка ниже укладывается по length,
    // но не по байтам, если бы лимит считался неверно.
    const description = "п".repeat(MAX_DESCRIPTION_BYTES); // 2*MAX байт
    expect(() => validateDescription(description)).toThrow(DescriptionTooLongError);
  });

  it("rejects a description with more than the allowed image references", () => {
    const description = Array.from({ length: MAX_DESCRIPTION_IMAGES + 1 }, (_, i) => `![img${i}](u${i}.png)`).join("\n");
    expect(() => validateDescription(description)).toThrow(TooManyDescriptionImagesError);
  });

  it("accepts exactly the image limit", () => {
    const description = Array.from({ length: MAX_DESCRIPTION_IMAGES }, (_, i) => `![img${i}](u${i}.png)`).join("\n");
    expect(() => validateDescription(description)).not.toThrow();
  });
});
