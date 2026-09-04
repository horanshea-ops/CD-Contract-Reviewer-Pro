# CD Contract Reviewer

Internal tool for ConferenceDirect associates: upload a proposed hotel/venue contract,
get back a list of terms that create financial exposure, measured against how CD
actually negotiates, with proposed replacement language.

**This is a negotiating aid, not legal advice.** See the full build brief for the
complete spec, non-negotiables, and phased rollout plan.

## Status

Working end to end, locally, on personal accounts: login, upload, background analysis,
findings review (accept/edit/dismiss), audit logging, and a dashboard. See
[ROADMAP.md](ROADMAP.md) for progress against the build brief's build order and what's
still open.

The standards library (19 clause types) is currently seeded from generic industry
practice (`provenance: industry_default`) — not CD's actual negotiated positions.
Nothing built on it yet should be described as "how ConferenceDirect negotiates."
Not yet deployed anywhere — runs locally via `npm run dev` only.

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

## Auth

Email magic-link login (Supabase Auth), gated by the `associates` table — a successful
login isn't enough by itself; the email also has to be an active row there (the
allowlist, per build brief §4.2). No corporate IT/SSO involved for v1.

To add someone to the allowlist for local testing:
```
npx tsx scripts/seed-test-associate.ts you@example.com "Your Name"
```

Supabase's free tier only sends 2 auth emails/hour, which makes iterating on login
locally painful. To test without waiting on real email (and without touching that
limit at all), generate a working login link directly:
```
npx tsx scripts/dev-login-link.ts you@example.com
```
This calls the same login code path a real emailed link would — it just skips the
mail step. Before a real pilot with multiple associates, Supabase's default mailer
will need to be replaced with a proper transactional email provider (or the Pro plan,
which raises but doesn't remove the limit) under Auth → Email settings.
