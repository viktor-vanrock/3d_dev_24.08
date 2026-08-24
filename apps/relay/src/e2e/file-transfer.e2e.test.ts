import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FileChunk } from "@portal/contracts/device-protocol/v1";
import type { RelayTransferMetadataResponseDto } from "@portal/contracts/http/relay-internal.v1.dto";
import {
  createRelayE2eHarness,
  createTestCertificates,
  eventually,
  removeTestCertificates,
  type RelayE2eHarness,
  type TestCertificates,
  type TestGatewayClient,
} from "./relay-e2e-harness.ts";

type TransferStatus = "pending" | "completed" | "failed";

interface TransferRecord {
  readonly transferId: string;
  readonly deviceId: string;
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly objectVersion: string;
  readonly fileName: string;
  readonly chunkSize: number;
  nextOffset: number;
  nextSequence: number;
  status: TransferStatus;
  sourceSha256?: string;
  malformedRange?: boolean;
}

interface ProgressWrite {
  readonly transferId: string;
  readonly nextOffset: number;
  readonly nextSequence: number;
}

interface TransferResultWrite extends ProgressWrite {
  readonly status: "completed" | "failed";
  readonly errorCode?: string;
  readonly keys: readonly string[];
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function transfer(transferId: string, content = "abcdef", overrides: Partial<TransferRecord> = {}): TransferRecord {
  const bytes = Buffer.from(content);
  return {
    transferId,
    deviceId: "device-1",
    bytes,
    sha256: digest(bytes),
    objectVersion: `version-${transferId}`,
    fileName: `${transferId}.gcode`,
    chunkSize: 3,
    nextOffset: 0,
    nextSequence: 0,
    status: "pending",
    ...overrides,
  };
}

class TransferControlPlane {
  readonly transfers = new Map<string, TransferRecord>();
  readonly progressWrites: ProgressWrite[] = [];
  readonly resultWrites: TransferResultWrite[] = [];
  readonly sourceRanges: string[] = [];
  authorizedDeviceIds = ["device-1"];
  private sessionGeneration = 0;

  constructor(...records: TransferRecord[]) {
    for (const record of records) this.transfers.set(record.transferId, record);
  }

  readonly sourceFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const transferId = url.pathname.slice(1);
    const record = this.requireTransfer(transferId);
    const range = new Headers(init?.headers).get("range") ?? "";
    this.sourceRanges.push(`${transferId}:${range}`);
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!match) return new Response(null, { status: 400 });
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (record.malformedRange) {
      const body = record.bytes.subarray(start, Math.max(start, end));
      return new Response(body, {
        status: 206,
        headers: { "content-length": String(body.byteLength), "content-range": `bytes ${start}-${Math.max(start, end - 1)}/${record.bytes.byteLength}` },
      });
    }
    const body = record.bytes.subarray(start, end + 1);
    return new Response(body, {
      status: 206,
      headers: { "content-length": String(body.byteLength), "content-range": `bytes ${start}-${end}/${record.bytes.byteLength}` },
    });
  };

  async relaySessionAuthorize(): Promise<object> {
    this.sessionGeneration += 1;
    return {
      gateway_id: "gateway-1",
      session_id: `session-${this.sessionGeneration}`,
      session_generation: this.sessionGeneration,
      authorization_revision: 1,
      authorized_devices: this.authorizedDeviceIds.map((deviceId) => ({ device_id: deviceId, authorization_revision: 1 })),
      pending_transfer_ids: [...this.transfers.values()].filter((record) => record.status === "pending").map((record) => record.transferId),
      heartbeat_interval_ms: 1_000,
      heartbeat_timeout_ms: 10_000,
    };
  }

  async relaySessionClose(): Promise<object> {
    return { session_id: `session-${this.sessionGeneration}`, session_generation: this.sessionGeneration, closed_at: new Date().toISOString(), replayed: false };
  }

  async relaySessionHeartbeat(): Promise<object> {
    return {
      session_id: `session-${this.sessionGeneration}`,
      session_generation: this.sessionGeneration,
      authorization_revision: 1,
      accepted_device_ids: this.authorizedDeviceIds,
      pending_transfer_ids: [...this.transfers.values()].filter((record) => record.status === "pending").map((record) => record.transferId),
      persisted_at: new Date().toISOString(),
      replayed: false,
    };
  }

  async relayGatewaysRevalidate(input: { readonly body: { readonly gateways: ReadonlyArray<{ readonly gateway_id: string; readonly session_id: string; readonly session_generation: number }> } }): Promise<object> {
    return {
      validated_at: new Date().toISOString(),
      results: input.body.gateways.map((gateway) => ({
        ...gateway,
        state: "authorized",
        authorization_revision: 1,
        authorized_devices: this.authorizedDeviceIds.map((deviceId) => ({ device_id: deviceId })),
      })),
    };
  }

  async relayCommandsClaim(): Promise<object> {
    return { claim_owner: "relay-e2e", claimed_at: new Date().toISOString(), commands: [], replayed: false };
  }

  async relayTransferMetadata(input: { readonly path: { readonly transferId: string } }): Promise<RelayTransferMetadataResponseDto> {
    const record = this.requireTransfer(input.path.transferId);
    return {
      transfer_id: record.transferId,
      session_id: `session-${this.sessionGeneration}`,
      session_generation: this.sessionGeneration,
      gateway_id: "gateway-1",
      device_id: record.deviceId,
      file_name: record.fileName,
      kind: "gcode",
      content_type: "model/gcode",
      size_bytes: record.bytes.byteLength,
      sha256: record.sha256,
      object_version: record.objectVersion,
      chunk_size_bytes: record.chunkSize,
      next_offset: record.nextOffset,
      next_sequence: record.nextSequence,
      start_print: true,
    };
  }

  async relayTransferSourceUrl(input: { readonly path: { readonly transferId: string } }): Promise<object> {
    const record = this.requireTransfer(input.path.transferId);
    return {
      transfer_id: record.transferId,
      object_version: record.objectVersion,
      size_bytes: record.bytes.byteLength,
      sha256: record.sourceSha256 ?? record.sha256,
      next_offset: record.nextOffset,
      next_sequence: record.nextSequence,
      range_supported: true,
      source_url: `https://source.test/${record.transferId}`,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async relayTransferProgress(input: { readonly path: { readonly transferId: string }; readonly body: { readonly next_offset: number; readonly next_sequence: number } }): Promise<object> {
    const record = this.requireTransfer(input.path.transferId);
    record.nextOffset = input.body.next_offset;
    record.nextSequence = input.body.next_sequence;
    this.progressWrites.push({ transferId: record.transferId, nextOffset: record.nextOffset, nextSequence: record.nextSequence });
    return {
      transfer_id: record.transferId,
      next_offset: record.nextOffset,
      next_sequence: record.nextSequence,
      persisted_at: new Date().toISOString(),
      replayed: false,
    };
  }

  async relayTransferResult(input: { readonly path: { readonly transferId: string }; readonly body: Readonly<Record<string, unknown>> }): Promise<object> {
    const record = this.requireTransfer(input.path.transferId);
    const status = input.body.status === "completed" ? "completed" : "failed";
    record.status = status;
    const nextOffset = Number(input.body.next_offset);
    const nextSequence = Number(input.body.next_sequence);
    this.resultWrites.push({
      transferId: record.transferId,
      nextOffset,
      nextSequence,
      status,
      ...(typeof input.body.error_code === "string" ? { errorCode: input.body.error_code } : {}),
      keys: Object.keys(input.body).sort(),
    });
    return {
      transfer_id: record.transferId,
      next_offset: nextOffset,
      next_sequence: nextSequence,
      status,
      persisted_at: new Date().toISOString(),
      replayed: false,
    };
  }

  private requireTransfer(transferId: string): TransferRecord {
    const record = this.transfers.get(transferId);
    if (!record) throw new Error("transfer not found");
    return record;
  }
}

async function acknowledgeChunk(gateway: TestGatewayClient, chunk: FileChunk): Promise<void> {
  gateway.send({
    type: "file_chunk_ack",
    device_id: chunk.device_id,
    transfer_id: chunk.transfer_id,
    seq: chunk.seq,
    next_seq: chunk.seq + 1,
    next_offset_bytes: chunk.offset_bytes + Buffer.from(chunk.data_base64, "base64").byteLength,
  });
}

describe("relay file transfer over real WSS", () => {
  let certificates: TestCertificates;
  let harness: RelayE2eHarness | undefined;

  beforeAll(() => { certificates = createTestCertificates(); });
  afterEach(async () => { await harness?.shutdown(); harness = undefined; });
  afterAll(() => removeTestCertificates(certificates));

  it("streams bounded chunks and treats the agent's final stored result as the terminal acknowledgement", async () => {
    const api = new TransferControlPlane(transfer("transfer-success"));
    harness = await createRelayE2eHarness({ certificates, apiV1: api, fileOptions: { sourceFetch: api.sourceFetch } });
    const gateway = await harness.connect(["file_transfer"]);

    const start = await gateway.next("file_start");
    expect(start).toMatchObject({ transfer_id: "transfer-success", size_bytes: 6, chunk_size_bytes: 3, object_version: "version-transfer-success" });
    gateway.send({ type: "file_start_ack", device_id: start.device_id, transfer_id: start.transfer_id, next_seq: 0, next_offset_bytes: 0 });
    const first = await gateway.next("file_chunk");
    expect(Buffer.from(first.data_base64, "base64").toString()).toBe("abc");
    await acknowledgeChunk(gateway, first);
    const final = await gateway.next("file_chunk");
    expect(Buffer.from(final.data_base64, "base64").toString()).toBe("def");
    expect(final.last).toBe(true);

    gateway.send({ type: "file_result", device_id: final.device_id, transfer_id: final.transfer_id, outcome: "stored", stored_as: "transfer-success.gcode" });
    await eventually(() => expect(api.resultWrites).toContainEqual(expect.objectContaining({ transferId: "transfer-success", status: "completed", nextOffset: 6, nextSequence: 2 })));
    expect(api.progressWrites).toEqual([
      { transferId: "transfer-success", nextOffset: 3, nextSequence: 1 },
      { transferId: "transfer-success", nextOffset: 6, nextSequence: 2 },
    ]);
    expect(api.sourceRanges).toEqual(["transfer-success:bytes=0-2", "transfer-success:bytes=3-5"]);
  });

  it("resumes from durable progress after disconnect and a fresh relay runtime", async () => {
    const api = new TransferControlPlane(transfer("transfer-resume", "abcdefghi"));
    harness = await createRelayE2eHarness({ certificates, apiV1: api, fileOptions: { sourceFetch: api.sourceFetch } });
    const firstGateway = await harness.connect(["file_transfer"]);
    const firstStart = await firstGateway.next("file_start");
    firstGateway.send({ type: "file_start_ack", device_id: firstStart.device_id, transfer_id: firstStart.transfer_id, next_seq: 0, next_offset_bytes: 0 });
    const firstChunk = await firstGateway.next("file_chunk");
    await acknowledgeChunk(firstGateway, firstChunk);
    await eventually(() => expect(api.progressWrites).toContainEqual({ transferId: "transfer-resume", nextOffset: 3, nextSequence: 1 }));
    await firstGateway.next("file_chunk");
    firstGateway.terminate();
    await eventually(() => expect(harness?.fileTransfers.activeCount).toBe(0));
    expect(api.resultWrites).toEqual([]);

    await harness.shutdown();
    harness = await createRelayE2eHarness({ certificates, apiV1: api, fileOptions: { sourceFetch: api.sourceFetch } });
    const restartedGateway = await harness.connect(["file_transfer"]);
    const resumedStart = await restartedGateway.next("file_start");
    restartedGateway.send({ type: "file_start_ack", device_id: resumedStart.device_id, transfer_id: resumedStart.transfer_id, next_seq: 1, next_offset_bytes: 3 });
    const resumedChunk = await restartedGateway.next("file_chunk");
    expect(resumedChunk).toMatchObject({ transfer_id: "transfer-resume", seq: 1, offset_bytes: 3 });
    expect(Buffer.from(resumedChunk.data_base64, "base64").toString()).toBe("def");
    expect(api.sourceRanges.at(-1)).toBe("transfer-resume:bytes=3-5");
  });

  it.each([
    ["checksum", { sourceSha256: "f".repeat(64) }, "checksum_mismatch"],
    ["size", { malformedRange: true }, "size_mismatch"],
  ] as const)("fails a %s mismatch without emitting a file chunk", async (_label, overrides, expectedCode) => {
    const api = new TransferControlPlane(transfer(`transfer-${expectedCode}`, "abcdef", overrides));
    harness = await createRelayE2eHarness({ certificates, apiV1: api, fileOptions: { sourceFetch: api.sourceFetch } });
    const gateway = await harness.connect(["file_transfer"]);
    const start = await gateway.next("file_start");
    gateway.send({ type: "file_start_ack", device_id: start.device_id, transfer_id: start.transfer_id, next_seq: 0, next_offset_bytes: 0 });

    await eventually(() => expect(api.resultWrites).toContainEqual(expect.objectContaining({ transferId: start.transfer_id, status: "failed", errorCode: expectedCode })));
    await gateway.expectNoFrame("file_chunk");
  });

  it("rejects a pending transfer for a device outside the authorized session", async () => {
    const api = new TransferControlPlane(transfer("transfer-unauthorized"));
    api.authorizedDeviceIds = [];
    harness = await createRelayE2eHarness({ certificates, apiV1: api, fileOptions: { sourceFetch: api.sourceFetch } });
    const gateway = await harness.connect(["file_transfer"]);

    await gateway.expectNoFrame("file_start", 150);
    expect(api.sourceRanges).toEqual([]);
    expect(api.progressWrites).toEqual([]);
    expect(api.resultWrites).toEqual([]);
    expect(harness.fileTransfers.activeCount).toBe(0);
  });

  it("persists an agent failure using only the stable error code", async () => {
    const api = new TransferControlPlane(transfer("transfer-agent-error"));
    harness = await createRelayE2eHarness({ certificates, apiV1: api, fileOptions: { sourceFetch: api.sourceFetch } });
    const gateway = await harness.connect(["file_transfer"]);
    const start = await gateway.next("file_start");

    gateway.send({
      type: "file_result",
      device_id: start.device_id,
      transfer_id: start.transfer_id,
      outcome: "failed",
      error_code: "upload_failed",
      message: "provider stack and path must not cross the boundary",
    });
    await eventually(() => expect(api.resultWrites).toContainEqual(expect.objectContaining({ transferId: start.transfer_id, status: "failed", errorCode: "upload_failed" })));
    expect(api.resultWrites[0]?.keys).not.toContain("message");
  });
});
