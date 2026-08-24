import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { FileChunk, FileStart } from "@portal/contracts/device-protocol/v1";
import type { RelayTransferMetadataResponseDto, RelayTransferSourceUrlResponseDto } from "@portal/contracts/http/relay-internal.v1.dto";
import type { RelayApiClient } from "../api/relay-api-client.service.ts";
import type { RelayLogger } from "../observability/relay-logger.ts";
import { FileTransferService } from "./file-transfer.service.ts";
import type { TransferSendOutcome, TransferSessionFence, TransferSessionPort } from "./transfer-session.port.ts";

const session: TransferSessionFence = {
  gatewayId: "gateway-1",
  sessionId: "session-1",
  sessionGeneration: 4,
  connectionId: "connection-1",
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function metadata(bytes: Uint8Array, overrides: Partial<RelayTransferMetadataResponseDto> = {}): RelayTransferMetadataResponseDto {
  return {
    transfer_id: "transfer-1",
    session_id: session.sessionId,
    session_generation: session.sessionGeneration,
    gateway_id: session.gatewayId,
    device_id: "device-1",
    file_name: "part.gcode",
    kind: "gcode",
    content_type: "model/gcode",
    size_bytes: bytes.byteLength,
    sha256: sha256(bytes),
    object_version: "version-1",
    chunk_size_bytes: 3,
    next_offset: 0,
    next_sequence: 0,
    start_print: true,
    ...overrides,
  };
}

interface Harness {
  readonly service: FileTransferService;
  readonly api: {
    relayTransferMetadata: ReturnType<typeof vi.fn>;
    relayTransferSourceUrl: ReturnType<typeof vi.fn>;
    relayTransferProgress: ReturnType<typeof vi.fn>;
    relayTransferResult: ReturnType<typeof vi.fn>;
  };
  readonly sessions: TransferSessionPort & {
    authorized: boolean;
    current: boolean;
    chunkOutcome: TransferSendOutcome;
    starts: FileStart[];
    chunks: FileChunk[];
  };
  readonly sourceFetch: ReturnType<typeof vi.fn>;
}

function harness(bytes: Uint8Array, metadataOverrides: Partial<RelayTransferMetadataResponseDto> = {}): Harness {
  const transferMetadata = metadata(bytes, metadataOverrides);
  const source = (suffix = "1"): RelayTransferSourceUrlResponseDto => ({
    transfer_id: transferMetadata.transfer_id,
    object_version: transferMetadata.object_version,
    size_bytes: transferMetadata.size_bytes,
    sha256: transferMetadata.sha256,
    next_offset: transferMetadata.next_offset,
    next_sequence: transferMetadata.next_sequence,
    range_supported: true,
    source_url: `https://source.test/${suffix}`,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  const api = {
    relayTransferMetadata: vi.fn(async () => transferMetadata),
    relayTransferSourceUrl: vi.fn(async () => source()),
    relayTransferProgress: vi.fn(async (input: { body: { next_offset: number; next_sequence: number } }) => ({
      transfer_id: transferMetadata.transfer_id,
      next_offset: input.body.next_offset,
      next_sequence: input.body.next_sequence,
      persisted_at: new Date().toISOString(),
      replayed: false,
    })),
    relayTransferResult: vi.fn(async (input: { body: { next_offset: number; next_sequence: number; status: "completed" | "failed" } }) => ({
      transfer_id: transferMetadata.transfer_id,
      next_offset: input.body.next_offset,
      next_sequence: input.body.next_sequence,
      status: input.body.status,
      persisted_at: new Date().toISOString(),
      replayed: false,
    })),
  };
  const sessions = {
    authorized: true,
    current: true,
    chunkOutcome: "sent" as TransferSendOutcome,
    starts: [] as FileStart[],
    chunks: [] as FileChunk[],
    isCurrent: () => sessions.current,
    authorizes: (_session: TransferSessionFence, deviceId: string) => sessions.authorized && deviceId === transferMetadata.device_id,
    sendFileStart: (_session: TransferSessionFence, frame: FileStart) => {
      sessions.starts.push(frame);
      return sessions.current ? "sent" as const : "unavailable" as const;
    },
    sendFileChunk: (_session: TransferSessionFence, frame: FileChunk) => {
      sessions.chunks.push(frame);
      return sessions.chunkOutcome;
    },
  };
  const sourceFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("range");
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
    if (!match) return new Response(null, { status: 400 });
    const start = Number(match[1]);
    const end = Number(match[2]);
    const body = bytes.slice(start, end + 1);
    return new Response(body, {
      status: 206,
      headers: {
        "content-length": String(body.byteLength),
        "content-range": `bytes ${start}-${end}/${transferMetadata.size_bytes}`,
      },
    });
  });
  const client = { v1: api } as unknown as RelayApiClient;
  const logger = { warn: vi.fn() } as unknown as RelayLogger;
  const service = new FileTransferService(client, sessions, logger, { sourceFetch: sourceFetch as unknown as typeof fetch, sourceTimeoutMs: 1_000 });
  return { service, api, sessions, sourceFetch };
}

async function acknowledgeLastChunk(test: Harness): Promise<void> {
  const chunk = test.sessions.chunks.at(-1);
  if (!chunk) throw new Error("expected a chunk");
  await test.service.handleChunkAcknowledged(session, {
    type: "file_chunk_ack",
    device_id: chunk.device_id,
    transfer_id: chunk.transfer_id,
    seq: chunk.seq,
    next_seq: chunk.seq + 1,
    next_offset_bytes: chunk.offset_bytes + Buffer.from(chunk.data_base64, "base64").byteLength,
  });
}

describe("FileTransferService", () => {
  it("streams bounded ranges, accepts the agent's terminal result for the final chunk, and never exposes the source URL", async () => {
    const bytes = Buffer.from("abcdef");
    const test = harness(bytes);

    expect(await test.service.startTransfer(session, "transfer-1")).toEqual({ accepted: true, replayed: false });
    expect(await test.service.startTransfer(session, "transfer-1")).toEqual({ accepted: true, replayed: true });
    expect(test.sessions.starts).toHaveLength(1);
    await test.service.handleStartAcknowledged(session, { type: "file_start_ack", device_id: "device-1", transfer_id: "transfer-1", next_seq: 0, next_offset_bytes: 0 });
    expect(test.sessions.chunks).toHaveLength(1);
    expect(Buffer.from(test.sessions.chunks[0]!.data_base64, "base64").toString()).toBe("abc");
    await acknowledgeLastChunk(test);
    expect(test.sessions.chunks).toHaveLength(2);
    expect(Buffer.from(test.sessions.chunks[1]!.data_base64, "base64").toString()).toBe("def");

    const result = await test.service.handleResult(session, { type: "file_result", device_id: "device-1", transfer_id: "transfer-1", outcome: "stored", stored_as: "part.gcode" });
    expect(result).toEqual({ accepted: true, replayed: false });
    expect(test.api.relayTransferProgress).toHaveBeenCalledTimes(2);
    expect(test.api.relayTransferResult).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ status: "completed", next_offset: 6, next_sequence: 2 }) }));
    expect(JSON.stringify([...test.sessions.starts, ...test.sessions.chunks])).not.toContain("source.test");
    expect(test.sourceFetch.mock.calls.map(([, init]) => new Headers(init?.headers).get("range"))).toEqual(["bytes=0-2", "bytes=3-5"]);
  });

  it("recovers service state from API metadata and resumes at the durable agent-confirmed position", async () => {
    const bytes = Buffer.from("abcdef");
    const test = harness(bytes, { next_offset: 3, next_sequence: 1 });

    expect(await test.service.startTransfer(session, "transfer-1")).toEqual({ accepted: true, replayed: true });
    expect(test.sessions.starts[0]).toMatchObject({ chunk_size_bytes: 3, object_version: "version-1" });
    await test.service.handleStartAcknowledged(session, { type: "file_start_ack", device_id: "device-1", transfer_id: "transfer-1", next_seq: 1, next_offset_bytes: 3 });

    expect(test.sessions.chunks[0]).toMatchObject({ seq: 1, offset_bytes: 3, last: true });
    expect(new Headers(test.sourceFetch.mock.calls[0]?.[1]?.headers).get("range")).toBe("bytes=3-5");
  });

  it("rejects checksum drift when refreshing the immutable source", async () => {
    const bytes = Buffer.from("abcdef");
    const test = harness(bytes);
    test.api.relayTransferSourceUrl.mockResolvedValueOnce({
      transfer_id: "transfer-1", object_version: "version-1", size_bytes: 6, sha256: "f".repeat(64), next_offset: 0, next_sequence: 0,
      range_supported: true, source_url: "https://source.test/bad", expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    await test.service.startTransfer(session, "transfer-1");
    await test.service.handleStartAcknowledged(session, { type: "file_start_ack", device_id: "device-1", transfer_id: "transfer-1", next_seq: 0, next_offset_bytes: 0 });

    expect(test.sessions.chunks).toHaveLength(0);
    expect(test.api.relayTransferResult).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ status: "failed", error_code: "checksum_mismatch" }) }));
  });

  it("rejects a source response whose bounded range has the wrong size", async () => {
    const bytes = Buffer.from("abcdef");
    const test = harness(bytes);
    test.sourceFetch.mockResolvedValueOnce(new Response(Buffer.from("ab"), { status: 206, headers: { "content-length": "2", "content-range": "bytes 0-1/6" } }));

    await test.service.startTransfer(session, "transfer-1");
    await test.service.handleStartAcknowledged(session, { type: "file_start_ack", device_id: "device-1", transfer_id: "transfer-1", next_seq: 0, next_offset_bytes: 0 });

    expect(test.api.relayTransferResult).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ error_code: "size_mismatch" }) }));
  });

  it("fails closed when the API denies metadata authorization", async () => {
    const test = harness(Buffer.from("abc"));
    test.api.relayTransferMetadata.mockRejectedValueOnce(new Error("forbidden"));

    expect(await test.service.startTransfer(session, "transfer-1")).toEqual({ accepted: false, errorCode: "invalid_transfer" });
    expect(test.sessions.starts).toHaveLength(0);
    expect(test.sourceFetch).not.toHaveBeenCalled();
  });

  it("stops a disconnected transfer and can later resume from API-owned progress", async () => {
    const bytes = Buffer.from("abcdef");
    const test = harness(bytes);
    await test.service.startTransfer(session, "transfer-1");
    await test.service.handleStartAcknowledged(session, { type: "file_start_ack", device_id: "device-1", transfer_id: "transfer-1", next_seq: 0, next_offset_bytes: 0 });
    await acknowledgeLastChunk(test);
    test.service.handleDisconnect(session);
    expect(test.service.activeCount).toBe(0);
    expect(test.api.relayTransferResult).not.toHaveBeenCalled();

    test.api.relayTransferMetadata.mockResolvedValueOnce(metadata(bytes, { next_offset: 3, next_sequence: 1 }));
    const restarted = new FileTransferService(
      { v1: test.api } as unknown as RelayApiClient,
      test.sessions,
      { warn: vi.fn() } as unknown as RelayLogger,
      { sourceFetch: test.sourceFetch as unknown as typeof fetch, sourceTimeoutMs: 1_000 },
    );
    await restarted.startTransfer({ ...session, connectionId: "connection-2" }, "transfer-1");
    expect(test.sessions.starts.at(-1)).toMatchObject({ transfer_id: "transfer-1" });
  });

  it("refreshes an expired source URL and retries the same byte range", async () => {
    const bytes = Buffer.from("abc");
    const test = harness(bytes);
    test.sourceFetch.mockResolvedValueOnce(new Response(null, { status: 403 }));

    await test.service.startTransfer(session, "transfer-1");
    await test.service.handleStartAcknowledged(session, { type: "file_start_ack", device_id: "device-1", transfer_id: "transfer-1", next_seq: 0, next_offset_bytes: 0 });

    expect(test.api.relayTransferSourceUrl).toHaveBeenCalledTimes(2);
    expect(test.sourceFetch).toHaveBeenCalledTimes(2);
    expect(test.sessions.chunks).toHaveLength(1);
  });

  it("releases transport backpressure for reconnect without terminalizing durable transfer state", async () => {
    const test = harness(Buffer.from("abcdef"));
    test.sessions.chunkOutcome = "backpressure";

    await test.service.startTransfer(session, "transfer-1");
    await test.service.handleStartAcknowledged(session, { type: "file_start_ack", device_id: "device-1", transfer_id: "transfer-1", next_seq: 0, next_offset_bytes: 0 });

    expect(test.sourceFetch).toHaveBeenCalledTimes(1);
    expect(test.api.relayTransferProgress).not.toHaveBeenCalled();
    expect(test.api.relayTransferResult).not.toHaveBeenCalled();
    expect(test.service.activeCount).toBe(0);
  });

  it("persists a stable failed result for an agent error", async () => {
    const bytes = Buffer.from("abc");
    const test = harness(bytes);
    await test.service.startTransfer(session, "transfer-1");

    const result = await test.service.handleResult(session, {
      type: "file_result", device_id: "device-1", transfer_id: "transfer-1", outcome: "failed", error_code: "upload_failed", message: "provider details",
    });

    expect(result).toEqual({ accepted: true, replayed: false });
    expect(test.api.relayTransferResult).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ status: "failed", error_code: "upload_failed" }) }));
    expect(JSON.stringify(test.api.relayTransferResult.mock.calls)).not.toContain("provider details");
  });

  it("reuses operation identities when progress or terminal API responses are lost", async () => {
    const test = harness(Buffer.from("abc"));
    await test.service.startTransfer(session, "transfer-1");
    await test.service.handleStartAcknowledged(session, { type: "file_start_ack", device_id: "device-1", transfer_id: "transfer-1", next_seq: 0, next_offset_bytes: 0 });
    const chunk = test.sessions.chunks[0]!;
    const ack = { type: "file_chunk_ack" as const, device_id: "device-1", transfer_id: "transfer-1", seq: chunk.seq, next_seq: 1, next_offset_bytes: 3 };
    test.api.relayTransferProgress.mockRejectedValueOnce(new Error("response lost"));

    expect(await test.service.handleChunkAcknowledged(session, ack)).toEqual({ accepted: false, errorCode: "internal_error" });
    expect(await test.service.handleChunkAcknowledged(session, ack)).toEqual({ accepted: true, replayed: false });
    expect(test.api.relayTransferProgress.mock.calls[0]![0].headers["x-operation-id"]).toBe(test.api.relayTransferProgress.mock.calls[1]![0].headers["x-operation-id"]);

    const stored = { type: "file_result" as const, device_id: "device-1", transfer_id: "transfer-1", outcome: "stored" as const, stored_as: "part.gcode" };
    test.api.relayTransferResult.mockRejectedValueOnce(new Error("response lost"));
    expect(await test.service.handleResult(session, stored)).toEqual({ accepted: false, errorCode: "internal_error" });
    expect(await test.service.handleResult(session, stored)).toEqual({ accepted: true, replayed: false });
    expect(test.api.relayTransferResult.mock.calls[0]![0].headers["x-operation-id"]).toBe(test.api.relayTransferResult.mock.calls[1]![0].headers["x-operation-id"]);
  });
});
