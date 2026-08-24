import { describe, expect, it } from "vitest";

import {
  LEGACY_RELAY_API_OPERATIONS,
  RELAY_INTERNAL_V1_OPERATIONS,
  RELAY_INTERNAL_V1_PREFIX,
  type RelayInternalOperation,
  type RelayInternalOperationId,
} from "./relay-internal.v1.ts";

const REQUIRED_OPERATION_IDS = [
  "relaySessionAuthorize",
  "relaySessionHeartbeat",
  "relaySessionClose",
  "relayGatewaysRevalidate",
  "relayCommandsClaim",
  "relayCommandLeaseHeartbeat",
  "relayCommandResult",
  "relayTransferMetadata",
  "relayTransferSourceUrl",
  "relayTransferProgress",
  "relayTransferResult",
] as const satisfies readonly RelayInternalOperationId[];

const OPERATIONS: readonly RelayInternalOperation[] = RELAY_INTERNAL_V1_OPERATIONS;

describe("relay internal v1 operation inventory", () => {
  it("covers the complete target control plane exactly once", () => {
    expect(OPERATIONS.map((operation) => operation.operationId)).toEqual(REQUIRED_OPERATION_IDS);
    expect(new Set(OPERATIONS.map((operation) => `${operation.method} ${operation.path}`)).size).toBe(OPERATIONS.length);
    expect(new Set(OPERATIONS.map((operation) => operation.operationId)).size).toBe(OPERATIONS.length);
  });

  it("keeps every target client operation under the canonical versioned prefix", () => {
    expect(OPERATIONS.every((operation) => operation.path.startsWith(`${RELAY_INTERNAL_V1_PREFIX}/`))).toBe(true);
    expect(OPERATIONS.every((operation) => !operation.path.includes("//"))).toBe(true);
  });

  it("does not restore any unversioned legacy operation as a target alias", () => {
    const target = new Set<string>(OPERATIONS.map((operation) => `${operation.method} ${operation.path}`));
    const targetPaths = OPERATIONS.map(({ path }): string => path);
    expect(LEGACY_RELAY_API_OPERATIONS.filter((operation) => target.has(operation))).toEqual([]);
    expect(targetPaths.some((path) => path === "/internal/relay/command" || path === "/internal/relay/files/send")).toBe(false);
  });

  it("declares retry behavior for every mutation and read behavior only for metadata", () => {
    expect(OPERATIONS.filter((operation) => operation.retry === "read").map((operation) => operation.operationId)).toEqual(["relayTransferMetadata"]);
    expect(OPERATIONS.filter((operation) => operation.method !== "GET").every((operation) => operation.retry !== "read")).toBe(true);
  });

  it("covers sessions, batched gateway revalidation, commands and transfers", () => {
    expect(new Set(OPERATIONS.map((operation) => operation.capability))).toEqual(new Set(["session", "gateway_revalidation", "command", "transfer"]));
  });
});
