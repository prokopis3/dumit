# Dumit — Domain AI Search (vinext + Cloudflare Workers)

Parallel domain search + AI suggestion engine with model routing, availability checks, ranking, and searchable history.

## Stack

- Next.js App Router on vinext
- Cloudflare Workers (Edge runtime)
- Tailwind CSS + Framer Motion + Lucide
- Multi-model AI providers:
	- Groq (`GROQ_API_KEY`)
	- Gemini (`GEMINI_API_KEY`)
	- OpenAI (`OPENAI_API_KEY`)
	- xAI Grok (`XAI_API_KEY`)
	- Hugging Face Inference (`HUGGINGFACE_API_KEY`)
- Domain availability:
	- DNS-over-HTTPS (Cloudflare + Google)
	- Free RDAP fallback (rdap.org)
- Infra integrations:
	- Upstash Redis + Ratelimit
	- Supabase (auth + user-scoped history/settings persistence)
	- Optional Milvus semantic ranking endpoint

## Product Flow

1. User enters a search prompt.
2. User controls constraints (letters range, result count, providers).
3. `/api/session` orchestrates:
	 - prompt analysis,
	 - AI candidate generation,
	 - parallel availability checks,
	 - relevance ranking,
	 - history save.
4. User can reprompt in loop with new constraints.
5. User accepts domains, saved as selections under same topic.
6. UI history panel restores prior prompt/result contexts.
7. Signed users can store provider API keys + provider order in Settings.

### Secrets Architecture

- Non-secret preferences are stored in `public.user_settings`.
- Provider API keys are stored in **Supabase Vault** and linked by `public.user_provider_api_keys`.
- API key GET responses return **metadata only** (`hasKey`, `last4`, `updatedAt`) and never return full key values.
- API key writes are partial per-provider updates to avoid accidentally clearing other providers.
- Key set/rotate/delete operations are auditable in `public.user_provider_api_key_events`.

## API Endpoints

- `POST /api/session` — full orchestrated run
- `POST /api/suggest` — provider-only candidate generation
- `POST /api/search` — direct availability check for domain lists
- `GET /api/history` — list topics
- `GET /api/history?topicId=...` — topic details
- `POST /api/selection` — save accepted domain
- `GET /api/settings` — get user model settings
- `POST /api/settings` — persist user model settings
- `GET /api/api-keys` — get provider key metadata (masked, no raw secrets)
- `POST /api/api-keys` — upsert one or more provider keys
- `PATCH /api/api-keys` — rotate/clear one provider key

## Environment Variables

Create your env file at the project root:

- `.env` (recommended with `dotenvx`)
- or `.env.local`

You can start from `.env.example`.

### Required (at least one model key)

- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `XAI_API_KEY`
- `HUGGINGFACE_API_KEY`
- `GROQ_API_KEY`

### Optional

- `ENABLE_RDAP_FALLBACK` (default: `true`)
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (recommended for server-side writes)
- `MILVUS_ENDPOINT`
- `MILVUS_TOKEN`
- `MILVUS_COLLECTION`
- `MILVUS_VECTOR_FIELD` (default: `embedding`)
- `GEMINI_EMBEDDING_MODEL` (default: `text-embedding-004`)
- `OPENAI_EMBEDDING_MODEL` (default: `text-embedding-3-small`)

Embedding behavior for Milvus ranking:
- Uses Gemini/OpenAI embedding APIs when keys are available.
- Falls back to a built-in local deterministic embedding when external embedding keys are not configured.

### Model defaults (configured in `wrangler.jsonc`)

- `OPENAI_MODEL`
- `GROQ_MODEL`
- `XAI_MODEL`
- `GEMINI_MODEL`
- `HUGGINGFACE_MODEL`
- `DOMAIN_SUGGEST_COUNT`
- `DOMAIN_SUGGEST_MAX`

## Supabase Table (optional)

```sql
create table if not exists domain_topics (
	id uuid primary key,
	payload jsonb not null,
	updated_at timestamptz not null default now()
);
```

For full initializer (RLS policies, trigger, indexes, publication, and PowerShell CLI flow), see [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) and run migrations in:

- [supabase/migrations/202602280001_init_domain_topics.sql](supabase/migrations/202602280001_init_domain_topics.sql)
- [supabase/migrations/202603010001_user_settings_and_topics_owner.sql](supabase/migrations/202603010001_user_settings_and_topics_owner.sql)
- [supabase/migrations/202603010002_backfill_domain_topics_user_id.sql](supabase/migrations/202603010002_backfill_domain_topics_user_id.sql)
- [supabase/migrations/202603010003_user_provider_api_keys_vault.sql](supabase/migrations/202603010003_user_provider_api_keys_vault.sql)
- [supabase/migrations/202603020001_user_provider_api_keys_hardening.sql](supabase/migrations/202603020001_user_provider_api_keys_hardening.sql)
- [supabase/migrations/202603020002_add_groq_provider_support.sql](supabase/migrations/202603020002_add_groq_provider_support.sql)

User provider API keys are stored per-user using Supabase Vault (`supabase_vault`, schema `vault`) with table links in `public.user_provider_api_keys`.

## Local Development

```bash
bun install
cp .env.example .env
bun run dev
```

Open `http://localhost:3000`.

## Verification

```bash
bun run lint
bun run test
bun run build
```

## Deploy to Cloudflare Workers

```bash
bun run build
npx wrangler deploy
```

Set secrets using Wrangler:

```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put GROQ_API_KEY
wrangler secret put XAI_API_KEY
wrangler secret put HUGGINGFACE_API_KEY
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put MILVUS_TOKEN
```

## Notes

- Designed for App Router flow on vinext + Workers.
- Cache strategy uses Cloudflare Cache API inside edge handlers.
- Upstash rate-limit is optional; if not configured, the app runs with a permissive fallback.
