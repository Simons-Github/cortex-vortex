-- P0 security hardening (idempotent). Safe to re-run on an existing project.
-- Also reflected in profiles.sql / mastery_streak_rpcs.sql / ai_usage_log.sql
-- for fresh installs. Apply via Supabase SQL Editor or migration tooling.

-- 1. profiles: SELECT-only for clients. Streak writes must go through touch_streak.
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;

-- 2. handle_new_user: trigger-only — not callable via PostgREST /rpc.
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

-- 3. App RPCs: authenticated only (revoke PUBLIC + anon explicitly).
revoke all on function public.increment_mastery(text, integer) from public;
revoke all on function public.increment_mastery(text, integer) from anon;
grant execute on function public.increment_mastery(text, integer) to authenticated;

revoke all on function public.touch_streak() from public;
revoke all on function public.touch_streak() from anon;
grant execute on function public.touch_streak() to authenticated;

revoke all on function public.log_ai_usage(text, text) from public;
revoke all on function public.log_ai_usage(text, text) from anon;
grant execute on function public.log_ai_usage(text, text) to authenticated;

revoke all on function public.try_log_ai_usage(text, text, integer) from public;
revoke all on function public.try_log_ai_usage(text, text, integer) from anon;
grant execute on function public.try_log_ai_usage(text, text, integer) to authenticated;

revoke all on function public.try_log_key_save(text) from public;
revoke all on function public.try_log_key_save(text) from anon;
grant execute on function public.try_log_key_save(text) to authenticated;

-- Quiz attempts (see quiz_attempts.sql — apply that file first on a fresh DB).
revoke all on function public.log_quiz_attempt(text, text, boolean) from public;
revoke all on function public.log_quiz_attempt(text, text, boolean) from anon;
grant execute on function public.log_quiz_attempt(text, text, boolean) to authenticated;

revoke all on function public.list_recent_quiz_misses(text, integer) from public;
revoke all on function public.list_recent_quiz_misses(text, integer) from anon;
grant execute on function public.list_recent_quiz_misses(text, integer) to authenticated;

revoke all on function public.apply_quiz_result(text, boolean) from public;
revoke all on function public.apply_quiz_result(text, boolean) from anon;
grant execute on function public.apply_quiz_result(text, boolean) to authenticated;

-- BYOK privileged RPCs: service_role only (never anon/authenticated).
revoke all on function public.service_require_role() from public;
revoke all on function public.service_require_role() from anon;
revoke all on function public.service_require_role() from authenticated;
grant execute on function public.service_require_role() to service_role;

revoke all on function public.service_upsert_user_gemini_key(uuid, text, text) from public;
revoke all on function public.service_upsert_user_gemini_key(uuid, text, text) from anon;
revoke all on function public.service_upsert_user_gemini_key(uuid, text, text) from authenticated;
grant execute on function public.service_upsert_user_gemini_key(uuid, text, text) to service_role;

revoke all on function public.service_load_user_gemini_key(uuid) from public;
revoke all on function public.service_load_user_gemini_key(uuid) from anon;
revoke all on function public.service_load_user_gemini_key(uuid) from authenticated;
grant execute on function public.service_load_user_gemini_key(uuid) to service_role;

revoke all on function public.service_hint_user_gemini_key(uuid) from public;
revoke all on function public.service_hint_user_gemini_key(uuid) from anon;
revoke all on function public.service_hint_user_gemini_key(uuid) from authenticated;
grant execute on function public.service_hint_user_gemini_key(uuid) to service_role;

revoke all on function public.service_delete_user_gemini_key(uuid) from public;
revoke all on function public.service_delete_user_gemini_key(uuid) from anon;
revoke all on function public.service_delete_user_gemini_key(uuid) from authenticated;
grant execute on function public.service_delete_user_gemini_key(uuid) to service_role;

-- 4. Fail closed if somehow invoked without a JWT (defense in depth).
create or replace function public.increment_mastery(p_topic_id text, p_delta integer)
returns public.user_topic_mastery
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.user_topic_mastery;
begin
  if auth.uid() is null then
    raise exception 'increment_mastery requires an authenticated user';
  end if;

  if p_delta < -10 or p_delta > 10 then
    raise exception 'invalid delta: must be between -10 and 10';
  end if;

  insert into public.user_topic_mastery (user_id, topic_id, mastery_score, last_reviewed_at)
  values (auth.uid(), p_topic_id, greatest(0, least(100, p_delta)), now())
  on conflict (user_id, topic_id)
  do update set
    mastery_score = greatest(0, least(100, public.user_topic_mastery.mastery_score + p_delta)),
    last_reviewed_at = now()
  returning * into result;

  return result;
end;
$$;

create or replace function public.touch_streak()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.profiles;
  last_date date;
begin
  if auth.uid() is null then
    raise exception 'touch_streak requires an authenticated user';
  end if;

  select last_active_date into last_date from public.profiles where id = auth.uid();

  if last_date = current_date then
    null;
  elsif last_date = current_date - 1 then
    update public.profiles
      set streak_count = streak_count + 1,
          last_active_date = current_date,
          updated_at = now()
      where id = auth.uid();
  else
    update public.profiles
      set streak_count = 1,
          last_active_date = current_date,
          updated_at = now()
      where id = auth.uid();
  end if;

  select * into result from public.profiles where id = auth.uid();
  return result;
end;
$$;

-- Re-assert grants after CREATE OR REPLACE (which can reset privileges).
revoke all on function public.increment_mastery(text, integer) from public;
revoke all on function public.increment_mastery(text, integer) from anon;
grant execute on function public.increment_mastery(text, integer) to authenticated;

revoke all on function public.touch_streak() from public;
revoke all on function public.touch_streak() from anon;
grant execute on function public.touch_streak() to authenticated;
