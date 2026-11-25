import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { topics, type Topic } from "@/lib/mock-data";
import { TOPIC_PDF_BUCKET, topicPdfObjectPath } from "@/lib/pdf";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Whether Supabase credentials are present in the environment. When false,
 * the rest of the app falls back to a fully-functional localStorage-backed
 * anonymous mode (see `src/lib/local-store.ts` and `src/lib/mastery-store.ts`)
 * instead of throwing — Cortex Vortex must work out of the box with no
 * backend configured.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

// Standard browser client using the public publishable key. Safe to use
// from client-side code — access control is enforced by Supabase Row Level
// Security policies, not by keeping this key secret. `null` when the env
// vars aren't set, so callers must go through `requireClient()` below.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null;

function requireClient(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      "Supabase isn't configured. Define VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY " +
        "(see .env.example) before calling this function, or use the localStorage " +
        "fallback in `src/lib/local-store.ts` instead.",
    );
  }
  return supabase;
}

/** Row shape of `public.user_topic_mastery`. */
export type TopicMastery = {
  id: string;
  user_id: string;
  topic_id: string;
  mastery_score: number;
  last_reviewed_at: string;
};

/** Query cache key for `getProfile` — shared by mastery/streak and Settings. */
export const PROFILE_QUERY_KEY = "profile" as const;

export function profileQueryKey(userId: string) {
  return [PROFILE_QUERY_KEY, userId] as const;
}

export const EXPLANATION_TONES = ["Concise", "Socratic", "Deeply technical"] as const;
export type ExplanationTone = (typeof EXPLANATION_TONES)[number];

export const DEFAULT_DAILY_GOAL_MINUTES = 20;
export const DEFAULT_EXPLANATION_TONE: ExplanationTone = "Concise";
export const DEFAULT_DECAY_REMINDERS = true;

/** Row shape of `public.profiles`. */
export type Profile = {
  id: string;
  updated_at: string;
  streak_count: number;
  last_active_date: string | null;
  display_name: string | null;
  daily_goal_minutes: number;
  explanation_tone: ExplanationTone;
  decay_reminders: boolean;
};

export type ProfilePreferences = {
  displayName: string;
  dailyGoalMinutes: number;
  explanationTone: ExplanationTone;
  decayReminders: boolean;
};

export function isExplanationTone(value: unknown): value is ExplanationTone {
  return typeof value === "string" && (EXPLANATION_TONES as readonly string[]).includes(value);
}

export function profilePreferencesFrom(profile: Profile | null | undefined): ProfilePreferences {
  return {
    displayName: profile?.display_name?.trim() ?? "",
    dailyGoalMinutes: profile?.daily_goal_minutes ?? DEFAULT_DAILY_GOAL_MINUTES,
    explanationTone: isExplanationTone(profile?.explanation_tone)
      ? profile.explanation_tone
      : DEFAULT_EXPLANATION_TONE,
    decayReminders: profile?.decay_reminders ?? DEFAULT_DECAY_REMINDERS,
  };
}

/**
 * Plain `select` of every mastery row the user owns. RLS already restricts
 * `user_topic_mastery` to `auth.uid() = user_id`, so `userId` mainly documents
 * intent and lets callers scope their query cache key.
 */
export async function getTopicMastery(userId: string): Promise<TopicMastery[]> {
  const { data, error } = await requireClient()
    .from("user_topic_mastery")
    .select("*")
    .eq("user_id", userId);

  if (error) throw error;
  return data ?? [];
}

/**
 * Bumps mastery for a topic through the `increment_mastery` Postgres RPC.
 * Used for login-merge of local scores (arbitrary totals, chunked at ±10).
 * Quiz answers must go through `applyTopicQuizResult` instead so the delta
 * is chosen server-side rather than rolled on the client.
 *
 * `user_topic_mastery` has no client-writable insert/update RLS policy, and
 * the RPC (`SECURITY DEFINER`) both clamps `mastery_score` to [0, 100] and
 * rejects any `delta` outside [-10, 10].
 */
export async function incrementTopicMastery(topicId: string, delta: number): Promise<TopicMastery> {
  const { data, error } = await requireClient().rpc("increment_mastery", {
    p_topic_id: topicId,
    p_delta: delta,
  });

  if (error) throw error;
  if (!data) throw new Error("increment_mastery returned no row.");
  return data as TopicMastery;
}

/**
 * Applies one quiz answer through `apply_quiz_result`. The client only sends
 * `correct` — Postgres picks the delta (Beginner +3 / Intermediate +2 /
 * Advanced +1 / miss −1), then `increment_mastery` clamps and stamps
 * `last_reviewed_at`.
 */
export async function applyTopicQuizResult(
  topicId: string,
  correct: boolean,
): Promise<TopicMastery> {
  const { data, error } = await requireClient().rpc("apply_quiz_result", {
    p_topic_id: topicId,
    p_correct: correct,
  });

  if (error) throw error;
  if (!data) throw new Error("apply_quiz_result returned no row.");
  return data as TopicMastery;
}

const QUIZ_STEM_MAX = 500;

/**
 * Persists one quiz answer through `log_quiz_attempt`. Not a Gemini call and
 * not quota-gated. Fire-and-forget from the quiz UI — failures should toast,
 * never block answering.
 */
export async function logQuizAttempt(
  topicId: string,
  stem: string,
  correct: boolean,
): Promise<void> {
  const { error } = await requireClient().rpc("log_quiz_attempt", {
    p_topic_id: topicId,
    p_stem: stem.trim().slice(0, QUIZ_STEM_MAX),
    p_correct: correct,
  });

  if (error) throw error;
}

/**
 * Advances the user's streak through the `touch_streak` Postgres RPC.
 * Same-day/consecutive-day/reset streak math lives entirely in Postgres
 * (see the `touch_streak` function) so it can never be spoofed from the
 * client — this function only ever asks the server to recompute it.
 */
export async function touchStreak(): Promise<Profile> {
  const { data, error } = await requireClient().rpc("touch_streak");

  if (error) throw error;
  if (!data) throw new Error("touch_streak returned no row.");
  return data as Profile;
}

/** Plain `select` of the user's profile row (streak, last active date, preferences). */
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await requireClient()
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Replaces Settings preference columns through `update_profile_preferences`.
 * Streak fields are untouched — same SELECT-only client policy as `touch_streak`.
 */
export async function updateProfilePreferences(prefs: ProfilePreferences): Promise<Profile> {
  const { data, error } = await requireClient().rpc("update_profile_preferences", {
    p_display_name: prefs.displayName.trim() || null,
    p_daily_goal_minutes: prefs.dailyGoalMinutes,
    p_explanation_tone: prefs.explanationTone,
    p_decay_reminders: prefs.decayReminders,
  });

  if (error) throw error;
  if (!data) throw new Error("update_profile_preferences returned no row.");
  return data as Profile;
}

/** Row shape of `public.custom_topics` (see `supabase/sql/custom_topics.sql`). */
export type CustomTopicLevel = "beginner" | "intermediate" | "advanced";

export type CustomTopic = {
  id: string;
  user_id: string;
  title: string;
  level: CustomTopicLevel;
  created_at: string;
};

/**
 * Plain `select` of every custom topic the user has created. RLS already
 * restricts `custom_topics` to `auth.uid() = user_id`, so `userId` mainly
 * documents intent and lets callers scope their query cache key, same as
 * `getTopicMastery` above.
 */
export async function getCustomTopics(userId: string): Promise<CustomTopic[]> {
  const { data, error } = await requireClient()
    .from("custom_topics")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/** Distinguishes user-created topics from the app's built-in demo topics — see `MergedTopic`. */
export type TopicSource = "demo" | "custom";

/** PDF metadata for a custom topic — never includes `study_brief`. */
export type TopicPdfMeta = {
  fileName: string;
  status: "ready" | "failed";
  pageCount: number | null;
  failureReason: string | null;
};

/**
 * A `Topic` tagged with where it came from, so the UI (matrix, study room,
 * etc.) can visually distinguish "Custom" from "Demo" topics without
 * needing to know the underlying data source itself.
 */
export type MergedTopic = Topic & { source: TopicSource; pdf?: TopicPdfMeta | null };

const CUSTOM_TOPIC_DIFFICULTY: Record<CustomTopicLevel, Topic["difficulty"]> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/**
 * Adapts a `custom_topics` row into the shape the rest of the app already
 * knows how to render as a `Topic`. There's no static quiz/resource/summary
 * content for a user-created topic (that's generated on demand by
 * `generateQuiz` / `createCustomTopic`), so those fields start empty — a
 * freshly created topic still ships its first question via `createCustomTopic`
 * so the study room can render immediately.
 */
function customTopicToMergedTopic(row: CustomTopic, pdf?: TopicPdfMeta | null): MergedTopic {
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
    source: "custom",
    pdf: pdf ?? null,
  };
}

type TopicDocumentMetaRow = {
  topic_id: string;
  file_name: string;
  status: "ready" | "failed";
  page_count: number | null;
  failure_reason: string | null;
};

async function getTopicPdfMetas(userId: string): Promise<Map<string, TopicPdfMeta>> {
  const { data, error } = await requireClient()
    .from("topic_documents")
    .select("topic_id, file_name, status, page_count, failure_reason")
    .eq("user_id", userId);

  if (error) throw error;
  const map = new Map<string, TopicPdfMeta>();
  for (const row of (data ?? []) as TopicDocumentMetaRow[]) {
    map.set(row.topic_id, {
      fileName: row.file_name,
      status: row.status,
      pageCount: row.page_count,
      failureReason: row.failure_reason,
    });
  }
  return map;
}

/** Uploads (or replaces) the one PDF object for a custom topic. */
export async function uploadTopicPdf(
  userId: string,
  topicId: string,
  bytes: Uint8Array,
): Promise<void> {
  const { error } = await requireClient()
    .storage.from(TOPIC_PDF_BUCKET)
    .upload(
      topicPdfObjectPath(userId, topicId),
      new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      {
        upsert: true,
        // Bucket only allows application/pdf — ignore whatever the OS/browser reported.
        contentType: "application/pdf",
        cacheControl: "3600",
      },
    );
  if (error) throw error;
}

/**
 * Fetches this user's custom topics and merges them alongside the app's
 * built-in demo topics, each tagged with `source: "demo" | "custom"` (see
 * `MergedTopic`) — the single list the Knowledge Matrix and similar
 * topic-listing UI should load from once they want to surface custom
 * topics, instead of importing the static `topics` array directly.
 */
export async function getMergedTopics(userId: string): Promise<MergedTopic[]> {
  const demoTopics: MergedTopic[] = topics.map((t) => ({ ...t, source: "demo" }));
  const [customRows, pdfMetas] = await Promise.all([
    getCustomTopics(userId),
    getTopicPdfMetas(userId).catch((error) => {
      console.error("Failed to load topic PDF metadata (non-fatal):", error);
      return new Map<string, TopicPdfMeta>();
    }),
  ]);
  return [
    ...demoTopics,
    ...customRows.map((row) => customTopicToMergedTopic(row, pdfMetas.get(row.id) ?? null)),
  ];
}
