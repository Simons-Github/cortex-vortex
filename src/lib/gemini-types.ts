/**
 * Shared response/discriminated-union types for the Gemini-backed endpoints
 * in `src/lib/gemini-actions.ts`. This file has zero runtime imports — only
 * `import type` — so it is fully erased at build time. Client code (routes,
 * components) can safely import types from here without any risk of
 * pulling server-only code (e.g. `@tanstack/react-start/server`, or
 * `src/lib/gemini.ts`, which holds the GEMINI_API_KEY) into the client
 * bundle.
 */
import type { GeneratedQuizQuestion } from "@/lib/gemini";

export type FallbackReason = "not-configured" | "rate-limited" | "api-error";

export type ExplainResponse =
  | { quotaExceeded: true; resetInHours: number }
  | { quotaExceeded?: false; text: string; fallback: boolean; reason?: FallbackReason };

export type QuizResponse =
  | { quotaExceeded: true; resetInHours: number }
  | ({ quotaExceeded?: false } & GeneratedQuizQuestion & {
        fallback: boolean;
        reason?: FallbackReason;
      });

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
