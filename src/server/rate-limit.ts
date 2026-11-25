/**
 * Cross-instance burst limiter for Gemini endpoints.
 *
 * Delegates to `try_log_ai_burst` (`supabase/sql/ai_burst_limit.sql`), which
 * counts `ai_usage_log` rows in a rolling 60s window. Burst hits are stored
 * under `burst_<endpoint>` so they do not inflate the 24h daily quota
 * (`try_log_ai_usage`). An advisory transaction lock serializes concurrent
 * consumes for the same user+endpoint.
 *
 * Returns true if the caller is still within the burst limit and a row was
 * reserved; false if they should fall back for this window. Returns true in
 * demo mode (Supabase not configured).
 */
import { tryLogAiBurst, type AiBurstEndpoint } from "@/server/supabase-auth";

export async function consumeRateLimit(
  accessToken: string,
  endpoint: AiBurstEndpoint,
  limit: number,
  ipAddress: string | null,
): Promise<boolean> {
  const reserved = await tryLogAiBurst(accessToken, endpoint, ipAddress, limit);
  if (reserved === null) return true;
  return reserved;
}
