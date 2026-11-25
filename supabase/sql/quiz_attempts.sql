-- Per-user quiz attempt history so generate/explain can target weak spots,
-- plus the RPC that applies a deterministic mastery delta after each answer.
-- Writes are SECURITY DEFINER only — clients never INSERT/UPDATE this table.
-- Review and run this in the Supabase SQL Editor *after* `user_topic_mastery.sql`
-- and `mastery_streak_rpcs.sql` (`apply_quiz_result` calls `increment_mastery`).

-- 1. Table: one row per answered question. Stems are truncated at write time
--    (~500 chars) so prompts never receive unbounded quiz text.
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  topic_id text not null,
  question_stem text not null check (char_length(question_stem) between 1 and 500),
  correct boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists quiz_attempts_user_topic_created_idx
  on public.quiz_attempts (user_id, topic_id, created_at desc);

-- 2. RLS: users can read only their own attempts. No insert/update/delete
--    policy — the only write path is `log_quiz_attempt`.
alter table public.quiz_attempts enable row level security;

drop policy if exists "Users can view own quiz attempts" on public.quiz_attempts;
create policy "Users can view own quiz attempts"
  on public.quiz_attempts
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on table public.quiz_attempts from public;
revoke insert, update, delete on table public.quiz_attempts from anon;
revoke insert, update, delete on table public.quiz_attempts from authenticated;
grant select on table public.quiz_attempts to authenticated;

-- 3. RPC: persist one attempt. `auth.uid()` is the only user_id ever written.
create or replace function public.log_quiz_attempt(
  p_topic_id text,
  p_stem text,
  p_correct boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stem text;
begin
  if auth.uid() is null then
    raise exception 'log_quiz_attempt requires an authenticated user';
  end if;

  if p_topic_id is null or char_length(trim(p_topic_id)) = 0 then
    raise exception 'topic_id required';
  end if;

  if char_length(p_topic_id) > 128 then
    raise exception 'topic_id too long';
  end if;

  v_stem := left(trim(coalesce(p_stem, '')), 500);
  if char_length(v_stem) = 0 then
    raise exception 'stem required';
  end if;

  insert into public.quiz_attempts (user_id, topic_id, question_stem, correct)
  values (auth.uid(), p_topic_id, v_stem, p_correct);
end;
$$;

revoke all on function public.log_quiz_attempt(text, text, boolean) from public;
revoke all on function public.log_quiz_attempt(text, text, boolean) from anon;
grant execute on function public.log_quiz_attempt(text, text, boolean) to authenticated;

-- 4. RPC: last N missed stems for this topic (weak-spot prompt context).
create or replace function public.list_recent_quiz_misses(
  p_topic_id text,
  p_limit integer default 8
)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  result text[];
begin
  if auth.uid() is null then
    raise exception 'list_recent_quiz_misses requires an authenticated user';
  end if;

  if p_topic_id is null or char_length(trim(p_topic_id)) = 0 then
    return '{}'::text[];
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 8), 20));

  select coalesce(array_agg(question_stem order by created_at desc), '{}'::text[])
    into result
  from (
    select question_stem, created_at
    from public.quiz_attempts
    where user_id = auth.uid()
      and topic_id = p_topic_id
      and correct = false
    order by created_at desc
    limit v_limit
  ) recent;

  return coalesce(result, '{}'::text[]);
end;
$$;

revoke all on function public.list_recent_quiz_misses(text, integer) from public;
revoke all on function public.list_recent_quiz_misses(text, integer) from anon;
grant execute on function public.list_recent_quiz_misses(text, integer) to authenticated;

-- 5. RPC: apply one quiz answer's mastery change. The client only sends
--    `correct` — the delta is chosen here (mirrors `src/lib/quiz-mastery.ts`
--    / `levelFor`) and then clamped by `increment_mastery` (also sets
--    `last_reviewed_at`). Beginner ≤30 → +3, Intermediate ≤70 → +2,
--    Advanced → +1; a miss is always −1.
create or replace function public.apply_quiz_result(p_topic_id text, p_correct boolean)
returns public.user_topic_mastery
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_score integer;
  v_delta integer;
  result public.user_topic_mastery;
begin
  if auth.uid() is null then
    raise exception 'apply_quiz_result requires an authenticated user';
  end if;

  if p_topic_id is null or char_length(trim(p_topic_id)) = 0 then
    raise exception 'topic_id required';
  end if;

  if char_length(p_topic_id) > 128 then
    raise exception 'topic_id too long';
  end if;

  select mastery_score into current_score
  from public.user_topic_mastery
  where user_id = auth.uid()
    and topic_id = p_topic_id;

  if current_score is null then
    current_score := 0;
  end if;

  if p_correct then
    if current_score <= 30 then
      v_delta := 3;
    elsif current_score <= 70 then
      v_delta := 2;
    else
      v_delta := 1;
    end if;
  else
    v_delta := -1;
  end if;

  select * into result from public.increment_mastery(p_topic_id, v_delta);
  return result;
end;
$$;

revoke all on function public.apply_quiz_result(text, boolean) from public;
revoke all on function public.apply_quiz_result(text, boolean) from anon;
grant execute on function public.apply_quiz_result(text, boolean) to authenticated;
