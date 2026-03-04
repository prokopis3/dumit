-- Domain AI Search - Supabase initializer
-- Safe to run multiple times.

begin;

-- 1) Extensions
create extension if not exists pgcrypto;

-- 2) Tables
create table if not exists public.domain_topics (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint domain_topics_payload_is_object check (jsonb_typeof(payload) = 'object')
);

-- 3) Functions
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Optional helper RPC (for direct SQL/automation clients)
create or replace function public.upsert_domain_topic(
  p_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.domain_topics (id, payload)
  values (p_id, p_payload)
  on conflict (id) do update
  set payload = excluded.payload,
      updated_at = now();
end;
$$;

-- 4) Triggers

drop trigger if exists trg_domain_topics_updated_at on public.domain_topics;
create trigger trg_domain_topics_updated_at
before update on public.domain_topics
for each row
execute function public.set_updated_at();

-- 5) Indexes
create index if not exists idx_domain_topics_updated_at_desc
  on public.domain_topics (updated_at desc);

create index if not exists idx_domain_topics_payload_gin
  on public.domain_topics
  using gin (payload jsonb_path_ops);

-- Helpful if you frequently sort/filter by latest prompt text in payload
create index if not exists idx_domain_topics_latest_prompt
  on public.domain_topics ((payload->>'latestPrompt'));

-- 6) Publications (Realtime)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.domain_topics;
    exception
      when duplicate_object then
        null;
    end;
  end if;
end $$;

-- 7) Security: RLS + policies
alter table public.domain_topics enable row level security;

-- Development-friendly policies (MVP):
-- If you want strict per-user ownership later, add an owner_id and tighten these.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'domain_topics'
      and policyname = 'domain_topics_select_all'
  ) then
    create policy domain_topics_select_all
      on public.domain_topics
      for select
      to anon, authenticated, service_role
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'domain_topics'
      and policyname = 'domain_topics_insert_all'
  ) then
    create policy domain_topics_insert_all
      on public.domain_topics
      for insert
      to anon, authenticated, service_role
      with check (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'domain_topics'
      and policyname = 'domain_topics_update_all'
  ) then
    create policy domain_topics_update_all
      on public.domain_topics
      for update
      to anon, authenticated, service_role
      using (true)
      with check (true);
  end if;
end $$;

commit;

select extname from pg_extension where extname = 'supabase_vault';

select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in ('upsert_user_provider_api_key', 'get_user_provider_api_keys');

select tablename
from pg_tables
where schemaname = 'public'
  and tablename = 'user_provider_api_keys';
