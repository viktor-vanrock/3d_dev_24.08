import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

// Эмулированный Moonraker для тестов MoonrakerAdapter — HTTP (`/access/oneshot_token`,
// `/server/files/upload`) + WS JSON-RPC (`/websocket`), ровно тот срез реального API, что
// адаптер реально вызывает. Test-only (использует `ws` как сервер — production-код адаптера
// его не импортирует, только глобальный клиентский WebSocket, см. jsonRpcClient.ts).

export interface FakeMoonrakerOptions {
  apiKey?: string;
  objects?: string[];
  webcams?: Array<{ stream_url: string; service?: string }>;
}

export interface FakeMoonraker {
  url: string;
  uploadedFiles: Map<string, Buffer>;
  gcodeScripts: string[];
  printCommandCalls: { pause: number; resume: number; cancel: number; start: string[] };
  setPrintStats(stats: Record<string, unknown>): void;
  /** Шлёт notify_status_update ВСЕМ подключённым WS-клиентам — тест использует, чтобы доказать
   *  push-путь subscribeTelemetry без polling. */
  pushStatusUpdate(status: Record<string, unknown>): void;
  close(): Promise<void>;
}

export async function startFakeMoonraker(options: FakeMoonrakerOptions = {}): Promise<FakeMoonraker> {
  const objects = options.objects ?? ["toolhead", "extruder", "heater_bed", "print_stats", "virtual_sdcard"];
  const webcams = options.webcams ?? [];
  const uploadedFiles = new Map<string, Buffer>();
  const gcodeScripts: string[] = [];
  const printCommandCalls = { pause: 0, resume: 0, cancel: 0, start: [] as string[] };
  let printStats: Record<string, unknown> = { state: "standby", filename: "" };
  let issuedToken: string | null = null;
  const sockets = new Set<WebSocket>();

  const server = createServer((req, res) => {
    void handleHttp(req, res);
  });

  async function handleHttp(req: IncomingMessage, res: import("node:http").ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://fake-moonraker");

    if (req.method === "GET" && url.pathname === "/access/oneshot_token") {
      if (options.apiKey && req.headers["x-api-key"] !== options.apiKey) {
        res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      issuedToken = randomBytes(16).toString("hex");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ result: issuedToken }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/server/files/upload") {
      if (options.apiKey && req.headers["x-api-key"] !== options.apiKey) {
        res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] ?? "";
      const parsed = parseMultipartFile(body, contentType);
      if (!parsed) {
        res.writeHead(400).end(JSON.stringify({ error: "no file part" }));
        return;
      }
      uploadedFiles.set(parsed.fileName, parsed.data);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ item: { path: `gcodes/${parsed.fileName}`, size: parsed.data.length } }));
      return;
    }

    res.writeHead(404).end();
  }

  const wss = new WebSocketServer({ server, path: "/websocket" });

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url ?? "/", "http://fake-moonraker");
    if (options.apiKey) {
      const token = url.searchParams.get("token");
      if (!token || token !== issuedToken) {
        socket.close(4401, "unauthorized");
        return;
      }
    }
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));

    socket.on("message", (raw) => {
      let msg: { id?: number; method?: string; params?: Record<string, unknown> };
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      const reply = (result: unknown) => socket.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));

      switch (msg.method) {
        case "printer.objects.list":
          reply({ objects });
          return;
        case "printer.objects.subscribe":
        case "printer.objects.query":
          reply({
            status: {
              print_stats: printStats,
              heater_bed: { temperature: 60.1 },
              extruder: { temperature: 210.4 },
              chamber: { temperature: 32 },
              virtual_sdcard: { progress: typeof printStats.progress === "number" ? printStats.progress : 0 },
            },
          });
          return;
        case "server.webcams.list":
          reply({ webcams });
          return;
        case "printer.gcode.script":
          gcodeScripts.push(typeof msg.params?.script === "string" ? msg.params.script : "");
          reply({});
          return;
        case "printer.print.pause":
          printCommandCalls.pause += 1;
          printStats = { ...printStats, state: "paused" };
          reply({});
          return;
        case "printer.print.resume":
          printCommandCalls.resume += 1;
          printStats = { ...printStats, state: "printing" };
          reply({});
          return;
        case "printer.print.cancel":
          printCommandCalls.cancel += 1;
          printStats = { ...printStats, state: "cancelled" };
          reply({});
          return;
        case "printer.print.start": {
          const fileName = typeof msg.params?.filename === "string" ? msg.params.filename : "";
          printCommandCalls.start.push(fileName);
          printStats = { state: "printing", filename: fileName };
          reply({});
          return;
        }
        default:
          socket.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { message: `unknown method ${msg.method}` } }));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake moonraker: no port assigned");

  return {
    url: `http://127.0.0.1:${address.port}`,
    uploadedFiles,
    gcodeScripts,
    printCommandCalls,
    setPrintStats(stats) {
      printStats = stats;
    },
    pushStatusUpdate(status) {
      const frame = JSON.stringify({ jsonrpc: "2.0", method: "notify_status_update", params: [status, Date.now() / 1000] });
      for (const socket of sockets) socket.send(frame);
    },
    async close() {
      for (const socket of sockets) socket.close();
      await new Promise<void>((resolve, reject) =>
        wss.close((err) => (err ? reject(err) : resolve())),
      );
      await closeHttpServer(server);
    },
  };
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

// Минимальный multipart/form-data парсер — ТОЛЬКО чтобы вытащить одну часть `file` из тела,
// которое реально шлёт MoonrakerAdapter.uploadFile (FormData + Blob). Не претендует на полный
// RFC 2046: тестовый двойник реального Moonraker, не отдельная либа.
function parseMultipartFile(body: Buffer, contentType: string): { fileName: string; data: Buffer } | null {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) return null;

  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    parts.push(body.subarray(start + delimiter.length, next));
    start = next;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const header = part.subarray(0, headerEnd).toString("utf8");
    if (!/name="file"/.test(header)) continue;
    const fileNameMatch = /filename="([^"]*)"/.exec(header);
    if (!fileNameMatch) continue;
    let content = part.subarray(headerEnd + 4);
    if (content.subarray(-2).toString("utf8") === "\r\n") content = content.subarray(0, -2);
    return { fileName: fileNameMatch[1]!, data: Buffer.from(content) };
  }
  return null;
}
