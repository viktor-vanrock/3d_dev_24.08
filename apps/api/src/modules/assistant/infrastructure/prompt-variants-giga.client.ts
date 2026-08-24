// Внутренний клиент HTTP-поверхности apps/giga (MF-2068) — генерация вариантов промпта из
// свободного запроса главной. Тот же приватный контур/паттерн, что apps/api/src/ideas/
// gigaClient.ts (MF-565): giga слушает ТОЛЬКО 127.0.0.1:3102, без публичного домена и без auth —
// api уже прогнал запрос через свой сессионный гейт (или явно решил не требовать auth на этом
// эндпоинте — см. promptVariants.ts), giga доверяет по границе сети.
//
// Локальная Gemma на HYPERPC в живом контуре отвечает за 10–15с (особенно после простоя).
// 5с стабильно обрывали здоровый запрос и превращали каждый ответ в heuristic fallback.
// Каталог и ready-кэш при этом грузятся независимо, поэтому 30с здесь не блокируют быстрые
// результаты главной, но оставляют запас на холодный первый токен локальной модели.

const PROMPT_VARIANTS_TIMEOUT_MS = 30_000;

export interface GigaPromptVariant {
  label: string;
  prompt: string;
  motif: string | null;
  confidence: number;
}

export interface GigaPromptVariantsDraft {
  normalized_query: string;
  motif: string | null;
  variants: GigaPromptVariant[];
}

export type GigaPromptVariantsResult = { ok: true; draft: GigaPromptVariantsDraft } | { ok: false; status: number; error: string };

function gigaBaseUrl(): string {
  return process.env.GIGA_HTTP_URL ?? "http://127.0.0.1:3102";
}

export async function requestPromptVariants(query: string, limit: number, batch = 0, excludeLabels: readonly string[] = []): Promise<GigaPromptVariantsResult> {
  let response: Response;
  try {
    response = await fetch(`${gigaBaseUrl()}/assistant/prompt-variants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, limit, batch, exclude_labels: excludeLabels }),
      signal: AbortSignal.timeout(PROMPT_VARIANTS_TIMEOUT_MS),
    });
  } catch {
    // Сеть недоступна ИЛИ таймаут (AbortSignal.timeout бросает тот же DOMException) — оба случая
    // трактуются одинаково: giga недоступен, вызывающая сторона деградирует на heuristic-фоллбэк.
    return { ok: false, status: 503, error: "giga_unreachable" };
  }

  if (response.status === 200) {
    const draft = (await response.json()) as GigaPromptVariantsDraft;
    return { ok: true, draft };
  }

  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  const detail = typeof body?.detail === "string" ? body.detail : `giga_error_${response.status}`;
  return { ok: false, status: response.status, error: detail };
}
