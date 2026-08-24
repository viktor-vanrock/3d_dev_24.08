import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { createServer, type Server } from "node:https";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as WebSocketPeer } from "ws";
import type { PrinterDriver } from "./driver/printerDriver.ts";
import { enrollDeviceAgent } from "./enrollmentClient.ts";
import { loadAgentCredentials } from "./credentials.ts";
import { AgentRuntime } from "./runtime/agentRuntime.ts";
import { RelayClient, type RelayLifecycleEvent } from "./relay/client.ts";
import { CommandHandler } from "./relay/commandHandler.ts";
import { applyRelayLifecycleEvent } from "./relay/runtimeLifecycle.ts";

const gatewayId = "11111111-1111-4111-8111-111111111111";
const deviceId = "33333333-3333-4333-8333-333333333333";
const ownerId = "22222222-2222-4222-8222-222222222222";
let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  delete process.env.COMMAND_VERIFICATION_KEYS;
  await cleanup?.();
  cleanup = undefined;
});

describe("device-agent security chain e2e", () => {
  it("enrolls, connects with mTLS, executes rotated Ed25519 commands, revokes, and recovers", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-security-chain-"));
    cleanup = async () => { rmSync(directory, { recursive: true, force: true }); };
    const current = await commandKey("current");
    const next = await commandKey("next");
    const pki = createPki(directory);
    let issuedAgentId = gatewayId;
    const enrollmentRequest: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { csr_pem: string };
      expect(body.csr_pem).toContain("BEGIN CERTIFICATE REQUEST");
      expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");
      const certificate = signCsr(pki, body.csr_pem, issuedAgentId);
      return new Response(JSON.stringify(enrollmentResponse(issuedAgentId, certificate, pki.ca, [current.publicJwk])), { status: 201 });
    };

    await enrollDeviceAgent({ apiUrl: "https://api.invalid", code: "enrollment-once", agentVersion: "1.2.3", home: directory }, enrollmentRequest);
    expect(loadAgentCredentials(directory)).toMatchObject({ agentId: gatewayId, deviceId });

    const relay = await startMtlsRelay(pki, directory);
    const runtime = new AgentRuntime({ version: "1.2.3", commitSha: "1524467" });
    runtime.update({ moonraker: "ready" });
    const events: RelayLifecycleEvent[] = [];
    const client = new RelayClient({
      url: relay.url, cert: readFileSync(join(directory, "gateway-certificate.pem")), key: readFileSync(join(directory, "gateway-key.pem")), ca: pki.ca,
      agentVersion: "1.2.3+1524467", capabilities: ["cmd.pause"], reconnectMinDelayMs: 10_000,
      onLifecycle: (event) => { events.push(event); applyRelayLifecycleEvent(runtime, event, () => client.disconnect()); }, log: () => undefined,
    });
    cleanup = async () => { client.disconnect(); await relay.close(); rmSync(directory, { recursive: true, force: true }); };
    client.connect();
    await eventually(() => expect(runtime.snapshot.status).toBe("healthy"));
    expect(relay.peerAuthorized()).toBe(true);

    configureKeys([current.publicJwk]);
    const driver = fakeDriver();
    const handler = new CommandHandler(driver, deviceId, () => runtime.snapshot.status, () => undefined, undefined, undefined, gatewayId);
    const accepted = await handler.handle(commandFrame("command-1", 1, await token(current.privateKey, "current", "command-1", deviceId, gatewayId)));
    expect(accepted).toMatchObject({ outcome: "executed" });
    expect(driver.pauseCalls).toBe(1);

    const crossDevice = await handler.handle(commandFrame("command-cross", 2, await token(current.privateKey, "current", "command-cross", "other-device", gatewayId)));
    expect(crossDevice).toMatchObject({ outcome: "failed", error_code: "invalid_command_token" });
    const downgraded = await hsToken("command-hs");
    expect(await handler.handle(commandFrame("command-hs", 3, downgraded))).toMatchObject({ outcome: "failed", error_code: "invalid_command_token" });
    expect(driver.pauseCalls).toBe(1);

    configureKeys([current.publicJwk, next.publicJwk]);
    expect(await handler.handle(commandFrame("command-2", 4, await token(next.privateKey, "next", "command-2", deviceId, gatewayId)))).toMatchObject({ outcome: "executed" });
    configureKeys([next.publicJwk]);
    expect(await handler.handle(commandFrame("command-retired", 5, await token(current.privateKey, "current", "command-retired", deviceId, gatewayId)))).toMatchObject({ outcome: "failed", error_code: "invalid_command_token" });
    expect(driver.pauseCalls).toBe(2);

    relay.revoke();
    await eventually(() => expect(runtime.snapshot.status).toBe("revoked"));
    expect(await handler.handle(commandFrame("command-after-revoke", 6, await token(next.privateKey, "next", "command-after-revoke", deviceId, gatewayId)))).toMatchObject({ outcome: "failed", error_code: "device_unavailable" });
    expect(driver.pauseCalls).toBe(2);

    issuedAgentId = "44444444-4444-4444-8444-444444444444";
    await enrollDeviceAgent({ apiUrl: "https://api.invalid", code: "recovery-once", agentVersion: "1.2.4", home: directory, recovery: true }, enrollmentRequest);
    expect(loadAgentCredentials(directory)).toMatchObject({ agentId: issuedAgentId, deviceId });
    expect(readFileSync(join(directory, "gateway-certificate.pem"), "utf8")).toContain("BEGIN CERTIFICATE");
    expect(events.some((event) => event.type === "revoked")).toBe(true);

  });
});

function createPki(directory: string) {
  run(directory, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-subj", "/CN=Security Chain CA", "-days", "2"]);
  run(directory, ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-subj", "/CN=localhost"]);
  writeFileSync(join(directory, "server.ext"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  run(directory, ["x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.crt", "-days", "2", "-extfile", "server.ext"]);
  return { directory, ca: readFileSync(join(directory, "ca.crt")), serverCert: readFileSync(join(directory, "server.crt")), serverKey: readFileSync(join(directory, "server.key")) };
}

function signCsr(pki: ReturnType<typeof createPki>, csr: string, agentId: string): string {
  writeFileSync(join(pki.directory, "agent.csr"), csr);
  writeFileSync(join(pki.directory, "agent.ext"), `subjectAltName=URI:urn:portal:gateway:${agentId}\nextendedKeyUsage=clientAuth\n`);
  run(pki.directory, ["x509", "-req", "-in", "agent.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "agent.crt", "-days", "2", "-extfile", "agent.ext"]);
  return readFileSync(join(pki.directory, "agent.crt"), "utf8");
}

function enrollmentResponse(agentId: string, certificate: string, ca: Buffer, keys: readonly object[]) {
  return { version: "device-agent-runtime.v1", agent_id: agentId, gateway_id: agentId, device_id: deviceId, owner_id: ownerId,
    certificate_pem: certificate, certificate_chain_pem: [certificate], ca_bundle_pem: [ca.toString("utf8")],
    certificate_fingerprint_sha256: new X509Certificate(certificate).fingerprint256.replaceAll(":", "").toLowerCase(),
    command_verification: { version: "device-agent-runtime.v1", issuer: "portal-api", audience: "portal-device-agent", keys },
    expires_at: new Date(Date.now() + 86_400_000).toISOString() };
}

async function startMtlsRelay(pki: ReturnType<typeof createPki>, directory: string): Promise<{ url: string; revoke: () => void; peerAuthorized: () => boolean; close: () => Promise<void> }> {
  const server: Server = createServer({ cert: pki.serverCert, key: pki.serverKey, ca: pki.ca, requestCert: true, rejectUnauthorized: true });
  const sockets = new Set<WebSocketPeer>();
  let authorized = false;
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket, request) => {
    authorized = request.socket instanceof TLSSocket && request.socket.authorized;
    sockets.add(socket);
    socket.send(JSON.stringify({ type: "hello_challenge", nonce: "0123456789abcdef0123456789abcdef" }));
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString()) as { type?: string };
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "hello_ack", session_id: "session-1", gateway_id: gatewayId, devices: [{ device_id: deviceId, firmware_class: "klipper" }], heartbeat_interval_seconds: 20, heartbeat_timeout_seconds: 45 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("relay address unavailable");
  return { url: `wss://localhost:${address.port}`, revoke: () => { for (const socket of sockets) socket.close(4004, "gateway_revoked"); }, peerAuthorized: () => authorized,
    close: async () => { for (const socket of sockets) socket.terminate(); await new Promise<void>((resolve) => wss.close(() => server.close(() => resolve()))); void directory; } };
}

async function commandKey(kid: string) {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  const jwk = await exportJWK(pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk: { kid, alg: "EdDSA", kty: "OKP", crv: "Ed25519", x: jwk.x } };
}

function configureKeys(keys: readonly object[]): void {
  process.env.COMMAND_VERIFICATION_KEYS = JSON.stringify({ version: "device-agent-runtime.v1", issuer: "portal-api", audience: "portal-device-agent", keys });
}

async function token(key: KeyLike, kid: string, commandId: string, tokenDeviceId: string, tokenGatewayId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ typ: "command", gateway_id: tokenGatewayId, command_id: commandId, owner_id: ownerId, device_id: tokenDeviceId, role: "owner", command: "pause" })
    .setProtectedHeader({ alg: "EdDSA", kid }).setIssuer("portal-api").setAudience("portal-device-agent").setJti(`jti-${commandId}`).setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 60).sign(key);
}

async function hsToken(commandId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ typ: "command", gateway_id: gatewayId, command_id: commandId, owner_id: ownerId, device_id: deviceId, role: "owner", command: "pause" })
    .setProtectedHeader({ alg: "HS256", kid: "current" }).setIssuer("portal-api").setAudience("portal-device-agent").setJti(`jti-${commandId}`).setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 60).sign(new TextEncoder().encode("legacy-secret"));
}

function commandFrame(commandId: string, sequence: number, commandToken: string) {
  return { type: "command", device_id: deviceId, command_id: commandId, command_seq: sequence, command: "pause", command_token: commandToken, payload: {} } as const;
}

function fakeDriver(): PrinterDriver & { pauseCalls: number } {
  return { firmwareClass: "fake", pauseCalls: 0, connect: async () => undefined, disconnect: async () => undefined,
    capabilities: async () => ({ camera: false, heatedBed: false, heatedChamber: false, multiExtruder: false, supportedCommands: ["pause"], raw: {} }),
    status: async () => ({ status: "ready", nozzleTempC: null, bedTempC: null, chamberTempC: null, progress: null, jobId: null, jobFileName: null, raw: {} }),
    pause: async function () { this.pauseCalls += 1; return { ok: true }; }, resume: async () => ({ ok: false }), cancel: async () => ({ ok: false }), startPrint: async () => ({ ok: false }),
    uploadGcode: async () => ({ ok: false }), camera: async () => null, onStatusUpdate: () => () => undefined };
}

function run(directory: string, args: readonly string[]): void { execFileSync("openssl", args, { cwd: directory, stdio: "ignore" }); }
async function eventually(assertion: () => void): Promise<void> { const deadline = Date.now() + 5_000; while (true) { try { assertion(); return; } catch (error) { if (Date.now() >= deadline) throw error; await new Promise((resolve) => setTimeout(resolve, 10)); } } }
