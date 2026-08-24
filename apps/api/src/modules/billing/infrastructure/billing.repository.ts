import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { DATABASE_POOL } from "../../../nest/database/database.constants.ts";
import type { UserId } from "../../_kernel/brandedIds.ts";
import { holdAvailableAt } from "../domain/billing.ts";

export interface PurchaseRow {
  id: string;
  model_id: string;
  buyer_id: string;
  seller_id: string;
  price_minor: string;
  platform_fee_minor: string;
  seller_amount_minor: string;
  currency: string;
  status: string;
  created_at: Date;
  paid_at?: Date | null;
}
export interface PayoutRow {
  id: string;
  user_id: string;
  amount_minor: string;
  currency: string;
  status: string;
  created_at: Date;
  processed_at: Date | null;
}

@Injectable()
export class BillingRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async alreadyPurchased(buyerId: UserId, modelId: string): Promise<boolean> {
    return (await this.pool.query(`select id from purchases where buyer_id=$1 and model_id=$2 and status='paid'`, [buyerId, modelId])).rowCount !== 0;
  }
  async createPurchase(input: {
    modelId: string;
    buyerId: UserId;
    sellerId: UserId;
    priceMinor: number;
    platformFeeMinor: number;
    sellerAmountMinor: number;
    currency: string;
  }): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `insert into purchases (model_id,buyer_id,seller_id,price_minor,platform_fee_minor,seller_amount_minor,currency) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [input.modelId, input.buyerId, input.sellerId, input.priceMinor, input.platformFeeMinor, input.sellerAmountMinor, input.currency],
    );
    return result.rows[0]!.id;
  }
  async setPurchaseProvider(id: string, paymentId: string) {
    await this.pool.query(`update purchases set provider='yookassa',provider_payment_id=$1 where id=$2`, [paymentId, id]);
  }
  async failPurchase(id: string) {
    await this.pool.query(`update purchases set status='failed',failed_at=now() where id=$1`, [id]);
  }

  async insertWebhook(eventId: string, event: string, payload: unknown): Promise<string | null> {
    const r = await this.pool.query<{ id: string }>(
      `insert into payment_webhook_events (provider,event_id,event_type,payload) values ('yookassa',$1,$2,$3) on conflict (provider,event_id) do nothing returning id`,
      [eventId, event, JSON.stringify(payload)],
    );
    return r.rows[0]?.id ?? null;
  }
  async providerPurchase(paymentId: string): Promise<PurchaseRow | null> {
    const r = await this.pool.query<PurchaseRow>(
      `select id,status,model_id,buyer_id,seller_id,platform_fee_minor,seller_amount_minor,currency,price_minor,created_at from purchases where provider='yookassa' and provider_payment_id=$1`,
      [paymentId],
    );
    return r.rows[0] ?? null;
  }
  async linkWebhook(eventRowId: string, purchaseId: string) {
    await this.pool.query(`update payment_webhook_events set purchase_id=$1 where id=$2`, [purchaseId, eventRowId]);
  }
  async settlePurchase(row: PurchaseRow, status: "paid" | "cancelled"): Promise<"settled" | "terminal"> {
    const tx = await this.pool.connect();
    try {
      await tx.query("begin");
      const column = status === "paid" ? "paid_at" : "cancelled_at";
      const updated = await tx.query(`update purchases set status=$1, ${column}=now() where id=$2 and status='pending' returning id`, [status, row.id]);
      if (updated.rowCount === 0) {
        await tx.query("rollback");
        return "terminal";
      }
      if (status === "paid") {
        const availableAt = holdAvailableAt();
        await tx.query(
          `insert into ledger_entries (account,user_id,amount_minor,currency,reason,purchase_id,available_at) values ('seller_balance',$1,$2,$3,'purchase_credit',$4,$5)`,
          [row.seller_id, Number(row.seller_amount_minor), row.currency, row.id, availableAt],
        );
        await tx.query(
          `insert into ledger_entries (account,user_id,amount_minor,currency,reason,purchase_id,available_at) values ('platform_revenue',null,$1,$2,'platform_fee',$3,now())`,
          [Number(row.platform_fee_minor), row.currency, row.id],
        );
      }
      await tx.query("commit");
      return "settled";
    } catch (error) {
      await tx.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      tx.release();
    }
  }

  async buyerPurchases(userId: UserId) {
    return (
      await this.pool.query<PurchaseRow>(
        `select id,model_id,buyer_id,seller_id,price_minor,platform_fee_minor,seller_amount_minor,currency,status,created_at from purchases where buyer_id=$1 order by created_at desc`,
        [userId],
      )
    ).rows;
  }
  async buyerPurchase(userId: UserId, id: string) {
    const r = await this.pool.query<PurchaseRow>(
      `select id,model_id,buyer_id,seller_id,price_minor,platform_fee_minor,seller_amount_minor,currency,status,created_at from purchases where id=$1 and buyer_id=$2`,
      [id, userId],
    );
    return r.rows[0] ?? null;
  }
  async sellerSales(userId: UserId) {
    return (
      await this.pool.query<PurchaseRow>(
        `select id,model_id,buyer_id,seller_id,price_minor,platform_fee_minor,seller_amount_minor,currency,status,created_at,paid_at from purchases where seller_id=$1 and status='paid' order by paid_at desc nulls last,created_at desc`,
        [userId],
      )
    ).rows;
  }

  balance(userId: UserId, tx?: PoolClient) {
    return this.computeBalance(tx ?? this.pool, userId);
  }
  async requestPayout(userId: UserId, amountMinor: number, requisites: unknown): Promise<{ kind: "insufficient" } | { kind: "created"; row: PayoutRow }> {
    const tx = await this.pool.connect();
    try {
      await tx.query("begin");
      await tx.query("select pg_advisory_xact_lock(hashtext($1))", [userId]);
      const balance = await this.computeBalance(tx, userId);
      if (amountMinor > balance.availableMinor) {
        await tx.query("rollback");
        return { kind: "insufficient" };
      }
      const r = await tx.query<PayoutRow>(
        `insert into payouts (user_id,amount_minor,currency,status,requisites) values ($1,$2,$3,'pending',$4) returning id,user_id,amount_minor,currency,status,created_at,processed_at`,
        [userId, amountMinor, balance.currency, JSON.stringify(requisites)],
      );
      const row = r.rows[0]!;
      await tx.query(
        `insert into ledger_entries (account,user_id,amount_minor,currency,reason,payout_id,available_at) values ('seller_balance',$1,$2,$3,'payout_debit',$4,now())`,
        [userId, -amountMinor, balance.currency, row.id],
      );
      await tx.query("commit");
      return { kind: "created", row };
    } catch (error) {
      await tx.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      tx.release();
    }
  }
  async payouts(userId: UserId) {
    return (
      await this.pool.query<PayoutRow>(`select id,user_id,amount_minor,currency,status,created_at,processed_at from payouts where user_id=$1 order by created_at desc`, [userId])
    ).rows;
  }
  async transitionPayout(id: string, next: string): Promise<"not_found" | "invalid" | PayoutRow> {
    const tx = await this.pool.connect();
    try {
      await tx.query("begin");
      const r = await tx.query<PayoutRow>(`select id,user_id,amount_minor,currency,status,created_at,processed_at from payouts where id=$1 for update`, [id]);
      const row = r.rows[0];
      if (!row) {
        await tx.query("rollback");
        return "not_found";
      }
      const allowed: Readonly<Record<string, readonly string[]>> = {
        pending: ["processing", "failed"],
        processing: ["paid", "failed"],
      };
      if (!(allowed[row.status] ?? []).includes(next)) {
        await tx.query("rollback");
        return "invalid";
      }
      await tx.query(`update payouts set status=$1,processed_at=case when $1 in ('paid','failed') then now() else processed_at end where id=$2`, [next, id]);
      if (next === "failed")
        await tx.query(
          `insert into ledger_entries (account,user_id,amount_minor,currency,reason,payout_id,available_at) values ('seller_balance',$1,$2,$3,'manual_adjustment',$4,now())`,
          [row.user_id, Number(row.amount_minor), row.currency, row.id],
        );
      await tx.query("commit");
      return { ...row, status: next };
    } catch (error) {
      await tx.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      tx.release();
    }
  }

  private async computeBalance(db: Pick<Pool | PoolClient, "query">, userId: UserId, currency = "RUB") {
    const r = await db.query<{ available: string | null; hold: string | null }>(
      `select coalesce(sum(amount_minor) filter (where available_at<=now()),0) as available,coalesce(sum(amount_minor) filter (where available_at>now()),0) as hold from ledger_entries where account='seller_balance' and user_id=$1 and currency=$2`,
      [userId, currency],
    );
    return {
      availableMinor: Number(r.rows[0]?.available ?? 0),
      holdMinor: Number(r.rows[0]?.hold ?? 0),
      currency,
    };
  }
}
