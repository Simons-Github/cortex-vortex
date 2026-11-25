-- One PDF source per custom topic (BYOK ingest). Clients may SELECT their
-- own metadata; writes go through the app server with service_role.
-- Review and run this in the SQL Editor *after* custom_topics.sql and
-- *before* re-running ai_burst_limit.sql (that file must stay last among
-- usage-log constraint updates). Idempotent — safe to re-run.

-- 1. Metadata table. `study_brief` is the capped Gemini digest used for
--    later explain/quiz calls so we do not re-upload the PDF every time.
create table if not exists public.topic_documents (
  topic_id uuid primary key references public.custom_topics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 200),
  byte_size integer not null check (byte_size > 0 and byte_size <= 5242880),
  page_count integer check (page_count is null or (page_count between 1 and 20)),
  status text not null check (status in ('ready', 'failed')),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 300),
  study_brief text check (study_brief is null or char_length(study_brief) <= 24000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topic_documents_user_matches_topic
    check (user_id is not null)
);

create index if not exists topic_documents_user_id_idx
  on public.topic_documents (user_id);

alter table public.topic_documents enable row level security;

drop policy if exists "Users can view their own topic documents"
  on public.topic_documents;

create policy "Users can view their own topic documents"
  on public.topic_documents
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on table public.topic_documents from public;
revoke insert, update, delete on table public.topic_documents from anon;
revoke insert, update, delete on table public.topic_documents from authenticated;
grant select on table public.topic_documents to authenticated;

-- 2. Private Storage bucket. Object path: {auth.uid()}/{topic_id}/source.pdf
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'topic-pdfs',
  'topic-pdfs',
  false,
  5242880,
  array['application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload own topic pdfs" on storage.objects;
drop policy if exists "Users can read own topic pdfs" on storage.objects;
drop policy if exists "Users can update own topic pdfs" on storage.objects;
drop policy if exists "Users can delete own topic pdfs" on storage.objects;

create policy "Users can upload own topic pdfs"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'topic-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can read own topic pdfs"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'topic-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update own topic pdfs"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'topic-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'topic-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete own topic pdfs"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'topic-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
