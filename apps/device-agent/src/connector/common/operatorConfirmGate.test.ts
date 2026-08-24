import { describe, expect, it } from "vitest";
import type { PrinterEndpoint } from "./connector.ts";
import { TelegramOperatorConfirmGate } from "./operatorConfirmGate.ts";

const ENDPOINT: PrinterEndpoint = { host: "192.168.88.82" };

// Фейковый Bot API: sendMessage выдаёт растущий message_id, getUpdates отдаёт очередь
// реплаев, которую тест подсовывает вручную (эмулирует оператора, отвечающего в Telegram).
function fakeTelegram() {
  let lastSentMessageId = 0;
  const sent: string[] = [];
  // Каждая запись материализуется в update лениво, в момент getUpdates — так реплай всегда
  // ссылается на message_id реально отправленного к тому моменту вопроса, а не на id,
  // "предсказанный" тестом до вызова requestApproval.
  let pendingReplies: Array<{ text: string; threaded: boolean }> = [];
  let nextUpdateId = 1;

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
    if (url.endsWith("/sendMessage")) {
      sent.push(body.text as string);
      lastSentMessageId += 1;
      return jsonResponse({ ok: true, result: { message_id: lastSentMessageId, chat: { id: 1 } } });
    }
    if (url.endsWith("/getUpdates")) {
      const batch = pendingReplies.map((reply) => ({
        update_id: nextUpdateId++,
        message: {
          message_id: 1000 + nextUpdateId,
          text: reply.text,
          chat: { id: 1 },
          ...(reply.threaded ? { reply_to_message: { message_id: lastSentMessageId } } : {}),
        },
      }));
      pendingReplies = [];
      return jsonResponse({ ok: true, result: batch });
    }
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;

  function jsonResponse(payload: unknown): Response {
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }

  return {
    sent,
    fetchImpl,
    replyToLastSent(text: string) {
      pendingReplies.push({ text, threaded: true });
    },
    replyNotThreaded(text: string) {
      pendingReplies.push({ text, threaded: false });
    },
  };
}

function gate(fetchImpl: typeof fetch, overrides: Partial<{ timeoutMs: number; pollIntervalMs: number }> = {}) {
  let clock = 0;
  return new TelegramOperatorConfirmGate({
    botToken: "test-token",
    chatId: 1,
    fetchImpl,
    pollIntervalMs: overrides.pollIntervalMs ?? 1,
    timeoutMs: overrides.timeoutMs ?? 50,
    sleep: async () => {
      clock += 1;
    },
    now: () => clock,
  });
}

describe("TelegramOperatorConfirmGate", () => {
  it("sends context (vendor, host, reason) in the message", async () => {
    const tg = fakeTelegram();
    tg.replyToLastSent("да");
    const g = gate(tg.fetchImpl);

    await g.requestApproval({ vendor: "snapmaker", endpoint: ENDPOINT, reason: "confirm-on-printer", message: "подтверди на принтере" });

    expect(tg.sent[0]).toContain("snapmaker");
    expect(tg.sent[0]).toContain("192.168.88.82");
    expect(tg.sent[0]).toContain("подтверди на принтере");
  });

  it("resolves approved:true on an approve reply", async () => {
    const tg = fakeTelegram();
    tg.replyToLastSent("да");
    const g = gate(tg.fetchImpl);

    const result = await g.requestApproval({ vendor: "snapmaker", endpoint: ENDPOINT, reason: "confirm-on-printer", message: "m" });
    expect(result).toEqual({ approved: true });
  });

  it("resolves approved:false on a deny reply", async () => {
    const tg = fakeTelegram();
    tg.replyToLastSent("нет");
    const g = gate(tg.fetchImpl);

    const result = await g.requestApproval({ vendor: "snapmaker", endpoint: ENDPOINT, reason: "confirm-on-printer", message: "m" });
    expect(result).toEqual({ approved: false });
  });

  it("treats a non-approve/deny reply as the token when a token was requested", async () => {
    const tg = fakeTelegram();
    tg.replyToLastSent("ABCD-1234");
    const g = gate(tg.fetchImpl);

    const result = await g.requestApproval({ vendor: "snapmaker", endpoint: ENDPOINT, reason: "token-required", message: "пришли токен" });
    expect(result).toEqual({ approved: true, token: "ABCD-1234" });
  });

  it("ignores replies not addressed to the question (no reply_to_message match)", async () => {
    const tg = fakeTelegram();
    tg.replyNotThreaded("да");
    tg.replyToLastSent("да");
    const g = gate(tg.fetchImpl);

    const result = await g.requestApproval({ vendor: "snapmaker", endpoint: ENDPOINT, reason: "confirm-on-printer", message: "m" });
    expect(result).toEqual({ approved: true });
  });

  it("times out to approved:false when the operator never replies", async () => {
    const tg = fakeTelegram();
    const g = gate(tg.fetchImpl, { timeoutMs: 5, pollIntervalMs: 1 });

    const result = await g.requestApproval({ vendor: "snapmaker", endpoint: ENDPOINT, reason: "confirm-on-printer", message: "m" });
    expect(result).toEqual({ approved: false });
  });
});
