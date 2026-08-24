import { describe, expect, it } from "vitest";
import { COACHMARK_SPECS, selectCoachmark } from "./coachmarks.ts";

describe("selectCoachmark", () => {
  it("предлагает единственную коачмарку, пока она не отклонена", () => {
    const spec = selectCoachmark(() => false);
    expect(spec?.id).toBe("search_or_generate");
    expect(spec?.id).toBe(COACHMARK_SPECS[0]?.id);
  });

  it("null — коачмарка уже отклонена", () => {
    const spec = selectCoachmark((id) => id === "search_or_generate");
    expect(spec).toBeNull();
  });
});
