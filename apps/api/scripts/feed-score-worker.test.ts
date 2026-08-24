import { EventEmitter } from "node:events";

import type { Notification } from "pg";
import { describe, expect, it, vi } from "vitest";

import { startFeedScoreWorker, type ScoreWorkerDependencies } from "./feed-score-worker.ts";

class FakeClient extends EventEmitter {
  readonly connect = vi.fn().mockResolvedValue(undefined);
  readonly query = vi.fn().mockResolvedValue({});
  readonly end = vi.fn().mockResolvedValue(undefined);

  emitNotification(channel: string, payload: string): void {
    this.emit("notification", { channel, payload } satisfies Partial<Notification>);
  }

  emitError(error: Error): void {
    this.emit("error", error);
  }
}

function dependencies(
  client: FakeClient,
): ScoreWorkerDependencies & { readonly batch: ReturnType<typeof vi.fn>; readonly recompute: ReturnType<typeof vi.fn>; readonly fatal: ReturnType<typeof vi.fn> } {
  return {
    client,
    batchIntervalMs: 1000,
    batch: vi.fn().mockResolvedValue(3),
    recompute: vi.fn().mockResolvedValue(undefined),
    channel: "post_score_recompute",
    setInterval: vi.fn(() => 42 as unknown as ReturnType<typeof setInterval>),
    clearInterval: vi.fn(),
    fatal: vi.fn(),
  };
}

describe("feed score worker lifecycle", () => {
  it("listens, runs the initial batch, and recomputes notified posts", async () => {
    const client = new FakeClient();
    const deps = dependencies(client);
    const worker = await startFeedScoreWorker(deps);

    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.query).toHaveBeenCalledWith("listen post_score_recompute");
    expect(deps.batch).toHaveBeenCalledOnce();
    client.emitNotification("post_score_recompute", "post-1");
    await vi.waitFor(() => expect(deps.recompute).toHaveBeenCalledWith("post-1"));

    await worker.shutdown();
    expect(client.end).toHaveBeenCalledOnce();
  });

  it("closes the connection and requests a non-zero supervisor exit after connection loss", async () => {
    const client = new FakeClient();
    const deps = dependencies(client);
    await startFeedScoreWorker(deps);

    const error = new Error("connection lost");
    client.emitError(error);
    await vi.waitFor(() => expect(deps.fatal).toHaveBeenCalledWith(error));
    expect(client.end).toHaveBeenCalledOnce();
    expect(deps.clearInterval).toHaveBeenCalledOnce();
  });

  it("rejects an invalid batch interval before opening a connection", async () => {
    const client = new FakeClient();
    const deps = { ...dependencies(client), batchIntervalMs: Number.NaN };
    await expect(startFeedScoreWorker(deps)).rejects.toThrow("positive finite");
    expect(client.connect).not.toHaveBeenCalled();
  });
});
