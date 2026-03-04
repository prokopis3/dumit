begin;

create extension if not exists pgcrypto;

alter table public.domain_topics
  add column if not exists user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'domain_topics_user_id_fkey'
  ) then
    alter table public.domain_topics
      add constraint domain_topics_user_id_fkey
      foreign key (user_id) references auth.users(id)
      on delete cascade;
  end if;
end $$;

update public.domain_topics
set user_id = null
where user_id is distinct from null;

create index if not exists idx_domain_topics_user_id_updated
  on public.domain_topics (user_id, updated_at desc);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_user_settings_updated
  on public.user_settings (updated_at desc);

drop trigger if exists trg_user_settings_updated_at on public.user_settings;
create trigger trg_user_settings_updated_at
before update on public.user_settings
for each row
execute function public.set_updated_at();

drop policy if exists domain_topics_select_all on public.domain_topics;
drop policy if exists domain_topics_insert_all on public.domain_topics;
drop policy if exists domain_topics_update_all on public.domain_topics;

create policy domain_topics_select_own
  on public.domain_topics
  for select
  to authenticated, service_role
  using (auth.uid() = user_id);

create policy domain_topics_insert_own
  on public.domain_topics
  for insert
  to authenticated, service_role
  with check (auth.uid() = user_id);

create policy domain_topics_update_own
  on public.domain_topics
  for update
  to authenticated, service_role
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy domain_topics_delete_own
  on public.domain_topics
  for delete
  to authenticated, service_role
  using (auth.uid() = user_id);

alter table public.user_settings enable row level security;

create policy user_settings_select_own
  on public.user_settings
  for select
  to authenticated, service_role
  using (auth.uid() = user_id);

create policy user_settings_insert_own
  on public.user_settings
  for insert
  to authenticated, service_role
  with check (auth.uid() = user_id);

create policy user_settings_update_own
  on public.user_settings
  for update
  to authenticated, service_role
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy user_settings_delete_own
  on public.user_settings
  for delete
  to authenticated, service_role
  using (auth.uid() = user_id);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.user_settings;
    exception
      when duplicate_object then
        null;
    end;
  end if;
end $$;

commit;
