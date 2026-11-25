# Database setup

All schema lives in `supabase/sql/` as idempotent snippets. Run them in the Supabase SQL Editor before deploying app code that calls the RPCs. Order matters because `custom_topics.sql` resets `ai_usage_log_endpoint_check`.

## Fresh project

1. `profiles.sql` - profiles + signup trigger
2. `profile_preferences.sql` - preference columns + `update_profile_preferences`
3. `user_topic_mastery.sql` - mastery table (SELECT-only)
4. `mastery_streak_rpcs.sql` - `increment_mastery` / `touch_streak`
5. `quiz_attempts.sql` - attempt log + `log_quiz_attempt` / `list_recent_quiz_misses` / `apply_quiz_result`
6. `ai_usage_log.sql` - usage log + `log_ai_usage` / `try_log_ai_usage`
7. `custom_topics.sql` - custom topics table (SELECT-only; no client INSERT)
8. `user_gemini_keys.sql` - `private.user_gemini_keys` + service_role RPCs + `try_log_key_save`
9. `create_custom_topic.sql` - atomic quota + insert RPC (skips quota when a BYOK row exists)
10. `topic_documents.sql` - private `topic-pdfs` bucket + SELECT-only `topic_documents`
11. `ai_burst_limit.sql` - last among the usage-log files (`burst_*` including `burst_pdf_ingest`)
12. `security_hardening_p0.sql` - extra GRANT/REVOKE hardening (safe on a fresh DB too)

Then, in the Supabase dashboard:

- Enable Authentication -> Providers -> Email (and Google, if used).
- Set redirect URLs (local: `http://localhost:8080`; production: your deployed origin).
- Optional: enable [leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Upgrading an existing project

Re-run the files for the feature you are adding:

- Attempt logging: re-run `quiz_attempts.sql` (adds `apply_quiz_result`).
- Combined daily pool of 5: re-run `ai_combined_daily_quota.sql` if the DB still has a per-endpoint daily cap.
- Always run `ai_burst_limit.sql` after `custom_topics.sql`.
- BYOK: `user_gemini_keys.sql`, then `create_custom_topic.sql` and `ai_burst_limit.sql`.
- Profile preferences: `profile_preferences.sql`, then `security_hardening_p0.sql`.
- PDF sources: `topic_documents.sql`, then `ai_burst_limit.sql` and `security_hardening_p0.sql`.

## Tables and RPCs

| Table / RPC                  | Purpose                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `profiles`                   | Streak + Settings preferences. SELECT-only; writes via RPCs                          |
| `update_profile_preferences` | SECURITY DEFINER. Display name, daily goal, tone, decay reminders (`auth.uid()`)     |
| `user_topic_mastery`         | Mastery score per topic. SELECT-only                                                 |
| `custom_topics`              | User-created topics. SELECT-only; inserts via RPC only                               |
| `ai_usage_log`               | Rolling 24h AI quota log (plus 60s `burst_*` rows)                                   |
| `private.user_gemini_keys`   | Encrypted BYOK Gemini keys. Not in the Data API; service_role RPCs only              |
| `service_*_user_gemini_key`  | SECURITY DEFINER. Upsert/load/hint/delete; `auth.role()` must be `service_role`      |
| `try_log_key_save`           | SECURITY DEFINER. 5 key saves per rolling 10 minutes                                 |
| `quiz_attempts`              | Per-answer log (SELECT-only); stems truncated to 500                                 |
| `log_quiz_attempt`           | SECURITY DEFINER. Insert one attempt (`auth.uid()`)                                  |
| `list_recent_quiz_misses`    | SECURITY DEFINER. Last N missed stems for a topic                                    |
| `apply_quiz_result`          | SECURITY DEFINER. Takes `correct` only; delta via `levelFor`, then `increment_mastery` |
| `increment_mastery`          | SECURITY DEFINER. Delta +/-10, score 0-100 (`last_reviewed_at`)                      |
| `touch_streak`               | SECURITY DEFINER. Streak per calendar day                                            |
| `create_custom_topic`        | SECURITY DEFINER. Quota + insert (quota skipped when a BYOK row exists)              |
| `topic_documents`            | One PDF per custom topic + capped study brief. SELECT-only; writes via service_role  |
| `log_ai_usage`               | SECURITY DEFINER. Visibility-only rows (e.g. `topic_moderation`)                     |
| `try_log_ai_usage`           | SECURITY DEFINER. Atomic combined 24h quota (5 across explain/quiz/create_topic)     |
| `try_log_ai_burst`           | SECURITY DEFINER. Atomic 60s burst reservation                                       |

Tables use Row Level Security (`auth.uid()` = own row). Mastery, streak, profile preferences, custom topics and quiz attempts are not written directly from the client, only through RPCs.

## Limits

- Daily AI quota (rolling 24h, combined): 5 requests across Explain, Quiz and Create Topic. Skipped when the caller has a stored BYOK key, since the pool protects the platform key, not the user's own Google bill.
- Burst limits (rolling 60s, shared across server instances): Explain 20, Quiz 30, Create Topic 5, PDF ingest 3. These still apply with BYOK.
- Key saves: 5 per rolling 10 minutes.
