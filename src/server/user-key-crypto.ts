/**
 * AES-256-GCM helpers for encrypting a user's Gemini API key at rest.
 * Server-only — never import from client code (covered by importProtection
 * on the server directory in vite.config.ts).
 *
 * Payload format: `v1.{nonce}.{tag}.{ciphertext}` (base64url). Additional
 * authenticated data is the user id, so a ciphertext cannot be copied onto
 * another user's row.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const VERSION = "v1";
const KEY_BYTES = 32;

function masterKeyFromEnv(): Buffer | null {
  const raw = process.env["USER_KEY_ENCRYPTION_SECRET"]?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) return null;
  return key;
}

/** True when `USER_KEY_ENCRYPTION_SECRET` is 32 bytes of base64. */
export function isUserKeyEncryptionConfigured(): boolean {
  return masterKeyFromEnv() !== null;
}

function requireMasterKey(): Buffer {
  const key = masterKeyFromEnv();
  if (!key) {
    throw new Error(
      "USER_KEY_ENCRYPTION_SECRET is missing or is not 32 bytes of base64 (see .env.example).",
    );
  }
  return key;
}

export function encryptUserSecret(plaintext: string, userId: string): string {
  const key = requireMasterKey();
  const nonce = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, nonce);
  cipher.setAAD(Buffer.from(userId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    nonce.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptUserSecret(payload: string, userId: string): string {
  const key = requireMasterKey();
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Unsupported encrypted payload.");
  }
  const nonce = Buffer.from(parts[1]!, "base64url");
  const tag = Buffer.from(parts[2]!, "base64url");
  const ciphertext = Buffer.from(parts[3]!, "base64url");
  if (nonce.length !== IV_LENGTH) {
    throw new Error("Unsupported encrypted payload.");
  }
  const decipher = createDecipheriv(ALGO, key, nonce);
  decipher.setAAD(Buffer.from(userId, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Last four characters of a stored key — safe to show in the UI. */
export function hintFromApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed.slice(-4);
}
