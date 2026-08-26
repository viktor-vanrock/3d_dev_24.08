import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import { PublicApiService } from "./publicapi.service.ts";

function request() {
  return { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as never;
}
function setup() {
  const repository = {
    activeApiKeyCount: vi.fn().mockResolvedValue(0),
    insertApiKey: vi.fn().mockResolvedValue({
      id: "key-id",
      name: "name",
      key_prefix: "prefix",
      scopes: ["read"],
      revoked_at: null,
      last_used_at: null,
      created_at: new Date("2026-01-01T00:00:00Z"),
    }),
    verifyApiKey: vi.fn(),
    insertUserApiKey: vi.fn().mockResolvedValue({ id: "agent-key", created_at: new Date("2026-01-01T00:00:00Z") }),
  };
  const external = { assertRateLimit: vi.fn().mockResolvedValue(undefined) };
  const profiles = { loadOwnerAuthState: vi.fn().mockResolvedValue({ status: "active", sessionVersion: 1 }) };
  const metrics = { incRevokedCredentialUse: vi.fn(), incCredentialRevocation: vi.fn() };
  return { repository, external, profiles, metrics, service: new PublicApiService(repository as never, external, profiles as never, metrics as never) };
}
describe("PublicApiService", () => {
  it("returns a printer key once and stores only its SHA-256", async () => {
    const { service, repository, external } = setup();
    const result = await service.createApiKey(UserId("00000000-0000-4000-8000-000000000001"), { name: "name" }, { request: request(), requestId: "request-id" });
    expect(result.key).toMatch(/^mf_pub_/);
    const stored = repository.insertApiKey.mock.calls[0]![1] as { hash: Buffer; prefix: string };
    expect(stored.hash).toHaveLength(32);
    expect(stored.hash.toString()).not.toContain(result.key);
    expect(stored.prefix).toBe(result.key.slice(0, "mf_pub_".length + 8));
    expect(external.assertRateLimit).toHaveBeenCalledOnce();
  });
  it("keeps an explicitly empty scope list read-only", async () => {
    const { service, repository } = setup();
    await service.createApiKey(UserId("00000000-0000-4000-8000-000000000001"), { scopes: [] }, { request: request(), requestId: "request-id" });
    expect(repository.insertApiKey).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scopes: ["read"] }));
  });
  it("refuses to issue a key for an inactive owner", async () => {
    const { service, repository, profiles } = setup();
    profiles.loadOwnerAuthState.mockResolvedValue({ status: "restricted", sessionVersion: 1 });
    await expect(service.createApiKey(UserId("00000000-0000-4000-8000-000000000001"), {}, { request: request(), requestId: "request-id" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.insertApiKey).not.toHaveBeenCalled();
  });
  it("checks key rate-limit before rejecting a missing scope", async () => {
    const { service, repository, external } = setup();
    repository.verifyApiKey.mockResolvedValue({ kind: "active", row: { id: "principal", owner_id: "00000000-0000-4000-8000-000000000001", scopes: ["read"] } });
    await expect(service.authenticate("Bearer mf_pub_secret", "control", { request: request(), requestId: "request-id" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(external.assertRateLimit).toHaveBeenCalledWith(expect.anything(), "principal");
  });
  it("counts a rejected revoked public API key", async () => {
    const { service, repository, metrics } = setup();
    repository.verifyApiKey.mockResolvedValue({ kind: "revoked" });
    await expect(service.authenticate("Bearer mf_pub_secret", "read", { request: request(), requestId: "request-id" })).rejects.toBeDefined();
    expect(metrics.incRevokedCredentialUse).toHaveBeenCalledWith("public_api_key_v0", "revoked");
  });
  it("mints agent_content keys through the publicapi owner repository", async () => {
    const { service, repository } = setup();
    const result = await service.mintAgentKey(UserId("00000000-0000-4000-8000-000000000001"), "00000000-0000-4000-8000-000000000002", "agent");
    expect(result).toMatchObject({ id: "agent-key", scope: "agent_content", agent_id: "00000000-0000-4000-8000-000000000002" });
    expect(result.key).toMatch(/^mf_agent_/);
    expect(repository.insertUserApiKey).toHaveBeenCalledWith(expect.objectContaining({ scope: "agent_content", scopes: ["write"] }));
  });
});
