import { randomUUID } from "node:crypto";
import type { RelayConfig } from "../config/relay-config.ts";
import type { CorrelationContext } from "../observability/correlation-context.ts";
import type { RelayLogger } from "../observability/relay-logger.ts";
import type { RelayMetrics } from "../observability/metrics.service.ts";

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
type FetchInput = Parameters<typeof fetch>[0];

export interface BoundedFetchDependencies {
  readonly config: RelayConfig["api"];
  readonly fetchImplementation?: typeof fetch;
  readonly correlation?: Pick<CorrelationContext, "currentOrCreate">;
  readonly logger?: Pick<RelayLogger, "warn">;
  readonly metrics?: Pick<RelayMetrics, "recordInternalApi">;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

function operationName(input: FetchInput): string {
  const url = input instanceof URL ? input : typeof input === "string" ? new URL(input) : new URL(input.url);
  return url.pathname.replace(/^\/internal\/relay\/v1\//, "").replaceAll(/\/[0-9a-f-]{8,}/gi, "/:id").slice(0, 96);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createBoundedFetch(dependencies: BoundedFetchDependencies): typeof fetch {
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  const sleep = dependencies.sleep ?? defaultSleep;

  return async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const operation = operationName(input);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    if (!headers.has("x-correlation-id")) headers.set("x-correlation-id", dependencies.correlation?.currentOrCreate() ?? randomUUID());
    const requestInit = { ...init, headers };
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= dependencies.config.retryAttempts; attempt += 1) {
      const timeout = AbortSignal.timeout(dependencies.config.timeoutMs);
      try {
        const response = await fetchImplementation(input, { ...requestInit, signal: timeout });
        if (!RETRYABLE_STATUSES.has(response.status) || attempt === dependencies.config.retryAttempts) {
          dependencies.metrics?.recordInternalApi(operation, response.ok ? "success" : "error");
          return response;
        }
        await response.body?.cancel();
        dependencies.metrics?.recordInternalApi(operation, "retry");
        dependencies.logger?.warn({ event: "relay_internal_api_retry", operation, status_code: response.status, attempt: attempt + 1 }, "retrying bounded relay internal API request");
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("relay internal API request failed");
        const timedOut = timeout.aborted;
        if (attempt === dependencies.config.retryAttempts) {
          dependencies.metrics?.recordInternalApi(operation, timedOut ? "timeout" : "error");
          throw lastError;
        }
        dependencies.metrics?.recordInternalApi(operation, timedOut ? "timeout" : "retry");
        dependencies.logger?.warn({ event: "relay_internal_api_retry", operation, outcome: timedOut ? "timeout" : "error", attempt: attempt + 1 }, "retrying bounded relay internal API request");
      }

      const delay = Math.min(dependencies.config.retryBaseDelayMs * 2 ** attempt, 1_000);
      await sleep(delay);
    }

    throw lastError ?? new Error("relay internal API request failed");
  };
}
