import { describe, expect, it } from "vitest";
import { evaluateCommand, evaluateSafeTestJobCommand } from "./command-policy.ts";

describe("device command enforcement policy", () => {
  it("разрешает stop только оператору в scope конкретного устройства", () => {
    expect(
      evaluateCommand({
        command: "stop",
        deviceId: "device-1",
        scopedDeviceId: "device-1",
        actorScope: "control",
        actorRole: "operator",
      }),
    ).toEqual({ allowed: true });
  });

  it("отказывает format и delete безопасным deny-by-default результатом", () => {
    for (const command of ["format", "delete", "reboot"]) {
      expect(
        evaluateCommand({
          command,
          deviceId: "device-1",
          scopedDeviceId: "device-1",
          actorScope: "control",
          actorRole: "owner",
        }),
      ).toEqual({ allowed: false, error: "command_denied" });
    }
  });

  it("отказывает stop при чужом device scope или без control scope", () => {
    expect(
      evaluateCommand({
        command: "stop",
        deviceId: "device-1",
        scopedDeviceId: "device-2",
        actorScope: "control",
        actorRole: "owner",
      }),
    ).toEqual({ allowed: false, error: "command_denied" });
    expect(
      evaluateCommand({
        command: "stop",
        deviceId: "device-1",
        scopedDeviceId: "device-1",
        actorScope: "read",
        actorRole: "owner",
      }),
    ).toEqual({ allowed: false, error: "command_denied" });
  });

  describe("safe test job", () => {
    it("разрешает только query/pause/resume при явной safe-маркировке", () => {
      for (const command of ["query", "pause", "resume"]) {
        expect(evaluateSafeTestJobCommand({ command, safeTestJob: true })).toEqual({ allowed: true });
      }
    });

    it("отказывает без safe-маркировки и destructive-командам", () => {
      expect(evaluateSafeTestJobCommand({ command: "pause", safeTestJob: false })).toEqual({
        allowed: false,
        error: "safe_test_job_required",
      });
      for (const command of ["start", "stop", "reboot"]) {
        expect(evaluateSafeTestJobCommand({ command, safeTestJob: true })).toEqual({
          allowed: false,
          error: command === "reboot" ? "unknown_command" : "command_denied",
        });
      }
    });
  });
});
