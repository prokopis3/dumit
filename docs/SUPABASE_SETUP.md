# Supabase Setup (Initializer + PowerShell)

This project persists prompt history and user model settings to Supabase from `src/lib/infra/history.ts` and `src/lib/infra/settings.ts`.

## 1) Initializer SQL

Use migration files:
- `supabase/migrations/202602280001_init_domain_topics.sql`
- `supabase/migrations/202603010001_user_settings_and_topics_owner.sql`
- `supabase/migrations/202603010002_backfill_domain_topics_user_id.sql`
- `supabase/migrations/202603010003_user_provider_api_keys_vault.sql`
- `supabase/migrations/202603020001_user_provider_api_keys_hardening.sql`

It includes:
- **Extensions:** `pgcrypto`, `supabase_vault` (schema `vault`)
- **Tables:** `public.domain_topics`, `public.user_settings`, `public.user_provider_api_keys`
- **Tables (hardened):** `public.user_provider_api_key_events` (audit trail for set/rotate/delete)
- **Functions:** `set_updated_at`, `upsert_domain_topic`, `upsert_user_provider_api_key`, `get_user_provider_api_keys`, `get_user_provider_api_key_metadata`
- **Triggers:** `trg_domain_topics_updated_at`
- **Indexes:** timestamp + JSONB indexes
- **Publications:** adds table to `supabase_realtime` (if publication exists)
- **Policies / RLS:** user-scoped ownership policies (`auth.uid() = user_id`) for authenticated users

## 2) Apply via Dashboard (fastest)

1. Open Supabase project → **SQL Editor**
2. Run migrations in order (recommended):
  - `202602280001_init_domain_topics.sql`
  - `202603010001_user_settings_and_topics_owner.sql`
  - `202603010002_backfill_domain_topics_user_id.sql`
  - `202603010003_user_provider_api_keys_vault.sql`
  - `202603020001_user_provider_api_keys_hardening.sql`
3. Execute and confirm success

## 3) Apply via Supabase CLI (PowerShell)

### Install CLI (if needed)
```powershell
scoop install supabase
# or
npm install -g supabase
```

### Login and link project
```powershell
supabase login
supabase link --project-ref <your-project-ref>
```

### Push migrations
```powershell
supabase db push
```

## 4) Environment variables

Set these in `.env` (local) and Worker secrets (prod):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (recommended)
- `SUPABASE_URL` (same value as `SUPABASE_URL`)
- `SUPABASE_ANON_KEY` (same value as `SUPABASE_ANON_KEY`)

## 5) Verification queries

```sql
select id, updated_at
from public.domain_topics
order by updated_at desc
limit 10;
```

```sql
select relname as index_name
from pg_class
where relkind = 'i'
  and relname like 'idx_domain_topics_%';
```

```sql
select provider, has_key, last4, updated_at
from public.get_user_provider_api_key_metadata(auth.uid());
```

```sql
select provider, event_type, created_at
from public.user_provider_api_key_events
where user_id = auth.uid()
order by created_at desc
limit 20;
```

## 6) Mapping to Supabase UI sections

- **Tables:** `public.domain_topics`, `public.user_settings`, `public.user_provider_api_keys`, `public.user_provider_api_key_events`
- **Functions:** `public.set_updated_at`, `public.upsert_domain_topic`, `public.upsert_user_provider_api_key`, `public.get_user_provider_api_keys`, `public.get_user_provider_api_key_metadata`
- **Triggers:** `trg_domain_topics_updated_at`
- **Enumerated Types:** none required for current schema
- **Extensions:** `pgcrypto`, `supabase_vault` (schema `vault`)
- **Indexes:** `idx_domain_topics_updated_at_desc`, `idx_domain_topics_payload_gin`, `idx_domain_topics_latest_prompt`
- **Publications:** `supabase_realtime` includes `public.domain_topics`

- **Roles:** uses built-in `anon`, `authenticated`, `service_role`
- **Policies:** user-scoped RLS policies on `domain_topics`, `user_settings`, and `user_provider_api_keys`
- **Settings / Platform / Replication / Backups / Migrations / Wrappers / Webhooks:**
  - No custom requirement for this project beyond default Supabase configuration.
  - Backups/replication are managed by Supabase plan and project settings.
