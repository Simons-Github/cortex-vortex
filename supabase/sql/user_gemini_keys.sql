-- Encrypted per-user Gemini API keys (BYOK).
-- Review and run this in the Supabase SQL Editor *after* profiles.sql and
-- *before* re-running create_custom_topic.sql (that RPC checks this table
-- to skip the shared daily quota). Idempotent — safe to re-run.
--
-- The table lives in `private`, which is not in PostgREST's exposed schemas
-- (`public` / `graphql_public`). anon/authenticated have no grants here.
-- App server access is only via the `service_*` SECURITY DEFINER RPCs below,
-- which require the service_role JWT. The Node server must pass
-- `getAuthenticatedUser().id` — never a client-supplied user id.

create schema if not exists private;

revoke usage on schema private from public;
revoke usage on schema private from anon;
revoke usage on schema private from authenticated;

grant usage on schema private to postgres;
grant usage on schema private to service_role;

create table if not exists private.user_gemini_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  encrypted_payload text not null
    check (char_length(encrypted_payload) between 32 and 4000),
  key_hint text not null
    check (char_length(key_hint) between 1 and 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.user_gemini_keys enable row level security;

revoke all on table private.user_gemini_keys from public;
revoke all on table private.user_gemini_keys from anon;
revoke all on table private.user_gemini_keys from authenticated;

grant select, insert, update, delete on table private.user_gemini_keys to service_role;

-- Burst row for "save own key" (5 / 10 minutes). `custom_topics.sql` resets
-- this check; `ai_burst_limit.sql` must be re-run last so the full list sticks.
-- This file also writes the full list so a one-file upgrade still allows
-- `try_log_key_save` to insert.
alter table public.ai_usage_log
  drop constraint if exists ai_usage_log_endpoint_check;

alter table public.ai_usage_log
  add constraint ai_usage_log_endpoint_check
  check (endpoint in (
    'explain',
    'quiz',
    'create_topic',
    'topic_moderation',
    'burst_explain',
    'burst_quiz',
    'burst_create_topic',
    'burst_save_key'
  ));

create or replace function public.service_require_role()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service_role required';
  end if;
end;
$$;

revoke all on function public.service_require_role() from public;
revoke all on function public.service_require_role() from anon;
revoke all on function public.service_require_role() from authenticated;
grant execute on function public.service_require_role() to service_role;

create or replace function public.service_upsert_user_gemini_key(
  p_user_id uuid,
  p_encrypted_payload text,
  p_key_hint text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.service_require_role();

  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  insert into private.user_gemini_keys (user_id, encrypted_payload, key_hint, updated_at)
  values (p_user_id, p_encrypted_payload, p_key_hint, now())
  on conflict (user_id) do update set
    encrypted_payload = excluded.encrypted_payload,
    key_hint = excluded.key_hint,
    updated_at = now();
end;
$$;

create or replace function public.service_load_user_gemini_key(p_user_id uuid)
returns table (encrypted_payload text, key_hint text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.service_require_role();

  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  return query
  select k.encrypted_payload, k.key_hint
  from private.user_gemini_keys k
  where k.user_id = p_user_id;
end;
$$;

create or replace function public.service_hint_user_gemini_key(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hint text;
begin
  perform public.service_require_role();

  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  select k.key_hint into v_hint
  from private.user_gemini_keys k
  where k.user_id = p_user_id;

  return v_hint;
end;
$$;

create or replace function public.service_delete_user_gemini_key(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.service_require_role();

  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  delete from private.user_gemini_keys
  where user_id = p_user_id;
end;
$$;

revoke all on function public.service_upsert_user_gemini_key(uuid, text, text) from public;
revoke all on function public.service_upsert_user_gemini_key(uuid, text, text) from anon;
revoke all on function public.service_upsert_user_gemini_key(uuid, text, text) from authenticated;
grant execute on function public.service_upsert_user_gemini_key(uuid, text, text) to service_role;

revoke all on function public.service_load_user_gemini_key(uuid) from public;
revoke all on function public.service_load_user_gemini_key(uuid) from anon;
revoke all on function public.service_load_user_gemini_key(uuid) from authenticated;
grant execute on function public.service_load_user_gemini_key(uuid) to service_role;

revoke all on function public.service_hint_user_gemini_key(uuid) from public;
revoke all on function public.service_hint_user_gemini_key(uuid) from anon;
revoke all on function public.service_hint_user_gemini_key(uuid) from authenticated;
grant execute on function public.service_hint_user_gemini_key(uuid) to service_role;

revoke all on function public.service_delete_user_gemini_key(uuid) from public;
revoke all on function public.service_delete_user_gemini_key(uuid) from anon;
revoke all on function public.service_delete_user_gemini_key(uuid) from authenticated;
grant execute on function public.service_delete_user_gemini_key(uuid) to service_role;

-- Hardcoded 5 saves / rolling 10 minutes. Called with the *user* JWT
-- (same pattern as try_log_ai_burst), not service_role — it only inserts a
-- usage row; it cannot read or write private.user_gemini_keys.
create or replace function public.try_log_key_save(p_ip text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
  v_limit constant integer := 5;
begin
  if v_user_id is null then
    raise exception 'try_log_key_save requires an authenticated user';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_user_id::text),
    pg_catalog.hashtext('burst_save_key')
  );

  select count(*)::integer into v_count
  from public.ai_usage_log
  where user_id = v_user_id
    and endpoint = 'burst_save_key'
    and created_at > pg_catalog.now() - interval '10 minutes';

  if v_count >= v_limit then
    return false;
  end if;

  insert into public.ai_usage_log (user_id, endpoint, ip_address)
  values (v_user_id, 'burst_save_key', p_ip);

  return true;
end;
$$;

revoke all on function public.try_log_key_save(text) from public;
revoke all on function public.try_log_key_save(text) from anon;
grant execute on function public.try_log_key_save(text) to authenticated;
