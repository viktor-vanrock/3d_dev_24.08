import { describe, expect, it } from "vitest";
import { RELAY_CONTROL_CLOSE_REASONS, RELAY_CONTROL_CLOSE_SESSIONS_PATH } from "./relay-control.v1.ts";

describe("relay control v1 contract", () => {
  it("keeps the close-sessions path and compatible close reasons stable", () => {
    expect(RELAY_CONTROL_CLOSE_SESSIONS_PATH).toBe("/internal/relay/v1/sessions/close");
    expect(RELAY_CONTROL_CLOSE_REASONS).toEqual(["agent_revoked", "owner_blocked", "admin_action"]);
  });
});
