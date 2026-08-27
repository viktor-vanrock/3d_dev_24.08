import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  RELAY_CONTROL_CLOSE_SESSIONS_PATH,
  type CloseSessionsResponse,
  type RelayControlCloseReason,
} from "@portal/contracts/http/relay-control.v1";
import { RuntimeLogger } from "../../../nest/observability/runtime-logger.ts";
import { MetricsService } from "../../../nest/observability/metrics.service.ts";
import type { DeviceRelayPushPort } from "../public/index.ts";

const TIMEOUT_MS = 2_000;

@Injectable()
export class RelayControlClient implements DeviceRelayPushPort {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(RuntimeLogger) private readonly logger: RuntimeLogger,
    @Inject(MetricsService) private readonly metrics: MetricsService,
  ) {}

  async closeAgentSessions(agentIds: readonly string[], reason: RelayControlCloseReason): Promise<CloseSessionsResponse> {
    if (agentIds.length === 0) return { closed: [], notConnected: [] };
    const baseUrl = this.config.get<string>("RELAY_INTERNAL_BASE_URL")?.trim();
    if (!baseUrl) {
      this.metrics.incRelayPushClose("failed");
      this.logger.warn({ event: "relay.control.push_failed", reason }, "relay control endpoint is not configured");
      throw new Error("relay_control_not_configured");
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
      const result = await response.json() as CloseSessionsResponse;
      for (const _agentId of result.closed) this.metrics.incRelayPushClose("sent");
      for (const _agentId of result.notConnected) this.metrics.incRelayPushClose("agent_not_connected");
      return result;
    } catch (error) {
      this.metrics.incRelayPushClose("failed");
      this.logger.warn({ event: "relay.control.push_failed", reason }, "relay control push failed safely");
      throw error;
    }
  }
}
