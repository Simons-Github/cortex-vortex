-- Per-user profile row: streak_count + last_active_date (advanced only via
-- the `touch_streak` SECURITY DEFINER RPC — see `mastery_streak_rpcs.sql`).
-- Also installs the auth trigger that inserts a profile when a user signs up.
-- Review and run this in the Supabase SQL Editor.

-- 1. Table: one row per auth user. Defaults seed a streak of 1 for "today"
--    so a brand-new account already looks active on first login.
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  updated_at timestamptz not null default timezone('utc'::text, now()),
  streak_count integer default 1,
  last_active_date date default current_date
);

-- 2. RLS: users can read only their own profile row. There is deliberately
--    no insert/update/delete policy for clients — signup inserts go through
--    `handle_new_user` (SECURITY DEFINER), streak writes go through
--    `touch_streak`, and account cleanup is owned by the auth.users cascade
--    (and the service role), not the browser client. A client UPDATE policy
--    would let users spoof streak_count / last_active_date.
alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- 3. Trigger: when a new auth.users row is created, insert a matching
--    profiles row (id only — streak defaults apply). SECURITY DEFINER so the
--    insert succeeds even though the signup path has no authenticated JWT yet.
--    Not callable via the Data API — EXECUTE is revoked from anon/authenticated
--    in the grants block below (the trigger still invokes it as owner).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Trigger-only: revoke Data API / RPC execute from every public role.
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;
