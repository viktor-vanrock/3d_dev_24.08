export interface FetchWithRetryOptions {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429]);

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status) || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(url: string, init: RequestInit, options: FetchWithRetryOptions): Promise<Response> {
  const attempts = options.retries + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await options.fetchImpl(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs) });
      if (!isRetryableStatus(response.status) || attempt === attempts) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }

    if (options.retryDelayMs > 0) await sleep(options.retryDelayMs);
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Request failed after ${attempts} attempt(s): ${url}: ${detail}`, { cause: lastError });
}
