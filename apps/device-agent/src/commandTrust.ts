import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isCommandVerificationKeySet, type CommandVerificationKeySet } from "@portal/contracts/device-agent-runtime/v1";

export function readCommandVerificationKeySet(environment: NodeJS.ProcessEnv = process.env): CommandVerificationKeySet | null {
  let raw = environment.COMMAND_VERIFICATION_KEYS;
  if (raw === undefined) {
    const home = environment.MULTICA_AGENT_HOME ?? join(environment.HOME ?? homedir(), ".3mf-agent");
    try {
      raw = readFileSync(join(home, "command-verification-keys.json"), "utf8");
    } catch {
      return null;
    }
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isCommandVerificationKeySet(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
