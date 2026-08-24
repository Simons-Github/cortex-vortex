import { z } from "zod";
import type { GeneratedQuizQuestion } from "@/lib/gemini";

/**
 * First quiz question from `createCustomTopic`, handed to the study room via
 * sessionStorage so the correct answer never lands in a shareable URL.
 */
export const FIRST_QUESTION_STORAGE_KEY_PREFIX = "cortex-vortex:first-question:";

const storedFirstQuestionSchema = z.object({
  question: z.object({
    question: z.string(),
    options: z.array(z.string()),
    correctOptionIndex: z.number(),
    explanation: z.string(),
  }),
  fallback: z.boolean().optional(),
});

export type StoredFirstQuestion = {
  question: GeneratedQuizQuestion;
  fallback?: boolean | undefined;
};

export function firstQuestionStorageKey(topicId: string): string {
  return `${FIRST_QUESTION_STORAGE_KEY_PREFIX}${topicId}`;
}

export function storeFirstQuestion(topicId: string, payload: StoredFirstQuestion): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(firstQuestionStorageKey(topicId), JSON.stringify(payload));
}

/** Reads a stored first question without removing it (safe under Strict Mode remounts). */
export function readStoredFirstQuestion(topicId: string): StoredFirstQuestion | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(firstQuestionStorageKey(topicId));
  if (!raw) return null;
  try {
    return storedFirstQuestionSchema.parse(JSON.parse(raw));
  } catch {
    window.sessionStorage.removeItem(firstQuestionStorageKey(topicId));
    return null;
  }
}

export function clearStoredFirstQuestion(topicId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(firstQuestionStorageKey(topicId));
}
