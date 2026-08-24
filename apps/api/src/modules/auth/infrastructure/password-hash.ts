import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const N = 32_768;
const R = 8;
const P = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

function encodedHash(salt: Buffer, hash: Buffer): string {
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

async function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: MAX_MEMORY }, (error, derivedKey) => {
      if (error !== null) reject(error);
      else resolve(Buffer.from(derivedKey));
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return encodedHash(salt, await derive(password, salt, N, R, P));
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, nValue, rValue, pValue, saltValue, hashValue, ...rest] = encoded.split("$");
  if (algorithm !== "scrypt" || rest.length !== 0) return false;

  const n = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  if (n !== N || r !== R || p !== P || saltValue === undefined || hashValue === undefined) return false;

  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await derive(password, salt, n, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
