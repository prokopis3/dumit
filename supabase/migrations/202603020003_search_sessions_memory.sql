begin;

create extension if not exists pgcrypto;

create table if not exists public.search_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  guest_key text,
  topic_id uuid,
  prompt_id uuid,
  prompt text not null,
  intent jsonb not null default '{}'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
  provider_order jsonb not null default '[]'::jsonb,
  execution_mode text not null default 'speed',
  provider_usage jsonb not null default '{}'::jsonb,
  status_steps jsonb not null default '[]'::jsonb,
  candidates jsonb not null default '[]'::jsonb,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint search_sessions_owner_present check (user_id is not null or guest_key is not null),
  constraint search_sessions_execution_mode_check check (execution_mode in ('speed', 'balanced', 'quality')),
  constraint search_sessions_intent_object check (jsonb_typeof(intent) = 'object'),
  constraint search_sessions_constraints_object check (jsonb_typeof(constraints) = 'object'),
  constraint search_sessions_provider_order_array check (jsonb_typeof(provider_order) = 'array'),
  constraint search_sessions_provider_usage_object check (jsonb_typeof(provider_usage) = 'object'),
  constraint search_sessions_status_steps_array check (jsonb_typeof(status_steps) = 'array'),
  constraint search_sessions_candidates_array check (jsonb_typeof(candidates) = 'array'),
  constraint search_sessions_results_array check (jsonb_typeof(results) = 'array')
);

create index if not exists idx_search_sessions_user_created_desc
  on public.search_sessions (user_id, created_at desc)
  where user_id is not null;

create index if not exists idx_search_sessions_guest_created_desc
  on public.search_sessions (guest_key, created_at desc)
  where guest_key is not null;

create index if not exists idx_search_sessions_topic_prompt
  on public.search_sessions (topic_id, prompt_id);

create index if not exists idx_search_sessions_intent_gin
  on public.search_sessions using gin (intent jsonb_path_ops);

create index if not exists idx_search_sessions_results_gin
  on public.search_sessions using gin (results jsonb_path_ops);

alter table public.search_sessions enable row level security;

create policy search_sessions_select_own
  on public.search_sessions
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy search_sessions_insert_own
  on public.search_sessions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy search_sessions_update_own
  on public.search_sessions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy search_sessions_delete_own
  on public.search_sessions
  for delete
  to authenticated
  using (auth.uid() = user_id);

create policy search_sessions_service_role_all
  on public.search_sessions
  for all
  to service_role
  using (true)
  with check (true);

drop trigger if exists trg_search_sessions_updated_at on public.search_sessions;
create trigger trg_search_sessions_updated_at
before update on public.search_sessions
for each row
execute function public.set_updated_at();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.search_sessions;
    exception
      when duplicate_object then
        null;
    end;
  end if;
end $$;

commit;
