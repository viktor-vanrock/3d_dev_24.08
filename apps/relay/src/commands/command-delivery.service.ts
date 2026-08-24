import { randomUUID } from "node:crypto";
import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { Command, CommandAck, CommandResult } from "@portal/contracts/device-protocol/v1";
import type { RelayClaimedCommandDto } from "@portal/contracts/http/relay-internal.v1.dto";
import { RelayApiClient } from "../api/relay-api-client.service.ts";
import { RELAY_CONFIG, type RelayConfig } from "../config/relay-config.ts";
import { RelayLogger } from "../observability/relay-logger.ts";
import { RelayMetrics } from "../observability/metrics.service.ts";
import { COMMAND_SESSION_PORT, type CommandSessionFence, type CommandSessionPort, type LiveCommandSession } from "./command-session.port.ts";

export const COMMAND_DELIVERY_OPTIONS = Symbol("COMMAND_DELIVERY_OPTIONS");

export interface CommandDeliveryOptions {
  readonly claimBatchSize: number;
  readonly maxConcurrentCommands: number;
  readonly claimIntervalMs: number;
  readonly leaseHeartbeatMs: number;
  readonly commandTimeoutMs: number;
  readonly completedLedgerSize: number;
}

const DEFAULT_OPTIONS: CommandDeliveryOptions = {
  claimBatchSize: 25,
  maxConcurrentCommands: 100,
  claimIntervalMs: 500,
  leaseHeartbeatMs: 5_000,
  commandTimeoutMs: 120_000,
  completedLedgerSize: 1_000,
};

type DeliveryState = "leased" | "delivered" | "acknowledged";
type TerminalStatus = "executed" | "failed";

interface ActiveCommand {
  readonly command: RelayClaimedCommandDto;
  readonly session: CommandSessionFence;
  readonly terminalOperationId: string;
  readonly completion: Promise<void>;
  resolveCompletion(): void;
  deliveryState: DeliveryState;
  leaseTimer?: NodeJS.Timeout;
  timeoutTimer?: NodeJS.Timeout;
  stateTransition?: Promise<boolean>;
  terminalWrite?: Promise<CommandFrameOutcome>;
  terminalIntent?: CompletedResult;
  closed: boolean;
}

interface CompletedResult {
  readonly commandSeq: number;
  readonly status: TerminalStatus;
  readonly errorCode?: string;
  readonly session: CommandSessionFence;
}

export interface CommandFrameOutcome {
  readonly accepted: boolean;
  readonly replayed: boolean;
}

@Injectable()
export class CommandDeliveryService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly activeByCommand = new Map<string, ActiveCommand>();
  private readonly activeByDevice = new Map<string, string>();
  private readonly completed = new Map<string, CompletedResult>();
  private readonly options: CommandDeliveryOptions;
  private claimTimer: NodeJS.Timeout | undefined;
  private claiming = false;
  private acceptingClaims = false;

  constructor(
    @Inject(RelayApiClient) private readonly api: RelayApiClient,
    @Inject(COMMAND_SESSION_PORT) private readonly sessions: CommandSessionPort,
    @Inject(RELAY_CONFIG) private readonly config: RelayConfig,
    @Inject(RelayMetrics) private readonly metrics: RelayMetrics,
    @Inject(RelayLogger) private readonly logger: RelayLogger,
    @Inject(COMMAND_DELIVERY_OPTIONS) options: Partial<CommandDeliveryOptions> = {},
  ) {
    this.options = this.validateOptions({ ...DEFAULT_OPTIONS, ...options });
  }

  get activeCount(): number {
    return this.activeByCommand.size;
  }

  start(): void {
    if (this.acceptingClaims) return;
    this.acceptingClaims = true;
    this.claimTimer = setInterval(() => void this.claimOnce(), this.options.claimIntervalMs);
    this.claimTimer.unref();
    void this.claimOnce();
  }

  onApplicationBootstrap(): void {
    this.start();
  }

  stopClaiming(): void {
    this.acceptingClaims = false;
    if (this.claimTimer) clearInterval(this.claimTimer);
    this.claimTimer = undefined;
  }

  async drain(timeoutMs: number): Promise<boolean> {
    this.stopClaiming();
    const active = [...this.activeByCommand.values()];
    if (active.length === 0) return true;
    let timer: NodeJS.Timeout | undefined;
    const drained = await Promise.race([
      Promise.all(active.map((entry) => entry.completion)).then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!drained) {
      for (const entry of [...this.activeByCommand.values()]) this.releaseForReclaim(entry, "drain_timeout");
    }
    return drained;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drain(this.config.gateway.shutdownDrainMs);
  }

  async claimOnce(): Promise<number> {
    if (!this.acceptingClaims || this.claiming) return 0;
    const capacity = this.options.maxConcurrentCommands - this.activeByCommand.size;
    if (capacity <= 0) return 0;
    this.claiming = true;
    let accepted = 0;
    try {
      for (const session of this.sessions.listLiveAuthorizedSessions()) {
        if (!this.acceptingClaims || accepted >= capacity || !this.sessions.isCurrent(session) || session.authorizedDeviceIds.length === 0) continue;
        const limit = Math.min(this.options.claimBatchSize, capacity - accepted);
        const response = await this.api.v1.relayCommandsClaim({
          headers: { "x-correlation-id": randomUUID(), "x-operation-id": randomUUID() },
          body: {
            gateway_id: session.gatewayId,
            session_id: session.sessionId,
            session_generation: session.sessionGeneration,
            authorization_revision: session.authorizationRevision,
            claim_owner: this.config.instanceId,
            limit,
          },
        });
        if (!this.sessions.isCurrent(session)) continue;
        for (const command of response.commands) {
          if (accepted >= capacity) break;
          if (this.accept(command, session)) accepted += 1;
        }
      }
      return accepted;
    } catch {
      this.logger.warn({ event: "relay_command_claim_failed", outcome: "error" }, "command claim failed safely");
      return accepted;
    } finally {
      this.claiming = false;
    }
  }

  async handleAcknowledged(session: CommandSessionFence, frame: CommandAck): Promise<CommandFrameOutcome> {
    const entry = this.matchActive(session, frame.device_id, frame.command_id, frame.command_seq);
    if (!entry || entry.terminalIntent) return { accepted: false, replayed: false };
    if (entry.deliveryState === "acknowledged") return { accepted: true, replayed: true };
    const updated = await this.persistDeliveryState(entry, "acknowledged");
    return { accepted: updated, replayed: false };
  }

  async handleResult(session: CommandSessionFence, frame: CommandResult): Promise<CommandFrameOutcome> {
    const previous = this.completed.get(frame.command_id);
    const errorCode = frame.outcome === "failed" ? this.toApiErrorCode(frame.error_code) : undefined;
    if (previous?.commandSeq === frame.command_seq && previous.status === frame.outcome && previous.errorCode === errorCode
      && this.sameSession(previous.session, session) && this.sessions.isCurrent(session)) {
      return { accepted: true, replayed: true };
    }
    const entry = this.matchActive(session, frame.device_id, frame.command_id, frame.command_seq);
    if (!entry) return { accepted: false, replayed: false };
    return this.persistTerminal(entry, frame.outcome, errorCode);
  }

  handleDisconnect(session: CommandSessionFence): void {
    for (const entry of [...this.activeByCommand.values()]) {
      if (this.sameSession(entry.session, session)) this.releaseForReclaim(entry, "session_disconnected");
    }
  }

  private accept(command: RelayClaimedCommandDto, session: LiveCommandSession): boolean {
    if (!session.authorizedDeviceIds.includes(command.device_id)) return false;
    if (this.activeByCommand.has(command.command_id) || this.activeByDevice.has(command.device_id)) return false;
    let resolveCompletion = (): void => undefined;
    const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
    const entry: ActiveCommand = {
      command,
      session,
      terminalOperationId: randomUUID(),
      completion,
      resolveCompletion,
      deliveryState: "leased",
      closed: false,
    };
    this.activeByCommand.set(command.command_id, entry);
    this.activeByDevice.set(command.device_id, command.command_id);
    this.metrics.recordCommand("claimed", "accepted");
    entry.leaseTimer = setInterval(() => void this.persistDeliveryState(entry, entry.deliveryState), this.options.leaseHeartbeatMs);
    entry.leaseTimer.unref();
    entry.timeoutTimer = setTimeout(() => void this.persistTerminal(entry, "failed", "timeout"), this.options.commandTimeoutMs);
    entry.timeoutTimer.unref();
    void this.deliver(entry);
    return true;
  }

  private async deliver(entry: ActiveCommand): Promise<void> {
    try {
      const sent = await this.sessions.sendCommand(entry.session, this.toWireCommand(entry.command));
      if (!sent || !this.sessions.isCurrent(entry.session)) {
        this.releaseForReclaim(entry, "session_unavailable");
        return;
      }
      await this.persistDeliveryState(entry, "delivered");
    } catch {
      this.releaseForReclaim(entry, "send_failed");
    }
  }

  private async persistDeliveryState(entry: ActiveCommand, state: DeliveryState): Promise<boolean> {
    if (entry.closed || !this.sessions.isCurrent(entry.session)) return false;
    if (entry.stateTransition) {
      const previousAccepted = await entry.stateTransition;
      if (!previousAccepted || entry.closed) return false;
      if (this.deliveryRank(entry.deliveryState) >= this.deliveryRank(state)) return true;
      return this.persistDeliveryState(entry, state);
    }
    const transition = (async (): Promise<boolean> => {
      try {
        const response = await this.api.v1.relayCommandLeaseHeartbeat({
          headers: { "x-correlation-id": randomUUID(), "x-operation-id": randomUUID() },
          path: { commandId: entry.command.command_id },
          body: {
            claim_owner: entry.command.claim_owner,
            claim_token: entry.command.claim_token,
            generation: entry.command.generation,
            delivery_state: state,
            observed_at: new Date().toISOString(),
          },
        });
        if (entry.closed) return false;
        entry.deliveryState = response.status;
        if (state === "delivered" || state === "acknowledged") this.metrics.recordCommand(state, response.replayed ? "replayed" : "accepted");
        return true;
      } catch {
        this.releaseForReclaim(entry, "lease_rejected");
        return false;
      } finally {
        entry.stateTransition = undefined;
      }
    })();
    entry.stateTransition = transition;
    return transition;
  }

  private async persistTerminal(entry: ActiveCommand, status: TerminalStatus, errorCode?: string): Promise<CommandFrameOutcome> {
    if (entry.closed || !this.sessions.isCurrent(entry.session)) return { accepted: false, replayed: false };
    if (entry.terminalWrite) {
      if (entry.terminalIntent?.status !== status || entry.terminalIntent.errorCode !== errorCode) return { accepted: false, replayed: false };
      return entry.terminalWrite;
    }
    entry.terminalIntent = { commandSeq: entry.command.command_seq, status, ...(errorCode ? { errorCode } : {}), session: entry.session };
    const write = (async (): Promise<CommandFrameOutcome> => {
      try {
        if (entry.stateTransition && !await entry.stateTransition) return { accepted: false, replayed: false };
        if (entry.closed || !this.sessions.isCurrent(entry.session)) return { accepted: false, replayed: false };
        const response = await this.api.v1.relayCommandResult({
          headers: { "x-correlation-id": randomUUID(), "x-operation-id": entry.terminalOperationId },
          path: { commandId: entry.command.command_id },
          body: {
            claim_owner: entry.command.claim_owner,
            claim_token: entry.command.claim_token,
            generation: entry.command.generation,
            command_seq: entry.command.command_seq,
            status,
            ...(errorCode ? { error_code: errorCode as "timeout" | "disconnected" | "command_failed" | "command_not_supported" | "role_not_allowed" | "replay_rejected" | "invalid_token" | "device_not_owned" | "device_revoked" | "blocked_config" | "driver_error" | "internal_error" } : {}),
            observed_at: new Date().toISOString(),
          },
        });
        this.rememberCompleted(entry.command.command_id, {
          commandSeq: entry.command.command_seq,
          status,
          ...(errorCode ? { errorCode } : {}),
          session: entry.session,
        });
        this.finish(entry);
        this.metrics.recordCommand(status, response.replayed ? "replayed" : "accepted");
        return { accepted: true, replayed: response.replayed };
      } catch {
        this.releaseForReclaim(entry, "terminal_rejected");
        return { accepted: false, replayed: false };
      }
    })();
    entry.terminalWrite = write;
    return write;
  }

  private matchActive(session: CommandSessionFence, deviceId: string, commandId: string, commandSeq: number): ActiveCommand | undefined {
    const entry = this.activeByCommand.get(commandId);
    if (!entry || entry.closed || !this.sameSession(entry.session, session) || !this.sessions.isCurrent(session)) return undefined;
    if (entry.command.device_id !== deviceId || entry.command.command_seq !== commandSeq) return undefined;
    return entry;
  }

  private releaseForReclaim(entry: ActiveCommand, reason: string): void {
    if (entry.closed) return;
    this.logger.warn({ event: "relay_command_released_for_reclaim", gateway_id: entry.session.gatewayId, device_id: entry.command.device_id, command_id: entry.command.command_id, outcome: "reclaimable", reason }, "command lease left reclaimable");
    this.finish(entry);
  }

  private finish(entry: ActiveCommand): void {
    if (entry.closed) return;
    entry.closed = true;
    if (entry.leaseTimer) clearInterval(entry.leaseTimer);
    if (entry.timeoutTimer) clearTimeout(entry.timeoutTimer);
    this.activeByCommand.delete(entry.command.command_id);
    if (this.activeByDevice.get(entry.command.device_id) === entry.command.command_id) this.activeByDevice.delete(entry.command.device_id);
    entry.resolveCompletion();
  }

  private rememberCompleted(commandId: string, result: CompletedResult): void {
    this.completed.delete(commandId);
    this.completed.set(commandId, result);
    while (this.completed.size > this.options.completedLedgerSize) {
      const oldest = this.completed.keys().next().value as string | undefined;
      if (!oldest) break;
      this.completed.delete(oldest);
    }
  }

  private toWireCommand(command: RelayClaimedCommandDto): Command {
    const common = {
      type: "command" as const,
      device_id: command.device_id,
      command_id: command.command_id,
      command_seq: command.command_seq,
      command_token: command.command_token,
    };
    if (command.payload.command === "start") {
      if (!command.payload.file_name) throw new Error("start command is missing file_name");
      return { ...common, command: "start", payload: { file_name: command.payload.file_name } };
    }
    return { ...common, command: command.payload.command, payload: {} };
  }

  private toApiErrorCode(code: Extract<CommandResult, { readonly outcome: "failed" }>["error_code"]): string {
    const mapping: Record<typeof code, string> = {
      device_not_authorized: "device_not_owned",
      device_unavailable: "disconnected",
      command_not_supported: "command_not_supported",
      role_not_allowed: "role_not_allowed",
      replay_rejected: "replay_rejected",
      invalid_command: "command_failed",
      invalid_command_token: "invalid_token",
      command_failed: "command_failed",
      command_timeout: "timeout",
    };
    return mapping[code];
  }

  private sameSession(left: CommandSessionFence, right: CommandSessionFence): boolean {
    return left.gatewayId === right.gatewayId
      && left.sessionId === right.sessionId
      && left.sessionGeneration === right.sessionGeneration
      && left.connectionId === right.connectionId;
  }

  private deliveryRank(state: DeliveryState): number {
    return state === "leased" ? 0 : state === "delivered" ? 1 : 2;
  }

  private validateOptions(options: CommandDeliveryOptions): CommandDeliveryOptions {
    for (const [name, value] of Object.entries(options)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
    }
    if (options.claimBatchSize > 100 || options.maxConcurrentCommands > 10_000) throw new Error("command delivery bounds exceed safe limits");
    return options;
  }
}
