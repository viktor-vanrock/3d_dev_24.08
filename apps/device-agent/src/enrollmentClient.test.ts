import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadAgentCredentials } from "./credentials.ts";
import { enrollDeviceAgent } from "./enrollmentClient.ts";

describe("standalone CSR enrollment client", () => {
  it("sends only the CSR and atomically activates the returned identity", async () => {
    const home = mkdtempSync(join(tmpdir(), "agent-enrollment-client-"));
    const request = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body: unknown = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ code: "one-time-code", agent_version: "1.2.3" });
      expect((body as { csr_pem?: string }).csr_pem).toContain("BEGIN CERTIFICATE REQUEST");
      expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");
      return new Response(JSON.stringify({
        version: "device-agent-runtime.v1",
        agent_id: "11111111-1111-4111-8111-111111111111",
        gateway_id: "11111111-1111-4111-8111-111111111111",
        device_id: "33333333-3333-4333-8333-333333333333",
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
      }), { status: 201, headers: { "content-type": "application/json" } });
    });
    try {
      await enrollDeviceAgent({ apiUrl: "https://portal.example", code: "one-time-code", agentVersion: "1.2.3", home }, request as typeof fetch);
      expect(loadAgentCredentials(home)).toEqual({
        agentId: "11111111-1111-4111-8111-111111111111",
        deviceId: "33333333-3333-4333-8333-333333333333",
        ownerId: "22222222-2222-4222-8222-222222222222",
      });
      expect(readFileSync(join(home, "gateway-key.pem"), "utf8")).toContain("BEGIN PRIVATE KEY");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
