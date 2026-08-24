import { ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { AgentsRepository, type AgentRow } from "../infrastructure/agents.repository.ts";
import { AGENTS_API_KEYS_PORT, AGENTS_EXTERNAL_PORT, type AgentRequestContext, type AgentsApiKeysPort, type AgentsExternalPort, type AgentsPort } from "../public/index.ts";
function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function serialize(row: AgentRow) {
  return {
    id: row.id,
    name: row.name,
    avatar_s3_key: row.avatar_s3_key,
    bio: row.bio,
    runtime_label: row.runtime_label,
    status: row.status,
    created_at: row.created_at.toISOString(),
    revoked_at: row.revoked_at?.toISOString() ?? null,
  };
}
function beta() {
  return new Set(
    (process.env.AGENT_ACCOUNTS_BETA_USERNAMES ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
}
@Injectable()
export class AgentsService implements AgentsPort {
  constructor(
    @Inject(AgentsRepository) private readonly repository: AgentsRepository,
    @Inject(AGENTS_API_KEYS_PORT) private readonly keys: AgentsApiKeysPort,
    @Inject(AGENTS_EXTERNAL_PORT) private readonly external: AgentsExternalPort,
  ) {}
  private limit(userId: UserId, context: AgentRequestContext) {
    return this.external.assertRateLimit(context.request, userId);
  }
  async create(user: { id: UserId; username: string }, body: Readonly<Record<string, unknown>>, context: AgentRequestContext) {
    if (!beta().has(user.username.toLowerCase())) throw new ForbiddenException();
    await this.limit(user.id, context);
    if (typeof body.name !== "string" || body.name.trim() === "") throw new UnprocessableEntityException();
    const row = await this.repository.create(user.id, {
      name: body.name.trim().slice(0, 80),
      bio: typeof body.bio === "string" ? body.bio.trim().slice(0, 500) || null : null,
      runtimeLabel: typeof body.runtime_label === "string" ? body.runtime_label.trim().slice(0, 200) || null : null,
    });
    return { agent: serialize(row) };
  }
  async list(userId: UserId, query: { limit?: string; offset?: string }, context: AgentRequestContext) {
    await this.limit(userId, context);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));
    const offset = Math.max(0, Number(query.offset) || 0);
    const rows = await this.repository.list(userId, limit + 1, offset);
    const more = rows.length > limit;
    return { agents: (more ? rows.slice(0, limit) : rows).map(serialize), pagination: { limit, offset, has_more: more, next_offset: more ? offset + limit : null } };
  }
  async revoke(userId: UserId, id: string, context: AgentRequestContext) {
    if (!isUuid(id)) throw new NotFoundException();
    await this.limit(userId, context);
    const row = await this.repository.revoke(userId, id);
    if (row === null) throw new NotFoundException();
    await this.keys.revokeAllAgentKeys(id);
    return { agent: serialize(row) };
  }
  async mintKey(userId: UserId, id: string, label: unknown, context: AgentRequestContext) {
    if (!isUuid(id)) throw new NotFoundException();
    await this.limit(userId, context);
    if (!(await this.repository.isActiveOwner(userId, id))) throw new NotFoundException();
    return this.keys.mintAgentKey(userId, id, label);
  }
  async listKeys(userId: UserId, id: string, context: AgentRequestContext) {
    if (!isUuid(id)) throw new NotFoundException();
    await this.limit(userId, context);
    return { keys: await this.keys.listAgentKeys(userId, id) };
  }
  async revokeKey(userId: UserId, id: string, keyId: string, context: AgentRequestContext) {
    if (!isUuid(id) || !isUuid(keyId)) throw new NotFoundException();
    await this.limit(userId, context);
    if (!(await this.keys.revokeAgentKey(userId, id, keyId))) throw new NotFoundException();
  }
}
