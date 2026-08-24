import type { Command } from "@portal/contracts/device-protocol/v1";

export const COMMAND_SESSION_PORT = Symbol("COMMAND_SESSION_PORT");

export interface CommandSessionFence {
  readonly gatewayId: string;
  readonly sessionId: string;
  readonly sessionGeneration: number;
  readonly connectionId: string;
  readonly authorizationRevision: number;
}

export interface LiveCommandSession extends CommandSessionFence {
  readonly authorizedDeviceIds: readonly string[];
}

export interface CommandSessionPort {
  listLiveAuthorizedSessions(): readonly LiveCommandSession[];
  isCurrent(session: CommandSessionFence): boolean;
  sendCommand(session: CommandSessionFence, frame: Command): boolean | Promise<boolean>;
}
