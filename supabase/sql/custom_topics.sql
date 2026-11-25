-- User-created custom quiz topics, plus the daily-quota plumbing needed to
-- rate-limit their (expensive) creation separately from explain/quiz.
-- Review and run this in the Supabase SQL Editor (or via the Supabase MCP).

-- 1. Table: one row per custom topic a user has created.
create table if not exists public.custom_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null check (char_length(title) between 3 and 80),
  level text not null check (level in ('beginner', 'intermediate', 'advanced')),
  created_at timestamptz not null default now(),
  -- Prevents a user from creating the exact same topic (title + level) twice.
  unique (user_id, title, level)
);

-- 2. Index for "list this user's custom topics" lookups (e.g. matrix loading).
create index if not exists custom_topics_user_id_idx
  on public.custom_topics (user_id);

-- 3. RLS: users can only see their own custom topics. No insert/update/
--    delete policy — topics are immutable once created, and inserts must
--    go through `create_custom_topic` (see create_custom_topic.sql) so
--    Gemini moderation (`isTopicAllowed`) and the `create_topic` daily
--    quota cannot be skipped by writing the table directly.
alter table public.custom_topics enable row level security;

create policy "Users can view their own custom topics"
  on public.custom_topics
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Leftover from earlier schema versions that allowed a client INSERT.
-- Fresh installs never create this policy; re-running this file on an
-- existing project drops it so the RPC is the only write path.
drop policy if exists "Users can create their own custom topics"
  on public.custom_topics;

revoke insert on table public.custom_topics from public;
revoke insert on table public.custom_topics from anon;
revoke insert on table public.custom_topics from authenticated;

-- 4. Extend the existing `ai_usage_log` endpoint check constraint (see
--    `ai_usage_log.sql`) to allow two new endpoint values used by the
--    custom-topic-creation flow:
--      - 'create_topic': the user-facing action, gated by the shared
--        daily pool of 5 (explain + quiz + create_topic).
--      - 'topic_moderation': the cheap pre-check Gemini call
--        (isTopicAllowed) that runs before topic creation. Logged for
--        visibility only — it is never checked against a quota itself.
--        Over-quota callers are rejected with a read-only peek before
--        moderation; a successful create then goes through
--        `create_custom_topic` (quota + insert in one RPC).
alter table public.ai_usage_log
  drop constraint if exists ai_usage_log_endpoint_check;

alter table public.ai_usage_log
  add constraint ai_usage_log_endpoint_check
  check (endpoint in ('explain', 'quiz', 'create_topic', 'topic_moderation'));
