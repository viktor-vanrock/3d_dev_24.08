import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ModelId, type UserId } from "../../_kernel/brandedIds.ts";
import { mapProviderStatus, PAYOUT_METHODS, splitAmount } from "../domain/billing.ts";
import { BillingRepository, type PurchaseRow } from "../infrastructure/billing.repository.ts";
import {
  BILLING_ANALYTICS_PORT,
  BILLING_MODEL_READ_PORT,
  BILLING_PROVIDER_PORT,
  BILLING_STAFF_PORT,
  BillingProviderNotConfiguredError,
  type BillingAnalyticsPort,
  type BillingWebhookResult,
  type BillingModelReadPort,
  type BillingPayoutInput,
  type BillingPort,
  type BillingProviderPort,
  type BillingStaffPort,
} from "../public/index.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class BillingService implements BillingPort {
  constructor(
    @Inject(BillingRepository) private readonly repository: BillingRepository,
    @Inject(BILLING_MODEL_READ_PORT)
    private readonly models: BillingModelReadPort,
    @Inject(BILLING_PROVIDER_PORT)
    private readonly provider: BillingProviderPort,
    @Inject(BILLING_STAFF_PORT) private readonly staff: BillingStaffPort,
    @Inject(BILLING_ANALYTICS_PORT)
    private readonly analytics: BillingAnalyticsPort,
  ) {}

  async createPurchase(userId: UserId, rawModelId: unknown) {
    if (typeof rawModelId !== "string" || rawModelId.length === 0) throw new BadRequestException();
    if (!this.provider.configured()) throw new ServiceUnavailableException();
    const modelId = ModelId(rawModelId);
    const model = (await this.models.findMany([modelId])).get(modelId);
    if (model === undefined || model.publishStatus !== "published") throw new NotFoundException();
    if (model.priceMinor <= 0) throw new UnprocessableEntityException();
    if (model.ownerId === userId) throw new UnprocessableEntityException();
    if (await this.repository.alreadyPurchased(userId, modelId)) throw new ConflictException();
    const split = splitAmount(model.priceMinor);
    const purchaseId = await this.repository.createPurchase({
      modelId,
      buyerId: userId,
      sellerId: model.ownerId,
      priceMinor: model.priceMinor,
      ...split,
      currency: model.currency,
    });
    try {
      const payment = await this.provider.create({
        amountMinor: model.priceMinor,
        currency: model.currency,
        description: `Покупка модели ${modelId}`,
        returnUrl: `${(process.env.WEB_APP_URL ?? "https://3mf.tech").replace(/\/+$/, "")}/purchases/${purchaseId}`,
        idempotenceKey: purchaseId,
        metadata: { purchase_id: purchaseId, model_id: modelId },
      });
      await this.repository.setPurchaseProvider(purchaseId, payment.id);
      return { purchaseId, confirmationUrl: payment.confirmationUrl };
    } catch (error) {
      await this.repository.failPurchase(purchaseId);
      if (error instanceof BillingProviderNotConfiguredError) throw new ServiceUnavailableException();
      throw new BadGatewayException();
    }
  }

  async webhook(raw: unknown): Promise<BillingWebhookResult> {
    const body = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const object = typeof body.object === "object" && body.object !== null ? (body.object as Record<string, unknown>) : {};
    const event = body.event,
      objectId = object.id;
    if (typeof event !== "string" || typeof objectId !== "string") throw new BadRequestException();
    const eventId = `${event}:${objectId}`;
    // Deliberately preserves the legacy defect: the dedupe row commits before provider verification,
    // so a transient verification failure makes a redelivery look duplicate. Task 3.7 is parity-only.
    const eventRowId = await this.repository.insertWebhook(eventId, event, body);
    if (eventRowId === null) return { ok: true, duplicate: true };
    const purchase = await this.repository.providerPurchase(objectId);
    if (purchase === null) return { ok: true, matched: false };
    await this.repository.linkWebhook(eventRowId, purchase.id);
    if (purchase.status !== "pending") return { ok: true, alreadyTerminal: true };
    let verified: { readonly status: string };
    try {
      verified = await this.provider.fetch(objectId);
    } catch {
      throw new BadGatewayException();
    }
    const mapped = mapProviderStatus(verified.status);
    if (mapped === null) return { ok: true, ignoredStatus: verified.status };
    const result = await this.repository.settlePurchase(purchase, mapped);
    if (result === "terminal") return { ok: true, alreadyTerminal: true };
    if (mapped === "paid")
      await this.analytics.purchased({
        buyerId: purchase.buyer_id as UserId,
        modelId: ModelId(purchase.model_id),
        sellerId: purchase.seller_id as UserId,
        amount: Number(purchase.price_minor) / 100,
      });
    return { ok: true };
  }

  async purchases(userId: UserId) {
    const rows = await this.repository.buyerPurchases(userId);
    const models = await this.modelMap(rows);
    return {
      purchases: rows.map((row) => this.purchaseJson(row, models.get(ModelId(row.model_id))!.title)),
    };
  }
  async purchase(userId: UserId, id: string) {
    if (!UUID_RE.test(id)) throw new NotFoundException();
    const row = await this.repository.buyerPurchase(userId, id);
    if (row === null) throw new NotFoundException();
    const model = (await this.models.findMany([ModelId(row.model_id)])).get(ModelId(row.model_id));
    if (model === undefined) throw new NotFoundException();
    return { purchase: this.purchaseJson(row, model.title) };
  }
  async sales(userId: UserId) {
    const rows = await this.repository.sellerSales(userId);
    const models = await this.modelMap(rows);
    return {
      sales: rows.map((row) => ({
        id: row.id,
        model_id: row.model_id,
        model_title: models.get(ModelId(row.model_id))!.title,
        seller_amount_minor: Number(row.seller_amount_minor),
        currency: row.currency,
        created_at: row.created_at,
        paid_at: row.paid_at ?? null,
      })),
    };
  }
  balance(userId: UserId) {
    return this.repository.balance(userId);
  }
  async createPayout(userId: UserId, body: BillingPayoutInput) {
    const amount = body.amountMinor;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) throw new BadRequestException();
    const req = body.requisites ?? {};
    const method = req.method,
      value = req.value;
    if (typeof method !== "string" || !PAYOUT_METHODS.has(method) || typeof value !== "string" || value.trim().length === 0) throw new BadRequestException();
    const result = await this.repository.requestPayout(userId, amount, {
      method,
      value,
    });
    if (result.kind === "insufficient") throw new UnprocessableEntityException();
    return {
      id: result.row.id,
      amountMinor: amount,
      currency: result.row.currency,
      status: result.row.status,
      createdAt: result.row.created_at,
    };
  }
  async payouts(userId: UserId) {
    return {
      payouts: (await this.repository.payouts(userId)).map((row) => ({
        id: row.id,
        amountMinor: Number(row.amount_minor),
        currency: row.currency,
        status: row.status,
        createdAt: row.created_at,
        processedAt: row.processed_at,
      })),
    };
  }
  async transitionPayout(userId: UserId, id: string, status: unknown) {
    if (!(await this.staff.isStaff(userId))) throw new ForbiddenException();
    if (!UUID_RE.test(id)) throw new NotFoundException();
    if (status !== "processing" && status !== "paid" && status !== "failed") throw new BadRequestException();
    const next: "processing" | "paid" | "failed" = status;
    const result = await this.repository.transitionPayout(id, next);
    if (result === "not_found") throw new NotFoundException();
    if (result === "invalid") throw new ConflictException();
    return { id: result.id, status: next };
  }

  private async modelMap(rows: readonly PurchaseRow[]) {
    return this.models.findMany([...new Set(rows.map((row) => ModelId(row.model_id)))]);
  }
  private purchaseJson(row: PurchaseRow, title: string) {
    return {
      id: row.id,
      model_id: row.model_id,
      model_title: title,
      price_minor: Number(row.price_minor),
      currency: row.currency,
      status: row.status,
      created_at: row.created_at,
    };
  }
}
