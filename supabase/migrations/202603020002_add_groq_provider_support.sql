begin;

alter table if exists public.user_provider_api_keys
  drop constraint if exists user_provider_api_keys_provider_check;

alter table if exists public.user_provider_api_keys
  add constraint user_provider_api_keys_provider_check
  check (provider in ('groq', 'grok', 'gemini', 'openai', 'huggingface'));

alter table if exists public.user_provider_api_key_events
  drop constraint if exists user_provider_api_key_events_provider_check;

alter table if exists public.user_provider_api_key_events
  add constraint user_provider_api_key_events_provider_check
  check (provider in ('groq', 'grok', 'gemini', 'openai', 'huggingface'));

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
  v_event_type text;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  if p_provider not in ('groq', 'grok', 'gemini', 'openai', 'huggingface') then
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

      insert into public.user_provider_api_key_events (user_id, provider, event_type, actor_uid)
      values (p_user_id, p_provider, 'delete', auth.uid());
    end if;

    return;
  end if;

  v_event_type := case
    when v_existing_secret_id is null then 'set'
    else 'rotate'
  end;

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

  insert into public.user_provider_api_key_events (user_id, provider, event_type, actor_uid)
  values (p_user_id, p_provider, v_event_type, auth.uid());
end;
$$;

commit;
