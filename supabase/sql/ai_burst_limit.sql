-- Cross-instance burst limiter for Gemini endpoints.
-- Review and run this in the Supabase SQL Editor *last* (after
-- `custom_topics.sql`): that file resets `ai_usage_log_endpoint_check`, so
-- this migration must re-extend it. Safe to re-run (idempotent).
--
-- Same table and compare-and-insert pattern as `try_log_ai_usage`
-- (`ai_usage_log.sql`), but a rolling 60s window instead of 24h. Burst rows
-- are stored under `burst_<endpoint>` so they are invisible to the daily
-- quota count, which stays on `explain` / `quiz` / `create_topic`.

-- 1. Allow burst endpoint values on the shared usage log.
alter table public.ai_usage_log
  drop constraint if exists ai_usage_log_endpoint_check;

alter table public.ai_usage_log
  add constraint ai_usage_log_endpoint_check
  check (endpoint in (
    'explain',
    'quiz',
    'create_topic',
    'topic_moderation',
    'burst_explain',
    'burst_quiz',
    'burst_create_topic'
  ));

-- 2. Atomic compare-and-insert for the short-window burst layer. Counts the
--    caller's rolling 60s rows for `burst_<p_endpoint>`, and only inserts
--    when count < p_limit. Returns true when a row was reserved, false when
--    already at/over limit (no insert). An advisory transaction lock
--    serializes concurrent consumes for the same user+burst-endpoint so two
--    in-flight requests cannot both slip under the limit.
drop function if exists public.try_log_ai_burst(text, text, integer);
drop function if exists public.try_log_ai_burst(text, text);

create or replace function public.try_log_ai_burst(
  p_endpoint text,
  p_ip text,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_burst_endpoint text;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'try_log_ai_burst requires an authenticated user';
  end if;

  if p_limit is null or p_limit < 0 then
    raise exception 'try_log_ai_burst requires a non-negative p_limit';
  end if;

  if p_endpoint not in ('explain', 'quiz', 'create_topic') then
    raise exception 'try_log_ai_burst: unsupported endpoint %', p_endpoint;
  end if;

  v_burst_endpoint := 'burst_' || p_endpoint;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_user_id::text),
    pg_catalog.hashtext(v_burst_endpoint)
  );

  select count(*)::integer into v_count
  from public.ai_usage_log
  where user_id = v_user_id
    and endpoint = v_burst_endpoint
    and created_at > pg_catalog.now() - interval '60 seconds';

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.ai_usage_log (user_id, endpoint, ip_address)
  values (v_user_id, v_burst_endpoint, p_ip);

  return true;
end;
$$;

revoke all on function public.try_log_ai_burst(text, text, integer) from public;
revoke all on function public.try_log_ai_burst(text, text, integer) from anon;
grant execute on function public.try_log_ai_burst(text, text, integer) to authenticated;
