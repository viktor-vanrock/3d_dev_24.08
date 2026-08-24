import type { DomainTableManifest } from "../../_boundaries/ownership.ts";

export const devicesTables: DomainTableManifest = {
  owns: [
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
  ],
  readsForeignViews: [],
};
