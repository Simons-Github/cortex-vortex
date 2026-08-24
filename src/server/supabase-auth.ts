/**
 * Server-side verification of a Supabase access token. This gates the
 * Gemini endpoints (`src/lib/gemini-actions.ts`) behind a real signed-in
 * user without ever trusting anything the client claims about itself.
 *
 * The browser's Supabase session lives in its own storage and never
 * automatically reaches the server here, so the client attaches its
 * current `access_token` to each request and this module independently
 * re-validates that token against the Supabase Auth server on every call
 * (via `auth.getUser(token)`) — a spoofed or expired token simply fails.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const authClient =
  supabaseUrl && supabasePublishableKey
    ? createClient(supabaseUrl, supabasePublishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/**
 * Returns the authenticated Supabase user for `accessToken`, or `null` if
 * the token is missing, invalid, expired, or Supabase isn't configured on
 * the server. Callers that require a signed-in user should treat `null`
 * as "not authenticated" and fail closed.
 */
export async function getAuthenticatedUser(
  accessToken: string | null | undefined,
): Promise<User | null> {
  if (!authClient || !accessToken) return null;

  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}

/**
 * Creates a Supabase client scoped to a single caller by attaching their
 * access token as the `Authorization` header. Unlike the shared `authClient`
 * singleton above (used only for one-off token verification), this client is
 * created fresh per call so concurrent requests from different users never
 * share session state — and any RPC called through it runs with `auth.uid()`
 * resolved to that user, which is what lets a `SECURITY DEFINER` function
 * like `log_ai_usage` attribute the row it inserts to the right person.
 */
function createUserScopedClient(accessToken: string): SupabaseClient | null {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabasePublishableKey) return null;

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Reserves one "save own Gemini key" slot (5 per rolling 10 minutes) via
 * `try_log_key_save`. Returns `true` when reserved, `false` when at/over
 * limit, `null` if Supabase isn't configured.
 */
export async function tryLogKeySave(
  accessToken: string,
  ipAddress: string | null,
): Promise<boolean | null> {
  const client = createUserScopedClient(accessToken);
  if (!client) return null;

  const { data, error } = await client.rpc("try_log_key_save", {
    p_ip: ipAddress,
  });
  if (error) throw error;
  return Boolean(data);
}

/**
 * Endpoints tracked by the `ai_usage_log` daily quota (see
 * `supabase/sql/ai_usage_log.sql` and `supabase/sql/custom_topics.sql`).
 * `topic_moderation` is logged for visibility only — it is never checked
 * against its own quota, since it always follows a `create_topic` quota
 * check that already gates it.
 */
export type AiUsageEndpoint = "explain" | "quiz" | "create_topic" | "topic_moderation";

/**
 * Logs one AI usage event through the `log_ai_usage` Postgres RPC — a
 * `SECURITY DEFINER` function, since `ai_usage_log` has no client-writable
 * insert policy — and returns the caller's rolling 24h request count for
 * `endpoint`, including the row just inserted.
 *
 * Prefer `tryLogAiUsage` for quota-gated endpoints so over-limit probes do
 * not insert. This unconditional logger is for visibility-only rows
 * (e.g. `topic_moderation`).
 *
 * Returns `null` if Supabase isn't configured, so callers can fail open
 * (skip quota enforcement) rather than block AI features entirely when
 * there's no backend to track usage against.
 */
export async function logAiUsage(
  accessToken: string,
  endpoint: AiUsageEndpoint,
  ipAddress: string | null,
): Promise<number | null> {
  const client = createUserScopedClient(accessToken);
  if (!client) return null;

  const { data, error } = await client.rpc("log_ai_usage", {
    p_endpoint: endpoint,
    p_ip: ipAddress,
  });
  if (error) throw error;
  return typeof data === "number" ? data : Number(data);
}

/** Endpoints that share the combined rolling-24h pool of 5 (not burst / moderation). */
const DAILY_QUOTA_ENDPOINTS: Exclude<AiUsageEndpoint, "topic_moderation">[] = [
  "explain",
  "quiz",
  "create_topic",
];

/**
 * Read-only rolling 24h usage count across explain + quiz + create_topic,
 * via the caller's RLS SELECT policy on `ai_usage_log` (no insert). Used as
 * an early gate before expensive work (e.g. topic moderation) so over-quota
 * callers are rejected without consuming a slot or burning Gemini.
 *
 * Returns `null` if Supabase isn't configured (demo mode).
 */
export async function countAiUsage(accessToken: string): Promise<number | null> {
  const client = createUserScopedClient(accessToken);
  if (!client) return null;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await client
    .from("ai_usage_log")
    .select("*", { count: "exact", head: true })
    .in("endpoint", DAILY_QUOTA_ENDPOINTS)
    .gt("created_at", since);

  if (error) throw error;
  return count ?? 0;
}

/**
 * Atomically reserves one daily-quota slot via `try_log_ai_usage`: counts the
 * caller's rolling 24h rows across explain + quiz + create_topic and inserts
 * only when that combined count is under the hardcoded cap of 5. Returns
 * `true` when reserved, `false` when already at/over limit (no row written).
 *
 * Returns `null` if Supabase isn't configured (demo mode — treat as allowed).
 */
export async function tryLogAiUsage(
  accessToken: string,
  endpoint: Exclude<AiUsageEndpoint, "topic_moderation">,
  ipAddress: string | null,
  limit: number,
): Promise<boolean | null> {
  const client = createUserScopedClient(accessToken);
  if (!client) return null;

  const { data, error } = await client.rpc("try_log_ai_usage", {
    p_endpoint: endpoint,
    p_ip: ipAddress,
    p_limit: limit,
  });
  if (error) throw error;
  return Boolean(data);
}

/** Endpoints that have a short-window burst cap (see `try_log_ai_burst`). */
export type AiBurstEndpoint = "explain" | "quiz" | "create_topic";

/**
 * Atomically reserves one burst-limit slot via `try_log_ai_burst`: counts the
 * caller's rolling 60s rows for `burst_<endpoint>` and inserts only when under
 * `limit`. Returns `true` when reserved, `false` when already at/over limit
 * (no row written). Independent of the 24h daily quota.
 *
 * Returns `null` if Supabase isn't configured (demo mode — treat as allowed).
 */
export async function tryLogAiBurst(
  accessToken: string,
  endpoint: AiBurstEndpoint,
  ipAddress: string | null,
  limit: number,
): Promise<boolean | null> {
  const client = createUserScopedClient(accessToken);
  if (!client) return null;

  const { data, error } = await client.rpc("try_log_ai_burst", {
    p_endpoint: endpoint,
    p_ip: ipAddress,
    p_limit: limit,
  });
  if (error) throw error;
  return Boolean(data);
}

/** Row shape of `public.custom_topics` (see `supabase/sql/custom_topics.sql`). */
export type CustomTopicLevel = "beginner" | "intermediate" | "advanced";

export type CustomTopicRow = {
  id: string;
  user_id: string;
  title: string;
  level: CustomTopicLevel;
  created_at: string;
};

/** Postgres error code for a unique constraint violation. */
const UNIQUE_VIOLATION = "23505";

export type InsertCustomTopicResult =
  | { row: CustomTopicRow; duplicate: false; quotaExceeded: false }
  | { row: null; duplicate: true; quotaExceeded: false }
  | { row: null; duplicate: false; quotaExceeded: true }
  | { row: null; duplicate: false; quotaExceeded: false };

function isQuotaExceededError(error: { code?: string; message?: string }): boolean {
  return (error.message ?? "").includes("quota_exceeded");
}

function isDuplicateTopicError(error: { code?: string; message?: string }): boolean {
  const message = error.message ?? "";
  return error.code === UNIQUE_VIOLATION || message.includes("duplicate_topic");
}

/**
 * Creates one custom topic through the `create_custom_topic` SECURITY DEFINER
 * RPC — the only remaining write path now that `custom_topics` has no INSERT
 * policy. The RPC resolves `auth.uid()` itself, atomically reserves one slot
 * from the shared daily pool of 5 (advisory lock `ai_daily`, same pattern as
 * `try_log_ai_usage`), and inserts only after that slot is reserved.
 *
 * Returns `{ row: null, duplicate: false, quotaExceeded: false }` if
 * Supabase isn't configured; `{ quotaExceeded: true }` when the daily
 * limit is already consumed (no row written); `{ duplicate: true }` if
 * `(user_id, title, level)` already exists (the quota insert rolls back
 * with the unique violation).
 */
export async function insertCustomTopic(
  accessToken: string,
  title: string,
  level: CustomTopicLevel,
  ipAddress: string | null,
): Promise<InsertCustomTopicResult> {
  const client = createUserScopedClient(accessToken);
  if (!client) return { row: null, duplicate: false, quotaExceeded: false };

  const { data, error } = await client.rpc("create_custom_topic", {
    p_title: title,
    p_level: level,
    p_ip: ipAddress,
  });

  if (error) {
    if (isDuplicateTopicError(error)) {
      return { row: null, duplicate: true, quotaExceeded: false };
    }
    if (isQuotaExceededError(error)) {
      return { row: null, duplicate: false, quotaExceeded: true };
    }
    throw error;
  }
  return { row: data as CustomTopicRow, duplicate: false, quotaExceeded: false };
}

/**
 * Looks up one of the caller's custom topics by id through a user-scoped
 * client. RLS already restricts `custom_topics` to `auth.uid() = user_id`,
 * so a missing or foreign row simply returns `null` — never another user's
 * topic. Returns `null` if Supabase isn't configured.
 */
export async function getCustomTopicById(
  accessToken: string,
  topicId: string,
): Promise<CustomTopicRow | null> {
  const client = createUserScopedClient(accessToken);
  if (!client) return null;

  const { data, error } = await client
    .from("custom_topics")
    .select("*")
    .eq("id", topicId)
    .maybeSingle();

  if (error) throw error;
  return (data as CustomTopicRow | null) ?? null;
}

const DEFAULT_MISS_LIMIT = 8;

/**
 * Last N missed quiz stems for this topic via `list_recent_quiz_misses`.
 * Used by generate/explain so prompts can target weak spots. Returns `[]`
 * if Supabase isn't configured or the RPC errors — callers fail open so a
 * missing migration never blocks Gemini.
 */
export async function listRecentQuizMisses(
  accessToken: string,
  topicId: string,
  limit = DEFAULT_MISS_LIMIT,
): Promise<string[]> {
  const client = createUserScopedClient(accessToken);
  if (!client) return [];

  const { data, error } = await client.rpc("list_recent_quiz_misses", {
    p_topic_id: topicId,
    p_limit: limit,
  });
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return data.filter((stem): stem is string => typeof stem === "string" && stem.trim().length > 0);
}
