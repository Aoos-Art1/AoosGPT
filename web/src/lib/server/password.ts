import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP scrypt minimum: N=2^17, r=8, p=1. Async native hashing keeps the event
// loop responsive. Rate limiting must happen before invoking this function.
const COST = 131_072;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 64;
const MAX_MEMORY = 256 * 1024 * 1024;

export function validPasswordLength(password: string): boolean {
  const length = Array.from(password).length;
  return length >= 15 && length <= 128 && Buffer.byteLength(password, "utf8") <= 512;
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, {
      N: COST,
      r: BLOCK_SIZE,
      p: PARALLELISM,
      maxmem: MAX_MEMORY,
    }, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (!validPasswordLength(password)) {
    throw new Error("Password must contain 15–128 characters.");
  }
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return ["scrypt", COST, BLOCK_SIZE, PARALLELISM, salt.toString("hex"), key.toString("hex")].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  // Bound both client input and database-controlled work factors.
  if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > 512) return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || parts[1] !== String(COST)
    || parts[2] !== String(BLOCK_SIZE) || parts[3] !== String(PARALLELISM)
    || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const actual = await derive(password, Buffer.from(parts[4], "hex"));
  return timingSafeEqual(actual, Buffer.from(parts[5], "hex"));
}

// Unknown users still incur exactly one normal password-verification cost.
// This dummy verifier is not an account credential and can never sign in.
export async function verifyDummyPassword(password: string): Promise<void> {
  await derive(password, Buffer.from("9ac0bdd719f14769242cef6797b7a64d", "hex"));
}
