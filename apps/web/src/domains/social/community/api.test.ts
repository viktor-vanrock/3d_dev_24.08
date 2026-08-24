import { describe, expect, it } from "vitest";
import type { SessionUser } from "@shared/types";
import { authorDisplayName, formatMemberCount, formatPostCount, formatThreadCount } from "./api.ts";

const VIEWER: SessionUser = {
  id: "u1",
  username: "plag",
  display_name: null,
  avatar_url: null,
  handle_confirmed: true,
  role: "user",
};

describe("formatMemberCount (community.md §1.2, RU-склонение)", () => {
  it("склоняет точное число (owner/moderator видят exact)", () => {
    expect(formatMemberCount(1)).toBe("1 участник");
    expect(formatMemberCount(2)).toBe("2 участника");
    expect(formatMemberCount(5)).toBe("5 участников");
    expect(formatMemberCount(11)).toBe("11 участников");
    expect(formatMemberCount(21)).toBe("21 участник");
  });

  it("округлённая строка ('100+', contract.ts#roundMemberCount) — суффикс без склонения числа", () => {
    expect(formatMemberCount("100+")).toBe("100+ участников");
  });

  it("roundMemberCount отдаёт СТРОКУ и для точных малых чисел (<10, без '+') — склоняем по значению", () => {
    expect(formatMemberCount("1")).toBe("1 участник");
    expect(formatMemberCount("2")).toBe("2 участника");
    expect(formatMemberCount("9")).toBe("9 участников");
  });
});

describe("formatThreadCount / formatPostCount", () => {
  it("128 участников · 34 треда — пример спеки §1.2 воспроизводится буквально", () => {
    expect(formatMemberCount(128)).toBe("128 участников");
    expect(formatThreadCount(34)).toBe("34 треда");
  });

  it("formatPostCount склоняет «ответ/ответа/ответов»", () => {
    expect(formatPostCount(1)).toBe("1 ответ");
    expect(formatPostCount(3)).toBe("3 ответа");
    expect(formatPostCount(0)).toBe("0 ответов");
  });
});

describe("authorDisplayName (GAP-API: author_id без join на users — заявка Back)", () => {
  it("своя реплика — @username из сессии", () => {
    expect(authorDisplayName("u1", VIEWER)).toBe("@plag");
  });

  it("чужая реплика — честный нейтральный фолбэк, не выдуманный ник", () => {
    expect(authorDisplayName("u2", VIEWER)).toBe("Участник");
  });

  it("гость (viewer=null) — тоже фолбэк, не падает", () => {
    expect(authorDisplayName("u2", null)).toBe("Участник");
  });
});
