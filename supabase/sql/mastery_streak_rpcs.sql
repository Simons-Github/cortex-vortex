-- SECURITY DEFINER RPCs that own all writes to `user_topic_mastery` and
-- streak fields on `profiles`. Clients never update those columns directly
-- (see the RLS policies in `user_topic_mastery.sql` / `profiles.sql`).
-- Review and run this in the Supabase SQL Editor *after* those table files.

-- 1. RPC: bump mastery for a topic by a small delta (±10), clamp the score
--    to [0, 100], upsert the row, and return it. `auth.uid()` is the only
--    user_id the function will ever write — the client cannot spoof ownership.
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

-- Only signed-in users may call the RPC; it resolves auth.uid() itself and
-- runs as the function owner (SECURITY DEFINER) to bypass the table's
-- lack of a client-writable insert/update policy. Explicitly revoke from
-- PUBLIC *and* anon — Supabase default grants can leave anon executable.
revoke all on function public.increment_mastery(text, integer) from public;
revoke all on function public.increment_mastery(text, integer) from anon;
grant execute on function public.increment_mastery(text, integer) to authenticated;

-- 2. RPC: advance the calling user's study streak for the current calendar
--    day. Idempotent within a day; consecutive calendar days increment;
--    any gap resets to 1. All date math lives here so the client cannot
--    spoof streak_count / last_active_date.
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
    -- Already active today — leave streak unchanged.
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

revoke all on function public.touch_streak() from public;
revoke all on function public.touch_streak() from anon;
grant execute on function public.touch_streak() to authenticated;
