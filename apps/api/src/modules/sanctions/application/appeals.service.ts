import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { SanctionAppealId, SanctionId, UserId } from "../../_kernel/brandedIds.ts";
import { PROFILE_SANCTIONS_PORT, type ProfileSanctionsPort } from "../../profile/public/index.ts";
import {
  SanctionActorNotStaffError, SanctionAppealAlreadyPendingError, SanctionAppealForbiddenError, SanctionAppealNotFoundError,
  SanctionAppealNotPendingError, SanctionAppealResolverIsCreatorError, SanctionAppealSubmitterMismatchError, SanctionAppealTargetSanctionNotActiveError,
  SanctionTargetNotFoundError,
} from "../domain/sanction.errors.ts";
import { SanctionsRepository } from "../infrastructure/sanctions.repository.ts";
import type { SanctionAppealsPort, SanctionAppealRecord } from "../public/index.ts";

function isUniqueViolation(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "23505"; }

@Injectable()
export class AppealsService implements SanctionAppealsPort {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly repository: SanctionsRepository,
    @Inject(PROFILE_SANCTIONS_PORT) private readonly profiles: ProfileSanctionsPort,
  ) {}

  async submit(input: { readonly submitterId: UserId; readonly sanctionId: SanctionId; readonly message: string }): Promise<SanctionAppealRecord> {
    const tx = await this.pool.connect();
    try {
      await tx.query("begin");
      const sanction = await this.repository.findById(tx, input.sanctionId);
      if (sanction === null) throw new SanctionTargetNotFoundError();
      if (sanction.userId !== input.submitterId) throw new SanctionAppealSubmitterMismatchError();
      if (sanction.state !== "active") throw new SanctionAppealTargetSanctionNotActiveError();
      let appeal: SanctionAppealRecord;
      try { appeal = await this.repository.insertAppeal(tx, input); } catch (error) { if (isUniqueViolation(error)) throw new SanctionAppealAlreadyPendingError(); throw error; }
      await tx.query("commit"); return appeal;
    } catch (error) { await tx.query("rollback").catch(() => undefined); throw error; } finally { tx.release(); }
  }

  async list(input: { readonly sanctionId: SanctionId; readonly requesterId: UserId }): Promise<{ readonly appeals: readonly SanctionAppealRecord[]; readonly requesterIsStaff: boolean }> {
    const tx = await this.pool.connect();
    try {
      await tx.query("begin");
      const sanction = await this.repository.findById(tx, input.sanctionId);
      if (sanction === null) throw new SanctionTargetNotFoundError();
      const requesterIsStaff = (await this.profiles.loadSanctionActor(tx, { actorId: input.requesterId }))?.isStaff === true;
      if (!requesterIsStaff && sanction.userId !== input.requesterId) throw new SanctionAppealForbiddenError();
      const appeals = await this.repository.findAppealsBySanction(tx, input.sanctionId, requesterIsStaff ? {} : { onlyForUserId: input.requesterId });
      await tx.query("commit"); return { appeals, requesterIsStaff };
    } catch (error) { await tx.query("rollback").catch(() => undefined); throw error; } finally { tx.release(); }
  }

  async resolve(input: { readonly resolverId: UserId; readonly appealId: SanctionAppealId; readonly state: "accepted" | "rejected"; readonly resolutionNote: string }): Promise<SanctionAppealRecord> {
    const tx = await this.pool.connect();
    try {
      await tx.query("begin");
      const actor = await this.profiles.loadSanctionActor(tx, { actorId: input.resolverId });
      if (actor === null || !actor.isStaff) throw new SanctionActorNotStaffError();
      const appeal = await this.repository.findAppealById(tx, input.appealId);
      if (appeal === null) throw new SanctionAppealNotFoundError();
      const sanction = await this.repository.findById(tx, appeal.sanctionId);
      if (sanction === null) throw new SanctionTargetNotFoundError();
      if (sanction.createdBy === input.resolverId) throw new SanctionAppealResolverIsCreatorError();
      if (appeal.state !== "pending") throw new SanctionAppealNotPendingError();
      const resolved = await this.repository.resolveAppeal(tx, input.appealId, input);
      if (resolved === null) throw new SanctionAppealNotPendingError();
      await tx.query("commit"); return resolved;
    } catch (error) { await tx.query("rollback").catch(() => undefined); throw error; } finally { tx.release(); }
  }
}
