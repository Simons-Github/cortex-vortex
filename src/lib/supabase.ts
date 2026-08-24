import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { topics, type Topic } from "@/lib/mock-data";

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

/** Row shape of `public.profiles`. */
export type Profile = {
  id: string;
  updated_at: string;
  streak_count: number;
  last_active_date: string | null;
};

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
 * This is deliberately the *only* way mastery ever changes server-side:
 * `user_topic_mastery` has no client-writable insert/update RLS policy, and
 * the RPC (`SECURITY DEFINER`) both clamps `mastery_score` to [0, 100] and
 * rejects any `delta` outside [-10, 10] — never trust a client-computed
 * final score, only ever send a small delta and use the row it returns.
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

/** Plain `select` of the user's profile row (streak, last active date, etc). */
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await requireClient()
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
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

/**
 * A `Topic` tagged with where it came from, so the UI (matrix, study room,
 * etc.) can visually distinguish "Custom" from "Demo" topics without
 * needing to know the underlying data source itself.
 */
export type MergedTopic = Topic & { source: TopicSource };

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
function customTopicToMergedTopic(row: CustomTopic): MergedTopic {
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
  };
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
  const customRows = await getCustomTopics(userId);
  return [...demoTopics, ...customRows.map(customTopicToMergedTopic)];
}
