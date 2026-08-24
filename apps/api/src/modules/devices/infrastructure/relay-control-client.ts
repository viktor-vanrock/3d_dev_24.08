import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  RELAY_CONTROL_CLOSE_SESSIONS_PATH,
  type CloseSessionsResponse,
  type RelayControlCloseReason,
} from "@portal/contracts/http/relay-control.v1";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import type { DeviceRelayPushPort } from "../public/index.ts";

const TIMEOUT_MS = 2_000;

@Injectable()
export class RelayControlClient implements DeviceRelayPushPort {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(RuntimeLogger) private readonly logger: RuntimeLogger,
  ) {}

  async closeAgentSessions(agentIds: readonly string[], reason: RelayControlCloseReason): Promise<void> {
    if (agentIds.length === 0) return;
    const baseUrl = this.config.get<string>("RELAY_INTERNAL_BASE_URL")?.trim();
    if (!baseUrl) {
      this.logger.warn({ event: "relay.control.push_failed", reason }, "relay control endpoint is not configured");
      return;
    }
    const token = this.config.get<string>("RELAY_SERVICE_TOKEN") ?? "";
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}${RELAY_CONTROL_CLOSE_SESSIONS_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-relay-service-token": token },
        body: JSON.stringify({ agentIds, reason }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`relay_control_status_${response.status}`);
      await response.json() as CloseSessionsResponse;
    } catch {
      this.logger.warn({ event: "relay.control.push_failed", reason }, "relay control push failed safely");
    }
  }
}
