import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, chmodSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isDeviceEnrollmentResponseV1, type DeviceEnrollmentResponseV1 } from "@portal/contracts/device-agent-runtime/v1";

// Расшифровывает `credentials.enc`, который installScript.ts (apps/api/src/devices/installScript.ts)
// зашифровал на устройстве командой:
//   openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$KEY_FILE"
// Формат файла — классический openssl "Salted__" (8 байт) + соль (8 байт) + шифротекст. Без
// явных -iter/-md openssl берёт задокументированные дефолты для -pbkdf2 (openssl-enc(1), с
// 1.1.0): 10000 итераций, digest sha256, ключ+iv одним вызовом PBKDF2 на keylen+ivlen байт,
// затем срез на key (первые 32 байта, AES-256) и iv (следующие 16). Те же дефолты, эмпирически
// сверено с реальным openssl 3.0.13 в разработке — см. credentials.test.ts.
const PBKDF2_ITERATIONS = 10_000;
const PBKDF2_DIGEST = "sha256";
const KEY_LEN = 32;
const IV_LEN = 16;
const SALT_HEADER = "Salted__";

export interface AgentCredentials {
  agentId: string;
  deviceId: string;
  ownerId: string;
  /** Enrollment credential retained for agent-owned API flows; relay v1 authenticates with mTLS. */
  credential?: string;
}

function configDir(): string {
  return process.env.MULTICA_AGENT_HOME ?? join(homedir(), ".3mf-agent");
}

export function decryptCredentials(encrypted: Buffer, keyFileContents: string): AgentCredentials {
  if (encrypted.subarray(0, 8).toString("latin1") !== SALT_HEADER) {
    throw new Error("credentials.enc: неизвестный формат (ожидался openssl 'Salted__' заголовок)");
  }
  const salt = encrypted.subarray(8, 16);
  const ciphertext = encrypted.subarray(16);

  const derived = pbkdf2Sync(keyFileContents.trim(), salt, PBKDF2_ITERATIONS, KEY_LEN + IV_LEN, PBKDF2_DIGEST);
  const key = derived.subarray(0, KEY_LEN);
  const iv = derived.subarray(KEY_LEN);

  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

  let value: unknown;
  try {
    value = JSON.parse(plaintext) as unknown;
  } catch {
    throw new Error("credentials.enc: invalid JSON payload");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("credentials.enc: unexpected payload type");
  }
  const parsed = value as Record<string, unknown>;
  const allowed = new Set(["agent_id", "device_id", "owner_id", "credential"]);
  if (
    Object.keys(parsed).some((key) => !allowed.has(key)) ||
    Object.keys(parsed).length !== allowed.size ||
    typeof parsed.agent_id !== "string" ||
    typeof parsed.device_id !== "string" ||
    typeof parsed.owner_id !== "string" ||
    typeof parsed.credential !== "string"
  ) {
    throw new Error("credentials.enc: неожиданный формат payload после расшифровки");
  }
  return { agentId: parsed.agent_id, deviceId: parsed.device_id, ownerId: parsed.owner_id, credential: parsed.credential };
}

// Читает agent.key/credentials.enc из $MULTICA_AGENT_HOME (дефолт ~/.3mf-agent — тот же
// CONFIG_DIR, что installScript.ts использует при первом enroll).
export function loadAgentCredentials(home = configDir()): AgentCredentials {
  const identityPath = join(home, "agent-identity.json");
  if (existsSync(identityPath)) {
    let value: unknown;
    try { value = JSON.parse(readFileSync(identityPath, "utf8")) as unknown; } catch { throw new Error("agent-identity.json: invalid JSON"); }
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("agent-identity.json: invalid payload");
    const identity = value as Record<string, unknown>;
    const keys = ["version", "agent_id", "gateway_id", "device_id", "owner_id"];
    if (Object.keys(identity).length !== keys.length || keys.some((key) => !(key in identity)) || identity.version !== "device-agent-runtime.v1"
      || typeof identity.agent_id !== "string" || identity.gateway_id !== identity.agent_id || typeof identity.device_id !== "string" || typeof identity.owner_id !== "string") {
      throw new Error("agent-identity.json: invalid payload");
    }
    return { agentId: identity.agent_id, deviceId: identity.device_id, ownerId: identity.owner_id };
  }
  const dir = home;
  const keyFile = readFileSync(join(dir, "agent.key"), "utf8");
  const enc = readFileSync(join(dir, "credentials.enc"));
  return decryptCredentials(enc, keyFile);
}

function atomicPrivateWrite(path: string, contents: string): void {
  const temporary = `${path}.tmp-${process.pid}`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, contents, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

/** Generates the private key locally; only the CSR is intended for the API. */
export function generateEnrollmentCsr(home = configDir()): { readonly csrPem: string; readonly privateKeyPath: string } {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  const temporaryKey = join(home, `.gateway-key-${process.pid}.pem`);
  const temporaryCsr = join(home, `.gateway-${process.pid}.csr`);
  const privateKeyPath = join(home, "gateway-key.pending.pem");
  try {
    execFileSync("openssl", ["req", "-new", "-newkey", "ed25519", "-nodes", "-subj", "/CN=portal-device-agent", "-keyout", temporaryKey, "-out", temporaryCsr], { stdio: "pipe" });
    atomicPrivateWrite(privateKeyPath, readFileSync(temporaryKey, "utf8"));
    return { csrPem: readFileSync(temporaryCsr, "utf8"), privateKeyPath };
  } finally {
    rmSync(temporaryKey, { force: true });
    rmSync(temporaryCsr, { force: true });
  }
}

export function writeEnrollmentCredentials(
  enrollment: DeviceEnrollmentResponseV1,
  home = configDir(),
): void {
  if (!isDeviceEnrollmentResponseV1(enrollment)) throw new Error("invalid enrollment response");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  const pendingKey = join(home, "gateway-key.pending.pem");
  if (!existsSync(pendingKey)) throw new Error("pending gateway private key is missing");
  atomicPrivateWrite(join(home, "gateway-certificate.pem"), enrollment.certificate_pem);
  atomicPrivateWrite(join(home, "gateway-chain.pem"), `${enrollment.certificate_chain_pem.join("\n")}\n`);
  atomicPrivateWrite(join(home, "gateway-ca.pem"), `${enrollment.ca_bundle_pem.join("\n")}\n`);
  atomicPrivateWrite(join(home, "command-verification-keys.json"), `${JSON.stringify(enrollment.command_verification)}\n`);
  atomicPrivateWrite(join(home, "gateway-key.pem"), readFileSync(pendingKey, "utf8"));
  atomicPrivateWrite(join(home, "agent-identity.json"), `${JSON.stringify({
    version: enrollment.version,
    agent_id: enrollment.agent_id,
    gateway_id: enrollment.gateway_id,
    device_id: enrollment.device_id,
    owner_id: enrollment.owner_id,
  })}\n`);
  rmSync(pendingKey, { force: true });
}
