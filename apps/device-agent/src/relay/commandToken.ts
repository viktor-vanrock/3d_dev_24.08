import { decodeProtectedHeader, importJWK, jwtVerify, type KeyLike } from "jose";
import type { CommandVerificationKeySet } from "@portal/contracts/device-agent-runtime/v1";
import { readCommandVerificationKeySet } from "../commandTrust.ts";
import type { DeviceCommand } from "./protocol.ts";

export const COMMAND_TOKEN_ISSUER = "portal-api";
export const COMMAND_TOKEN_AUDIENCE = "portal-device-agent";

export interface VerifiedCommand {
  readonly ownerId: string;
  readonly deviceId: string;
  readonly role: string;
  readonly command: DeviceCommand;
  readonly commandId: string;
  readonly nonce: string;
}

export type CommandTokenVerifier = (
  token: string,
  expectedDeviceId: string,
  expectedCommand: DeviceCommand,
  expectedCommandId: string,
  expectedGatewayId: string,
) => Promise<VerifiedCommand | null>;

const DEVICE_COMMANDS = new Set<DeviceCommand>(["pause", "resume", "cancel", "start"]);
const importedKeys = new Map<string, Promise<KeyLike | Uint8Array>>();

async function publicKey(set: CommandVerificationKeySet, kid: string): Promise<KeyLike | Uint8Array | null> {
  const jwk = set.keys.find((candidate) => candidate.kid === kid);
  if (jwk === undefined) return null;
  const cacheKey = `${kid}:${jwk.x}`;
  let imported = importedKeys.get(cacheKey);
  if (imported === undefined) {
    imported = importJWK(jwk, "EdDSA");
    importedKeys.set(cacheKey, imported);
  }
  return imported;
}

export const verifyCommandToken: CommandTokenVerifier = async (token, expectedDeviceId, expectedCommand, expectedCommandId, expectedGatewayId) => {
  try {
    const set = readCommandVerificationKeySet();
    if (set === null) return null;
    const header = decodeProtectedHeader(token);
    if (header.alg !== "EdDSA" || typeof header.kid !== "string" || !header.kid) return null;
    const key = await publicKey(set, header.kid);
    if (key === null) return null;
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["EdDSA"],
      issuer: set.issuer,
      audience: set.audience,
      clockTolerance: 0,
      requiredClaims: ["iat", "nbf", "exp", "jti", "iss", "aud"],
    });
    if (payload.typ !== "command" || payload.iss !== COMMAND_TOKEN_ISSUER || payload.aud !== COMMAND_TOKEN_AUDIENCE) return null;
    if (typeof payload.gateway_id !== "string" || payload.gateway_id !== expectedGatewayId) return null;
    if (typeof payload.owner_id !== "string" || typeof payload.device_id !== "string" || payload.device_id !== expectedDeviceId) return null;
    if (typeof payload.role !== "string" || typeof payload.command !== "string" || !DEVICE_COMMANDS.has(payload.command as DeviceCommand) || payload.command !== expectedCommand) return null;
    if (typeof payload.command_id !== "string" || payload.command_id !== expectedCommandId || typeof payload.jti !== "string" || !payload.jti) return null;
    if (typeof payload.iat !== "number" || typeof payload.nbf !== "number" || typeof payload.exp !== "number" || payload.exp - payload.iat > 60 || payload.nbf < payload.iat - 1) return null;
    return { ownerId: payload.owner_id, deviceId: payload.device_id, role: payload.role, command: payload.command, commandId: payload.command_id, nonce: payload.jti };
  } catch {
    return null;
  }
};
