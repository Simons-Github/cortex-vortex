// Exercise secret redaction used when expanding errors for console.error.
//
// Run from the repo root:
//   npx tsx scripts/test-error-redaction.ts

import { match, ok, strictEqual } from "node:assert/strict";

const { describeError, redactSecrets } = await import("../src/lib/error-capture.ts");

const leakUrl =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=AIzaSyFAKEKEY1234567890abcdef";
const error = new Error(`Gemini request failed: ${leakUrl}`);

ok(error.message.includes("AIzaSyFAKEKEY1234567890abcdef"), "original error.message stays intact");

const described = describeError(error);
ok(!described.includes("AIzaSyFAKEKEY"), "describeError must not leak the Gemini key");
ok(described.includes("Gemini request failed:"), "the rest of the message stays readable");
ok(
  described.includes("generativelanguage.googleapis.com"),
  "the request URL host stays readable",
);
match(described, /\?key=\[REDACTED\]/, "query-string key values are replaced in place");

strictEqual(
  redactSecrets("x-goog-api-key: AIzaSyFAKEKEY1234567890abcdef"),
  "x-goog-api-key: [REDACTED]",
  "header-shaped leaks are redacted",
);

const nested = new Error("outer failure");
nested.cause = new Error(`upstream: ${leakUrl}`);
ok(!describeError(nested).includes("AIzaSyFAKEKEY"), "cause-chain messages are redacted too");
ok((nested.cause as Error).message.includes("AIzaSyFAKEKEY"), "cause objects are not mutated");

console.log("error-redaction: all assertions passed");
