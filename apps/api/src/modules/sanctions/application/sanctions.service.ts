import { ConfigService } from "@nestjs/config";
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { DEVICE_SANCTIONS_PORT, type DeviceSanctionsPort } from "../../devices/public/index.ts";
import { PROFILE_SANCTIONS_PORT, type ProfileSanctionsPort } from "../../profile/public/index.ts";
import { OUTBOX_PORT, type OutboxPort } from "../../projects/public/index.ts";
import { PUBLICAPI_SANCTIONS_PORT, type PublicApiSanctionsPort } from "../../publicapi/public/index.ts";
import {
  SanctionActorNotStaffError,
  SanctionAlreadyActiveError,
  SanctionIdempotencyConflictError,
  SanctionNotActiveError,
  SanctionTargetIsBootstrapAdminError,
  SanctionTargetNotFoundError,
} from "../domain/sanction.errors.ts";
import { assertCanCreate, computeIdempotencyHash } from "../domain/sanction-policy.ts";
import type { Sanction } from "../domain/sanctions.ts";
import { SanctionsRepository } from "../infrastructure/sanctions.repository.ts";
import type { CancelSanctionCommand, CreateSanctionCommand, CreateSanctionResult, SanctionRecord, SanctionsPort } from "../public/index.ts";

function recordOf(sanction: Sanction): SanctionRecord {
  const { idempotencyKey: _key, idempotencyPayloadHash: _hash, ...record } = sanction;
  return record;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

@Injectable()
export class SanctionsService implements SanctionsPort {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(ConfigService) private readonly config: ConfigService,
    private readonly repository: SanctionsRepository,
    @Inject(PROFILE_SANCTIONS_PORT) private readonly profiles: ProfileSanctionsPort,
    @Inject(DEVICE_SANCTIONS_PORT) private readonly devices: DeviceSanctionsPort,
    @Inject(PUBLICAPI_SANCTIONS_PORT) private readonly publicApi: PublicApiSanctionsPort,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
  ) {}

  async create(input: CreateSanctionCommand): Promise<CreateSanctionResult> {
    const policyInput = { userId: input.targetId, type: input.type, reasonCode: input.reasonCode, endsAt: input.endsAt, actorId: input.actorId };
    assertCanCreate(policyInput);
    const hash = computeIdempotencyHash(policyInput);
    const tx = await this.pool.connect();
    try {
      await tx.query("begin");
      const existing = await this.repository.findByIdempotencyKey(tx, input.idempotencyKey);
      if (existing !== null) {
        if (existing.idempotencyPayloadHash.equals(hash)) {
          await tx.query("rollback");
          return { sanction: recordOf(existing), cascade: null, reused: true };
        }
        throw new SanctionIdempotencyConflictError();
      }
      const target = await this.profiles.loadSanctionTargetForUpdate(tx, { targetId: input.targetId });
      if (target === null || target.status === "deleted" || target.status === "banned") throw new SanctionTargetNotFoundError();
      const actor = await this.profiles.loadSanctionActor(tx, { actorId: input.actorId });
      if (actor === null || !actor.isStaff) throw new SanctionActorNotStaffError();
      const isBootstrapAdmin = await this.profiles.isBootstrapAdmin(tx, { userId: input.targetId, adminUsername: this.config.get<string>("ADMIN_USERNAME") ?? "" });
      if (isBootstrapAdmin) throw new SanctionTargetIsBootstrapAdminError();
      let sanction: Sanction;
      try {
        sanction = await this.repository.insertSanction(tx, {
          userId: input.targetId, type: input.type, state: "active", reasonCode: input.reasonCode, reasonNote: input.reasonNote,
          evidenceUrl: input.evidenceUrl, startsAt: new Date(), endsAt: input.endsAt, createdBy: input.actorId, cancelledAt: null,
          cancelledBy: null, cancelReason: null, idempotencyKey: input.idempotencyKey, idempotencyPayloadHash: hash,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new SanctionAlreadyActiveError();
        throw error;
      }
      const profile = await this.profiles.restrictForSanction(tx, { userId: input.targetId });
      const devices = await this.devices.revokeCredentialsForSanction(tx, { ownerId: input.targetId, actorId: input.actorId });
      const publicApi = await this.publicApi.revokeCredentialsForSanction(tx, { ownerId: input.targetId });
      const outbox = await this.outbox.enqueue(tx, {
        aggregateType: "Sanction", aggregateId: sanction.id, eventType: "sanction.relay_close.v1", eventVersion: 1,
        payload: { sanction_id: sanction.id, user_id: input.targetId, agent_ids: devices.agentIds, reason: "owner_sanctioned" },
      });
      await tx.query("commit");
      return {
        sanction: recordOf(sanction), reused: false,
        cascade: { sessionVersion: profile.sessionVersion, agentIds: devices.agentIds, agentsRevoked: devices.agentsRevoked, enrollCodesRevoked: devices.enrollCodesRevoked, apiKeysRevoked: publicApi.apiKeysRevoked, userApiKeysRevoked: publicApi.userApiKeysRevoked, outboxEventId: outbox.id },
      };
    } catch (error) {
      await tx.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      tx.release();
    }
  }

  async cancel(input: CancelSanctionCommand): Promise<SanctionRecord> {
    if (input.cancelReason.trim() === "") throw new Error("cancel reason must not be empty");
    const tx = await this.pool.connect();
    try {
      await tx.query("begin");
      const actor = await this.profiles.loadSanctionActor(tx, { actorId: input.actorId });
      if (actor === null || !actor.isStaff) throw new SanctionActorNotStaffError();
      const existing = await this.repository.findByIdForUpdate(tx, input.sanctionId);
      if (existing === null || existing.state !== "active") throw new SanctionNotActiveError();
      const cancelled = await this.repository.cancelSanction(tx, input.sanctionId, { actorId: input.actorId, reason: input.cancelReason });
      if (cancelled === null) throw new SanctionNotActiveError();
      if (await this.repository.countOtherActiveByUser(tx, { userId: cancelled.userId, excludingId: cancelled.id }) === 0) {
        await this.profiles.activateAfterSanctionExpiry(tx, { userId: cancelled.userId });
      }
      await tx.query("commit");
      return recordOf(cancelled);
    } catch (error) {
      await tx.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      tx.release();
    }
  }
}
