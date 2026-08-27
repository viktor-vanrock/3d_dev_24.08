import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import { PROFILE_SANCTIONS_PORT, type ProfileSanctionsPort } from "../../profile/public/index.ts";
import { SanctionsRepository } from "../infrastructure/sanctions.repository.ts";
import type { SanctionsExpirationPort } from "../public/index.ts";

/** Claims and materializes due expirations in one transaction; row locks make concurrent runs safe. */
@Injectable()
export class SanctionsExpirationService implements SanctionsExpirationPort {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, private readonly repository: SanctionsRepository, @Inject(PROFILE_SANCTIONS_PORT) private readonly profiles: ProfileSanctionsPort) {}
  async expireDue(input: { readonly limit: number; readonly workerId: string }): Promise<{ readonly expired: number; readonly activatedUsers: number }> {
    void input.workerId;
    const tx = await this.pool.connect();
    try {
      await tx.query("begin");
      const due = await this.repository.claimDueActiveSanctionsForUpdate(tx, { limit: input.limit });
      let expired = 0; let activatedUsers = 0;
      for (const sanction of due) {
        if (!(await this.repository.markExpired(tx, { id: sanction.id }))) continue;
        expired += 1;
        if (await this.repository.countActiveSanctionsForUser(tx, { userId: sanction.userId }) === 0) {
          if ((await this.profiles.activateAfterSanctionExpiry(tx, { userId: sanction.userId })).changed) activatedUsers += 1;
        }
      }
      await tx.query("commit");
      return { expired, activatedUsers };
    } catch (error) { await tx.query("rollback").catch(() => undefined); throw error; } finally { tx.release(); }
  }
}
