begin;

update public.domain_topics as dt
set user_id = (dt.payload->>'userId')::uuid,
    updated_at = now()
where dt.user_id is null
  and jsonb_typeof(dt.payload) = 'object'
  and dt.payload ? 'userId'
  and (dt.payload->>'userId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1
    from auth.users as au
    where au.id = (dt.payload->>'userId')::uuid
  );

commit;
