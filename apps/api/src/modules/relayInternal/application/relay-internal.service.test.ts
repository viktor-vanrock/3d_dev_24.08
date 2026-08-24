import { describe, expect, it, vi } from "vitest";
import type { DeviceCommandRelayPort } from "../../devices/public/index.ts";
import { RelayInternalException } from "../domain/relay-internal.error.ts";
import type { RelayControlPort } from "../public/index.ts";
import { RelayInternalService } from "./relay-internal.service.ts";

vi.mock("../../../storage/s3.ts", () => ({
  getDeviceTransferObjectPresignedUrl: vi.fn(async () => "https://objects.example/transfer?signature=safe"),
}));

const control = {} as RelayControlPort;

function serviceWith(writeResult: DeviceCommandRelayPort["writeResult"]): RelayInternalService {
  const commands = { writeResult } as DeviceCommandRelayPort;
  return new RelayInternalService(control, commands);
}

const request = {
  claim_owner: "relay-owner-1",
  claim_token: "c".repeat(32),
  generation: 2,
  command_seq: 7,
  status: "executed" as const,
  observed_at: "2026-08-11T12:00:00.000Z",
};

describe("RelayInternalService command result retry semantics", () => {
  it("returns the already persisted result after a lost response retry", async () => {
    const completedAt = new Date("2026-08-11T12:00:01.000Z");
    const service = serviceWith(
      vi.fn(async () => ({
        kind: "replayed" as const,
        row: { commandId: "command-1", commandSeq: 7, status: "executed" as const, generation: 2, terminalErrorCode: null, completedAt },
      })),
    );

    await expect(service.writeCommandResult("command-1", request)).resolves.toEqual({
      command_id: "command-1",
      command_seq: 7,
      status: "executed",
      generation: 2,
      persisted_at: completedAt.toISOString(),
      replayed: true,
    });
  });

  it("rejects a contradictory terminal result with the stable conflict code", async () => {
    const service = serviceWith(vi.fn(async () => ({ kind: "conflict" as const })));
    const result = service.writeCommandResult("command-1", { ...request, status: "failed", error_code: "command_failed" });
    await expect(result).rejects.toBeInstanceOf(RelayInternalException);
    await expect(result).rejects.toMatchObject({ code: "relay.command.result_conflict.v1" });
  });
});

describe("RelayInternalService source URL refresh", () => {
  it("re-authorizes every retry and preserves the immutable source tuple", async () => {
    const metadata = {
      transfer_id: "transfer-1",
      session_id: "session-1",
      session_generation: 3,
      gateway_id: "gateway-1",
      device_id: "device-1",
      file_name: "part.gcode",
      kind: "gcode" as const,
      content_type: "model/gcode" as const,
      size_bytes: 4096,
      sha256: "a".repeat(64),
      object_version: "version-1",
      chunk_size_bytes: 1024,
      next_offset: 2048,
      next_sequence: 2,
      start_print: true,
    };
    const getTransferSourceTuple = vi.fn(async () => ({
      objectKey: "protected/device-transfers/transfer-1/part.gcode",
      objectVersion: metadata.object_version,
      sha256: metadata.sha256,
      sizeBytes: metadata.size_bytes,
      contentType: metadata.content_type,
      metadata,
    }));
    const sourceControl = { getTransferSourceTuple } as unknown as RelayControlPort;
    const service = new RelayInternalService(sourceControl, {} as DeviceCommandRelayPort);
    const sourceRequest = {
      session_id: metadata.session_id,
      session_generation: metadata.session_generation,
      object_version: metadata.object_version,
      size_bytes: metadata.size_bytes,
      sha256: metadata.sha256,
      next_offset: metadata.next_offset,
      next_sequence: metadata.next_sequence,
    };

    const first = await service.transferSourceUrl("operation-1", metadata.transfer_id, sourceRequest);
    const retry = await service.transferSourceUrl("operation-1", metadata.transfer_id, sourceRequest);

    expect(first).toMatchObject({
      transfer_id: metadata.transfer_id,
      source_url: "https://objects.example/transfer?signature=safe",
      range_supported: true,
      size_bytes: metadata.size_bytes,
      sha256: metadata.sha256,
      object_version: metadata.object_version,
      next_offset: metadata.next_offset,
      next_sequence: metadata.next_sequence,
    });
    expect(retry).toMatchObject(first);
    expect(getTransferSourceTuple).toHaveBeenCalledTimes(2);
    expect(getTransferSourceTuple).toHaveBeenLastCalledWith({
      transferId: metadata.transfer_id,
      sessionId: metadata.session_id,
      sessionGeneration: metadata.session_generation,
      objectVersion: metadata.object_version,
      sha256: metadata.sha256,
      sizeBytes: metadata.size_bytes,
    });
  });
});
