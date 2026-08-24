import { describe, expect, it } from "vitest";
import { evaluatePrinterCommand, type PrinterCommandPolicyInput } from "./command-policy.ts";

const NOW = new Date("2026-07-15T12:00:00.000Z");

const base: PrinterCommandPolicyInput = {
  command: "pause",
  connectionMode: "managed-bridge",
  linkSource: "agent",
  agentId: "agent-1",
  agentStatus: "online",
  agentRevokedAt: null,
  agentLastSeenAt: NOW,
  deviceLastSeenAt: NOW,
  deviceStatus: "ready",
  capabilities: { supportedCommands: ["pause"] },
  now: NOW,
};

describe("evaluatePrinterCommand", () => {
  it("blocks managed-local before any server-side LAN access", () => {
    expect(evaluatePrinterCommand({ ...base, connectionMode: "managed-local", linkSource: "ip" })).toEqual({
      allowed: false,
      error: "LAN_FORBIDDEN",
    });
  });

  it("blocks a printer without an enrolled agent", () => {
    expect(evaluatePrinterCommand({ ...base, agentId: null })).toEqual({
      allowed: false,
      error: "LAN_FORBIDDEN",
    });
  });

  it("blocks an enrolled but offline agent", () => {
    expect(evaluatePrinterCommand({ ...base, agentStatus: "offline" })).toEqual({
      allowed: false,
      error: "DEVICE_OFFLINE",
    });
  });

  it("accepts only a command declared by the enrolled online agent", () => {
    expect(evaluatePrinterCommand(base)).toEqual({ allowed: true });
    expect(evaluatePrinterCommand({ ...base, command: "resume" })).toEqual({
      allowed: false,
      error: "CAPABILITY_UNSUPPORTED",
    });
  });
});
