import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import type { VendorClaimStatus } from "../domain/organizations.ts";
import type { VendorClaimRecord } from "../public/index.ts";

export type RevokeVendorClaimMemberships = (transaction: unknown, userId: UserId, vendorId: string) => Promise<void>;

type VerifyResult = { readonly kind: "not_found" } | { readonly kind: "not_pending" } | { readonly kind: "verified"; readonly claim: VendorClaimRecord };

type RevokeResult = { readonly kind: "not_found" } | { readonly kind: "already_revoked" } | { readonly kind: "revoked"; readonly claim: VendorClaimRecord };

@Injectable()
export class OrganizationsRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async submit(input: {
    readonly vendorId: string;
    readonly claimantUserId: UserId;
    readonly organizationName: string;
    readonly evidenceUrl: string | null;
    readonly evidenceNote: string | null;
  }): Promise<VendorClaimRecord | null> {
    const transaction = await this.pool.connect();
    try {
      await transaction.query("begin");
      const inserted = await transaction.query<VendorClaimRecord>(
        `insert into vendor_claims
           (vendor_id, claimant_user_id, organization_name, evidence_url, evidence_note)
         values ($1, $2, $3, $4, $5)
         on conflict (vendor_id, claimant_user_id) where status = 'pending' do nothing
         returning *`,
        [input.vendorId, input.claimantUserId, input.organizationName, input.evidenceUrl, input.evidenceNote],
      );
      const claim = inserted.rows[0];
      if (claim === undefined) {
        await transaction.query("rollback");
        return null;
      }
      await transaction.query(
        `insert into vendor_claim_events (claim_id, actor_user_id, action)
         values ($1, $2, 'submitted')`,
        [claim.id, input.claimantUserId],
      );
      await transaction.query("commit");
      return claim;
    } catch (error) {
      await transaction.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      transaction.release();
    }
  }

  async claimsForUser(userId: UserId): Promise<readonly VendorClaimRecord[]> {
    return (await this.pool.query<VendorClaimRecord>(`select * from vendor_claims where claimant_user_id = $1 order by created_at desc`, [userId])).rows;
  }

  async claims(status: VendorClaimStatus | undefined): Promise<readonly VendorClaimRecord[]> {
    if (status === undefined) {
      return (await this.pool.query<VendorClaimRecord>(`select * from vendor_claims order by created_at asc`)).rows;
    }
    return (await this.pool.query<VendorClaimRecord>(`select * from vendor_claims where status = $1 order by created_at asc`, [status])).rows;
  }

  async isVerifiedHead(vendorId: string, userId: UserId): Promise<boolean> {
    return (
      (
        await this.pool.query(
          `select 1
           from organization_members om
           join organizations o on o.id = om.organization_id
          where o.vendor_id = $1 and om.user_id = $2 and om.role = 'head'`,
          [vendorId, userId],
        )
      ).rowCount !== 0
    );
  }

  async verify(id: string, reviewerId: UserId, note: string | null): Promise<VerifyResult> {
    const transaction = await this.pool.connect();
    try {
      await transaction.query("begin");
      const claim = await this.claimForUpdate(transaction, id);
      if (claim === null) {
        await transaction.query("rollback");
        return { kind: "not_found" };
      }
      if (claim.status !== "pending") {
        await transaction.query("rollback");
        return { kind: "not_pending" };
      }

      const organization = await transaction.query<{ id: string }>(
        `insert into organizations (vendor_id, name) values ($1, $2)
         on conflict (vendor_id) do update set updated_at = now()
         returning id`,
        [claim.vendor_id, claim.organization_name],
      );
      const organizationId = organization.rows[0]!.id;
      await transaction.query(
        `insert into organization_members (organization_id, user_id, role, added_by)
         values ($1, $2, 'head', $3)
         on conflict (organization_id, user_id)
         do update set role = 'head', added_by = $3`,
        [organizationId, claim.claimant_user_id, reviewerId],
      );
      const updated = await transaction.query<VendorClaimRecord>(
        `update vendor_claims
            set status = 'verified', organization_id = $2, reviewed_by = $3,
                reviewed_at = now(), review_note = $4, updated_at = now()
          where id = $1
          returning *`,
        [id, organizationId, reviewerId, note],
      );
      await transaction.query(
        `insert into vendor_claim_events (claim_id, actor_user_id, action, note)
         values ($1, $2, 'verified', $3)`,
        [id, reviewerId, note],
      );
      await transaction.query("commit");
      return { kind: "verified", claim: updated.rows[0]! };
    } catch (error) {
      await transaction.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      transaction.release();
    }
  }

  async revoke(id: string, reviewerId: UserId, note: string, revokeVendorClaimMemberships: RevokeVendorClaimMemberships): Promise<RevokeResult> {
    const transaction = await this.pool.connect();
    try {
      await transaction.query("begin");
      const claim = await this.claimForUpdate(transaction, id);
      if (claim === null) {
        await transaction.query("rollback");
        return { kind: "not_found" };
      }
      if (claim.status === "revoked") {
        await transaction.query("rollback");
        return { kind: "already_revoked" };
      }

      const updated = await transaction.query<VendorClaimRecord>(
        `update vendor_claims
            set status = 'revoked', reviewed_by = $2, reviewed_at = now(),
                review_note = $3, updated_at = now()
          where id = $1
          returning *`,
        [id, reviewerId, note],
      );

      if (claim.status === "verified" && claim.organization_id !== null) {
        const stillVerified = await transaction.query(
          `select 1 from vendor_claims
            where organization_id = $1 and claimant_user_id = $2
              and status = 'verified' and id <> $3`,
          [claim.organization_id, claim.claimant_user_id, id],
        );
        if (stillVerified.rowCount === 0) {
          await transaction.query(`delete from organization_members where organization_id = $1 and user_id = $2`, [claim.organization_id, claim.claimant_user_id]);
          await revokeVendorClaimMemberships(transaction, claim.claimant_user_id, claim.vendor_id);
        }
      }

      await transaction.query(
        `insert into vendor_claim_events (claim_id, actor_user_id, action, note)
         values ($1, $2, 'revoked', $3)`,
        [id, reviewerId, note],
      );
      await transaction.query("commit");
      return { kind: "revoked", claim: updated.rows[0]! };
    } catch (error) {
      await transaction.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      transaction.release();
    }
  }

  private async claimForUpdate(transaction: PoolClient, id: string): Promise<VendorClaimRecord | null> {
    return (await transaction.query<VendorClaimRecord>(`select * from vendor_claims where id = $1 for update`, [id])).rows[0] ?? null;
  }
}
