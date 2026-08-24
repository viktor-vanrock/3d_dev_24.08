import { execFileSync } from "node:child_process";
import { randomBytes, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCommandVerificationKeySet, type CommandVerificationKeySet } from "@portal/contracts/device-agent-runtime/v1";
import type { GatewayCertificate } from "../public/index.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`gateway_ca_config_missing:${name}`);
  return value.replaceAll("\\n", "\n");
}

function verificationKeys(): CommandVerificationKeySet {
  const raw = required("COMMAND_VERIFICATION_KEYS");
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { throw new Error("command_verification_keys_invalid"); }
  if (!isCommandVerificationKeySet(parsed)) throw new Error("command_verification_keys_invalid");
  return parsed;
}

export function issueGatewayCertificate(csrPem: string, gatewayId: string): GatewayCertificate {
  if (!csrPem.includes("BEGIN CERTIFICATE REQUEST") || csrPem.length > 16_384) throw new Error("csr_invalid");
  const directory = mkdtempSync(join(tmpdir(), "portal-gateway-csr-"));
  try {
    const csrPath = join(directory, "request.pem");
    const caPath = join(directory, "ca.pem");
    const keyPath = join(directory, "ca-key.pem");
    const extPath = join(directory, "extensions.cnf");
    const certPath = join(directory, "certificate.pem");
    const caPem = required("GATEWAY_CA_CERTIFICATE_PEM");
    writeFileSync(csrPath, csrPem, { mode: 0o600 });
    writeFileSync(caPath, caPem, { mode: 0o600 });
    writeFileSync(keyPath, required("GATEWAY_CA_PRIVATE_KEY_PEM"), { mode: 0o600 });
    writeFileSync(extPath, `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\nsubjectAltName=URI:urn:portal:gateway:${gatewayId}\n`, { mode: 0o600 });
    execFileSync("openssl", ["req", "-in", csrPath, "-noout", "-verify"], { stdio: "pipe" });
    const details = execFileSync("openssl", ["req", "-in", csrPath, "-noout", "-text"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (!details.includes("Public Key Algorithm") || details.includes("Requested Extensions:\n                X509v3 Basic Constraints: critical\n                    CA:TRUE")) throw new Error("csr_policy_rejected");
    execFileSync("openssl", ["x509", "-req", "-in", csrPath, "-CA", caPath, "-CAkey", keyPath, "-set_serial", `0x${randomBytes(16).toString("hex")}`, "-days", "30", "-sha256", "-extfile", extPath, "-out", certPath], { stdio: "pipe" });
    const certificatePem = readFileSync(certPath, "utf8");
    const certificate = new X509Certificate(certificatePem);
    const fingerprintSha256 = certificate.fingerprint256.replaceAll(":", "").toLowerCase();
    const configuredBundle = process.env.GATEWAY_CA_BUNDLE_PEM;
    const caBundlePem = configuredBundle === undefined ? [caPem] : JSON.parse(configuredBundle) as unknown;
    if (!Array.isArray(caBundlePem) || !caBundlePem.every((item) => typeof item === "string" && item.includes("BEGIN CERTIFICATE"))) throw new Error("gateway_ca_bundle_invalid");
    return {
      certificatePem,
      certificateChainPem: [certificatePem, caPem],
      caBundlePem,
      fingerprintSha256,
      expiresAt: new Date(certificate.validTo).toISOString(),
      commandVerification: verificationKeys(),
    };
  } catch (error) {
    if (error instanceof Error && ["csr_invalid", "csr_policy_rejected", "gateway_ca_bundle_invalid", "command_verification_keys_invalid"].includes(error.message)) throw error;
    throw new Error("csr_invalid");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
