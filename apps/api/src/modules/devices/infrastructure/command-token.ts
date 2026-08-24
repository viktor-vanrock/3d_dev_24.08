import { randomUUID } from "node:crypto";
import { importJWK, SignJWT, type JWK } from "jose";

export const COMMAND_TOKEN_TTL_SECONDS = 60;
export const COMMAND_TOKEN_ISSUER = "portal-api";
export const COMMAND_TOKEN_AUDIENCE = "portal-device-agent";
export const DEVICE_CONTROL_COMMANDS = ["pause", "resume", "cancel"] as const;
export type DeviceControlCommand = (typeof DEVICE_CONTROL_COMMANDS)[number] | "start";
export type DeviceControlRole = "owner" | "operator";

function signingConfiguration(environment: NodeJS.ProcessEnv = process.env): { readonly kid: string; readonly jwk: JWK } {
  const kid = environment.COMMAND_TOKEN_SIGNING_KID;
  const raw = environment.COMMAND_TOKEN_SIGNING_PRIVATE_JWK;
  if (!kid || !raw) throw new Error("command_token_signing_config_missing");
  let jwk: unknown;
  try { jwk = JSON.parse(raw) as unknown; } catch { throw new Error("command_token_signing_jwk_invalid"); }
  if (jwk === null || typeof jwk !== "object" || Array.isArray(jwk)) throw new Error("command_token_signing_jwk_invalid");
  const record = jwk as Record<string, unknown>;
  if (record.kty !== "OKP" || record.crv !== "Ed25519" || typeof record.d !== "string" || typeof record.x !== "string") throw new Error("command_token_signing_jwk_invalid");
  return { kid, jwk: { kty: "OKP", crv: "Ed25519", d: record.d, x: record.x } };
}

export interface CommandTokenInput {
  readonly commandId: string;
  readonly gatewayId: string;
  readonly ownerId: string;
  readonly actorId: string;
  readonly deviceId: string;
  readonly role: DeviceControlRole;
  readonly command: DeviceControlCommand;
  readonly seq: number;
}

export async function issueCommandToken(input: CommandTokenInput): Promise<{ token: string; expiresAt: Date }> {
  const configuration = signingConfiguration();
  const key = await importJWK(configuration.jwk, "EdDSA");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((now + COMMAND_TOKEN_TTL_SECONDS) * 1000);
  const token = await new SignJWT({
    typ: "command", gateway_id: input.gatewayId, command_id: input.commandId,
    owner_id: input.ownerId, actor_id: input.actorId, device_id: input.deviceId,
    role: input.role, command: input.command, seq: input.seq, scope: "control",
  })
    .setProtectedHeader({ alg: "EdDSA", kid: configuration.kid, typ: "JWT" })
    .setIssuer(COMMAND_TOKEN_ISSUER).setAudience(COMMAND_TOKEN_AUDIENCE).setSubject(input.deviceId)
    .setJti(randomUUID()).setIssuedAt(now).setNotBefore(now).setExpirationTime(now + COMMAND_TOKEN_TTL_SECONDS)
    .sign(key);
  return { token, expiresAt };
}
