// Приватный клиент query-вектора гибридного поиска (model-search.v1, packages/contracts/http/
// search.ts). MF-2013/MF-2022 переключение: продюсер (indexQueue.ts) и consumer
// (apps/search/src/portal_search) обвязка индексации уже пишут под профилем
// `hyperpc/qwen3-vl-embedding-2b` (dim=2048) — этот клиент раньше звал apps/giga `POST /embed`
// (GigaChat-обёртка, apps/giga/src/giga/search/embed.py, EMBEDDING_DIM=1024, захардкожено), из-за
// чего вектор запроса и вектор индекса были в разных пространствах/размерностях (dim-cast упал бы
// 500-й, не деградацией). Ходим напрямую на HYPERPC слот 4 (embedding/reranker, `docs/process/
// hyperpc.local.llm.md`) — тот же сервис, что уже использует apps/search/src/portal_search/
// hyperpc_client.py, тот же Tailscale-периметр «сервер-сервер, браузер не знает адрес» (apps/api
// крутится на dev-vm, том же tailnet). HYPERPC_URL — та же точка расширения (env), что у
// apps/search.
//
// Таймаут короче типичного provider-таймаута: поиск не должен ждать полный ретрай-цикл —
// недоступность эмбеддинга обязана деградировать до lexical быстрее, чем каталог покажется
// подвисшим (model-search.v1 § degraded). Любая ошибка сети/таймаут/неверная форма ответа —
// единообразно `null`, вызывающая сторона (list.ts) трактует это как graceful fallback на
// lexical, не как 5xx каталога.

const SEARCH_EMBED_TIMEOUT_MS = 5_000;

export const SEARCH_QUERY_EMBEDDING_DIM = 2048 as const;

function hyperpcBaseUrl(): string | null {
  return process.env.HYPERPC_URL ?? null;
}

export async function embedSearchQuery(text: string, timeoutMs: number = SEARCH_EMBED_TIMEOUT_MS): Promise<number[] | null> {
  const baseUrl = hyperpcBaseUrl();
  if (!baseUrl) return null;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs: [text] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if (response.status !== 200) return null;

  const body = (await response.json().catch(() => null)) as { embeddings?: unknown; dim?: unknown } | null;
  const embedding: unknown = Array.isArray(body?.embeddings) ? (body.embeddings as unknown[])[0] : null;
  if (
    !body ||
    body.dim !== SEARCH_QUERY_EMBEDDING_DIM ||
    !Array.isArray(embedding) ||
    embedding.length !== SEARCH_QUERY_EMBEDDING_DIM ||
    !embedding.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    return null;
  }
  return embedding as number[];
}

/** `vector`/`halfvec` литерал pgvector — `[v1,v2,...]`, без пробелов (валидно для обоих типов). */
export function toPgVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}
