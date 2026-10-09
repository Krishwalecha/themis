import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

const N = 2 ** 15;
const KEYLEN = 64;
const opts = (n: number): ScryptOptions => ({ N: n, r: 8, p: 1, maxmem: 128 * n * 8 * 2 });

// Hashes a password with scrypt (memory-hard, built into Node)
export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, opts(N));
  return `scrypt$${N}$${salt.toString("base64")}$${key.toString("base64")}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [algo, nRaw, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const n = Number(nRaw);
  if (!Number.isInteger(n) || n < 2 ** 10 || n > 2 ** 20) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, opts(n));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

// A precomputed hash so unknown-email logins cost the same as wrong-password ones
let dummy: Promise<string> | null = null;
export const dummyHash = (): Promise<string> => {
  dummy ??= hashPassword(randomBytes(12).toString("hex"));
  return dummy;
};
