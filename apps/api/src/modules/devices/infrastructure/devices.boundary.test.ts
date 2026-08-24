import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { devicesTables } from "./devices.tables.ts";

describe("devices ownership boundary", () => {
  it("declares the authoritative devices-owned table set", () => {
    expect([...devicesTables.owns].sort()).toEqual([
      "agents",
      "assistant_thread_events",
      "device_audit_log",
      "device_command_counters",
      "device_commands",
      "device_enroll_codes",
      "device_incidents",
      "device_jobs",
      "device_print_requests",
      "device_shares",
      "device_state",
      "device_telemetry",
      "device_transfers",
    ]);
  });
  it("never accesses the printers-owned user_printers table inside the devices module", () => {
    const source = ["devices.repository.ts", "../application/devices.service.ts", "../api/devices.controller.ts"]
      .map((path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/\buser_printers\b/i);
  });
});
