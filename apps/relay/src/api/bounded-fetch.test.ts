import { describe, expect, it, vi } from "vitest";
import { createBoundedFetch } from "./bounded-fetch.ts";

const config = {
  baseUrl: "http://127.0.0.1:3000",
  serviceToken: "s".repeat(32),
  timeoutMs: 20,
  retryAttempts: 2,
  retryBaseDelayMs: 1,
} as const;

describe("createBoundedFetch", () => {
  it("retries bounded transient responses and then succeeds", async () => {
    const implementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"error":"busy"}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const sleep = vi.fn(async () => undefined);
    const metrics = { recordInternalApi: vi.fn() };
    const correlation = { currentOrCreate: () => "correlation-123" };

    const response = await createBoundedFetch({ config, fetchImplementation: implementation, sleep, metrics, correlation })(
      "http://127.0.0.1:3000/internal/relay/v1/commands/claim",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(implementation).toHaveBeenCalledTimes(2);
    expect(new Headers(implementation.mock.calls[0]?.[1]?.headers).get("x-correlation-id")).toBe("correlation-123");
    expect(sleep).toHaveBeenCalledWith(1);
    expect(metrics.recordInternalApi).toHaveBeenNthCalledWith(1, "commands/claim", "retry");
    expect(metrics.recordInternalApi).toHaveBeenNthCalledWith(2, "commands/claim", "success");
  });

  it("does not retry non-transient safe API errors", async () => {
    const implementation = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"error":"denied"}', { status: 403 }));
    const response = await createBoundedFetch({ config, fetchImplementation: implementation })("http://127.0.0.1:3000/internal/relay/v1/sessions/authorize");
    expect(response.status).toBe(403);
    expect(implementation).toHaveBeenCalledTimes(1);
  });

  it("aborts each attempt and stops at the configured retry bound", async () => {
    const implementation = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const metrics = { recordInternalApi: vi.fn() };

    await expect(
      createBoundedFetch({ config: { ...config, retryAttempts: 1 }, fetchImplementation: implementation, sleep: async () => undefined, metrics })(
        "http://127.0.0.1:3000/internal/relay/v1/gateways/revalidate",
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(implementation).toHaveBeenCalledTimes(2);
    expect(metrics.recordInternalApi).toHaveBeenLastCalledWith("gateways/revalidate", "timeout");
  });
});
