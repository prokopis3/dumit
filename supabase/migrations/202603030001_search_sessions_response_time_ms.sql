begin;

alter table public.search_sessions
  add column if not exists response_time_ms integer not null default 0;

alter table public.search_sessions
  drop constraint if exists search_sessions_response_time_ms_non_negative;

alter table public.search_sessions
  add constraint search_sessions_response_time_ms_non_negative
  check (response_time_ms >= 0);

commit;
