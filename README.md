# CD Contract Reviewer

Internal tool for ConferenceDirect associates: upload a proposed hotel/venue contract,
get back a list of terms that create financial exposure, measured against how CD
actually negotiates, with proposed replacement language.

**This is a negotiating aid, not legal advice.** See the full build brief for the
complete spec, non-negotiables, and phased rollout plan.

## Status

Stage 1 of the build: proving the analysis pipeline works, headlessly, before any UI.
The standards library is currently seeded from generic industry practice
(`provenance: industry_default`) — not CD's actual negotiated positions. Nothing built
on it yet should be described as "how ConferenceDirect negotiates."

## Local setup

1. Copy `.env.local.example` to `.env.local` and add your Anthropic API key
   (from console.anthropic.com → Settings → API Keys).
2. `npm install`
3. Generate a synthetic test contract: `npm run sample:generate`
4. Run it through the pipeline: `npm run pipeline:test`

This calls the real Claude API and will use a small amount of paid API credit.

## Database setup (Supabase)

1. In your Supabase project, run `supabase/schema.sql` (SQL Editor → paste → Run).
2. Add the project's URL and keys (Settings → API) to `.env.local`.
3. Load the standards library into the database: `npm run standards:seed`
   — safe to re-run any time the library changes in `lib/standards/v1.ts`.
