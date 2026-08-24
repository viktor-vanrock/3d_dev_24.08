import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeviceId, GatewayId } from "@portal/contracts/device-agent-runtime/v1";
import { decryptCredentials, generateEnrollmentCsr, writeEnrollmentCredentials } from "./credentials.ts";

// Воспроизводит ровно то, что делает `openssl enc -aes-256-cbc -pbkdf2 -salt -pass file:...`
// (см. installScript.ts) — без вызова самого openssl (не полагаемся на бинарь/версию в CI,
// формат уже сверен вручную с реальным openssl 3.0.13 при разработке credentials.ts).
function opensslEncrypt(plaintext: string, keyFileContents: string): Buffer {
  const salt = randomBytes(8);
  const derived = pbkdf2Sync(keyFileContents.trim(), salt, 10_000, 48, "sha256");
  const key = derived.subarray(0, 32);
  const iv = derived.subarray(32, 48);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("Salted__", "latin1"), salt, ciphertext]);
}

describe("decryptCredentials", () => {
  const keyFileContents = randomBytes(32).toString("hex") + "\n"; // openssl rand -hex 32 > agent.key (с трейлинг-переводом строки)

  it("decrypts a payload shaped like devices/agent/enroll's response", () => {
    const payload = {
      agent_id: "agent-1",
      device_id: "device-1",
      owner_id: "owner-1",
      credential: "header.payload.signature",
    };
    const enc = opensslEncrypt(JSON.stringify(payload), keyFileContents);

    expect(decryptCredentials(enc, keyFileContents)).toEqual({
      agentId: "agent-1",
      deviceId: "device-1",
      ownerId: "owner-1",
      credential: "header.payload.signature",
    });
  });

  it("throws on the wrong key (no silent garbage credential)", () => {
    const payload = { agent_id: "a", device_id: "d", owner_id: "o", credential: "c" };
    const enc = opensslEncrypt(JSON.stringify(payload), keyFileContents);
    const wrongKey = randomBytes(32).toString("hex") + "\n";

    expect(() => decryptCredentials(enc, wrongKey)).toThrow();
  });

  it("rejects a buffer without the openssl Salted__ header", () => {
    expect(() => decryptCredentials(Buffer.from("not an openssl file"), keyFileContents)).toThrow(/Salted__/);
  });
});

describe("CSR enrollment credentials", () => {
  it("generates the private key locally and atomically writes credential files with owner-only permissions", () => {
    const home = mkdtempSync(join(tmpdir(), "agent-enrollment-"));
    try {
      const generated = generateEnrollmentCsr(home);
      expect(generated.csrPem).toContain("BEGIN CERTIFICATE REQUEST");
      expect(readFileSync(generated.privateKeyPath, "utf8")).toContain("BEGIN PRIVATE KEY");
      writeEnrollmentCredentials({
        version: "device-agent-runtime.v1",
        agent_id: "11111111-1111-4111-8111-111111111111",
        gateway_id: GatewayId("11111111-1111-4111-8111-111111111111") ?? failIdentifier(),
        device_id: DeviceId("33333333-3333-4333-8333-333333333333") ?? failIdentifier(),
        owner_id: "22222222-2222-4222-8222-222222222222",
        certificate_pem: "-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----",
        certificate_chain_pem: ["-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----"],
        ca_bundle_pem: ["-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----"],
        certificate_fingerprint_sha256: "a".repeat(64),
        command_verification: {
          version: "device-agent-runtime.v1", issuer: "portal-api", audience: "portal-device-agent",
          keys: [{ kid: "current", alg: "EdDSA", kty: "OKP", crv: "Ed25519", x: "A".repeat(43) }],
        },
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }, home);
      for (const name of ["gateway-key.pem", "gateway-certificate.pem", "gateway-chain.pem", "gateway-ca.pem", "command-verification-keys.json"]) {
        expect(statSync(join(home, name)).mode & 0o777).toBe(0o600);
      }
      expect(readFileSync(join(home, "agent-identity.json"), "utf8")).toContain("33333333-3333-4333-8333-333333333333");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

function failIdentifier(): never {
  throw new Error("test identifier must be valid");
}
