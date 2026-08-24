// Внутренний клиент HTTP-поверхности apps/giga (MF-565, эпик MF-558 § «Волна 2.1») — AI-обогащение
// подачи идеи. giga слушает ТОЛЬКО 127.0.0.1:3102 (docs/architecture/neural.search.md § «Граница
// сервиса»), без публичного домена и без auth — тот же приватный контур, что embed/guides.draft:
// api уже прогнал запрос через свой сессионный гейт, giga доверяет по границе сети (см. apps/giga/
// src/giga/main.py докстринг). GIGA_HTTP_URL — точка расширения на случай другого порта/хоста
// (тот же приём, что MESH_HTTP_URL у meshClient.ts: process.env читается на каждый вызов).
//
// Таймаут 5с (эпик п. «Деградация», НЕ giga.gigachat_client.GIGACHAT_TIMEOUT_SECONDS=30 —
// обогащение не на критическом пути подачи, кнопка обязана дизейблиться быстрее, чем автор
// заскучает, а не ждать полный provider-таймаут с ретраями) — AbortSignal.timeout, не отдельный
// AbortController: запрос одноразовый, отменять нечего кроме самого fetch.

const ENRICH_TIMEOUT_MS = 5_000;

export interface GigaIdeaDraft {
  title: string;
  body: string;
  category: string;
}

export type GigaEnrichResult = { ok: true; draft: GigaIdeaDraft } | { ok: false; status: number; error: string };

function gigaBaseUrl(): string {
  return process.env.GIGA_HTTP_URL ?? "http://127.0.0.1:3102";
}

export async function enrichIdeaDraft(freeText: string): Promise<GigaEnrichResult> {
  let response: Response;
  try {
    response = await fetch(`${gigaBaseUrl()}/ideas/enrich`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ free_text: freeText }),
      signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS),
    });
  } catch {
    // Сеть недоступна ИЛИ таймаут (AbortSignal.timeout бросает тот же DOMException) — оба случая
    // эпик требует трактовать одинаково: giga недоступен, кнопка дизейблится, форма как в v1.
    return { ok: false, status: 503, error: "giga_unreachable" };
  }

  if (response.status === 200) {
    const draft = (await response.json()) as GigaIdeaDraft;
    return { ok: true, draft };
  }

  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  const detail = typeof body?.detail === "string" ? body.detail : `giga_error_${response.status}`;
  return { ok: false, status: response.status, error: detail };
}
