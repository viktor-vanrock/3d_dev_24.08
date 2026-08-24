import type { PrinterCommand, PrinterStatusSnapshot } from "./driver/printerDriver.ts";
import { loadAgentCredentials } from "./credentials.ts";
import { RelayClient } from "./relay/client.ts";
import type { HeartbeatDeviceUpdate, ProtocolCapability } from "./relay/protocol.ts";
import { FileTransferHandler } from "./relay/fileTransfer.ts";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { validateAgentHome } from "./recovery.ts";
import { CommandHandler } from "./relay/commandHandler.ts";
import { commandTerminalLedgerPath, FileCommandTerminalLedger } from "./relay/commandTerminalLedger.ts";
import { AgentRuntime } from "./runtime/agentRuntime.ts";
import { loadAgentBuildInfo, relayIdentityVersion } from "./buildInfo.ts";
import { composeDeviceAgentConnectorFromEnvironment } from "./connector/composition.ts";
import type { ConnectorLifecycle } from "./connector/registry.ts";
import { commandTrustStatus } from "./recovery.ts";
import { projectHealth } from "./runtime/health.ts";
import { applyRelayLifecycleEvent } from "./relay/runtimeLifecycle.ts";
import { enrollDeviceAgent } from "./enrollmentClient.ts";

const buildInfo = loadAgentBuildInfo();
if (process.argv.includes("--preflight")) {
  if (!buildInfo) throw new Error("embedded version and commit SHA are required");
  process.stdout.write(`${JSON.stringify({ schema: "device-agent.preflight.v1", ...buildInfo, nodeMajor: Number(process.versions.node.split(".")[0]) })}\n`);
  process.exit(0);
}
if (process.argv.includes("--enroll") || process.argv.includes("--recover")) {
  if (!buildInfo) throw new Error("embedded version and commit SHA are required");
  const home = process.env.MULTICA_AGENT_HOME ?? `${process.env.HOME ?? "/root"}/.3mf-agent`;
  const enrollment = await enrollDeviceAgent({
    apiUrl: process.env.MULTICA_API_URL ?? "",
    code: process.env.MULTICA_ENROLL_CODE ?? "",
    agentVersion: buildInfo.version,
    home,
    recovery: process.argv.includes("--recover"),
  });
  process.stdout.write(`${JSON.stringify({ version: enrollment.version, gateway_id: enrollment.gateway_id, device_id: enrollment.device_id })}\n`);
  process.exit(0);
}

const relayUrl = process.env.RELAY_URL;
if (!relayUrl) {
  // Тот же паттерн: относительное "no-op с warn" — драйвер против Moonraker продолжает работать
  // локально (полезно при разработке против голого MOONRAKER_URL без развёрнутого relay), просто
  // без push в веб.
  console.warn("RELAY_URL не задан — device-agent не пушит телеметрию в relay (apps/relay/readme.md)");
}

let relay: RelayClient | null = null;
let connectorLifecycle: ConnectorLifecycle | null = null;
let commandHandler: CommandHandler | null = null;
let fileTransferHandler: FileTransferHandler | null = null;
const runtime = new AgentRuntime(buildInfo ?? undefined);

const healthPort = Number(process.env.AGENT_HEALTH_PORT ?? "9797");
const healthServer = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  const health = projectHealth(runtime.snapshot);
  response.writeHead(health.status === "blocked_config" || health.status === "revoked" ? 503 : 200, { "content-type": "application/json" });
  response.end(JSON.stringify(health));
});
healthServer.listen(healthPort, "127.0.0.1");

// PrinterStatusSnapshot.progress — 0..1 (printerDriver.ts), device_state/device_telemetry.progress
// — 0..100 (numeric(5,2), device_fleet_foundation.sql check-констрейнт) — конвертация здесь, на
// стороне продюсера, relay/api метрики не интерпретируют (protocol.ts).
function toHeartbeatUpdate(deviceId: string, snapshot: PrinterStatusSnapshot): HeartbeatDeviceUpdate {
  return {
    id: deviceId,
    status: snapshot.status,
    progress: snapshot.progress === null ? null : Math.round(snapshot.progress * 10_000) / 100,
    metrics: {
      nozzleTempC: snapshot.nozzleTempC,
      bedTempC: snapshot.bedTempC,
      chamberTempC: snapshot.chamberTempC,
      jobId: snapshot.jobId,
      jobFileName: snapshot.jobFileName,
    },
  };
}

const COMMAND_CAPABILITY: Record<PrinterCommand, ProtocolCapability> = {
  pause: "cmd.pause",
  resume: "cmd.resume",
  cancel: "cmd.cancel",
  start: "cmd.start",
};

async function main(): Promise<void> {
  if (!buildInfo) {
    runtime.update({ status: "blocked_config", admission: "closed", reasonCode: "invalid_build_metadata" });
    console.error("device-agent: embedded version and commit SHA are required");
    return;
  }
  let connector;
  try {
    connector = composeDeviceAgentConnectorFromEnvironment(process.env);
  } catch (error) {
    runtime.update({ status: "blocked_config", moonraker: "blocked", admission: "closed", reasonCode: "invalid_connector_config" });
    console.error("device-agent: connector configuration is invalid", error);
    return;
  }
  const driver = connector.driver;
  connectorLifecycle = connector.lifecycle;
  try {
    await connector.lifecycle.connect();
  } catch (error) {
    runtime.update({ status: "degraded", moonraker: "down", relay: relayUrl ? "down" : "unknown", admission: "closed", reasonCode: "moonraker_unavailable" });
    console.error("device-agent: connector is unavailable", error);
    return;
  }
  runtime.update({
    moonraker: "ready",
    relay: relayUrl ? "starting" : "down",
    status: "degraded",
    admission: "closed",
    reasonCode: relayUrl ? "relay_connecting" : "relay_not_configured",
  });
  console.log("device-agent: connector ready", connector.type);

  const capabilities = await driver.capabilities();
  console.log("device-agent: capabilities", capabilities);

  const status = await driver.status();
  console.log("device-agent: status", status);

  if (relayUrl) {
    const home = process.env.MULTICA_AGENT_HOME ?? `${process.env.HOME ?? "/root"}/.3mf-agent`;
    const valid = validateAgentHome(home);
    if (!valid.ok) {
      runtime.update({ status: "blocked_config", reasonCode: "invalid_agent_home" });
      console.error(`device-agent: ${valid.reason}`);
      return;
    }
    let credentials;
    try {
      credentials = loadAgentCredentials(home);
    } catch (err) {
      runtime.update({ status: "blocked_config", reasonCode: "invalid_credentials" });
      console.error("device-agent: invalid credentials; commands and relay are disabled", err);
      return;
    }
    const trust = commandTrustStatus();
    if (trust.status === "blocked_config") {
      runtime.update({ status: "blocked_config", admission: "closed", reasonCode: trust.reason });
      console.error("device-agent: command verification material is invalid or missing");
      return;
    }
    if (!driver.identity) {
      runtime.update({ status: "blocked_config", admission: "closed", reasonCode: "connector_identity_unavailable" });
      console.error("device-agent: selected connector does not provide identity.v1");
      return;
    }
    const identity = await driver.identity(credentials.deviceId, buildInfo.version);
    const tlsCertFile = process.env.RELAY_TLS_CERT_FILE ?? `${home}/gateway-certificate.pem`;
    const tlsKeyFile = process.env.RELAY_TLS_KEY_FILE ?? `${home}/gateway-key.pem`;
    const tlsCAFile = process.env.RELAY_TLS_CA_FILE ?? `${home}/gateway-ca.pem`;
    if (!tlsCertFile || !tlsKeyFile || !tlsCAFile) {
      runtime.update({ status: "blocked_config", reasonCode: "missing_tls_material" });
      console.error("device-agent: RELAY_TLS_CERT_FILE, RELAY_TLS_KEY_FILE and RELAY_TLS_CA_FILE are required");
      return;
    }
    const inspectFile = driver.inspectFile?.bind(driver);
    const fileTransfer = new FileTransferHandler(driver, credentials.deviceId, `${home}/transfers`, {
      gatewayId: credentials.agentId,
      authorize: () => runtime.snapshot.admission === "open" && runtime.snapshot.status === "healthy",
      ...(inspectFile === undefined ? {} : {
        reconcileUpload: ({ remoteFileName, root }) => inspectFile({ fileName: remoteFileName, root }),
      }),
    });
    fileTransferHandler = fileTransfer;
    const commandLedger = new FileCommandTerminalLedger(commandTerminalLedgerPath(home));
    const commands = new CommandHandler(driver, credentials.deviceId, () => runtime.snapshot.status, console.warn, commandLedger, undefined, credentials.agentId);
    commandHandler = commands;
    const protocolCapabilities: ProtocolCapability[] = ["file_transfer"];
    if (capabilities.camera) protocolCapabilities.push("camera");
    if (capabilities.heatedBed) protocolCapabilities.push("heated_bed");
    if (capabilities.heatedChamber) protocolCapabilities.push("heated_chamber");
    if (capabilities.multiExtruder) protocolCapabilities.push("multi_extruder");
    for (const command of capabilities.supportedCommands) protocolCapabilities.push(COMMAND_CAPABILITY[command]);
    const relayClient = new RelayClient({
      url: relayUrl,
      agentVersion: relayIdentityVersion(buildInfo),
      capabilities: protocolCapabilities,
      ...(identity.model === null ? {} : { printerModel: identity.model }),
      firmwareClass: driver.firmwareClass,
      cert: readFileSync(tlsCertFile),
      key: readFileSync(tlsKeyFile),
      ca: readFileSync(tlsCAFile),
      onCommand: async (frame) => {
        return commands.handle(frame);
      },
      onFileStart: (frame) => fileTransfer.start(frame),
      onFileChunk: (frame) => fileTransfer.chunk(frame),
      onLifecycle: (event) => {
        applyRelayLifecycleEvent(runtime, event, () => { relayClient.disconnect(); });
      },
    });
    relay = relayClient;
    relayClient.connect();
    runtime.update({ relay: "starting", admission: "closed", status: "degraded", reasonCode: "relay_connecting" });

    driver.onStatusUpdate((snapshot) => {
      relayClient.pushStatus({
        ...toHeartbeatUpdate(credentials.deviceId, snapshot),
        identity,
      });
    });
    relayClient.pushStatus({
      ...toHeartbeatUpdate(credentials.deviceId, status),
      identity,
    });
    // `ready` is an internal lifecycle event; expose only the versioned health
    // contract to operators and relay consumers.
    // RelayClient becomes ready only after hello_ack; keep degraded until then.
  } else {
    driver.onStatusUpdate((snapshot) => {
      console.log("device-agent: push status update (relay выключен)", snapshot.status, snapshot.progress);
    });
  }
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadlineMs = Number(process.env.AGENT_SHUTDOWN_DEADLINE_MS ?? "10000");
  runtime.update({ status: "degraded", admission: "closed", shutdown: "stopping", reasonCode: "shutting_down" });
  relay?.disconnect();
  const closeHealth = new Promise<void>((resolve) => healthServer.close(() => { resolve(); }));
  const operations = Promise.all([
    commandHandler?.shutdown(deadlineMs) ?? Promise.resolve(true),
    fileTransferHandler?.shutdown(deadlineMs) ?? Promise.resolve(true),
  ]);
  const resources = Promise.all([operations, connectorLifecycle?.disconnect() ?? Promise.resolve(), closeHealth]);
  await Promise.race([resources, new Promise<void>((resolve) => setTimeout(resolve, deadlineMs))]);
  runtime.update({ shutdown: "stopped", moonraker: "stopping", relay: "stopping", admission: "closed" });
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}

main().catch((err: unknown) => {
  console.error("device-agent: fatal", err);
  process.exit(1);
});
