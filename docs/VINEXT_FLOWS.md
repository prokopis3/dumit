# vinext Workers Flows

This project runs with **App Router** on vinext, and follows Cloudflare Workers deployment patterns from `cloudflare/vinext`.

## App Router flow (current)

- Source routes live under `src/app/**`.
- Edge handlers in `src/app/api/**/route.ts` return `Request/Response` web primitives.
- `vite.config.ts` uses:
  - `vinext()`
  - `@vitejs/plugin-rsc` with vinext virtual entries
  - `@cloudflare/vite-plugin` with `{ name: "rsc", childEnvironments: ["ssr"] }`
- Worker entry delegates to vinext server.

## Pages Router flow (reference)

vinext supports Pages Router projects (`pages/**`) with Cloudflare Workers as documented in upstream examples.

Reference behavior:

- Worker can import from `virtual:vinext-server-entry`
- Supports `renderPage`, `handleApiRoute`, `runMiddleware`
- Includes routing behaviors for rewrites, redirects, middleware headers, and API handling.

If you need a Pages migration path, add `pages/` routes and generate worker/vite config using vinext init/deploy flow.

## Caching configuration

- App-level route handlers use Cloudflare `caches.default`.
- Responses include `Cache-Control: public, s-maxage=...`.
- Availability checks are cached per domain hash.

## Project structure highlights

- `src/lib/ai/*` — provider orchestration
- `src/lib/domain/*` — availability checks
- `src/lib/infra/*` — cache, rate-limit, history, vector ranking
- `src/lib/infra/*` — cache, rate-limit, auth, user settings, history, vector ranking
- `src/lib/services/*` — orchestration service
- `src/app/api/*` — edge endpoints
- `src/app/api/settings/route.ts` — per-user provider settings
- `src/app/page.tsx` — M3 Pastel Glass UX and looped flow

## Tests

- Unit tests are run with `vitest`.
- Command: `bun run test`.
