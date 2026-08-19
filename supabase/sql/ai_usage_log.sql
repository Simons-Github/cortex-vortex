-- Per-user daily quota tracking for AI (Gemini) requests.
-- Review and run this in the Supabase SQL Editor.

-- 1. Table: one row per AI request (explain / quiz), used to count usage
--    within a rolling 24h window.
create table if not exists public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null check (endpoint in ('explain', 'quiz')),
  ip_address text,
  created_at timestamptz not null default now()
);

-- 2. Index for fast "count rows for this user+endpoint in the last 24h" lookups.
create index if not exists ai_usage_log_user_endpoint_created_at_idx
  on public.ai_usage_log (user_id, endpoint, created_at);

-- 3. RLS: users can read only their own usage rows. There is deliberately
--    no insert/update/delete policy for clients — the only way a row gets
--    written is through the `log_ai_usage` SECURITY DEFINER RPC below.
alter table public.ai_usage_log enable row level security;

create policy "Users can view their own AI usage"
  on public.ai_usage_log
  for select
  using (auth.uid() = user_id);

-- 4. RPC: unconditional insert + rolling 24h count. Used for visibility-only
--    endpoints (e.g. `topic_moderation`) that should always record a row.
--    Quota-gated endpoints should call `try_log_ai_usage` instead so an
--    over-limit probe never inserts.
create or replace function public.log_ai_usage(p_endpoint text, p_ip text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'log_ai_usage requires an authenticated user';
  end if;

  insert into public.ai_usage_log (user_id, endpoint, ip_address)
  values (v_user_id, p_endpoint, p_ip);

  select count(*)::integer into v_count
  from public.ai_usage_log
  where user_id = v_user_id
    and endpoint = p_endpoint
    and created_at > now() - interval '24 hours';

  return v_count;
end;
$$;

-- Only signed-in users may call the RPC; it resolves auth.uid() itself and
-- runs as the function owner (SECURITY DEFINER) to bypass the table's
-- lack of a client-writable insert policy. Explicitly revoke from PUBLIC
-- *and* anon — Supabase default grants can leave anon executable.
revoke all on function public.log_ai_usage(text, text) from public;
revoke all on function public.log_ai_usage(text, text) from anon;
grant execute on function public.log_ai_usage(text, text) to authenticated;

-- 5. Atomic compare-and-insert for quota-gated endpoints. Counts the caller's
--    rolling 24h rows across explain + quiz + create_topic (shared pool of 5)
--    and only inserts when that combined count is under the cap. `p_limit` is
--    kept for signature compatibility; the cap is hardcoded so a direct RPC
--    caller cannot raise it. A shared advisory lock (`ai_daily`) serializes
--    concurrent consumes across those three endpoints so two in-flight
--    requests cannot both slip under the combined limit. Burst rows
--    (`burst_*`) and `topic_moderation` are excluded from the count.
create or replace function public.try_log_ai_usage(
  p_endpoint text,
  p_ip text,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_combined_limit constant integer := 5;
begin
  if v_user_id is null then
    raise exception 'try_log_ai_usage requires an authenticated user';
  end if;

  if p_limit is null or p_limit < 0 then
    raise exception 'try_log_ai_usage requires a non-negative p_limit';
  end if;

  if p_endpoint not in ('explain', 'quiz', 'create_topic') then
    raise exception 'try_log_ai_usage: unsupported endpoint %', p_endpoint;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext('ai_daily'));

  select count(*)::integer into v_count
  from public.ai_usage_log
  where user_id = v_user_id
    and endpoint in ('explain', 'quiz', 'create_topic')
    and created_at > now() - interval '24 hours';

  if v_count >= v_combined_limit then
    return false;
  end if;

  insert into public.ai_usage_log (user_id, endpoint, ip_address)
  values (v_user_id, p_endpoint, p_ip);

  return true;
end;
$$;

revoke all on function public.try_log_ai_usage(text, text, integer) from public;
revoke all on function public.try_log_ai_usage(text, text, integer) from anon;
grant execute on function public.try_log_ai_usage(text, text, integer) to authenticated;
