# GitHub Copilot Instructions for Domain AI Search

This project is a high-performance domain name search tool built with **vinext** (Vite-based Next.js for Cloudflare Workers) and follows the **M3 Pastel Glass** design system.

## Project Context
- **Framework:** Next.js (Edge Runtime via vinext)
- **Deployment:** Cloudflare Workers
- **Package Manager:** **Always use `bun`** (e.g., `bun add`, `bun run dev`, `bun run build`)
- **Styling:** Tailwind CSS with M3 (Material 3) + Glassmorphism (Pastel Glass)
- **Key APIs:** Multi-provider AI suggestions (Gemini/OpenAI/Grok/Hugging Face), DNS + free RDAP fallback availability checks

## Design Guidelines (M3 Pastel Glass)
- **Corners:** High border radius strictly set to `28px` (`rounded-[28px]`).
- **Surfaces:** Glassmorphism with `backdrop-blur-xl`, `bg-white/10`, and `border-white/20`.
- **Colors:** 
  - Background: Deep blue to indigo mesh gradients.
  - Accents: Pastel Blue (`#AEC6CF`), Pastel Green (success), Soft Red (failure).
- **Interactions:** Subtle scale animations (`framer-motion`) and neon focus rings.

## Technical Rules
- All API routes MUST be compatible with **Edge Runtime** (`experimental-edge` or `edge`).
- Use `lucide-react` for icons and `framer-motion` for all UI transitions.
- Implement parallel search logic in API handlers to minimize latency.
- Handle API keys via Cloudflare Worker secrets (`wrangler secret put`).
- Use provider fallbacks in this order unless user overrides: `gemini -> openai -> grok -> huggingface`.
- Keep model selection cost-sensitive (`*-mini`/flash defaults) and expose model env vars in `wrangler.jsonc`.
- Cache expensive API results with `caches.default` and explicit `Cache-Control` headers.
- Apply request-rate controls using Upstash rate limiting when credentials are available.
- Keep storage adapters optional and resilient:
  - Supabase for persistent history
  - Milvus endpoint for semantic ranking
  - Fallback to local in-memory behavior when external infra is absent

## App Architecture Rules
- `src/lib/ai/*`: model provider clients and prompt formatting
- `src/lib/domain/*`: availability resolvers
- `src/lib/infra/*`: cache, limiter, history, vector rank adapters
- `src/lib/services/*`: orchestrators used by route handlers
- `src/app/api/*`: thin route handlers only
- `src/app/page.tsx`: M3 Pastel Glass UX with looped prompt flow and history

## Workflow
- Use `bun run build` to verify Cloudflare compatibility before suggesting deployment.
- Prefer `clsx` and `tailwind-merge` for conditional class management.
- Always include loading skeletons with glassmorphism effects for parallel operations.
- Keep API output deterministic JSON schemas for UI consumption.
- Document any new infra integration in `README.md` and `docs/VINEXT_FLOWS.md`.
