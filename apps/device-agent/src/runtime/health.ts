import { isDeviceAgentHealthV1, type DeviceAgentHealthV1 } from "@portal/contracts/device-agent-runtime/v1";

import type { AgentRuntimeSnapshot, RuntimeSubstate } from "./agentRuntime.ts";

function moonrakerState(state: RuntimeSubstate): DeviceAgentHealthV1["moonraker"]["state"] {
  switch (state) {
    case "ready": return "ready";
    case "starting": return "connecting";
    case "stopping": return "stopped";
    case "unknown": return "not_configured";
    case "blocked":
    case "down": return "unavailable";
  }
}

function relayState(snapshot: AgentRuntimeSnapshot): DeviceAgentHealthV1["relay"]["state"] {
  if (snapshot.status === "revoked") return "revoked";
  if (snapshot.reasonCode === "relay_not_configured") return "not_configured";
  if (snapshot.reasonCode === "relay_socket_open") return "socket_open";
  if (snapshot.reasonCode === "relay_hello_challenge") return "authorizing";
  if (snapshot.reasonCode === "relay_backoff") return "backoff";
  if (snapshot.reasonCode === "relay_authorization_rejected") return "rejected";
  if (snapshot.relay === "ready") return "authorized";
  if (snapshot.relay === "stopping") return "stopped";
  if (snapshot.relay === "unknown" || snapshot.relay === "down") return "not_configured";
  return "connecting";
}

export function projectHealth(snapshot: AgentRuntimeSnapshot): DeviceAgentHealthV1 {
  const health: DeviceAgentHealthV1 = {
    version: "health.v1",
    status: snapshot.status,
    revision: snapshot.revision,
    agent_version: snapshot.agentVersion,
    agent_commit_sha: snapshot.agentCommitSha,
    reason_code: snapshot.reasonCode,
    moonraker: { state: moonrakerState(snapshot.moonraker) },
    relay: { state: relayState(snapshot), connection_generation: snapshot.relayGeneration },
  };
  if (!isDeviceAgentHealthV1(health)) throw new Error("invalid health.v1 projection");
  return health;
}

