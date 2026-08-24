import type { DetailedPeerCertificate, TLSSocket } from "node:tls";

const GATEWAY_URI_PATTERN = /(?:^|,\s*)URI:urn:portal:gateway:([A-Za-z0-9._:-]{1,128})(?=,|$)/g;

export interface GatewayCertificateIdentity {
  readonly gatewayIdentity: string;
  readonly fingerprintSha256: string;
}

export function gatewayCertificateIdentity(socket: Pick<TLSSocket, "authorized" | "authorizationError" | "getPeerCertificate">): GatewayCertificateIdentity | undefined {
  if (!socket.authorized || socket.authorizationError) return undefined;
  const certificate = socket.getPeerCertificate(true) as DetailedPeerCertificate;
  const subjectAlternativeName = certificate.subjectaltname;
  const fingerprint = certificate.fingerprint256?.replaceAll(":", "").toLowerCase();
  if (!subjectAlternativeName || !fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint)) return undefined;

  const identities = [...subjectAlternativeName.matchAll(GATEWAY_URI_PATTERN)].map((match) => match[1]).filter((value): value is string => value !== undefined);
  if (identities.length !== 1) return undefined;
  return { gatewayIdentity: identities[0]!, fingerprintSha256: fingerprint };
}
