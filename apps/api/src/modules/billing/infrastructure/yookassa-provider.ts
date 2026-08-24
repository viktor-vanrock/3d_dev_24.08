import type { Logger } from "../../../logger.ts";

// Клиент ЮKassa Payments API (создание платежа за модель, MF-364/MF-1025) — v3 REST,
// Basic-auth shopId:secretKey (https://yookassa.ru/developers/api). Тот же env-gated паттерн,
// что storage/s3.ts и email/send.ts: без креденшлов клиент не настроен, вызывающий код решает,
// что делать — здесь платёж физически не создать без провайдера, поэтому routes.ts отвечает
// 503, а не молчит (в отличие от push/email, где отсутствие транспорта не блокирует юзера).
//
// ⚠️ На момент этой карточки YOOKASSA_SHOP_ID на VDS не заведён: Ops (MF-1024, SECURITY.md)
// выдал только YOOKASSA_AGENT_ID/YOOKASSA_SECRET_KEY — это креды Payouts API (выплаты
// авторам, MF-1027), а не Payments API (приём оплаты от покупателя, нужный здесь). Код рабочий
// и покрыт тестами с мок-провайдером; реальный тестовый платёж на dev.3mf.tech потребует
// отдельных shop_id/secret_key тестового магазина ЮKassa от Ops/оператора.
const API_BASE = "https://api.yookassa.ru/v3";

export interface YookassaConfig {
  shopId: string;
  secretKey: string;
}

function readConfig(): YookassaConfig | null {
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) return null;
  return { shopId, secretKey };
}

export function isBillingConfigured(): boolean {
  return readConfig() !== null;
}

function authHeader(config: YookassaConfig): string {
  return `Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`).toString("base64")}`;
}

export class BillingNotConfiguredError extends Error {
  constructor() {
    super("ЮKassa не сконфигурирована (YOOKASSA_SHOP_ID/YOOKASSA_SECRET_KEY)");
    this.name = "BillingNotConfiguredError";
  }
}

export class YookassaApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "YookassaApiError";
    this.status = status;
  }
}

export interface CreatePaymentParams {
  amountMinor: number;
  currency: string;
  description: string;
  returnUrl: string;
  idempotenceKey: string;
  metadata: Record<string, string>;
}

export interface YookassaPayment {
  id: string;
  status: string;
  paid: boolean;
  confirmationUrl: string | null;
}

function toMajorUnits(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

interface RawPayment {
  id?: unknown;
  status?: unknown;
  paid?: unknown;
  confirmation?: { confirmation_url?: unknown };
}

function parsePayment(body: RawPayment): YookassaPayment {
  return {
    id: String(body.id),
    status: String(body.status),
    paid: Boolean(body.paid),
    confirmationUrl: typeof body.confirmation?.confirmation_url === "string" ? body.confirmation.confirmation_url : null,
  };
}

export async function createPayment(params: CreatePaymentParams, log?: Logger): Promise<YookassaPayment> {
  const config = readConfig();
  if (!config) throw new BillingNotConfiguredError();

  const res = await fetch(`${API_BASE}/payments`, {
    method: "POST",
    headers: {
      Authorization: authHeader(config),
      "Content-Type": "application/json",
      "Idempotence-Key": params.idempotenceKey,
    },
    body: JSON.stringify({
      amount: { value: toMajorUnits(params.amountMinor), currency: params.currency },
      capture: true,
      confirmation: { type: "redirect", return_url: params.returnUrl },
      description: params.description,
      metadata: params.metadata,
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    log?.error({ status: res.status, body }, "ЮKassa createPayment вернула ошибку");
    throw new YookassaApiError(`ЮKassa createPayment: HTTP ${res.status}`, res.status);
  }
  return parsePayment(body as RawPayment);
}

// Повторный запрос статуса платежа по id — единственный надёжный способ подтвердить подлинность
// вебхука у ЮKassa: провайдер не подписывает тело нотификации (нет HMAC/подписи в заголовках —
// официальная рекомендация ЮKassa: либо IP-allowlist их нотификатора, либо, надёжнее и не
// завязано на список IP, подтвердить статус собственным аутентифицированным запросом к API
// перед любой мутацией). Здесь выбран второй путь: тело вебхука определяет ТОЛЬКО какой
// purchase проверить (provider_payment_id), реальные status/paid берутся из ЭТОГО ответа,
// а не из тела нотификации.
export async function fetchPayment(paymentId: string, log?: Logger): Promise<YookassaPayment> {
  const config = readConfig();
  if (!config) throw new BillingNotConfiguredError();

  const res = await fetch(`${API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: authHeader(config) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    log?.error({ status: res.status, body, paymentId }, "ЮKassa fetchPayment вернула ошибку");
    throw new YookassaApiError(`ЮKassa fetchPayment: HTTP ${res.status}`, res.status);
  }
  return parsePayment(body as RawPayment);
}
