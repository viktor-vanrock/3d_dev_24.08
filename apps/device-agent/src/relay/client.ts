import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {
  parseGatewayToRelayFrame,
  parseRelayToGatewayFrame,
  type Command,
  type FileChunk,
  type FileChunkAck,
  type FileResult,
  type FileStart,
  type FileStartAck,
  type GatewayToRelayFrame,
  type Hello,
} from "./protocol-v1.ts";
import type { CommandTerminalFrame, HeartbeatDeviceUpdate, ProtocolCapability } from "./protocol.ts";

export interface RelayClientConfig {
  url: string;
  cert?: string | Buffer;
  key?: string | Buffer;
  ca?: string | Buffer;
  agentVersion: string;
  capabilities: readonly ProtocolCapability[];
  printerModel?: string;
  firmwareClass?: string;
  reconnectMinDelayMs?: number;
  reconnectMaxDelayMs?: number;
  heartbeatJitterRatio?: number;
  minPushGapMs?: number;
  onCommand?: (frame: Command) => Promise<CommandTerminalFrame>;
  onFileStart?: (frame: FileStart) => Promise<FileStartAck | FileResult>;
  onFileChunk?: (frame: FileChunk) => Promise<FileChunkAck | FileResult>;
  log?: (message: string, ...args: unknown[]) => void;
  onLifecycle?: (event: RelayLifecycleEvent) => void;
}

export type RelayLifecycleEvent =
  | { type: "connecting"; generation: number }
  | { type: "socket_open"; generation: number }
  | { type: "hello_challenge"; generation: number }
  | { type: "hello_ack"; generation: number }
  | { type: "authorization_rejected"; generation: number }
  | { type: "revoked"; generation: number }
  | { type: "disconnected"; generation: number; code: number }
  | { type: "backoff"; generation: number; delayMs: number }
  | { type: "stopped"; generation: number };

export class RelayClient {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs: number;
  private closed = true;
  private heartbeatIntervalSeconds = 20;
  private socketGeneration = 0;

  private readonly lastKnown = new Map<string, HeartbeatDeviceUpdate>();
  private readonly nextSeqByDevice = new Map<string, number>();
  private readonly lastPushAt = new Map<string, number>();
  private readonly pendingPush = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly minPushGapMs: number;
  private readonly heartbeatJitterRatio: number;
  private readonly log: (message: string, ...args: unknown[]) => void;

  constructor(private readonly config: RelayClientConfig) {
    this.reconnectDelayMs = config.reconnectMinDelayMs ?? 1000;
    this.minPushGapMs = config.minPushGapMs ?? 1000;
    this.heartbeatJitterRatio = Math.min(1, Math.max(0, config.heartbeatJitterRatio ?? 0.1));
    this.log = config.log ?? ((message, ...args) => {
      console.warn(message, ...args);
    });
  }

  connect(): void {
    this.closed = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;
    this.openSocket();
  }

  disconnect(): void {
    this.closed = true;
    this.socketGeneration += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const timer of this.pendingPush.values()) clearTimeout(timer);
    this.pendingPush.clear();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "agent_shutdown");
    this.config.onLifecycle?.({ type: "stopped", generation: this.socketGeneration });
  }

  pushStatus(update: HeartbeatDeviceUpdate): void {
    const previousSeq = this.nextSeqByDevice.get(update.id) ?? 0;
    const seq = update.seq ?? previousSeq + 1;
    this.nextSeqByDevice.set(update.id, Math.max(previousSeq, seq));
    const sequenced = update.seq === seq ? update : { ...update, seq };
    this.lastKnown.set(update.id, sequenced);

    const now = Date.now();
    const last = this.lastPushAt.get(update.id) ?? 0;
    if (now - last >= this.minPushGapMs) {
      this.lastPushAt.set(update.id, now);
      this.sendHeartbeat([sequenced]);
      return;
    }
    if (this.pendingPush.has(update.id)) return;
    const generation = this.socketGeneration;
    const timer = setTimeout(
      () => {
        this.pendingPush.delete(update.id);
        if (this.closed || generation !== this.socketGeneration) return;
        const latest = this.lastKnown.get(update.id);
        if (!latest) return;
        this.lastPushAt.set(update.id, Date.now());
        this.sendHeartbeat([latest]);
      },
      this.minPushGapMs - (now - last),
    );
    this.pendingPush.set(update.id, timer);
  }

  private openSocket(): void {
    if (this.closed) return;
    const generation = ++this.socketGeneration;
    this.config.onLifecycle?.({ type: "connecting", generation });
    const socket = new WebSocket(this.config.url, {
      cert: this.config.cert,
      key: this.config.key,
      ca: this.config.ca,
      rejectUnauthorized: true,
    });
    this.socket = socket;

    socket.once("open", () => {
      if (this.isActiveSocket(socket, generation)) this.config.onLifecycle?.({ type: "socket_open", generation });
    });

    socket.on("message", (raw: Buffer) => {
      if (!this.isActiveSocket(socket, generation)) return;
      const parsed = parseRelayToGatewayFrame(raw.toString("utf8"));
      if (!parsed.ok) {
        this.log("device-agent: rejected relay frame", parsed.error);
        socket.close(4001, parsed.error);
        return;
      }
      const frame = parsed.frame;

      if (frame.type === "hello_challenge") {
        this.config.onLifecycle?.({ type: "hello_challenge", generation });
        const hello: Hello = {
          type: "hello",
          protocol_version: "v1",
          nonce: frame.nonce,
          agent_version: this.config.agentVersion,
          capabilities: [...this.config.capabilities],
          ...(this.config.printerModel ? { printer_model: this.config.printerModel } : {}),
          ...(this.config.firmwareClass ? { firmware_class: this.config.firmwareClass } : {}),
        };
        this.sendFrame(hello, socket, generation);
        return;
      }
      if (frame.type === "hello_ack") {
        this.config.onLifecycle?.({ type: "hello_ack", generation });
        this.reconnectDelayMs = this.config.reconnectMinDelayMs ?? 1000;
        this.heartbeatIntervalSeconds = frame.heartbeat_interval_seconds;
        this.startHeartbeatLoop(socket, generation);
        if (this.lastKnown.size) this.sendHeartbeat([...this.lastKnown.values()], socket, generation);
        return;
      }
      if (frame.type === "error") {
        this.log("device-agent: relay error", frame.code, frame.message);
        if (frame.code === "authorization_failed" || frame.code === "authentication_failed") {
          this.config.onLifecycle?.({ type: "authorization_rejected", generation });
        }
        return;
      }
      if (frame.type === "command") {
        this.handleCommandFrame(frame, socket, generation);
        return;
      }
      if (frame.type === "file_start" || frame.type === "file_chunk") {
        this.handleFileFrame(frame, socket, generation);
      }
    });

    socket.on("close", (code: number, reason: Buffer) => {
      if (!this.isCurrentSocket(socket, generation)) return;
      if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.log("device-agent: relay connection closed", code, reason.toString());
      this.config.onLifecycle?.(code === 4004 ? { type: "revoked", generation } : { type: "disconnected", generation, code });
      this.scheduleReconnect();
    });

    socket.on("error", (error: Error) => {
      this.log("device-agent: relay socket error", error.message);
    });
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const maxDelay = this.config.reconnectMaxDelayMs ?? 30_000;
    const jitterMs = Math.floor(Math.random() * 250);
    const delay = this.reconnectDelayMs + jitterMs;
    const generation = this.socketGeneration;
    this.config.onLifecycle?.({ type: "backoff", generation, delayMs: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed && generation === this.socketGeneration) this.openSocket();
    }, delay);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, maxDelay);
  }

  private startHeartbeatLoop(socket: WebSocket, generation: number): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    const schedule = () => {
      if (!this.isActiveSocket(socket, generation)) return;
      this.sendHeartbeat([...this.lastKnown.values()], socket, generation);
      const intervalMs = this.heartbeatIntervalSeconds * 1000;
      const jitterMs = Math.floor(Math.random() * intervalMs * this.heartbeatJitterRatio);
      this.heartbeatTimer = setTimeout(schedule, intervalMs + jitterMs);
    };
    const intervalMs = this.heartbeatIntervalSeconds * 1000;
    const jitterMs = Math.floor(Math.random() * intervalMs * this.heartbeatJitterRatio);
    this.heartbeatTimer = setTimeout(schedule, intervalMs + jitterMs);
  }

  private sendHeartbeat(devices: readonly HeartbeatDeviceUpdate[], socket = this.socket, generation = this.socketGeneration): void {
    this.sendFrame(
      {
        type: "heartbeat",
        message_id: randomUUID(),
        devices: devices.map((device) => ({
          device_id: device.id,
          status: device.status,
          sequence: device.seq ?? 0,
          ...(device.progress === undefined ? {} : { progress_percent: device.progress }),
          ...(device.metrics === undefined ? {} : { metrics: device.metrics }),
          ...(device.identity === undefined
            ? {}
            : {
                identity: Object.fromEntries(
                  Object.entries(device.identity)
                    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
                    .map(([key, value]) => [toSnakeCase(key), value]),
                ),
              }),
        })),
      },
      socket,
      generation,
    );
  }

  private sendFrame(frame: GatewayToRelayFrame, socket: WebSocket | null, generation: number): boolean {
    if (!socket || !this.isActiveSocket(socket, generation) || socket.readyState !== WebSocket.OPEN) return false;
    const encoded = JSON.stringify(frame);
    const checked = parseGatewayToRelayFrame(encoded);
    if (!checked.ok) {
      this.log("device-agent: refused invalid outbound frame", checked.error);
      return false;
    }
    socket.send(encoded);
    return true;
  }

  private handleCommandFrame(frame: Command, socket: WebSocket, generation: number): void {
    if (!this.config.onCommand) return;
    this.sendFrame(
      {
        type: "command_ack",
        device_id: frame.device_id,
        command_id: frame.command_id,
        command_seq: frame.command_seq,
      },
      socket,
      generation,
    );
    void this.config
      .onCommand(frame)
      .then((result) => this.sendFrame(result, socket, generation))
      .catch((error: unknown) => {
        this.log("device-agent: onCommand handler failed", error);
      });
  }

  private handleFileFrame(frame: FileStart | FileChunk, socket: WebSocket, generation: number): void {
    const result = frame.type === "file_start" ? this.config.onFileStart?.(frame) : this.config.onFileChunk?.(frame);
    if (!result) return;
    void result.then((response) => this.sendFrame(response, socket, generation)).catch((error: unknown) => {
      this.log("device-agent: file handler failed", error);
    });
  }

  private isActiveSocket(socket: WebSocket, generation: number): boolean {
    return this.isCurrentSocket(socket, generation) && socket.readyState === WebSocket.OPEN;
  }

  private isCurrentSocket(socket: WebSocket, generation: number): boolean {
    return !this.closed && this.socket === socket && this.socketGeneration === generation;
  }
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
