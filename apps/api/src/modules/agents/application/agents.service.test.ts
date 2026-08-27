import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { AgentsService } from "./agents.service.ts";
const OWNER = UserId("00000000-0000-4000-8000-000000000001");
const AGENT = "00000000-0000-4000-8000-000000000002";
function row(status = "active") {
  return {
    id: AGENT,
    owner_user_id: OWNER,
    name: "Scout",
    avatar_s3_key: null,
    bio: null,
    runtime_label: null,
    status,
    created_at: new Date("2026-01-01T00:00:00Z"),
    revoked_at: status === "active" ? null : new Date("2026-01-02T00:00:00Z"),
  };
}
function setup() {
  const repository = {
    create: vi.fn().mockResolvedValue(row()),
    list: vi.fn().mockResolvedValue([]),
    revoke: vi.fn().mockResolvedValue(row("revoked")),
    isActiveOwner: vi.fn().mockResolvedValue(true),
  };
  const keys = {
    mintAgentKey: vi.fn().mockResolvedValue({ id: "key" }),
    listAgentKeys: vi.fn().mockResolvedValue([]),
    revokeAgentKey: vi.fn().mockResolvedValue(true),
    hasAgentKey: vi.fn().mockResolvedValue(true),
    revokeAllAgentKeys: vi.fn().mockResolvedValue(1),
  };
  const external = { assertRateLimit: vi.fn().mockResolvedValue(undefined) };
  const profiles = { loadOwnerAuthState: vi.fn().mockResolvedValue({ status: "active", sessionVersion: 1 }) };
  const metrics = { incCredentialRevocation: vi.fn() };
  return { repository, keys, external, profiles, metrics, service: new AgentsService(repository as never, keys, external, profiles as never, metrics as never) };
}
afterEach(() => {
  delete process.env.AGENT_ACCOUNTS_BETA_USERNAMES;
});
describe("AgentsService", () => {
  it("preserves beta allowlist, trimming and rate limiting on create", async () => {
    process.env.AGENT_ACCOUNTS_BETA_USERNAMES = "Tester";
    const { service, repository, external } = setup();
    const result = await service.create({ id: OWNER, username: "tester" }, { name: "  Scout  " }, { request: {} as never, requestId: "r" });
    expect(result).toMatchObject({ agent: { name: "Scout", status: "active" } });
    expect(repository.create).toHaveBeenCalledWith(OWNER, expect.objectContaining({ name: "Scout" }));
    expect(external.assertRateLimit).toHaveBeenCalledOnce();
  });
  it("revokes publicapi-owned agent keys after revoking the owned agent", async () => {
    const { service, keys } = setup();
    await service.revoke(OWNER, AGENT, { request: {} as never, requestId: "r" });
    expect(keys.revokeAllAgentKeys).toHaveBeenCalledWith(AGENT);
  });
  it("conceals inactive or foreign agents when minting", async () => {
    const { service, repository, keys } = setup();
    repository.isActiveOwner.mockResolvedValue(false);
    await expect(service.mintKey(OWNER, AGENT, "x", { request: {} as never, requestId: "r" })).rejects.toBeInstanceOf(NotFoundException);
    expect(keys.mintAgentKey).not.toHaveBeenCalled();
  });
  it("refuses to mint a key for an inactive owner", async () => {
    const { service, keys, profiles } = setup();
    profiles.loadOwnerAuthState.mockResolvedValue({ status: "restricted", sessionVersion: 1 });
    await expect(service.mintKey(OWNER, AGENT, "x", { request: {} as never, requestId: "r" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(keys.mintAgentKey).not.toHaveBeenCalled();
  });
});
