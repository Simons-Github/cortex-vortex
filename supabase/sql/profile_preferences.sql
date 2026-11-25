-- Settings profile preferences on `public.profiles`.
-- Review and run this in the Supabase SQL Editor *after* `profiles.sql`.
-- Idempotent — safe to re-run on an existing project.
--
-- Preference columns are user-owned (display name, daily goal, explanation
-- tone, decay reminders). Streak fields stay RPC-only via `touch_streak`;
-- this file never grants a client UPDATE policy on `profiles`.

-- 1. Columns for existing projects (`CREATE TABLE IF NOT EXISTS` in
--    profiles.sql will not add them). Fresh installs already have these
--    from the CREATE TABLE; ADD COLUMN IF NOT EXISTS is then a no-op.
alter table public.profiles
  add column if not exists display_name text;

alter table public.profiles
  add column if not exists daily_goal_minutes integer not null default 20;

alter table public.profiles
  add column if not exists explanation_tone text not null default 'Concise';

alter table public.profiles
  add column if not exists decay_reminders boolean not null default true;

alter table public.profiles drop constraint if exists profiles_display_name_len;
alter table public.profiles add constraint profiles_display_name_len
  check (display_name is null or char_length(btrim(display_name)) between 1 and 80);

alter table public.profiles drop constraint if exists profiles_daily_goal_minutes_range;
alter table public.profiles add constraint profiles_daily_goal_minutes_range
  check (daily_goal_minutes between 5 and 90 and daily_goal_minutes % 5 = 0);

alter table public.profiles drop constraint if exists profiles_explanation_tone_check;
alter table public.profiles add constraint profiles_explanation_tone_check
  check (explanation_tone in ('Concise', 'Socratic', 'Deeply technical'));

-- 2. RPC: replace only preference columns for `auth.uid()`. Empty / blank
--    display names become null. Missing profile rows are inserted with
--    streak defaults (same as `handle_new_user`).
create or replace function public.update_profile_preferences(
  p_display_name text,
  p_daily_goal_minutes integer,
  p_explanation_tone text,
  p_decay_reminders boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.profiles;
  v_display_name text := nullif(btrim(p_display_name), '');
begin
  if auth.uid() is null then
    raise exception 'update_profile_preferences requires an authenticated user';
  end if;

  if p_daily_goal_minutes is null
     or p_daily_goal_minutes < 5
     or p_daily_goal_minutes > 90
     or p_daily_goal_minutes % 5 <> 0 then
    raise exception 'invalid daily_goal_minutes: must be 5–90 in steps of 5';
  end if;

  if p_explanation_tone is null
     or p_explanation_tone not in ('Concise', 'Socratic', 'Deeply technical') then
    raise exception 'invalid explanation_tone';
  end if;

  if p_decay_reminders is null then
    raise exception 'decay_reminders is required';
  end if;

  if v_display_name is not null and char_length(v_display_name) > 80 then
    raise exception 'display_name must be at most 80 characters';
  end if;

  insert into public.profiles (
    id,
    display_name,
    daily_goal_minutes,
    explanation_tone,
    decay_reminders,
    updated_at
  )
  values (
    auth.uid(),
    v_display_name,
    p_daily_goal_minutes,
    p_explanation_tone,
    p_decay_reminders,
    now()
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    daily_goal_minutes = excluded.daily_goal_minutes,
    explanation_tone = excluded.explanation_tone,
    decay_reminders = excluded.decay_reminders,
    updated_at = now();

  select * into result from public.profiles where id = auth.uid();
  return result;
end;
$$;

revoke all on function public.update_profile_preferences(text, integer, text, boolean) from public;
revoke all on function public.update_profile_preferences(text, integer, text, boolean) from anon;
grant execute on function public.update_profile_preferences(text, integer, text, boolean) to authenticated;
