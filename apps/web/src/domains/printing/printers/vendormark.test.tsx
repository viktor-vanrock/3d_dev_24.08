import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { VendorMark } from "./vendormark.tsx";

describe("VendorMark (MF-2039 — иконка вендора без фото, всегда с фоном)", () => {
  it("показывает первую букву бренда заглавной", () => {
    const { container } = render(<VendorMark brand="bambu lab" />);
    expect(container.querySelector(".prnVendorMark")?.textContent).toBe("B");
  });

  it("детерминирован — один и тот же бренд даёт один и тот же --mark-hue между рендерами", () => {
    const first = render(<VendorMark brand="Formlabs" />);
    const firstHue = (first.container.querySelector(".prnVendorMark") as HTMLElement).style.getPropertyValue("--mark-hue");
    first.unmount();
    const second = render(<VendorMark brand="Formlabs" />);
    const secondHue = (second.container.querySelector(".prnVendorMark") as HTMLElement).style.getPropertyValue("--mark-hue");
    expect(secondHue).toBe(firstHue);
    expect(secondHue).not.toBe("");
  });

  it("не падает на пустой строке — отдаёт заглушку вместо пустого кружка", () => {
    const { container } = render(<VendorMark brand="" />);
    expect(container.querySelector(".prnVendorMark")?.textContent).toBe("?");
  });
});
