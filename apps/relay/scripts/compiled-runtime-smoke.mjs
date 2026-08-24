import { createHash, createHmac } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const relayDirectory = fileURLToPath(new URL("..", import.meta.url));
const deviceAgentDirectory = fileURLToPath(new URL("../../device-agent", import.meta.url));
const serviceToken = "compiled-smoke-relay-service-token-0001";
const commandSecret = "compiled-smoke-command-token-secret-0001";
const gatewayId = "gateway-smoke-1";
const deviceId = "device-smoke-1";
const commandId = "command-smoke-1";
const transferId = "transfer-smoke-1";
const sourceBytes = Buffer.from("G1 X1 Y1\n", "utf8");
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");

function runOpenSsl(directory, args) {
  execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
}

function createCertificates() {
  const directory = mkdtempSync(join(tmpdir(), "relay-compiled-smoke-tls-"));
  runOpenSsl(directory, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-subj", "/CN=Relay Compiled Smoke CA", "-days", "1"]);
  writeFileSync(join(directory, "server.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  runOpenSsl(directory, ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=localhost"]);
  runOpenSsl(directory, ["x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.crt", "-days", "1", "-extfile", "server.ext"]);
  writeFileSync(join(directory, "gateway.ext"), `subjectAltName=URI:urn:portal:gateway:${gatewayId}\nextendedKeyUsage=clientAuth\n`);
  runOpenSsl(directory, ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "gateway.key", "-out", "gateway.csr", "-subj", `/CN=${gatewayId}`]);
  runOpenSsl(directory, ["x509", "-req", "-in", "gateway.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAserial", "ca.srl", "-out", "gateway.crt", "-days", "1", "-extfile", "gateway.ext"]);
  return directory;
}

async function reservePort() {
  const server = createTcpServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to reserve smoke port");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "x-correlation-id": "compiled-smoke-correlation" });
  response.end(JSON.stringify(body));
}

async function waitFor(description, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${description}`);
}

function nextWebSocketMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

function signCommandToken() {
  const now = Math.floor(Date.now() / 1_000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    typ: "command",
    owner_id: "owner-smoke-1",
    device_id: deviceId,
    role: "owner",
    command: "pause",
    jti: commandId,
    iat: now,
    exp: now + 300,
  })}`;
  return `${unsigned}.${createHmac("sha256", commandSecret).update(unsigned).digest("base64url")}`;
}

async function main() {
  const certificates = createCertificates();
  const spoolDirectory = await mkdtemp(join(tmpdir(), "relay-compiled-smoke-spool-"));
  const apiPort = await reservePort();
  const gatewayPort = await reservePort();
  const observabilityPort = await reservePort();
  const apiBaseUrl = `https://127.0.0.1:${apiPort}`;
  const state = {
    authorizeCount: 0,
    currentSessionId: "",
    currentGeneration: 0,
    heartbeatSeen: false,
    heartbeatSeenAfterReconnect: false,
    commandClaimed: false,
    commandLeaseStates: [],
    commandResult: undefined,
    transferNextOffset: 0,
    transferNextSequence: 0,
    transferResult: undefined,
    closeReasons: [],
    forceReconnect: false,
    reconnectForced: false,
  };
  let relayProcess;
  let relayClient;
  let relayOutput = "";

  const apiServer = createHttpsServer({
    cert: readFileSync(join(certificates, "server.crt")),
    key: readFileSync(join(certificates, "server.key")),
  }, async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", apiBaseUrl);
      if (url.pathname === `/objects/${transferId}` && request.method === "GET") {
        const range = request.headers.range;
        const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
        if (!match) return sendJson(response, 416, { error: "range_required" });
        const start = Number(match[1]);
        const end = Number(match[2]);
        const bytes = sourceBytes.subarray(start, end + 1);
        response.writeHead(206, {
          "content-type": "application/octet-stream",
          "content-length": String(bytes.byteLength),
          "content-range": `bytes ${start}-${end}/${sourceBytes.byteLength}`,
          "accept-ranges": "bytes",
        });
        return response.end(bytes);
      }
      if (request.headers["x-relay-service-token"] !== serviceToken) return sendJson(response, 401, { error: { code: "unauthorized", message: "unauthorized" } });
      const body = await readJson(request);
      const now = new Date().toISOString();
      if (request.method === "POST" && url.pathname === "/internal/relay/v1/sessions/authorize") {
        state.authorizeCount += 1;
        state.currentGeneration = state.authorizeCount;
        state.currentSessionId = `session-smoke-${state.currentGeneration}`;
        return sendJson(response, 200, {
          session_id: state.currentSessionId,
          session_generation: state.currentGeneration,
          gateway_id: gatewayId,
          authorization_revision: 1,
          authorized_devices: [{ device_id: deviceId, authorization_revision: 1 }],
          pending_transfer_ids: state.transferResult ? [] : [transferId],
          heartbeat_interval_ms: 1_000,
          heartbeat_timeout_ms: 5_000,
        });
      }
      if (request.method === "POST" && /^\/internal\/relay\/v1\/sessions\/[^/]+\/heartbeat$/.test(url.pathname)) {
        state.heartbeatSeen = true;
        if (body.session_generation >= 2) state.heartbeatSeenAfterReconnect = true;
        return sendJson(response, 200, {
          session_id: state.currentSessionId,
          session_generation: body.session_generation,
          authorization_revision: 1,
          accepted_device_ids: [deviceId],
          pending_transfer_ids: state.transferResult ? [] : [transferId],
          persisted_at: now,
          replayed: false,
        });
      }
      if (request.method === "POST" && /^\/internal\/relay\/v1\/sessions\/[^/]+\/close$/.test(url.pathname)) {
        state.closeReasons.push(body.reason);
        return sendJson(response, 200, { session_id: url.pathname.split("/").at(-2), session_generation: body.session_generation, closed_at: now, replayed: false });
      }
      if (request.method === "POST" && url.pathname === "/internal/relay/v1/gateways/revalidate") {
        const shouldSupersede = state.forceReconnect && !state.reconnectForced;
        if (shouldSupersede) state.reconnectForced = true;
        return sendJson(response, 200, {
          results: body.gateways.map((gateway) => ({ ...gateway, state: shouldSupersede ? "superseded" : "authorized", authorization_revision: 1, authorized_devices: [{ device_id: deviceId, authorization_revision: 1 }] })),
          validated_at: now,
        });
      }
      if (request.method === "POST" && url.pathname === "/internal/relay/v1/commands/claim") {
        const commands = state.commandClaimed ? [] : [{
          command_id: commandId,
          device_id: deviceId,
          command_seq: 1,
          status: "leased",
          payload: { command: "pause" },
          command_token: commandToken,
          claim_owner: body.claim_owner,
          claim_token: "claim-token-compiled-smoke-00000001",
          generation: 1,
          attempt_count: 1,
          max_attempts: 3,
          lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
          expires_at: new Date(Date.now() + 300_000).toISOString(),
        }];
        state.commandClaimed = true;
        return sendJson(response, 200, { claim_owner: body.claim_owner, commands, claimed_at: now, replayed: false });
      }
      if (request.method === "POST" && url.pathname === `/internal/relay/v1/commands/${commandId}/lease-heartbeat`) {
        state.commandLeaseStates.push(body.delivery_state);
        return sendJson(response, 200, { command_id: commandId, status: body.delivery_state, generation: 1, lease_expires_at: new Date(Date.now() + 30_000).toISOString(), replayed: false });
      }
      if (request.method === "PUT" && url.pathname === `/internal/relay/v1/commands/${commandId}/result`) {
        state.commandResult = body;
        return sendJson(response, 200, { command_id: commandId, command_seq: 1, status: body.status, generation: 1, persisted_at: now, replayed: false });
      }
      if (request.method === "GET" && url.pathname === `/internal/relay/v1/transfers/${transferId}/metadata`) {
        return sendJson(response, 200, {
          transfer_id: transferId,
          session_id: state.currentSessionId,
          session_generation: state.currentGeneration,
          gateway_id: gatewayId,
          device_id: deviceId,
          file_name: "smoke.gcode",
          kind: "gcode",
          content_type: "model/gcode",
          size_bytes: sourceBytes.byteLength,
          sha256: sourceSha256,
          object_version: "etag:compiled-smoke",
          chunk_size_bytes: 1_024,
          next_offset: state.transferNextOffset,
          next_sequence: state.transferNextSequence,
          start_print: false,
        });
      }
      if (request.method === "POST" && url.pathname === `/internal/relay/v1/transfers/${transferId}/source-url`) {
        return sendJson(response, 200, {
          transfer_id: transferId,
          source_url: `${apiBaseUrl}/objects/${transferId}`,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          range_supported: true,
          size_bytes: sourceBytes.byteLength,
          sha256: sourceSha256,
          object_version: "etag:compiled-smoke",
          next_offset: state.transferNextOffset,
          next_sequence: state.transferNextSequence,
        });
      }
      if (request.method === "PUT" && url.pathname === `/internal/relay/v1/transfers/${transferId}/progress`) {
        state.transferNextOffset = body.next_offset;
        state.transferNextSequence = body.next_sequence;
        return sendJson(response, 200, { transfer_id: transferId, next_offset: body.next_offset, next_sequence: body.next_sequence, persisted_at: now, replayed: false });
      }
      if (request.method === "PUT" && url.pathname === `/internal/relay/v1/transfers/${transferId}/result`) {
        state.transferResult = body;
        return sendJson(response, 200, { transfer_id: transferId, status: body.status, next_offset: body.next_offset, next_sequence: body.next_sequence, persisted_at: now, replayed: false });
      }
      return sendJson(response, 404, { error: { code: "not_found", message: "not found" } });
    } catch (error) {
      return sendJson(response, 500, { error: { code: "internal_error", message: error instanceof Error ? error.message : "internal error" } });
    }
  });

  const commandToken = signCommandToken();

  try {
    await new Promise((resolve, reject) => {
      apiServer.once("error", reject);
      apiServer.listen(apiPort, "127.0.0.1", resolve);
    });
    relayProcess = spawn(process.execPath, [join(relayDirectory, "dist/main.js")], {
      cwd: relayDirectory,
      env: {
        ...process.env,
        NODE_ENV: "development",
        NODE_EXTRA_CA_CERTS: join(certificates, "ca.crt"),
        RELAY_PROTOCOL_VERSION: "v1",
        RELAY_INSTANCE_ID: "relay-compiled-smoke",
        RELAY_API_BASE_URL: apiBaseUrl,
        RELAY_SERVICE_TOKEN: serviceToken,
        RELAY_API_TIMEOUT_MS: "1000",
        RELAY_API_RETRY_ATTEMPTS: "1",
        RELAY_API_RETRY_BASE_DELAY_MS: "10",
        RELAY_GATEWAY_HOST: "127.0.0.1",
        RELAY_GATEWAY_PORT: String(gatewayPort),
        RELAY_OBSERVABILITY_HOST: "127.0.0.1",
        RELAY_OBSERVABILITY_PORT: String(observabilityPort),
        RELAY_TLS_CERT_FILE: join(certificates, "server.crt"),
        RELAY_TLS_KEY_FILE: join(certificates, "server.key"),
        RELAY_TLS_CA_FILE: join(certificates, "ca.crt"),
        RELAY_REVALIDATION_INTERVAL_MS: "500",
        RELAY_REVALIDATION_TIMEOUT_MS: "250",
        RELAY_REVALIDATION_FAIL_CLOSED_MS: "1000",
        RELAY_SHUTDOWN_DRAIN_MS: "2000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [relayProcess.stdout, relayProcess.stderr]) stream.on("data", (chunk) => { relayOutput = `${relayOutput}${chunk}`.slice(-65_536); });
    const unexpectedExit = new Promise((_, reject) => relayProcess.once("exit", (code, signal) => reject(new Error(`relay exited before smoke completion (${code ?? signal})\n${relayOutput}`))));

    await Promise.race([
      waitFor("compiled relay readiness", async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${observabilityPort}/ready`);
          return response.ok;
        } catch {
          return false;
        }
      }),
      unexpectedExit,
    ]);

    const unsupported = new WebSocket(`wss://127.0.0.1:${gatewayPort}/relay/ws`, {
      cert: readFileSync(join(certificates, "gateway.crt")),
      key: readFileSync(join(certificates, "gateway.key")),
      ca: readFileSync(join(certificates, "ca.crt")),
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
    });
    const challenge = await nextWebSocketMessage(unsupported);
    unsupported.send(JSON.stringify({ type: "hello", protocol_version: "v2", nonce: challenge.nonce, agent_version: "future-agent", capabilities: [] }));
    const unsupportedError = await nextWebSocketMessage(unsupported);
    if (unsupportedError.code !== "unsupported_version") throw new Error(`compiled relay accepted unsupported version: ${JSON.stringify(unsupportedError)}`);
    unsupported.close();

    process.env.COMMAND_TOKEN_SECRET = commandSecret;
    const [{ RelayClient }, { CommandHandler }, { FileTransferHandler }] = await Promise.all([
      import(join(deviceAgentDirectory, "dist/relay/client.js")),
      import(join(deviceAgentDirectory, "dist/relay/commandHandler.js")),
      import(join(deviceAgentDirectory, "dist/relay/fileTransfer.js")),
    ]);
    const uploaded = [];
    const driver = {
      firmwareClass: "compiled-smoke",
      connect: async () => undefined,
      disconnect: async () => undefined,
      capabilities: async () => ({ camera: false, heatedBed: false, heatedChamber: false, multiExtruder: false, supportedCommands: ["pause"], raw: {} }),
      status: async () => ({ status: "idle", nozzleTempC: null, bedTempC: null, chamberTempC: null, progress: null, jobId: null, jobFileName: null, raw: {} }),
      pause: async () => ({ ok: true }),
      resume: async () => ({ ok: true }),
      cancel: async () => ({ ok: true }),
      uploadGcode: async () => ({ ok: false, error: "stream-only" }),
      uploadGcodeStream: async ({ data }) => {
        for await (const chunk of data) uploaded.push(Buffer.from(chunk));
        return { ok: true, storedAs: "smoke.gcode" };
      },
      startPrint: async () => ({ ok: true }),
      camera: async () => null,
      onStatusUpdate: () => () => undefined,
    };
    const commandHandler = new CommandHandler(driver, deviceId, () => "healthy", () => undefined);
    const fileHandler = new FileTransferHandler(driver, deviceId, spoolDirectory);
    relayClient = new RelayClient({
      url: `wss://127.0.0.1:${gatewayPort}/relay/ws`,
      cert: readFileSync(join(certificates, "gateway.crt")),
      key: readFileSync(join(certificates, "gateway.key")),
      ca: readFileSync(join(certificates, "ca.crt")),
      agentVersion: "compiled-smoke-agent",
      capabilities: ["file_transfer", "cmd.pause"],
      reconnectMinDelayMs: 100,
      reconnectMaxDelayMs: 250,
      heartbeatJitterRatio: 0,
      minPushGapMs: 10,
      onCommand: (frame) => commandHandler.handle(frame),
      onFileStart: (frame) => fileHandler.start(frame),
      onFileChunk: (frame) => fileHandler.chunk(frame),
      log: (message, ...args) => { relayOutput = `${relayOutput}\n${message} ${args.join(" ")}`.slice(-65_536); },
    });
    relayClient.connect();
    relayClient.pushStatus({ id: deviceId, status: "idle", seq: 1, progress: 0 });

    try {
      await Promise.race([
        waitFor("heartbeat, command result and transfer result", () => state.heartbeatSeen && state.commandResult?.status === "executed" && state.transferResult?.status === "completed"),
        unexpectedExit,
      ]);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nstate=${JSON.stringify(state)}\n${relayOutput}`);
    }
    if (!state.commandLeaseStates.includes("delivered") || !state.commandLeaseStates.includes("acknowledged")) throw new Error(`missing command delivery states: ${state.commandLeaseStates.join(",")}`);
    if (state.transferNextOffset !== sourceBytes.byteLength || Buffer.concat(uploaded).compare(sourceBytes) !== 0) throw new Error("compiled transfer bytes or persisted offset mismatch");

    state.forceReconnect = true;
    await Promise.race([
      waitFor("device-agent reconnect and heartbeat", () => state.authorizeCount >= 2 && state.heartbeatSeenAfterReconnect),
      unexpectedExit,
    ]);

    relayProcess.kill("SIGTERM");
    const exit = await new Promise((resolve) => relayProcess.once("exit", (code, signal) => resolve({ code, signal })));
    if (exit.code !== 0) throw new Error(`compiled relay failed graceful SIGTERM (${exit.code ?? exit.signal})\n${relayOutput}`);
    await waitFor("shutdown close report", () => state.closeReasons.includes("shutdown"), 2_000);
    process.stdout.write(JSON.stringify({
      health: "ready",
      handshake: "v1-mtls",
      heartbeat: "accepted",
      reconnect: "reauthorized",
      unsupported_version: "rejected",
      command: state.commandResult.status,
      transfer: state.transferResult.status,
      graceful_sigterm: "exit-0",
    }) + "\n");
  } finally {
    relayClient?.disconnect();
    if (relayProcess && relayProcess.exitCode === null && relayProcess.signalCode === null) relayProcess.kill("SIGKILL");
    await new Promise((resolve) => apiServer.close(() => resolve()));
    rmSync(certificates, { recursive: true, force: true });
    rmSync(spoolDirectory, { recursive: true, force: true });
  }
}

await main();
