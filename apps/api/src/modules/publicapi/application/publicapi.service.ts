import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { UserId, type UserId as UserIdType } from "../../_kernel/brandedIds.ts";
import { PROFILE_AUTH_PORT, type ProfileAuthPort } from "../../profile/public/index.ts";
import { PublicApiRepository } from "../infrastructure/publicapi.repository.ts";
import {
  PUBLICAPI_EXTERNAL_PORT,
  PUBLIC_API_KEY_SCOPES,
  type AgentApiKey,
  type AgentApiKeysPort,
  type MintedAgentApiKey,
  type PublicApiExternalPort,
  type PublicApiKeyScope,
  type PublicApiPort,
  type PublicApiRequestContext,
  type UserApiKeySecret,
} from "../public/index.ts";

const API_PREFIX = "mf_pub_";
const USER_PREFIX = "mf_user_";
const AGENT_PREFIX = "mf_agent_";
const MAX_API_KEYS = 20;
function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function isScope(value: unknown): value is PublicApiKeyScope {
  return typeof value === "string" && (PUBLIC_API_KEY_SCOPES as readonly string[]).includes(value);
}
function secret(prefix: string) {
  const key = `${prefix}${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, prefix.length + 8), hash: hash(key) };
}

@Injectable()
export class PublicApiService implements PublicApiPort, AgentApiKeysPort {
  private readonly logger = new Logger(PublicApiService.name);
  constructor(
    @Inject(PublicApiRepository) private readonly repository: PublicApiRepository,
    @Inject(PUBLICAPI_EXTERNAL_PORT) private readonly external: PublicApiExternalPort,
    @Inject(PROFILE_AUTH_PORT) private readonly profiles: ProfileAuthPort,
  ) {}
  private async limit(ownerId: string, context: PublicApiRequestContext) {
    await this.external.assertRateLimit(context.request, ownerId);
  }
  private async assertActiveOwner(ownerId: UserIdType): Promise<void> {
    const owner = await this.profiles.loadOwnerAuthState(ownerId);
    if (owner === null || owner.status !== "active") throw new ForbiddenException();
  }
  private audit(action: "create" | "revoke" | "rotate", actorId: string, keyId: string | null, outcome: "success" | "failure", reason: string, correlationId: string) {
    void action;
    void actorId;
    void keyId;
    void reason;
    void correlationId;
    if (outcome === "success") this.logger.log("api key lifecycle succeeded");
    else this.logger.warn("api key lifecycle failed");
  }
  private denial(reason: "missing_bearer_token" | "invalid_api_key" | "missing_scope", scope: PublicApiKeyScope, context: PublicApiRequestContext) {
    void reason;
    void scope;
    void context;
    this.logger.warn("api key request denied");
  }

  async createApiKey(ownerId: UserIdType, body: Readonly<Record<string, unknown>>, context: PublicApiRequestContext) {
    await this.assertActiveOwner(ownerId);
    await this.limit(ownerId, context);
    const raw = Array.isArray(body.scopes) ? body.scopes : ["read"];
    if (!raw.every(isScope)) {
      this.audit("create", ownerId, null, "failure", "invalid_scopes", context.requestId);
      throw new BadRequestException();
    }
    const scopes: PublicApiKeyScope[] = raw.length > 0 ? raw : ["read"];
    if ((await this.repository.activeApiKeyCount(ownerId)) >= MAX_API_KEYS) {
      this.audit("create", ownerId, null, "failure", "too_many_keys", context.requestId);
      throw new HttpException({}, 429);
    }
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 128) || "API key" : "API key";
    const made = secret(API_PREFIX);
    try {
      const row = await this.repository.insertApiKey(ownerId, { name, prefix: made.prefix, hash: made.hash, scopes });
      this.audit("create", ownerId, row.id, "success", "created", context.requestId);
      return { id: row.id, key: made.key, key_prefix: made.prefix, name: row.name, scopes: row.scopes, created_at: row.created_at.toISOString() };
    } catch (error) {
      this.audit("create", ownerId, null, "failure", "storage_error", context.requestId);
      throw error;
    }
  }
  async listApiKeys(ownerId: UserIdType, context: PublicApiRequestContext) {
    await this.limit(ownerId, context);
    return {
      keys: (await this.repository.listApiKeys(ownerId)).map((row) => ({
        id: row.id,
        name: row.name,
        key_prefix: row.key_prefix,
        scopes: row.scopes,
        revoked_at: row.revoked_at?.toISOString() ?? null,
        last_used_at: row.last_used_at?.toISOString() ?? null,
        created_at: row.created_at.toISOString(),
      })),
    };
  }
  async revokeApiKey(ownerId: UserIdType, id: string, context: PublicApiRequestContext) {
    await this.limit(ownerId, context);
    if (!isUuid(id) || (!(await this.repository.revokeApiKey(ownerId, id)) && !(await this.repository.hasApiKey(ownerId, id)))) {
      this.audit("revoke", ownerId, id, "failure", "not_found", context.requestId);
      throw new NotFoundException();
    }
    this.audit("revoke", ownerId, id, "success", "revoked", context.requestId);
  }
  async rotateApiKey(ownerId: UserIdType, id: string, body: Readonly<Record<string, unknown>>, context: PublicApiRequestContext) {
    await this.assertActiveOwner(ownerId);
    await this.limit(ownerId, context);
    if (!isUuid(id)) {
      this.audit("rotate", ownerId, id, "failure", "not_found", context.requestId);
      throw new NotFoundException();
    }
    const made = secret(API_PREFIX);
    let row;
    try {
      row = await this.repository.rotateApiKey(ownerId, id, { name: typeof body.name === "string" ? body.name : undefined, prefix: made.prefix, hash: made.hash });
    } catch (error) {
      this.audit("rotate", ownerId, id, "failure", "storage_error", context.requestId);
      throw error;
    }
    if (row === "not_found") {
      this.audit("rotate", ownerId, id, "failure", "not_found", context.requestId);
      throw new NotFoundException();
    }
    if (row === "already_revoked") {
      this.audit("rotate", ownerId, id, "failure", "already_revoked", context.requestId);
      throw new ConflictException();
    }
    this.audit("rotate", ownerId, id, "success", "rotated", context.requestId);
    return { id: row.id, key: made.key, key_prefix: row.key_prefix, name: row.name, scopes: row.scopes, created_at: row.created_at.toISOString() };
  }

  async createUserApiKey(ownerId: UserIdType, body: Readonly<Record<string, unknown>>, context: PublicApiRequestContext): Promise<UserApiKeySecret> {
    await this.assertActiveOwner(ownerId);
    await this.limit(ownerId, context);
    if (body.scope !== undefined && body.scope !== "public_api") throw new BadRequestException();
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 128) || "API key" : "API key";
    const made = secret(USER_PREFIX);
    const row = await this.repository.insertUserApiKey({ ownerId, scope: "public_api", label, prefix: made.prefix, hash: made.hash });
    return { id: row.id, key: made.key, key_prefix: made.prefix, scope: "public_api", label, created_at: row.created_at.toISOString() };
  }
  async listUserApiKeys(ownerId: UserIdType, query: { limit?: string; offset?: string; scope?: string }, context: PublicApiRequestContext) {
    await this.limit(ownerId, context);
    if (query.scope !== undefined && query.scope !== "public_api") throw new BadRequestException();
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = Math.max(0, Number(query.offset) || 0);
    const rows = await this.repository.listUserApiKeys(ownerId, "public_api", limit + 1, offset);
    const hasMore = rows.length > limit;
    return {
      keys: (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
        id: row.id,
        label: row.label,
        key_prefix: row.key_prefix,
        scope: "public_api",
        status: row.status,
        last_used_at: row.last_used_at?.toISOString() ?? null,
        created_at: row.created_at.toISOString(),
        revoked_at: row.revoked_at?.toISOString() ?? null,
      })),
      pagination: { limit, offset, has_more: hasMore, next_offset: hasMore ? offset + limit : null },
    };
  }
  async revokeUserApiKey(ownerId: UserIdType, id: string, context: PublicApiRequestContext) {
    await this.limit(ownerId, context);
    if (!isUuid(id) || (!(await this.repository.revokeUserApiKey(ownerId, id, "public_api")) && !(await this.repository.hasUserApiKey(ownerId, id, "public_api")))) {
      throw new NotFoundException();
    }
  }
  async authenticate(rawAuthorization: string | undefined, requiredScope: PublicApiKeyScope, context: PublicApiRequestContext) {
    const match = rawAuthorization === undefined ? null : /^Bearer\s+([^\s]+)$/i.exec(rawAuthorization.trim());
    const raw = match?.[1];
    if (raw === undefined) {
      this.denial("missing_bearer_token", requiredScope, context);
      throw new UnauthorizedException();
    }
    if (!raw.startsWith(API_PREFIX)) {
      this.denial("invalid_api_key", requiredScope, context);
      throw new UnauthorizedException();
    }
    const row = await this.repository.verifyApiKey(hash(raw));
    if (row === null) {
      this.denial("invalid_api_key", requiredScope, context);
      throw new UnauthorizedException();
    }
    await this.limit(row.id, context);
    if (!row.scopes.every(isScope) || !row.scopes.includes(requiredScope)) {
      this.denial("missing_scope", requiredScope, context);
      throw new ForbiddenException();
    }
    return { id: row.id, ownerId: UserId(row.owner_id), scopes: row.scopes };
  }

  async mintAgentKey(ownerId: UserIdType, agentId: string, labelRaw: unknown): Promise<MintedAgentApiKey> {
    const label = typeof labelRaw === "string" ? labelRaw.trim().slice(0, 128) || "Agent key" : "Agent key";
    const made = secret(AGENT_PREFIX);
    const row = await this.repository.insertUserApiKey({ ownerId, agentId, scope: "agent_content", scopes: ["write"], label, prefix: made.prefix, hash: made.hash });
    return { id: row.id, key: made.key, key_prefix: made.prefix, scope: "agent_content", agent_id: agentId, label, created_at: row.created_at.toISOString() };
  }
  async listAgentKeys(ownerId: UserIdType, agentId: string): Promise<readonly AgentApiKey[]> {
    return (await this.repository.listAgentKeys(ownerId, agentId)).map((row) => ({
      id: row.id,
      label: row.label,
      key_prefix: row.key_prefix,
      status: row.status,
      last_used_at: row.last_used_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
      revoked_at: row.revoked_at?.toISOString() ?? null,
    }));
  }
  revokeAgentKey(ownerId: UserIdType, agentId: string, keyId: string) {
    return this.repository.revokeAgentKey(ownerId, agentId, keyId);
  }
  hasAgentKey(ownerId: UserIdType, agentId: string, keyId: string) {
    return this.repository.hasAgentKey(ownerId, agentId, keyId);
  }
  revokeAllAgentKeys(agentId: string) {
    return this.repository.revokeAllAgentKeys(agentId);
  }
}
