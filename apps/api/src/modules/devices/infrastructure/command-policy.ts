export const DEVICE_COMMAND_ALLOWLIST = ["gcode", "start", "pause", "resume", "stop", "cancel"] as const;
export const SAFE_TEST_JOB_COMMAND_ALLOWLIST = ["query", "pause", "resume"] as const;
export type DeviceCommand = (typeof DEVICE_COMMAND_ALLOWLIST)[number];
export type CommandActorRole = "owner" | "operator";
export type SafeTestJobCommand = (typeof SAFE_TEST_JOB_COMMAND_ALLOWLIST)[number];

const ALLOWED = new Set<string>(DEVICE_COMMAND_ALLOWLIST);
const SAFE_TEST_JOB_ALLOWED = new Set<string>(SAFE_TEST_JOB_COMMAND_ALLOWLIST);

export interface CommandPolicyInput {
  command: string;
  deviceId: string;
  scopedDeviceId: string | undefined;
  actorScope: string | undefined;
  actorRole: string | undefined;
}

export type CommandPolicyResult = { allowed: true } | { allowed: false; error: "command_denied" };

/** Enforcement boundary for commands. Anything not explicitly listed is denied. */
export function evaluateCommand(input: CommandPolicyInput): CommandPolicyResult {
  if (!ALLOWED.has(input.command)) return { allowed: false, error: "command_denied" };
  if (input.scopedDeviceId !== input.deviceId) return { allowed: false, error: "command_denied" };
  if (input.actorScope !== "control") return { allowed: false, error: "command_denied" };
  if (input.actorRole !== "owner" && input.actorRole !== "operator") {
    return { allowed: false, error: "command_denied" };
  }
  return { allowed: true };
}

export function isKnownCommand(command: string): command is DeviceCommand {
  return ALLOWED.has(command);
}

export type SafeTestJobPolicyResult = { allowed: true } | { allowed: false; error: "safe_test_job_required" | "unknown_command" | "command_denied" };

/** Безопасная boundary для QA test job: marker обязателен, allowlist намеренно минимален. */
export function evaluateSafeTestJobCommand(input: { command: string; safeTestJob: boolean }): SafeTestJobPolicyResult {
  if (!input.safeTestJob) return { allowed: false, error: "safe_test_job_required" };
  if (!SAFE_TEST_JOB_ALLOWED.has(input.command)) {
    return { allowed: false, error: DEVICE_COMMAND_ALLOWLIST.includes(input.command as DeviceCommand) ? "command_denied" : "unknown_command" };
  }
  return { allowed: true };
}
