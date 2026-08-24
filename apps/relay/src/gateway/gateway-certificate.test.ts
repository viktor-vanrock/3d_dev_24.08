import { describe, expect, it } from "vitest";
import { gatewayCertificateIdentity } from "./gateway-certificate.ts";

function socket(subjectaltname: string | undefined, authorized = true, authorizationError: Error | null = null) {
  return {
    authorized,
    authorizationError,
    getPeerCertificate: () => ({ subjectaltname, fingerprint256: Array.from({ length: 32 }, () => "AA").join(":") }),
  };
}

describe("gatewayCertificateIdentity", () => {
  it("binds exactly one verified individual gateway URI", () => {
    expect(gatewayCertificateIdentity(socket("URI:urn:portal:gateway:gateway-42") as never)).toEqual({
      gatewayIdentity: "gateway-42",
      fingerprintSha256: "aa".repeat(32),
    });
  });

  it("rejects unauthorized, missing and shared identities before hello", () => {
    expect(gatewayCertificateIdentity(socket("URI:urn:portal:gateway:gateway-42", false) as never)).toBeUndefined();
    expect(gatewayCertificateIdentity(socket("DNS:gateway.local") as never)).toBeUndefined();
    expect(gatewayCertificateIdentity(socket("URI:urn:portal:gateway:a, URI:urn:portal:gateway:b") as never)).toBeUndefined();
  });
});
