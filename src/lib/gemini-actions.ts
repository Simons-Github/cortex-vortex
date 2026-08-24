/**
 * Backend endpoints for Gemini-backed features (interactive explanation chat
 * + dynamic quiz generation), implemented as TanStack Start server functions
 * — the equivalent of POST /api/gemini/explain and POST /api/gemini/quiz.
 *
 * Server functions are the right tool here: TanStack Start's compiler splits
 * each `.handler()` body into a server-only chunk and leaves only a thin RPC
 * stub in the client bundle, so this file is safe to import from routes even
 * though its handlers reach into `@/lib/gemini` (the actual GEMINI_API_KEY
 * holder). The browser only ever calls these functions over the network; it
 * never sees the key or talks to the Gemini API directly.
 *
 * Endpoints fail closed: if neither a user BYOK key nor GEMINI_API_KEY is
 * available, the caller is rate-limited, or the Gemini call throws, we fall
 * back to the existing mock data and set `fallback: true` so the client can
 * surface a toast. A stored user key skips the shared daily quota of 5
 * (that pool protects the platform key); burst limits still apply.
 *
 * Both endpoints also require a signed-in Supabase user — that check runs
 * first, before the mock/rate-limit/Gemini logic, and rejects with an error
 * (never the mock fallback) so an unauthenticated caller never reaches the
 * Gemini API or the mock data path.
 */
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";

import { levelFor, topics, type QuizQuestion, type Topic } from "@/lib/mock-data";
import {
  generateExplanation,
  generateQuizQuestion,
  isGeminiConfigured,
  isTopicAllowed,
  verifyGeminiApiKey,
  type GeneratedQuizQuestion,
} from "@/lib/gemini";
import { consumeRateLimit } from "@/server/rate-limit";
import {
  countAiUsage,
  getAuthenticatedUser,
  getCustomTopicById,
  insertCustomTopic,
  logAiUsage,
  tryLogAiUsage,
  tryLogKeySave,
  type AiBurstEndpoint,
  type AiUsageEndpoint,
  type CustomTopicLevel,
  type CustomTopicRow,
} from "@/server/supabase-auth";
import {
  deleteUserGeminiKeyRow,
  isByokAvailable,
  loadDecryptedUserGeminiKey,
  loadUserGeminiKeyHint,
  upsertEncryptedUserGeminiKey,
} from "@/server/user-gemini-keys";
import type {
  CreateTopicResponse,
  DeleteUserGeminiKeyResult,
  ExplainResponse,
  GeminiStatus,
  QuizResponse,
  SaveUserGeminiKeyResult,
} from "@/lib/gemini-types";

export type {
  CreateTopicResponse,
  DeleteUserGeminiKeyResult,
  ExplainResponse,
  FallbackReason,
  GeminiStatus,
  QuizResponse,
  SaveUserGeminiKeyResult,
  UserGeminiKeyStatus,
} from "@/lib/gemini-types";

const GEMINI_KEY_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;

type ResolvedGeminiKey = { apiKey: string; source: "user" | "platform" };

/**
 * Prefer a decrypted BYOK key; otherwise the platform env key. Never logs
 * key material. Decrypt failures fall through to the platform key.
 */
async function resolveGeminiKey(userId: string): Promise<ResolvedGeminiKey | null> {
  try {
    const userKey = await loadDecryptedUserGeminiKey(userId);
    if (userKey) return { apiKey: userKey, source: "user" };
  } catch {
    console.error("Failed to load user Gemini key; falling back to platform key.");
  }
  const platform = process.env["GEMINI_API_KEY"]?.trim();
  if (platform) return { apiKey: platform, source: "platform" };
  return null;
}

const EXPLAIN_RATE_LIMIT = 20;
const QUIZ_RATE_LIMIT = 30;
// Topic creation still gets a short-window burst cap for consistency with
// explain/quiz (enforced by `try_log_ai_burst`, 60s rolling window). The
// daily cap is the shared pool of 5 below, not a separate create-topic quota.
const CREATE_TOPIC_RATE_LIMIT = 5;

/** Combined rolling-24h cap across explain + quiz + create_topic. Hardcoded in the RPCs too. */
const DAILY_LIMIT_COMBINED = 5;
// `log_ai_usage` counts a rolling 24h window rather than a calendar day, so
// this is a simple, conservative estimate for the UI rather than an exact
// "quota resets at this instant" figure.
const QUOTA_RESET_HOURS = 24;

// Wrapped in `createServerOnlyFn` (rather than calling `getRequestIP`
// directly from plain helpers like `peekDailyQuota`/`consumeDailyQuota`/
// `consumeBurstLimit` below) so the compiler's import-protection analysis
// recognizes this as a safe server-only boundary — a bare top-level call
// site isn't automatically split out from the client bundle the way a
// `createServerFn().handler()` body is, even though every caller of
// `getClientIp` here only ever runs inside a handler.
const getClientIp = createServerOnlyFn(
  (): string | null => getRequestIP({ xForwardedFor: true }) ?? null,
);

type QuotaResult = { exceeded: true; resetInHours: number } | { exceeded: false };

/**
 * Read-only combined daily-quota peek (no insert). Use before expensive
 * validation work when a later consume will reserve the slot — e.g. so an
 * already-over-limit caller never reaches topic moderation.
 *
 * Fail-closed when Supabase is configured; demo mode (no backend) fails open.
 */
async function peekDailyQuota(accessToken: string): Promise<QuotaResult> {
  try {
    const count = await countAiUsage(accessToken);
    if (count === null) return { exceeded: false };
    return count >= DAILY_LIMIT_COMBINED
      ? { exceeded: true, resetInHours: QUOTA_RESET_HOURS }
      : { exceeded: false };
  } catch (error) {
    console.error("ai_usage_log combined count failed, failing closed:", error);
    throw new Error("Couldn't verify your daily AI quota right now. Please try again.");
  }
}

/**
 * Atomically reserves one daily-quota slot via `try_log_ai_usage` (compare-
 * and-insert). Call only after auth, input validation, and topic resolution
 * have succeeded so rejected/invalid requests never consume a credit.
 *
 * Fail-closed when Supabase is configured; demo mode (no backend) fails open.
 */
async function consumeDailyQuota(
  accessToken: string,
  endpoint: Exclude<AiUsageEndpoint, "topic_moderation">,
): Promise<QuotaResult> {
  const ip = getClientIp();
  try {
    const reserved = await tryLogAiUsage(accessToken, endpoint, ip, DAILY_LIMIT_COMBINED);
    // Demo mode only: no Supabase backend means no quota store to enforce
    // against — fail-open here is intentional and nowhere else.
    if (reserved === null) return { exceeded: false };
    return reserved ? { exceeded: false } : { exceeded: true, resetInHours: QUOTA_RESET_HOURS };
  } catch (error) {
    console.error(`try_log_ai_usage RPC failed for "${endpoint}", failing closed:`, error);
    throw new Error("Couldn't verify your daily AI quota right now. Please try again.");
  }
}

/**
 * Atomically reserves one 60s burst-limit slot via `try_log_ai_burst`.
 * Call before `consumeDailyQuota` so a burst-rejected request never burns a
 * daily credit. Fail-closed when Supabase is configured; demo mode fails open.
 */
async function consumeBurstLimit(
  accessToken: string,
  endpoint: AiBurstEndpoint,
  limit: number,
): Promise<boolean> {
  const ip = getClientIp();
  try {
    return await consumeRateLimit(accessToken, endpoint, limit, ip);
  } catch (error) {
    console.error(`try_log_ai_burst RPC failed for "${endpoint}", failing closed:`, error);
    throw new Error("Couldn't verify the AI rate limit right now. Please try again.");
  }
}

function findMockTopic(topicId: string): Topic | undefined {
  return topics.find((t) => t.id === topicId);
}

const CUSTOM_TOPIC_DIFFICULTY: Record<CustomTopicLevel, Topic["difficulty"]> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/** Adapts a `custom_topics` row into the `Topic` shape explain/quiz handlers already use. */
function topicFromCustomRow(row: CustomTopicRow): Topic {
  return {
    id: row.id,
    title: row.title,
    category: "Custom",
    difficulty: CUSTOM_TOPIC_DIFFICULTY[row.level],
    mastery: 0,
    decay: 0,
    lastReviewed: "never",
    nextReview: "now",
    summary: `A custom topic you created on ${new Date(row.created_at).toLocaleDateString()}.`,
    conversation: [],
    quiz: [],
    resources: [],
  };
}

/**
 * Resolves a topic id to a `Topic`: first the static mock catalog, then the
 * caller's own `custom_topics` row (RLS-scoped). Throws for unknown ids so
 * callers can reject *before* logging a daily-quota hit.
 */
async function resolveTopic(topicId: string, accessToken: string): Promise<Topic> {
  const mock = findMockTopic(topicId);
  if (mock) return mock;

  const row = await getCustomTopicById(accessToken, topicId);
  if (row) return topicFromCustomRow(row);

  throw new Error(`Unknown topic: ${topicId}`);
}

/** Mock-catalog-only lookup — used by paths that do not yet support custom topic ids. */
function findTopic(topicId: string): Topic {
  const topic = findMockTopic(topicId);
  if (!topic) {
    throw new Error(`Unknown topic: ${topicId}`);
  }
  return topic;
}

const PROMPT_VARIANTS = {
  simplify: (topic: Topic) =>
    `Simplify your explanation of "${topic.title}". Use plainer language and one concrete analogy, assuming no prior background.`,
  deepen: (topic: Topic) =>
    `Go deeper on the technical details of "${topic.title}": formal definitions, edge cases, and the trade-offs an advanced practitioner would care about.`,
  example: (topic: Topic) =>
    `Give one concrete, real-world example that illustrates "${topic.title}" in practice.`,
  weakSpots: (topic: Topic) =>
    `Focus specifically on the aspects of "${topic.title}" this learner tends to get wrong in quizzes, and clear up those misconceptions.`,
  custom: (_topic: Topic, message: string) => message,
} satisfies Record<string, (topic: Topic, message: string) => string>;

type PromptVariant = keyof typeof PROMPT_VARIANTS;

const explainInputSchema = z.object({
  topicId: z.string().min(1),
  mastery: z.number().min(0).max(100),
  message: z.string().trim().min(1).max(2000),
  variant: z.enum(["simplify", "deepen", "example", "weakSpots", "custom"]).default("custom"),
  /** Caller's current Supabase `access_token`, re-verified server-side below. `null` when signed out. */
  accessToken: z.string().min(1).nullable(),
});

/** Thrown (never returned as a mock response) when a Gemini endpoint is called without a valid session. */
class UnauthenticatedError extends Error {
  constructor() {
    super("Sign in required to use the AI tutor.");
    this.name = "UnauthenticatedError";
  }
}

function buildMockExplanation(topic: Topic, message: string): string {
  return (
    `On "${message}" — here is the adapted breakdown for ${topic.title}. ${topic.summary} ` +
    `I have weighted this toward the parts your recall is weakest on.`
  );
}

/** Backend endpoint for the interactive explanation chat (equivalent to POST /api/gemini/explain). */
export const explainTopic = createServerFn({ method: "POST" })
  .validator((input: unknown) => explainInputSchema.parse(input))
  .handler(async ({ data }): Promise<ExplainResponse> => {
    const user = await getAuthenticatedUser(data.accessToken);
    if (!user) {
      throw new UnauthenticatedError();
    }

    // `data.accessToken` can't be null here: getAuthenticatedUser() above
    // returns null (and throws) for a null token.
    // Resolve mock *or* caller-owned custom topic *before* logging quota so
    // an unknown / foreign id never burns a daily explain credit.
    const topic = await resolveTopic(data.topicId, data.accessToken as string);
    const mockText = () => buildMockExplanation(topic, data.message);

    const resolved = await resolveGeminiKey(user.id);
    if (!resolved) {
      return { text: mockText(), fallback: true, reason: "not-configured" };
    }

    if (!(await consumeBurstLimit(data.accessToken as string, "explain", EXPLAIN_RATE_LIMIT))) {
      return { text: mockText(), fallback: true, reason: "rate-limited" };
    }

    // Reserve a daily slot only for the platform key (the pool protects
    // *our* Gemini bill). BYOK callers skip it; burst still applies.
    if (resolved.source === "platform") {
      const quota = await consumeDailyQuota(data.accessToken as string, "explain");
      if (quota.exceeded) {
        return { quotaExceeded: true, resetInHours: quota.resetInHours };
      }
    }

    try {
      const level = levelFor(data.mastery);
      // Only `topic.title` is treated as a (potentially user-supplied) topic
      // name and wrapped/guarded against prompt injection inside
      // `generateExplanation` — category/summary are static, app-authored
      // text, so they travel as trusted context instead.
      const trustedContext = `Category: ${topic.category}. Summary: ${topic.summary}`;
      const variant: PromptVariant = data.variant;
      const userQuery = PROMPT_VARIANTS[variant](topic, data.message);
      const text = await generateExplanation(
        topic.title,
        level,
        userQuery,
        trustedContext,
        resolved.apiKey,
      );
      return { text, fallback: false };
    } catch (error) {
      console.error("Gemini explain failed, falling back to mock data:", error);
      return { text: mockText(), fallback: true, reason: "api-error" };
    }
  });

const quizInputSchema = z.object({
  topicId: z.string().min(1),
  mastery: z.number().min(0).max(100),
  /** Caller's current Supabase `access_token`, re-verified server-side below. `null` when signed out. */
  accessToken: z.string().min(1).nullable(),
});

function pickMockQuizQuestion(topic: Topic): GeneratedQuizQuestion {
  const pool: QuizQuestion[] = topic.quiz;
  const q = pool[Math.floor(Math.random() * pool.length)];
  if (!q) {
    return {
      question: `What is one key idea behind ${topic.title}?`,
      options: [topic.summary, "Unrelated to this topic", "Not applicable", "None of the above"],
      correctOptionIndex: 0,
      explanation: topic.summary,
    };
  }
  return {
    question: q.prompt,
    options: q.options,
    correctOptionIndex: q.correctIndex,
    explanation: q.explanation,
  };
}

/** Backend endpoint for dynamic quiz generation (equivalent to POST /api/gemini/quiz). */
export const generateQuiz = createServerFn({ method: "POST" })
  .validator((input: unknown) => quizInputSchema.parse(input))
  .handler(async ({ data }): Promise<QuizResponse> => {
    const user = await getAuthenticatedUser(data.accessToken);
    if (!user) {
      throw new UnauthenticatedError();
    }

    // `data.accessToken` can't be null here: getAuthenticatedUser() above
    // returns null (and throws) for a null token.
    // Resolve the topic *before* reserving quota so an unknown id never burns
    // a daily quiz credit.
    const topic = findTopic(data.topicId);
    const mockQuestion = () => pickMockQuizQuestion(topic);

    const resolved = await resolveGeminiKey(user.id);
    if (!resolved) {
      return { ...mockQuestion(), fallback: true, reason: "not-configured" };
    }

    if (!(await consumeBurstLimit(data.accessToken as string, "quiz", QUIZ_RATE_LIMIT))) {
      return { ...mockQuestion(), fallback: true, reason: "rate-limited" };
    }

    if (resolved.source === "platform") {
      const quota = await consumeDailyQuota(data.accessToken as string, "quiz");
      if (quota.exceeded) {
        return { quotaExceeded: true, resetInHours: quota.resetInHours };
      }
    }

    try {
      const level = levelFor(data.mastery);
      const trustedContext = `Category: ${topic.category}. Summary: ${topic.summary}`;
      const question = await generateQuizQuestion(
        topic.title,
        level,
        trustedContext,
        resolved.apiKey,
      );
      return { ...question, fallback: false };
    } catch (error) {
      console.error("Gemini quiz generation failed, falling back to mock data:", error);
      return { ...mockQuestion(), fallback: true, reason: "api-error" };
    }
  });

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** Generic first-question fallback for a custom topic — there's no static quiz pool to draw from. */
function buildFallbackTopicQuestion(title: string): GeneratedQuizQuestion {
  return {
    question: `What is one key idea behind ${title}?`,
    options: [
      `A foundational concept in ${title}`,
      "Unrelated to this topic",
      "Not applicable",
      "None of the above",
    ],
    correctOptionIndex: 0,
    explanation: `This is a placeholder question — the AI quiz generator for "${title}" is temporarily unavailable.`,
  };
}

/** Best-effort log of the moderation pre-check; never blocks or fails the creation flow. */
async function logModerationEvent(accessToken: string): Promise<void> {
  const ip = getClientIp();
  try {
    await logAiUsage(accessToken, "topic_moderation", ip);
  } catch (error) {
    console.error("Failed to log topic_moderation usage (non-fatal):", error);
  }
}

/**
 * Core custom-topic-creation flow, called by the `createCustomTopic` server
 * function below once it has already authenticated the caller. In order:
 *
 *  1. Read-only peek against the shared daily pool of 5 (no insert) so
 *     over-quota callers never reach moderation / Gemini — skipped when the
 *     caller has a BYOK key (the RPC also skips reserving a slot).
 *  2. `isTopicAllowed` moderation pre-check (skipped only if no Gemini key
 *     is available at all) — logged under `topic_moderation` for visibility,
 *     but never charged against its own quota.
 *  3. `create_custom_topic` RPC: atomically reserves a `create_topic` slot
 *     (advisory lock) unless a BYOK row exists, then inserts. Rejected
 *     topics never reach it; there is no client INSERT policy on `custom_topics`.
 *  4. Generate the first quiz question for the new topic via the existing
 *     `generateQuizQuestion`, passing the custom title as the topic — this
 *     is the one Gemini call in this flow the moderation check above exists
 *     to gate.
 *
 * Wrapped in `createServerOnlyFn` (like `getClientIp` above) because it's a
 * plain function, not a `createServerFn().handler()` literal — without that,
 * its direct calls into `@/lib/gemini` wouldn't be recognized as a safe
 * server-only boundary, even though its only caller (`createCustomTopic`'s
 * handler, below) already is one.
 */
const generateTopicQuiz = createServerOnlyFn(async function generateTopicQuiz(
  userId: string,
  title: string,
  level: CustomTopicLevel,
  accessToken: string,
): Promise<CreateTopicResponse> {
  const resolved = await resolveGeminiKey(userId);

  // Early read-only gate: reject over-quota probes before moderation work.
  // BYOK callers skip the shared pool (the RPC does the same at insert time).
  if (resolved?.source !== "user") {
    const peeked = await peekDailyQuota(accessToken);
    if (peeked.exceeded) {
      return { quotaExceeded: true, resetInHours: peeked.resetInHours };
    }
  }

  // Extra server-side guard independent of the DB constraint (see
  // `supabase/sql/custom_topics.sql`) — never trust that a client validated this.
  const trimmedTitle = title.trim().slice(0, 80);

  if (resolved) {
    try {
      const moderation = await isTopicAllowed(trimmedTitle, resolved.apiKey);
      void logModerationEvent(accessToken);
      if (!moderation.allowed) {
        return { rejected: true, reason: moderation.reason };
      }
    } catch (error) {
      console.error("Topic moderation check failed, rejecting to be safe:", error);
      return { rejected: true, reason: "Couldn't verify this topic right now. Please try again." };
    }
  }

  // Quota + insert are a single RPC transaction. Rejected topics never reach
  // it; a duplicate unique violation rolls the reserved slot back.
  const inserted = await insertCustomTopic(accessToken, trimmedTitle, level, getClientIp());
  if (inserted.quotaExceeded) {
    return { quotaExceeded: true, resetInHours: QUOTA_RESET_HOURS };
  }
  if (inserted.duplicate) {
    return {
      rejected: true,
      reason: "You already have a custom topic with this exact title and level.",
    };
  }
  if (!inserted.row) {
    return { rejected: true, reason: "Couldn't save this topic right now. Please try again." };
  }

  const topicId = inserted.row.id;
  const fallbackQuestion = () => buildFallbackTopicQuestion(trimmedTitle);

  if (!resolved) {
    return {
      success: true,
      topicId,
      firstQuestion: fallbackQuestion(),
      fallback: true,
      reason: "not-configured",
    };
  }

  // Burst check is after insert so a limiter outage must not fail the
  // already-created topic — fall back to the mock question instead.
  let burstAllowed = false;
  try {
    burstAllowed = await consumeBurstLimit(accessToken, "create_topic", CREATE_TOPIC_RATE_LIMIT);
  } catch (error) {
    console.error("try_log_ai_burst RPC failed for create_topic, skipping Gemini:", error);
  }
  if (!burstAllowed) {
    return {
      success: true,
      topicId,
      firstQuestion: fallbackQuestion(),
      fallback: true,
      reason: "rate-limited",
    };
  }

  try {
    const firstQuestion = await generateQuizQuestion(
      trimmedTitle,
      capitalize(level),
      undefined,
      resolved.apiKey,
    );
    return { success: true, topicId, firstQuestion, fallback: false };
  } catch (error) {
    console.error("Gemini quiz generation failed for a new custom topic, falling back:", error);
    return {
      success: true,
      topicId,
      firstQuestion: fallbackQuestion(),
      fallback: true,
      reason: "api-error",
    };
  }
});

const createTopicInputSchema = z.object({
  title: z.string().trim().min(3).max(80),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  /** Caller's current Supabase `access_token`, re-verified server-side below. `null` when signed out. */
  accessToken: z.string().min(1).nullable(),
});

/** Backend endpoint for creating a user-defined custom quiz topic (equivalent to POST /api/gemini/create-topic). */
export const createCustomTopic = createServerFn({ method: "POST" })
  .validator((input: unknown) => createTopicInputSchema.parse(input))
  .handler(async ({ data }): Promise<CreateTopicResponse> => {
    const user = await getAuthenticatedUser(data.accessToken);
    if (!user) {
      throw new UnauthenticatedError();
    }

    // `data.accessToken` can't be null here: getAuthenticatedUser() above
    // returns null (and throws) for a null token.
    return generateTopicQuiz(user.id, data.title, data.level, data.accessToken as string);
  });

/** Lets the UI show platform vs BYOK status without ever exposing a key. */
export const getGeminiStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ accessToken: z.string().min(1).nullable() }).parse(input),
  )
  .handler(async ({ data }): Promise<GeminiStatus> => {
    const platformConfigured = isGeminiConfigured();
    const byokAvailable = isByokAvailable();

    if (!data.accessToken) {
      return { platformConfigured, byokAvailable, userKey: null };
    }

    const user = await getAuthenticatedUser(data.accessToken);
    if (!user) {
      return { platformConfigured, byokAvailable, userKey: null };
    }

    if (!byokAvailable) {
      return { platformConfigured, byokAvailable, userKey: { configured: false } };
    }

    try {
      const hint = await loadUserGeminiKeyHint(user.id);
      return {
        platformConfigured,
        byokAvailable,
        userKey: hint ? { configured: true, hint } : { configured: false },
      };
    } catch {
      console.error("Failed to load user Gemini key status.");
      return { platformConfigured, byokAvailable, userKey: { configured: false } };
    }
  });

const saveKeyInputSchema = z.object({
  accessToken: z.string().min(1).nullable(),
  apiKey: z.string().max(400),
});

export const saveUserGeminiKey = createServerFn({ method: "POST" })
  .validator((input: unknown) => saveKeyInputSchema.parse(input))
  .handler(async ({ data }): Promise<SaveUserGeminiKeyResult> => {
    const user = await getAuthenticatedUser(data.accessToken);
    if (!user) {
      throw new UnauthenticatedError();
    }
    if (!isByokAvailable()) {
      return { ok: false, reason: "byok-unavailable" };
    }

    const apiKey = data.apiKey.trim();
    if (!GEMINI_KEY_PATTERN.test(apiKey)) {
      return { ok: false, reason: "invalid-key" };
    }

    let reserved: boolean | null;
    try {
      reserved = await tryLogKeySave(data.accessToken as string, getClientIp());
    } catch {
      console.error("try_log_key_save failed, failing closed.");
      return { ok: false, reason: "save-failed" };
    }
    if (reserved !== true) {
      return { ok: false, reason: reserved === false ? "rate-limited" : "save-failed" };
    }

    const valid = await verifyGeminiApiKey(apiKey);
    if (!valid) {
      return { ok: false, reason: "invalid-key" };
    }

    try {
      const hint = await upsertEncryptedUserGeminiKey(user.id, apiKey);
      return { ok: true, hint };
    } catch {
      console.error("Failed to persist user Gemini key.");
      return { ok: false, reason: "save-failed" };
    }
  });

const deleteKeyInputSchema = z.object({
  accessToken: z.string().min(1).nullable(),
});

export const deleteUserGeminiKey = createServerFn({ method: "POST" })
  .validator((input: unknown) => deleteKeyInputSchema.parse(input))
  .handler(async ({ data }): Promise<DeleteUserGeminiKeyResult> => {
    const user = await getAuthenticatedUser(data.accessToken);
    if (!user) {
      throw new UnauthenticatedError();
    }
    if (!isByokAvailable()) {
      return { ok: false, reason: "byok-unavailable" };
    }

    try {
      await deleteUserGeminiKeyRow(user.id);
      return { ok: true };
    } catch {
      console.error("Failed to delete user Gemini key.");
      return { ok: false, reason: "delete-failed" };
    }
  });
