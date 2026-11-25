// Exercise AES-256-GCM helpers used to store user Gemini keys.
//
// Run from the repo root:
//   npx tsx scripts/test-user-key-crypto.ts

import { ok, strictEqual, throws } from "node:assert/strict";
import { Buffer } from "node:buffer";

process.env["USER_KEY_ENCRYPTION_SECRET"] = Buffer.alloc(32, 7).toString("base64");

const { decryptUserSecret, encryptUserSecret, hintFromApiKey, isUserKeyEncryptionConfigured } =
  await import("../src/server/user-key-crypto.ts");

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const secret = "AIzaSyDummyTestKeyValue0000000000000";

ok(isUserKeyEncryptionConfigured(), "32-byte base64 secret should be accepted");

const payload = encryptUserSecret(secret, userA);
ok(payload.startsWith("v1."), "payload is versioned");
ok(!payload.includes(secret), "plaintext must not appear in the payload");

strictEqual(decryptUserSecret(payload, userA), secret, "roundtrip decrypts");

throws(() => decryptUserSecret(payload, userB), "decrypt with a different user id (AAD) must fail");

throws(() => decryptUserSecret("v1.aaaa.bbbb.cccc", userA), "garbage payload must fail");

strictEqual(hintFromApiKey(secret), secret.slice(-4), "hint is last four characters");
ok(!hintFromApiKey(secret).includes(secret.slice(0, 8)), "hint must not include the key prefix");

process.env["USER_KEY_ENCRYPTION_SECRET"] = Buffer.alloc(16, 1).toString("base64");
strictEqual(
  isUserKeyEncryptionConfigured(),
  false,
  "non-32-byte secrets must be rejected at call time",
);

console.log("user-key-crypto: all assertions passed");
