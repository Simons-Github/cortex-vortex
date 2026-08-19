-- SECURITY DEFINER RPC that owns all writes to `custom_topics`.
-- Review and run this in the Supabase SQL Editor *after* custom_topics.sql
-- (and ai_usage_log.sql). Idempotent — safe to re-run on an existing project.
--
-- Direct client INSERTs are no longer allowed. This function:
--   1. Validates the title with the same structural guards the
--      `isTopicAllowed` caller applies (trim, 3–80 chars, no topic-tag
--      breakout). Gemini classification still runs in the app server
--      *before* this RPC; these checks are the DB-side backstop for
--      anyone who calls `/rpc/create_custom_topic` directly.
--   2. Atomically reserves one slot from the shared daily pool of 5
--      (explain + quiz + create_topic; advisory lock `ai_daily`, same
--      pattern as `try_log_ai_usage`).
--   3. Inserts the row only after the slot is reserved.
--
-- `search_path` is locked to '' (same as increment_mastery / touch_streak)
-- so every relation is schema-qualified and a malicious object in `public`
-- cannot shadow builtins.

-- 1. Close the old client INSERT path if this is an upgrade.
drop policy if exists "Users can create their own custom topics"
  on public.custom_topics;

revoke insert on table public.custom_topics from public;
revoke insert on table public.custom_topics from anon;
revoke insert on table public.custom_topics from authenticated;

-- 2. Combined daily cap (explain + quiz + create_topic) is hardcoded so an
--    authenticated caller cannot pass a larger limit. Same pool as
--    `try_log_ai_usage` / `DAILY_LIMIT_COMBINED` in gemini-actions.ts.
create or replace function public.create_custom_topic(
  p_title text,
  p_level text,
  p_ip text default null
)
returns public.custom_topics
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text;
  v_count integer;
  v_combined_limit constant integer := 5;
  result public.custom_topics;
begin
  if v_user_id is null then
    raise exception 'create_custom_topic requires an authenticated user';
  end if;

  -- Same caller-side guards as `isTopicAllowed` in src/lib/gemini.ts:
  -- trim, 3–80 chars (custom_topics.title check), and reject a
  -- `</user_topic>` breakout that would escape wrapTopicName().
  v_title := btrim(coalesce(p_title, ''));

  if char_length(v_title) < 3 or char_length(v_title) > 80 then
    raise exception 'invalid_title: length must be between 3 and 80';
  end if;

  if v_title ~* '</?user_topic>' then
    raise exception 'invalid_title: topic name must not contain user_topic tags';
  end if;

  if p_level is null or p_level not in ('beginner', 'intermediate', 'advanced') then
    raise exception 'invalid_level: must be beginner, intermediate, or advanced';
  end if;

  -- Same lock key as `try_log_ai_usage` so mixed explain/quiz/create_topic
  -- requests cannot race the shared pool of 5.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_user_id::text),
    pg_catalog.hashtext('ai_daily')
  );

  select count(*)::integer into v_count
  from public.ai_usage_log
  where user_id = v_user_id
    and endpoint in ('explain', 'quiz', 'create_topic')
    and created_at > pg_catalog.now() - interval '24 hours';

  if v_count >= v_combined_limit then
    raise exception 'quota_exceeded'
      using errcode = 'P0001',
            hint = 'combined daily AI limit reached';
  end if;

  insert into public.ai_usage_log (user_id, endpoint, ip_address)
  values (v_user_id, 'create_topic', p_ip);

  insert into public.custom_topics (user_id, title, level)
  values (v_user_id, v_title, p_level)
  returning * into result;

  return result;
exception
  when unique_violation then
    raise exception 'duplicate_topic'
      using errcode = '23505';
end;
$$;

revoke all on function public.create_custom_topic(text, text, text) from public;
revoke all on function public.create_custom_topic(text, text, text) from anon;
grant execute on function public.create_custom_topic(text, text, text) to authenticated;
