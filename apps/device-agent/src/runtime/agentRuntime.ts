import type { AgentHealthStatus } from "../recovery.ts";

export type RuntimeSubstate = "unknown" | "starting" | "ready" | "down" | "blocked" | "stopping";

export interface AgentRuntimeSnapshot {
  readonly schema: "health.v1";
  readonly revision: number;
  readonly status: AgentHealthStatus;
  readonly moonraker: RuntimeSubstate;
  readonly relay: RuntimeSubstate;
  readonly relayGeneration: number | null;
  readonly admission: "open" | "closed";
  readonly shutdown: "running" | "stopping" | "stopped";
  readonly reasonCode: string | null;
  readonly agentVersion: string;
  readonly agentCommitSha: string;
}

export class AgentRuntime {
  private snapshotValue: AgentRuntimeSnapshot;
  private readonly listeners = new Set<(snapshot: AgentRuntimeSnapshot) => void>();

  constructor(buildInfo: { readonly version: string; readonly commitSha: string } = { version: "invalid", commitSha: "0000000" }) {
    this.snapshotValue = {
      schema: "health.v1", revision: 0, status: "degraded", moonraker: "unknown",
      relay: "unknown", relayGeneration: null, admission: "closed", shutdown: "running", reasonCode: null,
      agentVersion: buildInfo.version, agentCommitSha: buildInfo.commitSha,
    };
  }

  get snapshot(): AgentRuntimeSnapshot { return this.snapshotValue; }

  subscribe(listener: (snapshot: AgentRuntimeSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(patch: Partial<Omit<AgentRuntimeSnapshot, "schema" | "revision">>): AgentRuntimeSnapshot {
    const candidate = { ...this.snapshotValue, ...patch, revision: this.snapshotValue.revision + 1 };
    const remoteBlocked = candidate.status === "blocked_config" || candidate.status === "revoked" || candidate.shutdown !== "running";
    this.snapshotValue = remoteBlocked ? { ...candidate, admission: "closed" } : candidate;
    for (const listener of this.listeners) listener(this.snapshotValue);
    return this.snapshotValue;
  }

  updateRelay(generation: number, patch: Partial<Omit<AgentRuntimeSnapshot, "schema" | "revision" | "relayGeneration">>): AgentRuntimeSnapshot {
    if (this.snapshotValue.relayGeneration !== null && generation < this.snapshotValue.relayGeneration) return this.snapshotValue;
    return this.update({ ...patch, relayGeneration: generation });
  }

  healthyIfReady(): AgentRuntimeSnapshot {
    const current = this.snapshotValue;
    if (current.moonraker === "ready" && current.relay === "ready" && current.admission === "open") {
      return this.update({ status: "healthy", reasonCode: null });
    }
    return current;
  }
}
