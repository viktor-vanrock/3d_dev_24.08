import WebSocket, { type RawData } from "ws";

// JSON-RPC 2.0 поверх WS к Moonraker (`/websocket`) — Moonraker сам говорит этим протоколом
// (https://moonraker.readthedocs.io/en/latest/web_api/#json-rpc-api-overview), это не наш
// формат. Отдельный от protocol.ts (apps/relay) файл: тот протокол — agent<->relay (наш,
// JSON-текстовые кадры с type), этот — agent<->Moonraker (чужой, JSON-RPC) — разные границы,
// разные форматы, путать их в одном модуле означало бы одну реализацию на два несвязанных
// контракта.

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export type NotificationListener = (method: string, params: unknown) => void;

export class JsonRpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

export class JsonRpcClient {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly notificationListeners = new Set<NotificationListener>();

  connect(url: string, timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error(`moonraker ws connect timeout (${url})`));
      }, timeoutMs);

      socket.once("open", () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.once("error", (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
      socket.on("message", (raw) => {
        this.handleMessage(rawDataToString(raw));
      });
      socket.on("close", () => {
        this.rejectAllPending(new Error("moonraker ws closed"));
      });
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.rejectAllPending(new Error("moonraker ws disconnected"));
  }

  onNotification(listener: NotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  call<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("moonraker ws not connected"));
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {}, id });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`moonraker call timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      socket.send(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private handleMessage(raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // мусорный кадр — не роняем соединение ради одного нечитаемого сообщения
    }
    if (typeof msg !== "object" || msg === null) return;
    const rec = msg as Record<string, unknown>;

    if (typeof rec.id === "number") {
      const call = this.pending.get(rec.id);
      if (!call) return;
      this.pending.delete(rec.id);
      if (rec.error) {
        const errObj = rec.error as { message?: string; code?: number };
        call.reject(new JsonRpcError(errObj.message ?? "moonraker rpc error", errObj.code));
      } else {
        call.resolve(rec.result);
      }
      return;
    }

    if (typeof rec.method === "string") {
      for (const listener of this.notificationListeners) listener(rec.method, rec.params);
    }
  }

  private rejectAllPending(err: Error): void {
    for (const call of this.pending.values()) call.reject(err);
    this.pending.clear();
  }
}

function rawDataToString(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return raw.toString("utf8");
}
