import { Inject, Injectable } from "@nestjs/common";
import type { Command } from "@portal/contracts/device-protocol/v1";
import type { CommandSessionFence, CommandSessionPort, LiveCommandSession } from "../commands/command-session.port.ts";
import { SessionRegistry } from "./session-registry.ts";

@Injectable()
export class SessionCommandPortAdapter implements CommandSessionPort {
  constructor(@Inject(SessionRegistry) private readonly registry: SessionRegistry) {}

  listLiveAuthorizedSessions(): readonly LiveCommandSession[] {
    return this.registry.list().filter((session) => !session.closing).map((session) => ({
      gatewayId: session.gatewayId,
      sessionId: session.sessionId,
      sessionGeneration: session.sessionGeneration,
      connectionId: session.connectionId,
      authorizationRevision: session.authorizationRevision,
      authorizedDeviceIds: [...session.authorizedDevices.keys()],
    }));
  }

  isCurrent(session: CommandSessionFence): boolean {
    return this.registry.current(session) !== undefined;
  }

  sendCommand(session: CommandSessionFence, frame: Command): boolean {
    if (!this.registry.authorizes(session, frame.device_id)) return false;
    return this.registry.send(session, JSON.stringify(frame));
  }
}
