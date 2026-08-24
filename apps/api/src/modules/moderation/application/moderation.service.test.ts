import { describe, expect, it, vi } from "vitest";
import { ModerationService } from "./moderation.service.ts";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111" as never;
const TARGET_ID = "22222222-2222-4222-8222-222222222222" as never;

describe("ModerationService device-agent cascade", () => {
  it("revokes owner gateways before scheduling their relay close", async () => {
    const profiles = { isStaff: vi.fn().mockResolvedValue(true), banUser: vi.fn().mockResolvedValue({ status: "banned", transitioned: true }) };
    const devices = { revokeAllActiveByOwner: vi.fn().mockResolvedValue(["agent-1", "agent-2"]) };
    const relayControl = { closeAgentSessions: vi.fn().mockResolvedValue(undefined) };
    const metrics = { incCredentialRevocation: vi.fn() };
    const service = new ModerationService(profiles, devices, relayControl, metrics as never);

    await expect(service.banUser(ACTOR_ID, TARGET_ID)).resolves.toEqual({ id: TARGET_ID, status: "banned" });
    expect(devices.revokeAllActiveByOwner).toHaveBeenCalledWith(TARGET_ID, "owner_blocked", ACTOR_ID);
    expect(relayControl.closeAgentSessions).toHaveBeenCalledWith(["agent-1", "agent-2"], "owner_blocked");
    expect(metrics.incCredentialRevocation).toHaveBeenCalledWith("session", "admin_ban");
    expect(metrics.incCredentialRevocation).toHaveBeenCalledTimes(3);
  });

  it("keeps the ban successful when the relay push rejects", async () => {
    const profiles = { isStaff: vi.fn().mockResolvedValue(true), banUser: vi.fn().mockResolvedValue({ status: "banned", transitioned: false }) };
    const devices = { revokeAllActiveByOwner: vi.fn().mockResolvedValue(["agent-1"]) };
    const relayControl = { closeAgentSessions: vi.fn().mockRejectedValue(new Error("relay unavailable")) };
    const metrics = { incCredentialRevocation: vi.fn() };
    const service = new ModerationService(profiles, devices, relayControl, metrics as never);

    await expect(service.banUser(ACTOR_ID, TARGET_ID)).resolves.toEqual({ id: TARGET_ID, status: "banned" });
    expect(metrics.incCredentialRevocation).not.toHaveBeenCalledWith("session", "admin_ban");
  });
});
