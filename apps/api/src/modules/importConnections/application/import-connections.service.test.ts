import { BadGatewayException, BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { UserId } from "../../_kernel/brandedIds.ts";
import type { ImportConnectionsRepository } from "../infrastructure/import-connections.repository.ts";
import type { ImportConnectionsExternalPort } from "../public/index.ts";
import { ImportConnectionsService } from "./import-connections.service.ts";

function setup() {
  const repository = {
    exists: vi.fn(),
    upsertCults3d: vi.fn().mockResolvedValue("11111111-1111-4111-8111-111111111111"),
    markVerified: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(),
    findCults3dCredential: vi.fn(),
    setChallenge: vi.fn(),
    findChallenge: vi.fn(),
    setOwnershipStatus: vi.fn().mockResolvedValue(undefined),
  };
  const external: ImportConnectionsExternalPort = {
    validateCredentials: vi.fn().mockResolvedValue([{ externalId: "m1", title: "One", originalUrl: "https://example.test/m1" }]),
    listModels: vi.fn(),
    encryptCredentials: vi.fn().mockReturnValue(Buffer.from("encrypted")),
    decryptCredentials: vi.fn(),
  };
  return {
    repository,
    external,
    service: new ImportConnectionsService(repository as unknown as ImportConnectionsRepository, external),
  };
}

describe("ImportConnectionsService", () => {
  const userId = UserId("22222222-2222-4222-8222-222222222222");

  it("validates the provider before persisting encrypted credentials and returns the legacy success shape", async () => {
    const { service, repository, external } = setup();
    await expect(service.connect(userId, { sourcePlatform: "cults3d", username: " maker ", apiKey: " secret " })).resolves.toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      source_platform: "cults3d",
      ownership_status: "verified",
      models_found: 1,
    });
    expect(external.validateCredentials).toHaveBeenCalledWith({ username: "maker", apiKey: "secret" });
    expect(repository.upsertCults3d).toHaveBeenCalledWith(userId, "maker", Buffer.from("encrypted"));
    expect(repository.upsertCults3d.mock.invocationCallOrder[0]).toBeLessThan(repository.markVerified.mock.invocationCallOrder[0]!);
  });

  it("keeps legacy 400 validation for unsupported providers and an empty API key", async () => {
    const { service } = setup();
    await expect(service.connect(userId, { sourcePlatform: "other", username: "", apiKey: "x" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.connect(userId, { sourcePlatform: "cults3d", username: "", apiKey: " " })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("maps generic provider, decrypt, and connection-read failures to the legacy 502 status", async () => {
    const { service, repository, external } = setup();
    vi.mocked(external.validateCredentials).mockRejectedValueOnce(new Error("provider secret details"));
    await expect(service.connect(userId, { sourcePlatform: "cults3d", username: "", apiKey: "x" })).rejects.toBeInstanceOf(BadGatewayException);

    repository.findCults3dCredential.mockResolvedValueOnce({ credential_enc: Buffer.from("bad"), external_username: null });
    vi.mocked(external.decryptCredentials).mockImplementationOnce(() => {
      throw new Error("decrypt details");
    });
    await expect(service.listModels(userId, "33333333-3333-4333-8333-333333333333")).rejects.toBeInstanceOf(BadGatewayException);

    repository.findCults3dCredential.mockRejectedValueOnce(new Error("db details"));
    await expect(service.listModels(userId, "33333333-3333-4333-8333-333333333333")).rejects.toBeInstanceOf(BadGatewayException);
  });

  it("returns 200-style rejected ownership for a challenge mismatch and updates both owner tables through the repository", async () => {
    const { service, repository } = setup();
    repository.findChallenge.mockResolvedValue({ challenge_token: "3mf-verify-token" });
    await expect(service.verifyChallenge(userId, "33333333-3333-4333-8333-333333333333", "not present")).resolves.toEqual({ ownership_status: "rejected" });
    expect(repository.setOwnershipStatus).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333", "rejected");
  });

  it("preserves 404 ownership hiding and 409 when no challenge is active", async () => {
    const { service, repository } = setup();
    repository.findChallenge.mockResolvedValueOnce(null).mockResolvedValueOnce({ challenge_token: null });
    await expect(service.verifyChallenge(userId, "33333333-3333-4333-8333-333333333333", "x")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.verifyChallenge(userId, "33333333-3333-4333-8333-333333333333", "x")).rejects.toBeInstanceOf(ConflictException);
  });
});
