import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { issueGatewayCertificate } from "./gateway-certificate.ts";

describe("gateway CSR certificate authority", () => {
  const directory = mkdtempSync(join(tmpdir(), "gateway-ca-test-"));
  afterEach(() => {
    for (const name of ["GATEWAY_CA_CERTIFICATE_PEM", "GATEWAY_CA_PRIVATE_KEY_PEM", "COMMAND_VERIFICATION_KEYS"]) delete process.env[name];
  });

  it("signs a verified CSR with exactly the canonical gateway SAN and never returns a private key", () => {
    const caKey = join(directory, "ca-key.pem");
    const caCert = join(directory, "ca.pem");
    const clientKey = join(directory, "client-key.pem");
    const csr = join(directory, "client.csr");
    execFileSync("openssl", ["req", "-x509", "-newkey", "ed25519", "-nodes", "-subj", "/CN=Portal test CA", "-keyout", caKey, "-out", caCert, "-days", "1"], { stdio: "pipe" });
    execFileSync("openssl", ["req", "-new", "-newkey", "ed25519", "-nodes", "-subj", "/CN=device-agent", "-keyout", clientKey, "-out", csr], { stdio: "pipe" });
    process.env.GATEWAY_CA_CERTIFICATE_PEM = readFileSync(caCert, "utf8");
    process.env.GATEWAY_CA_PRIVATE_KEY_PEM = readFileSync(caKey, "utf8");
    process.env.COMMAND_VERIFICATION_KEYS = JSON.stringify({ version: "device-agent-runtime.v1", issuer: "portal-api", audience: "portal-device-agent", keys: [{ kid: "k1", alg: "EdDSA", kty: "OKP", crv: "Ed25519", x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }] });
    const gatewayId = "11111111-1111-4111-8111-111111111111";
    const issued = issueGatewayCertificate(readFileSync(csr, "utf8"), gatewayId);
    expect(new X509Certificate(issued.certificatePem).subjectAltName).toBe(`URI:urn:portal:gateway:${gatewayId}`);
    expect(issued.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(issued)).not.toContain("PRIVATE KEY");
    rmSync(directory, { recursive: true, force: true });
  });

  it("rejects malformed CSR input before issuance", () => {
    expect(() => issueGatewayCertificate("not-a-csr", "11111111-1111-4111-8111-111111111111")).toThrow("csr_invalid");
  });
});
