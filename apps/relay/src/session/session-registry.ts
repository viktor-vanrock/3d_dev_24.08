import { Injectable } from "@nestjs/common";
import type { AuthorizedDevice } from "@portal/contracts/device-protocol/v1";

export interface SessionSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export interface SessionFence {
  readonly gatewayId: string;
  readonly sessionId: string;
  readonly sessionGeneration: number;
  readonly connectionId: string;
}

export interface GatewaySession extends SessionFence {
  readonly socket: SessionSocket;
  readonly gatewayIdentity: string;
  readonly certificateFingerprintSha256: string;
  authorizationRevision: number;
  authorizedDevices: Map<string, AuthorizedDevice>;
  lastHeartbeatAt: number;
  lastRevalidatedAt: number;
  heartbeatTimeoutMs: number;
  inflightFrames: number;
  rateWindowStartedAt: number;
  rateWindowCount: number;
  closing: boolean;
}

export interface SessionRegistryLimits {
  readonly maxSessions: number;
  readonly maxInflightFrames: number;
  readonly maxInflightFramesPerSession: number;
  readonly maxFramesPerSecond: number;
  readonly maxBufferedBytes: number;
  readonly maxBufferedBytesPerSession: number;
}

export type FrameAdmission = "accepted" | "superseded" | "rate_limited" | "session_busy" | "global_busy";

@Injectable()
export class SessionRegistry {
  private readonly sessions = new Map<string, GatewaySession>();
  private globalInflightFrames = 0;
  private accepting = true;
  private limits: SessionRegistryLimits = {
    maxSessions: 10_000,
    maxInflightFrames: 1_024,
    maxInflightFramesPerSession: 4,
    maxFramesPerSecond: 60,
    maxBufferedBytes: 67_108_864,
    maxBufferedBytesPerSession: 1_048_576,
  };

  configure(limits: SessionRegistryLimits): void {
    this.limits = limits;
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  get isAccepting(): boolean {
    return this.accepting;
  }

  get size(): number {
    return this.sessions.size;
  }

  get inflightFrames(): number {
    return this.globalInflightFrames;
  }

  install(session: GatewaySession): GatewaySession | undefined {
    if (!this.accepting) throw new Error("relay is draining");
    const current = this.sessions.get(session.gatewayId);
    if (!current && this.sessions.size >= this.limits.maxSessions) throw new Error("session capacity reached");
    if (current && session.sessionGeneration <= current.sessionGeneration) throw new Error("session generation is not newer than the current fence");
    this.sessions.set(session.gatewayId, session);
    return current;
  }

  get(gatewayId: string): GatewaySession | undefined {
    return this.sessions.get(gatewayId);
  }

  current(fence: SessionFence): GatewaySession | undefined {
    const session = this.sessions.get(fence.gatewayId);
    return session && this.matches(session, fence) ? session : undefined;
  }

  list(): readonly GatewaySession[] {
    return [...this.sessions.values()];
  }

  remove(fence: SessionFence): GatewaySession | undefined {
    const session = this.current(fence);
    if (!session) return undefined;
    this.sessions.delete(fence.gatewayId);
    return session;
  }

  heartbeat(fence: SessionFence, at: number): boolean {
    const session = this.current(fence);
    if (!session || session.closing) return false;
    session.lastHeartbeatAt = Math.max(session.lastHeartbeatAt, at);
    return true;
  }

  revalidated(fence: SessionFence, revision: number, devices: readonly AuthorizedDevice[], at: number): boolean {
    const session = this.current(fence);
    if (!session || session.closing) return false;
    session.authorizationRevision = revision;
    session.authorizedDevices = new Map(devices.map((device) => [device.device_id, device]));
    session.lastRevalidatedAt = Math.max(session.lastRevalidatedAt, at);
    return true;
  }

  authorizes(fence: SessionFence, deviceId: string): boolean {
    return this.current(fence)?.authorizedDevices.has(deviceId) ?? false;
  }

  beginFrame(fence: SessionFence, now: number): FrameAdmission {
    const session = this.current(fence);
    if (!session || session.closing) return "superseded";
    if (now - session.rateWindowStartedAt >= 1_000) {
      session.rateWindowStartedAt = now;
      session.rateWindowCount = 0;
    }
    session.rateWindowCount += 1;
    if (session.rateWindowCount > this.limits.maxFramesPerSecond) return "rate_limited";
    if (session.inflightFrames >= this.limits.maxInflightFramesPerSession) return "session_busy";
    if (this.globalInflightFrames >= this.limits.maxInflightFrames) return "global_busy";
    session.inflightFrames += 1;
    this.globalInflightFrames += 1;
    return "accepted";
  }

  endFrame(session: GatewaySession): void {
    if (session.inflightFrames === 0) return;
    session.inflightFrames -= 1;
    this.globalInflightFrames = Math.max(0, this.globalInflightFrames - 1);
  }

  send(fence: SessionFence, payload: string): boolean {
    const session = this.current(fence);
    if (!session || session.closing || session.socket.readyState !== 1) return false;
    const payloadBytes = Buffer.byteLength(payload);
    const globalBuffered = this.list().reduce((total, candidate) => total + candidate.socket.bufferedAmount, 0);
    if (
      session.socket.bufferedAmount + payloadBytes > this.limits.maxBufferedBytesPerSession
      || globalBuffered + payloadBytes > this.limits.maxBufferedBytes
    ) {
      return false;
    }
    session.socket.send(payload);
    return true;
  }

  private matches(session: GatewaySession, fence: SessionFence): boolean {
    return session.sessionId === fence.sessionId
      && session.sessionGeneration === fence.sessionGeneration
      && session.connectionId === fence.connectionId;
  }
}
