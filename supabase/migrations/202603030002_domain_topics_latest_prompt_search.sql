begin;

create extension if not exists pg_trgm;

alter table public.domain_topics
  add column if not exists latest_prompt text not null default '';

create or replace function public.sync_domain_topics_latest_prompt()
returns trigger
language plpgsql
as $$
begin
  new.latest_prompt := coalesce(
    case
      when jsonb_typeof(new.payload->'prompts') = 'array'
        and jsonb_array_length(new.payload->'prompts') > 0
      then new.payload->'prompts'->(jsonb_array_length(new.payload->'prompts') - 1)->>'prompt'
      else null
    end,
    new.payload->>'latestPrompt',
    ''
  );

  return new;
end;
$$;

drop trigger if exists trg_domain_topics_sync_latest_prompt on public.domain_topics;
create trigger trg_domain_topics_sync_latest_prompt
before insert or update of payload on public.domain_topics
for each row
execute function public.sync_domain_topics_latest_prompt();

update public.domain_topics
set latest_prompt = coalesce(
  case
    when jsonb_typeof(payload->'prompts') = 'array'
      and jsonb_array_length(payload->'prompts') > 0
    then payload->'prompts'->(jsonb_array_length(payload->'prompts') - 1)->>'prompt'
    else null
  end,
  payload->>'latestPrompt',
  ''
)
where latest_prompt = '';

create index if not exists idx_domain_topics_user_latest_prompt_trgm
  on public.domain_topics
  using gin (lower(latest_prompt) gin_trgm_ops);

commit;
