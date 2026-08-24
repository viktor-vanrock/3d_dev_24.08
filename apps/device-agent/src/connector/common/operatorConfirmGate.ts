import type { ConnectorVendor, OperatorConfirmGate, PrinterEndpoint } from "./connector.ts";

// Реализация OperatorConfirmGate поверх Telegram-бота @AutofabBot (docs/process/telegram.md).
// В отличие от CLI `ask-operator MF-N` (вопрос агента, ответ уезжает комментом в карточку),
// здесь нужен СИНХРОННЫЙ по времени životа коннектора ответ: коннектор ждёт reply на своё
// сообщение и продолжает auth-flow с approved/token. Поэтому шлём/поллим Bot API напрямую
// (getUpdates), а не через очередь моста — тому мосту чужероден "жди и получи структурный
// ответ в код", он только пересылает вопрос и льёт ответ куда-то дальше.

const APPROVE_WORDS = ["да", "yes", "approve", "/approve", "ok", "ок", "✅", "👍"];
const DENY_WORDS = ["нет", "no", "deny", "/deny", "отказ", "❌", "👎"];

export interface TelegramGateConfig {
  botToken: string;
  /** Числовой ID чата/супергруппы, куда шлём вопрос (docs/process/telegram.md: `-1004375876872`). */
  chatId: string | number;
  apiBaseUrl?: string;
  pollIntervalMs?: number;
  /** Сколько ждать ответа оператора, прежде чем считать это отказом. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface TelegramMessage {
  message_id: number;
  text?: string;
  reply_to_message?: { message_id: number };
  chat: { id: number };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function classify(text: string): "approve" | "deny" | "token" {
  const t = normalize(text);
  if (APPROVE_WORDS.includes(t)) return "approve";
  if (DENY_WORDS.includes(t)) return "deny";
  return "token";
}

function formatEndpoint(endpoint: PrinterEndpoint): string {
  return endpoint.port ? `${endpoint.host}:${endpoint.port}` : endpoint.host;
}

function formatVendor(vendor: ConnectorVendor): string {
  return vendor;
}

export class TelegramOperatorConfirmGate implements OperatorConfirmGate {
  private readonly apiBaseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private updateOffset = 0;

  constructor(private readonly config: TelegramGateConfig) {
    this.apiBaseUrl = config.apiBaseUrl ?? "https://api.telegram.org";
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.timeoutMs = config.timeoutMs ?? 180_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = config.now ?? Date.now;
  }

  private url(method: string): string {
    return `${this.apiBaseUrl}/bot${this.config.botToken}/${method}`;
  }

  private async sendMessage(text: string): Promise<number> {
    const res = await this.fetchImpl(this.url("sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.config.chatId, text }),
    });
    if (!res.ok) throw new Error(`tg sendMessage: HTTP ${res.status}`);
    const body = (await res.json()) as { ok: boolean; result?: TelegramMessage; description?: string };
    if (!body.ok || !body.result) throw new Error(`tg sendMessage: ${body.description ?? "unknown error"}`);
    return body.result.message_id;
  }

  private async pollUpdates(): Promise<TelegramUpdate[]> {
    const res = await this.fetchImpl(this.url("getUpdates"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ offset: this.updateOffset, timeout: 0 }),
    });
    if (!res.ok) throw new Error(`tg getUpdates: HTTP ${res.status}`);
    const body = (await res.json()) as { ok: boolean; result?: TelegramUpdate[] };
    if (!body.ok || !body.result) return [];
    for (const update of body.result) this.updateOffset = Math.max(this.updateOffset, update.update_id + 1);
    return body.result;
  }

  async requestApproval(input: {
    vendor: ConnectorVendor;
    endpoint: PrinterEndpoint;
    reason: "confirm-on-printer" | "token-required";
    message: string;
  }): Promise<{ approved: boolean; token?: string }> {
    const header = `пытаюсь подключиться к ${formatVendor(input.vendor)} ${formatEndpoint(input.endpoint)}`;
    const sentMessageId = await this.sendMessage(`${header}: ${input.message}`);

    const deadline = this.now() + this.timeoutMs;
    while (this.now() < deadline) {
      const updates = await this.pollUpdates();
      for (const update of updates) {
        const message = update.message;
        if (!message?.text) continue;
        if (message.reply_to_message?.message_id !== sentMessageId) continue;

        const kind = classify(message.text);
        if (kind === "deny") return { approved: false };
        if (kind === "approve") return { approved: true };
        // kind === "token": для confirm-on-printer токен не ждали — реплика не по адресу,
        // продолжаем ждать реальный approve/deny; для token-required это и есть сам токен.
        if (input.reason === "confirm-on-printer") continue;
        return { approved: true, token: message.text.trim() };
      }
      await this.sleep(this.pollIntervalMs);
    }
    return { approved: false };
  }
}
