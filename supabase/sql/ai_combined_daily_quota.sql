-- Combined rolling-24h AI quota: 5 requests total across explain, quiz,
-- and create_topic. Idempotent — safe to re-run after ai_usage_log.sql
-- (and create_custom_topic.sql on projects that have it).
--
-- Burst rows (`burst_*`) and `topic_moderation` stay outside this pool.

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
