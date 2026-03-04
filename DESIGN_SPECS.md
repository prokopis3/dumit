# Domain AI Search - Design Specs

## Theme: M3 Pastel Glass (Hybrid)
Combining Material You (M3) structure with the ethereal aesthetics of Glassmorphism and soft Pastel colors.

### 1. Visual Identity
- **Background:** Mesh gradient of deep and pastel blues.
  - `bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-950`
- **Surface:** Glassmorphism panels.
  - `bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl`
- **Corners:** Large rounded corners (28px) as per M3.
  - `rounded-[28px]`
- **Typography:**
  - Headings: Bold, expressive, sans-serif (Inter/Geist).
  - Body: Clean, readable.
- **Accents:** Pastel Blue (`#AEC6CF`) and Deep Blue (`#003366`).

### 2. User Experience (UX)
- **Search Bar:** Centered, floating glass input.
  - Large padding, neon-like focus ring.
- **AI Suggestions:** List of cards with "Sparkle" icon.
  - Morphing hover effects (slight scale up and glow).
- **Domain Status:**
  - Available: Pastel Green pill.
  - Taken: Soft Red/Greyed out.
- **Parallel Loading:** Skeleton screens during the parallel API calls to maintain perceived speed.

### 3. Architecture (vinext + Cloudflare)
- **Frontend:** Next.js App Router (shimmed by vinext).
- **Backend:** Cloudflare Workers (Edge runtime).
- **APIs:**
  - AI: Gemini 2.0 Flash (low cost, fast).
  - Search: Composite logic using DNS-over-HTTPS checks with free RDAP fallback.
- **Secrets:** Handled via Wrangler secrets/env vars.

## Implementation Details
- `src/app/page.tsx`: Main interactive search dashboard.
- `src/components/DomainCard.tsx`: Individual domain item with status.
- `src/app/api/search/route.ts`: Edge route for domain checks.
- `src/app/api/suggest/route.ts`: AI suggestion engine.
