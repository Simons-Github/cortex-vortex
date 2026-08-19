-- Per-user mastery score for each topic (demo or custom). Scores are never
-- written directly from the client — only through the `increment_mastery`
-- SECURITY DEFINER RPC (see `mastery_streak_rpcs.sql`), which clamps both
-- the delta (±10) and the resulting score (0–100).
-- Review and run this in the Supabase SQL Editor.

-- 1. Table: one row per (user, topic). Unique on (user_id, topic_id) so the
--    RPC can upsert safely with ON CONFLICT.
create table if not exists public.user_topic_mastery (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  topic_id text not null,
  mastery_score integer default 0
    check (mastery_score >= 0 and mastery_score <= 100),
  last_reviewed_at timestamptz default timezone('utc'::text, now()),
  unique (user_id, topic_id)
);

-- 2. RLS: users can read only their own mastery rows. There is deliberately
--    no insert/update/delete policy for clients — the only way a row gets
--    written is through the `increment_mastery` SECURITY DEFINER RPC.
alter table public.user_topic_mastery enable row level security;

create policy "Users can view own mastery"
  on public.user_topic_mastery
  for select
  to authenticated
  using (auth.uid() = user_id);
