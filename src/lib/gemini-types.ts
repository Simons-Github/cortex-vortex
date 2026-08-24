/**
 * Shared response/discriminated-union types (and a few client-safe constants)
 * for the Gemini-backed endpoints in `src/lib/gemini-actions.ts`.
 *
 * Runtime values here are numbers/strings only — no server imports — so client
 * code (routes, components) can import from this file without pulling
 * `@tanstack/react-start/server` or `src/lib/gemini.ts` (GEMINI_API_KEY) into
 * the browser bundle. Types from `@/lib/gemini` stay `import type` and erase.
 */
import type { GeneratedQuizQuestion } from "@/lib/gemini";

/** Questions per round — one Gemini call, one daily-quota slot. */
export const QUIZ_SESSION_SIZE = 5;

/** Combined daily quota (platform key) — explain + quiz + create topic. */
export const DAILY_QUOTA_TOAST =
  "Daily AI quota reached (5 requests across explain, quiz, and create topic) — try again tomorrow";

export type FallbackReason = "not-configured" | "rate-limited" | "api-error";

export type UserGeminiKeyStatus = { configured: true; hint: string } | { configured: false };

export type GeminiStatus = {
  platformConfigured: boolean;
  byokAvailable: boolean;
  /** `null` when the caller is signed out (or the token is invalid). */
  userKey: UserGeminiKeyStatus | null;
};

export type SaveUserGeminiKeyResult =
  | { ok: true; hint: string }
  | {
      ok: false;
      reason: "invalid-key" | "rate-limited" | "byok-unavailable" | "save-failed";
    };

export type DeleteUserGeminiKeyResult =
  { ok: true } | { ok: false; reason: "byok-unavailable" | "delete-failed" };

export type ExplainResponse =
  | { quotaExceeded: true; resetInHours: number }
  | { quotaExceeded?: false; text: string; fallback: boolean; reason?: FallbackReason };

export type QuizResponse =
  | { quotaExceeded: true; resetInHours: number }
  | {
      quotaExceeded?: false;
      questions: GeneratedQuizQuestion[];
      fallback: boolean;
      reason?: FallbackReason;
    };

export type CreateTopicResponse =
  | { quotaExceeded: true; resetInHours: number }
  | { rejected: true; reason: string }
  | {
      success: true;
      topicId: string;
      firstQuestion: GeneratedQuizQuestion;
      fallback: boolean;
      reason?: FallbackReason;
    };
