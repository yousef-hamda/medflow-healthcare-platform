/**
 * PIN fallback for biometric unlock.
 * The PIN is never stored in plaintext: we keep a salted SHA-256 digest in
 * expo-secure-store. (A device-bound KDF would be stronger; acceptable for a
 * fallback factor on top of full-disk encryption + OS keystore.)
 */
import * as Crypto from "expo-crypto";

import { secureStorage } from "@/lib/secureStorage";

export const PIN_HASH_KEY = "medflow.pin.hash.v1";
export const PIN_SALT_KEY = "medflow.pin.salt.v1";
export const PIN_LENGTH = 6;

async function digest(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${pin}`,
  );
}

export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN must be 4-8 digits");
  const salt = Crypto.randomUUID();
  const hash = await digest(pin, salt);
  await secureStorage.setItem(PIN_SALT_KEY, salt);
  await secureStorage.setItem(PIN_HASH_KEY, hash);
}

export async function verifyPin(pin: string): Promise<boolean> {
  const [salt, expected] = await Promise.all([
    secureStorage.getItem(PIN_SALT_KEY),
    secureStorage.getItem(PIN_HASH_KEY),
  ]);
  if (!salt || !expected) return false;
  const actual = await digest(pin, salt);
  return actual === expected;
}

export async function hasPin(): Promise<boolean> {
  return (await secureStorage.getItem(PIN_HASH_KEY)) !== null;
}

export async function clearPin(): Promise<void> {
  await secureStorage.removeItem(PIN_HASH_KEY);
  await secureStorage.removeItem(PIN_SALT_KEY);
}
