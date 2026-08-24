import { Global, HttpException, Inject, Injectable, Module } from "@nestjs/common";
import type { Request } from "express";
import { checkRateLimit, serializeRateLimitMetadata } from "../../modules/security/public/index.ts";
import { AGENTS_API_KEYS_PORT, AGENTS_EXTERNAL_PORT, type AgentsApiKeysPort, type AgentsExternalPort } from "../../modules/agents/public/index.ts";
import type { UserId } from "../../modules/_kernel/brandedIds.ts";
import { PublicApiModule } from "../../modules/publicapi/publicapi.module.ts";
import { AGENT_API_KEYS_PORT, type AgentApiKeysPort } from "../../modules/publicapi/public/index.ts";
import { getRequestId, type RequestWithId } from "../observability/request-id.ts";
@Injectable()
export class AgentsExternalAdapter implements AgentsExternalPort {
  async assertRateLimit(request: Request, userId: UserId) {
    const outcome = checkRateLimit({ ip: request.ip ?? request.socket.remoteAddress ?? "unknown", headers: request.headers }, "public_api", userId);
    const response = request.res;
    for (const [name, value] of Object.entries(serializeRateLimitMetadata(outcome, getRequestId(request as RequestWithId)))) response?.setHeader(name, value);
    if (outcome.limited) {
      response?.setHeader("Retry-After", String(outcome.retryAfterSeconds ?? 60));
      throw new HttpException({}, 429);
    }
    if (outcome.slowdownMs && outcome.slowdownMs > 0) await new Promise((resolve) => setTimeout(resolve, outcome.slowdownMs));
  }
}
@Injectable()
export class AgentsApiKeysAdapter implements AgentsApiKeysPort {
  constructor(@Inject(AGENT_API_KEYS_PORT) private readonly keys: AgentApiKeysPort) {}
  mintAgentKey(...args: Parameters<AgentsApiKeysPort["mintAgentKey"]>) {
    return this.keys.mintAgentKey(...args);
  }
  listAgentKeys(...args: Parameters<AgentsApiKeysPort["listAgentKeys"]>) {
    return this.keys.listAgentKeys(...args);
  }
  revokeAgentKey(...args: Parameters<AgentsApiKeysPort["revokeAgentKey"]>) {
    return this.keys.revokeAgentKey(...args);
  }
  hasAgentKey(...args: Parameters<AgentsApiKeysPort["hasAgentKey"]>) {
    return this.keys.hasAgentKey(...args);
  }
  revokeAllAgentKeys(...args: Parameters<AgentsApiKeysPort["revokeAllAgentKeys"]>) {
    return this.keys.revokeAllAgentKeys(...args);
  }
}
@Global()
@Module({
  imports: [PublicApiModule],
  providers: [
    AgentsExternalAdapter,
    AgentsApiKeysAdapter,
    { provide: AGENTS_EXTERNAL_PORT, useExisting: AgentsExternalAdapter },
    { provide: AGENTS_API_KEYS_PORT, useExisting: AgentsApiKeysAdapter },
  ],
  exports: [AGENTS_EXTERNAL_PORT, AGENTS_API_KEYS_PORT],
})
export class AgentsIntegrationModule {}
