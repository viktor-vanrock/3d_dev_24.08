import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { parseGatewayToRelayFrame, parseRelayToGatewayFrame } from "./protocol-v1.ts";
import { RelayClient, type RelayClientConfig } from "./client.ts";
import type { RelayLifecycleEvent } from "./client.ts";

interface FakeRelay {
  wss: WebSocketServer;
  port: number;
  sockets: WsSocket[];
  frames: Array<{ socketIndex: number; frame: Record<string, unknown> }>;
  close: () => Promise<void>;
}

const baseConfig = (port: number, overrides: Partial<RelayClientConfig> = {}): RelayClientConfig => ({
  url: `ws://127.0.0.1:${port}`,
  agentVersion: "1.2.3",
  capabilities: ["file_transfer", "cmd.pause"],
  heartbeatJitterRatio: 0,
  ...overrides,
});

async function startFakeRelay(): Promise<FakeRelay> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const address = wss.address();
  if (!address || typeof address === "string") throw new Error("no port");

  const sockets: WsSocket[] = [];
  const frames: Array<{ socketIndex: number; frame: Record<string, unknown> }> = [];
  wss.on("connection", (socket) => {
    const index = sockets.push(socket) - 1;
    socket.send(
      JSON.stringify({
        type: "hello_challenge",
        nonce: `${index}`.padStart(32, "0"),
      }),
    );
    socket.on("message", (raw) => {
      const parsed = parseGatewayToRelayFrame(raw.toString("utf8"));
      if (!parsed.ok) throw new Error(`invalid device-agent frame: ${parsed.error}`);
      const frame = parsed.frame as unknown as Record<string, unknown>;
      frames.push({ socketIndex: index, frame });
      if (frame.type === "hello") {
        socket.send(
          JSON.stringify({
            type: "hello_ack",
            session_id: `session-${index}`,
            gateway_id: "gateway-1",
            devices: [{ device_id: "device-1", firmware_class: "klipper" }],
            heartbeat_interval_seconds: 1,
            heartbeat_timeout_seconds: 3,
          }),
        );
      }
    });
  });

  return {
    wss,
    port: address.port,
    sockets,
    frames,
    close: () => new Promise((resolve, reject) => wss.close((error) => (error ? reject(error) : resolve()))),
  };
}

function heartbeatFrames(relay: FakeRelay, socketIndex = 0) {
  return relay.frames.filter((entry) => entry.socketIndex === socketIndex && entry.frame.type === "heartbeat");
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("RelayClient canonical device-protocol/v1", () => {
  let relay: FakeRelay;
  let client: RelayClient | undefined;

  beforeEach(async () => {
    relay = await startFakeRelay();
  });

  afterEach(async () => {
    client?.disconnect();
    for (const socket of relay.sockets) socket.terminate();
    await relay.close();
  });

  it("negotiates exact v1 with required agent version and capabilities and no frame credential", async () => {
    client = new RelayClient(
      baseConfig(relay.port, {
        printerModel: "Test Printer",
        firmwareClass: "klipper",
      }),
    );
    client.connect();

    await waitFor(() => relay.frames.some((entry) => entry.frame.type === "hello"));
    expect(relay.frames[0]!.frame).toEqual({
      type: "hello",
      protocol_version: "v1",
      nonce: "00000000000000000000000000000000",
      agent_version: "1.2.3",
      printer_model: "Test Printer",
      firmware_class: "klipper",
      capabilities: ["file_transfer", "cmd.pause"],
    });
    expect(relay.frames[0]!.frame).not.toHaveProperty("token");
  });

  it("consumes every shared relay-to-gateway golden fixture through the runtime validator", () => {
    const fixtures = JSON.parse(readFileSync(new URL("../../../../packages/contracts/device-protocol/v1/fixtures/valid.json", import.meta.url), "utf8")) as {
      cases: Array<{ direction: string; frame: object }>;
    };
    const inbound = fixtures.cases.filter((fixture) => fixture.direction === "relay_to_gateway");
    expect(inbound.length).toBeGreaterThan(0);
    for (const fixture of inbound)
      expect(parseRelayToGatewayFrame(JSON.stringify(fixture.frame))).toEqual({
        ok: true,
        frame: fixture.frame,
      });
  });

  it("rejects every shared invalid fixture with the canonical stable error", () => {
    const fixtures = JSON.parse(readFileSync(new URL("../../../../packages/contracts/device-protocol/v1/fixtures/invalid.json", import.meta.url), "utf8")) as {
      cases: Array<{
        direction: "gateway_to_relay" | "relay_to_gateway";
        frame: object;
        expected_error: string;
        validation_stage?: string;
      }>;
    };
    const limits = JSON.parse(readFileSync(new URL("../../../../packages/contracts/device-protocol/v1/limits.json", import.meta.url), "utf8")) as { max_text_frame_bytes: number };
    for (const fixture of fixtures.cases) {
      const raw = fixture.validation_stage === "transport_size" ? `${JSON.stringify(fixture.frame)}${" ".repeat(limits.max_text_frame_bytes)}` : JSON.stringify(fixture.frame);
      const result = fixture.direction === "gateway_to_relay" ? parseGatewayToRelayFrame(raw) : parseRelayToGatewayFrame(raw);
      expect(result).toEqual({ ok: false, error: fixture.expected_error });
    }
  });

  it("maps local snapshots to closed v1 heartbeat frames", async () => {
    client = new RelayClient(baseConfig(relay.port, { minPushGapMs: 0 }));
    client.connect();
    await waitFor(() => relay.frames.some((entry) => entry.frame.type === "hello"));

    client.pushStatus({
      id: "device-1",
      status: "printing",
      progress: 42.5,
      metrics: { nozzle_c: 210.4 },
    });
    await waitFor(() => heartbeatFrames(relay).length > 0);
    expect(heartbeatFrames(relay)[0]!.frame).toMatchObject({
      type: "heartbeat",
      devices: [
        {
          device_id: "device-1",
          status: "printing",
          sequence: 1,
          progress_percent: 42.5,
          metrics: { nozzle_c: 210.4 },
        },
      ],
    });
    expect(heartbeatFrames(relay)[0]!.frame.message_id).toEqual(expect.any(String));
  });

  it("reconnects once and immediately resends the last canonical snapshot", async () => {
    client = new RelayClient(
      baseConfig(relay.port, {
        minPushGapMs: 0,
        reconnectMinDelayMs: 20,
        reconnectMaxDelayMs: 100,
      }),
    );
    client.connect();
    await waitFor(() => relay.frames.some((entry) => entry.frame.type === "hello"));
    client.pushStatus({ id: "device-1", status: "paused" });
    await waitFor(() => heartbeatFrames(relay).length > 0);

    relay.sockets[0]!.close();
    await waitFor(() => relay.sockets.length >= 2);
    await waitFor(() => heartbeatFrames(relay, 1).length > 0);
    expect(heartbeatFrames(relay, 1)[0]!.frame.devices).toEqual([{ device_id: "device-1", status: "paused", sequence: 1 }]);
  });

  it("sends command_ack before the explicit terminal command_result", async () => {
    client = new RelayClient(
      baseConfig(relay.port, {
        onCommand: async (frame) => ({
          type: "command_result",
          device_id: frame.device_id,
          command_id: frame.command_id,
          command_seq: frame.command_seq,
          outcome: "executed",
        }),
      }),
    );
    client.connect();
    await waitFor(() => relay.sockets.length > 0 && relay.frames.some((entry) => entry.frame.type === "hello"));
    relay.sockets[0]!.send(
      JSON.stringify({
        type: "command",
        device_id: "device-1",
        command_id: "command-1",
        command_seq: 7,
        command: "pause",
        command_token: "0123456789abcdef",
        payload: {},
      }),
    );

    await waitFor(() => relay.frames.filter((entry) => entry.frame.type === "command_ack" || entry.frame.type === "command_result").length === 2);
    expect(relay.frames.filter((entry) => entry.frame.type === "command_ack" || entry.frame.type === "command_result").map((entry) => entry.frame)).toEqual([
      {
        type: "command_ack",
        device_id: "device-1",
        command_id: "command-1",
        command_seq: 7,
      },
      {
        type: "command_result",
        device_id: "device-1",
        command_id: "command-1",
        command_seq: 7,
        outcome: "executed",
      },
    ]);
  });

  it("round-trips file start and resume acknowledgements with byte offsets", async () => {
    client = new RelayClient(
      baseConfig(relay.port, {
        onFileStart: async (frame) => ({
          type: "file_start_ack",
          device_id: frame.device_id,
          transfer_id: frame.transfer_id,
          next_seq: 1,
          next_offset_bytes: 3,
        }),
        onFileChunk: async (frame) => ({
          type: "file_chunk_ack",
          device_id: frame.device_id,
          transfer_id: frame.transfer_id,
          seq: frame.seq,
          next_seq: frame.seq + 1,
          next_offset_bytes: frame.offset_bytes + 2,
        }),
      }),
    );
    client.connect();
    await waitFor(() => relay.frames.some((entry) => entry.frame.type === "hello"));
    relay.sockets[0]!.send(
      JSON.stringify({
        type: "file_start",
        device_id: "device-1",
        transfer_id: "transfer-1",
        file_name: "x.gcode",
        size_bytes: 5,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        object_version: "version-1",
        kind: "gcode",
        start_print: false,
        chunk_size_bytes: 65536,
      }),
    );
    relay.sockets[0]!.send(
      JSON.stringify({
        type: "file_chunk",
        device_id: "device-1",
        transfer_id: "transfer-1",
        seq: 1,
        offset_bytes: 3,
        last: true,
        data_base64: "bG8=",
      }),
    );

    await waitFor(() => relay.frames.filter((entry) => entry.frame.type === "file_start_ack" || entry.frame.type === "file_chunk_ack").length === 2);
    expect(relay.frames.filter((entry) => entry.frame.type === "file_start_ack" || entry.frame.type === "file_chunk_ack").map((entry) => entry.frame)).toEqual([
      {
        type: "file_start_ack",
        device_id: "device-1",
        transfer_id: "transfer-1",
        next_seq: 1,
        next_offset_bytes: 3,
      },
      {
        type: "file_chunk_ack",
        device_id: "device-1",
        transfer_id: "transfer-1",
        seq: 1,
        next_seq: 2,
        next_offset_bytes: 5,
      },
    ]);
  });

  it("rejects malformed inbound frames before invoking handlers", async () => {
    const onCommand = vi.fn();
    const logs: unknown[][] = [];
    client = new RelayClient(baseConfig(relay.port, { onCommand, log: (...args) => logs.push(args) }));
    client.connect();
    await waitFor(() => relay.frames.some((entry) => entry.frame.type === "hello"));
    relay.sockets[0]!.send(
      JSON.stringify({
        type: "command",
        device_id: "device-1",
        extra: "not allowed",
      }),
    );

    await waitFor(() => logs.some((entry) => entry.includes("invalid_frame")));
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("surfaces unsupported_version errors without attempting compatibility negotiation", async () => {
    const logs: unknown[][] = [];
    client = new RelayClient(baseConfig(relay.port, { log: (...args) => logs.push(args) }));
    client.connect();
    await waitFor(() => relay.frames.some((entry) => entry.frame.type === "hello"));
    relay.sockets[0]!.send(
      JSON.stringify({
        type: "error",
        code: "unsupported_version",
        message: "v1 required",
      }),
    );
    await waitFor(() => logs.some((entry) => entry.includes("unsupported_version")));
    expect(relay.frames.filter((entry) => entry.frame.type === "hello")).toHaveLength(1);
  });

  it("does not emit a stale terminal result after reconnect", async () => {
    let resolveCommand!: (frame: Awaited<ReturnType<NonNullable<RelayClientConfig["onCommand"]>>>) => void;
    client = new RelayClient(
      baseConfig(relay.port, {
        reconnectMinDelayMs: 20,
        reconnectMaxDelayMs: 100,
        onCommand: async () =>
          new Promise((resolve) => {
            resolveCommand = resolve;
          }),
      }),
    );
    client.connect();
    await waitFor(() => relay.frames.some((entry) => entry.frame.type === "hello"));
    relay.sockets[0]!.send(
      JSON.stringify({
        type: "command",
        device_id: "device-1",
        command_id: "command-1",
        command_seq: 1,
        command: "pause",
        command_token: "0123456789abcdef",
        payload: {},
      }),
    );
    await waitFor(() => relay.frames.some((entry) => entry.frame.type === "command_ack"));
    relay.sockets[0]!.close();
    await waitFor(() => relay.sockets.length > 1);
    resolveCommand({
      type: "command_result",
      device_id: "device-1",
      command_id: "command-1",
      command_seq: 1,
      outcome: "executed",
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(relay.frames.filter((entry) => entry.frame.type === "command_result")).toHaveLength(0);
  });

  it("keeps repeated connect calls on one socket and disconnect stops reconnect", async () => {
    client = new RelayClient(baseConfig(relay.port));
    client.connect();
    client.connect();
    await waitFor(() => relay.sockets.length > 0);
    expect(relay.sockets).toHaveLength(1);
    client.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(relay.sockets).toHaveLength(1);
  });

  it("emits generation-scoped authorization and revoke lifecycle events", async () => {
    const events: RelayLifecycleEvent[] = [];
    client = new RelayClient(baseConfig(relay.port, { onLifecycle: (event) => events.push(event), reconnectMinDelayMs: 10_000 }));
    client.connect();
    await waitFor(() => events.some((event) => event.type === "hello_ack"));
    const authorized = events.find((event) => event.type === "hello_ack");
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["connecting", "socket_open", "hello_challenge", "hello_ack"]));
    relay.sockets[0]!.close(4004, "gateway_revoked");
    await waitFor(() => events.some((event) => event.type === "revoked"));
    expect(events.find((event) => event.type === "revoked")?.generation).toBe(authorized?.generation);
  });
});
