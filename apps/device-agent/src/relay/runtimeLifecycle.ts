import type { AgentRuntime } from "../runtime/agentRuntime.ts";
import type { RelayLifecycleEvent } from "./client.ts";

export function applyRelayLifecycleEvent(runtime: AgentRuntime, event: RelayLifecycleEvent, stopRelay: () => void): void {
  if (event.type === "hello_ack") {
    runtime.updateRelay(event.generation, { relay: "ready", admission: "open", status: "degraded", reasonCode: null });
    runtime.healthyIfReady();
  } else if (event.type === "revoked") {
    runtime.updateRelay(event.generation, { relay: "blocked", status: "revoked", admission: "closed", reasonCode: "gateway_revoked" });
    stopRelay();
  } else if (event.type === "authorization_rejected") {
    runtime.updateRelay(event.generation, { relay: "blocked", status: "degraded", admission: "closed", reasonCode: "relay_authorization_rejected" });
  } else if (event.type === "disconnected" || event.type === "backoff") {
    runtime.updateRelay(event.generation, { relay: "down", status: "degraded", admission: "closed", reasonCode: event.type === "backoff" ? "relay_backoff" : "relay_disconnected" });
  } else if (event.type === "connecting" || event.type === "socket_open" || event.type === "hello_challenge") {
    runtime.updateRelay(event.generation, { relay: "starting", status: "degraded", admission: "closed", reasonCode: `relay_${event.type}` });
  } else {
    runtime.updateRelay(event.generation, { relay: "stopping", admission: "closed" });
  }
}
