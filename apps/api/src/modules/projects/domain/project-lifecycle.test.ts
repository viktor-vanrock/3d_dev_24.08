import { describe, expect, it } from "vitest";
import { canTransition, getAllowedEvents, getTransition, PROJECT_EVENT, PROJECT_STATUS, TRANSITION_TABLE } from "./project-lifecycle.types.ts";

describe("TRANSITION_TABLE — полнота", () => {
  it("покрывает все значения PROJECT_STATUS", () => {
    expect(Object.values(PROJECT_STATUS).filter((status) => !(status in TRANSITION_TABLE))).toEqual([]);
  });

  it("ни один переход кроме publish не переводит в published", () => {
    const illegal: string[] = [];
    for (const [from, events] of Object.entries(TRANSITION_TABLE)) {
      for (const [event, result] of Object.entries(events)) {
        if (result.toStatus === "published" && event !== PROJECT_EVENT.PUBLISH) illegal.push(`${from} --${event}--> published`);
      }
    }
    expect(illegal).toEqual([]);
  });

  it("publish требует подтверждения", () => {
    expect(getTransition("ready", PROJECT_EVENT.PUBLISH)?.requiresConfirm).toBe(true);
  });
});

describe("getTransition", () => {
  it("draft + start_upload → uploading", () => {
    expect(getTransition("draft", PROJECT_EVENT.START_UPLOAD)?.toStatus).toBe("uploading");
  });

  it("ready + publish → published, setPublishedAt=now", () => {
    const transition = getTransition("ready", PROJECT_EVENT.PUBLISH);
    expect(transition?.toStatus).toBe("published");
    expect(transition?.setPublishedAt).toBe("now");
  });

  it("rejects publish from draft and uploading", () => {
    expect(getTransition("draft", PROJECT_EVENT.PUBLISH)).toBeNull();
    expect(getTransition("uploading", PROJECT_EVENT.PUBLISH)).toBeNull();
  });

  it("unpublish keeps and restore clears publishedAt", () => {
    expect(getTransition("published", PROJECT_EVENT.UNPUBLISH)?.setPublishedAt).toBe("keep");
    expect(getTransition("archived", PROJECT_EVENT.RESTORE)?.setPublishedAt).toBe("null");
  });
});

describe("getAllowedEvents", () => {
  it.each([
    ["draft", ["start_upload", "submit_for_review", "archive"]],
    ["ready", ["publish", "start_upload", "archive"]],
    ["published", ["unpublish", "archive"]],
    ["archived", ["restore"]],
    ["uploading", []],
    ["reviewing", []],
    ["unpublished", ["publish", "archive"]],
  ] as const)("%s → %j", (status, expected) => {
    expect([...getAllowedEvents(status)].sort()).toEqual([...expected].sort());
  });
});

describe("canTransition", () => {
  it("returns true for draft → start_upload and false for archived → publish", () => {
    expect(canTransition("draft", PROJECT_EVENT.START_UPLOAD)).toBe(true);
    expect(canTransition("archived", PROJECT_EVENT.PUBLISH)).toBe(false);
  });
});
