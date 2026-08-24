import { describe, expect, it } from "vitest";
import { accountPillInfo } from "./facecapsule.tsx";
import type { FaceState } from "./facesource.ts";

const BASE: FaceState = {
  printerName: "Мой принтер",
  model: "Voron 2.4",
  phase: "idle",
  job: null,
  problem: null,
  problemSince: 0,
  hasCamera: true,
  accountLinked: false,
  accountName: null,
  relayOnline: true,
  files: { local: [], portal: [] },
};

// Шапка морды (printer.face.md §2.4/§2.5): один источник правды для текста/тона пилюли
// аккаунта — переиспользуется и капсулой, и строкой соединения в SettingsScene.
describe("accountPillInfo", () => {
  it("аккаунт не привязан → dim «Аккаунт не привязан», relay не важен", () => {
    expect(accountPillInfo({ ...BASE, accountLinked: false, relayOnline: true })).toEqual({
      tone: "dim",
      text: "Аккаунт не привязан",
    });
  });

  it("привязан + relay недоступен → dim «Локально, портал недоступен» (§2.5, не врёт про «на связи»)", () => {
    expect(accountPillInfo({ ...BASE, accountLinked: true, accountName: "Иван П.", relayOnline: false })).toEqual({
      tone: "dim",
      text: "Локально, портал недоступен",
    });
  });

  it("привязан + relay доступен → ok «Аккаунт: Имя»", () => {
    expect(accountPillInfo({ ...BASE, accountLinked: true, accountName: "Иван П.", relayOnline: true })).toEqual({
      tone: "ok",
      text: "Аккаунт: Иван П.",
    });
  });
});
