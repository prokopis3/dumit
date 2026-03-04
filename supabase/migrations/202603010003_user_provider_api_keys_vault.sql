begin;

create extension if not exists supabase_vault with schema vault;

create table if not exists public.user_provider_api_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider),
  constraint user_provider_api_keys_provider_check check (
    provider in ('grok', 'gemini', 'openai', 'huggingface')
  )
);

create index if not exists idx_user_provider_api_keys_user_id
  on public.user_provider_api_keys (user_id);

alter table public.user_provider_api_keys enable row level security;

drop policy if exists user_provider_api_keys_select_own on public.user_provider_api_keys;
create policy user_provider_api_keys_select_own
  on public.user_provider_api_keys
  for select
  to authenticated, service_role
  using (auth.uid() = user_id);

drop policy if exists user_provider_api_keys_insert_own on public.user_provider_api_keys;
create policy user_provider_api_keys_insert_own
  on public.user_provider_api_keys
  for insert
  to authenticated, service_role
  with check (auth.uid() = user_id);

drop policy if exists user_provider_api_keys_update_own on public.user_provider_api_keys;
create policy user_provider_api_keys_update_own
  on public.user_provider_api_keys
  for update
  to authenticated, service_role
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists user_provider_api_keys_delete_own on public.user_provider_api_keys;
create policy user_provider_api_keys_delete_own
  on public.user_provider_api_keys
  for delete
  to authenticated, service_role
  using (auth.uid() = user_id);

drop trigger if exists trg_user_provider_api_keys_updated_at on public.user_provider_api_keys;
create trigger trg_user_provider_api_keys_updated_at
before update on public.user_provider_api_keys
for each row
execute function public.set_updated_at();

create or replace function public.upsert_user_provider_api_key(
  p_user_id uuid,
  p_provider text,
  p_api_key text
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_existing_secret_id uuid;
  v_clean_key text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_provider not in ('grok', 'gemini', 'openai', 'huggingface') then
    raise exception 'unsupported provider: %', p_provider;
  end if;

  if auth.uid() is distinct from p_user_id then
    raise exception 'forbidden';
  end if;

  v_clean_key := nullif(trim(coalesce(p_api_key, '')), '');

  select vault_secret_id
    into v_existing_secret_id
  from public.user_provider_api_keys
  where user_id = p_user_id
    and provider = p_provider;

  if v_clean_key is null then
    if v_existing_secret_id is not null then
      begin
        perform vault.delete_secret(v_existing_secret_id);
      exception
        when undefined_function then
          delete from vault.secrets where id = v_existing_secret_id;
      end;

      delete from public.user_provider_api_keys
      where user_id = p_user_id
        and provider = p_provider;
    end if;

    return;
  end if;

  if v_existing_secret_id is not null then
    begin
      perform vault.delete_secret(v_existing_secret_id);
    exception
      when undefined_function then
        delete from vault.secrets where id = v_existing_secret_id;
    end;
  end if;

  begin
    select vault.create_secret(
      v_clean_key,
      format('user:%s:%s', p_user_id::text, p_provider),
      format('Provider API key for user %s provider %s', p_user_id::text, p_provider)
    )
    into v_secret_id;
  exception
    when undefined_function then
      insert into vault.secrets (name, description, secret)
      values (
        format('user:%s:%s', p_user_id::text, p_provider),
        format('Provider API key for user %s provider %s', p_user_id::text, p_provider),
        v_clean_key
      )
      returning id into v_secret_id;
  end;

  insert into public.user_provider_api_keys (user_id, provider, vault_secret_id)
  values (p_user_id, p_provider, v_secret_id)
  on conflict (user_id, provider)
  do update set
    vault_secret_id = excluded.vault_secret_id,
    updated_at = now();
end;
$$;

create or replace function public.get_user_provider_api_keys(
  p_user_id uuid
)
returns table(provider text, api_key text)
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if auth.uid() is distinct from p_user_id then
    raise exception 'forbidden';
  end if;

  return query
  select upak.provider,
         ds.decrypted_secret as api_key
  from public.user_provider_api_keys upak
  join vault.decrypted_secrets ds
    on ds.id = upak.vault_secret_id
  where upak.user_id = p_user_id;
end;
$$;

revoke all on function public.upsert_user_provider_api_key(uuid, text, text) from public;
revoke all on function public.get_user_provider_api_keys(uuid) from public;
grant execute on function public.upsert_user_provider_api_key(uuid, text, text) to authenticated, service_role;
grant execute on function public.get_user_provider_api_keys(uuid) to authenticated, service_role;

-- Backfill plaintext keys from existing user_settings payload into Vault.
do $$
declare
  row record;
  provider_name text;
  provider_value text;
begin
  for row in
    select user_id, payload
    from public.user_settings
  loop
    for provider_name in select unnest(array['grok', 'gemini', 'openai', 'huggingface'])
    loop
      provider_value := nullif(trim(coalesce(row.payload->'apiKeys'->>provider_name, '')), '');
      if provider_value is not null then
        perform public.upsert_user_provider_api_key(row.user_id, provider_name, provider_value);
      end if;
    end loop;

    update public.user_settings
    set payload = payload - 'apiKeys',
        updated_at = now()
    where user_id = row.user_id
      and payload ? 'apiKeys';
  end loop;
end $$;

commit;
