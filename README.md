# Commish

A season-long, real-money fantasy football platform — see `docs/research/2026-08-16-beating-apex-strategy.md` for the product strategy and `plans/00-roadmap.md` for the full 9-phase build plan.

## Development

```bash
npm run dev          # start the dev server
npm test             # run the test suite once
npm run test:watch   # run tests in watch mode
npm run lint         # lint
npm run typecheck    # type-check with no emit
npm run infra:up     # start local Postgres + Redis (docker compose)
npm run db:migrate   # apply the drizzle migrations (required before the first seed)
npm run seed         # seed players, dev leagues and the demo season league
```

`npm run seed` seeds three leagues: `Dev Snake League` and `Dev Auction League`, both empty and
scheduled so you can actually run a draft in them, and `Dev Season League` — a full 12-team
league that has already played its whole regular season. Its rosters are dealt legally through
the draft engine's own slot-assignment rule rather than replayed pick-by-pick, its schedule is
fully generated, and every week is already scored, so standings, matchup pages and a clinched
playoff spot all have real data to show the moment you sign in. Re-running the seed is safe —
every seeder upserts rather than duplicating. Set `DEV_SEED_CLAIM_USER_ID` to your own signed-in
user id first to take over team 1 and the commissioner's chair in all three leagues.

The seeders create placeholder users and mass-upsert every player, so they refuse to run unless
`ALLOW_DESTRUCTIVE_SEED=1` is set **and** `DATABASE_URL` names a loopback host — put both in
`.env.local` (see `.env.example`). The check is on the target, not on `NODE_ENV`, which is
`undefined` under `tsx` and would let the one accident that matters through.

Read `docs/conventions.md` before working in this repo — it's the single source of truth for directory layout, naming conventions, and the rules every step of the build plan assumes. See `docs/draft-engine.md`, `docs/draft-room.md`, `docs/draft-moderator.md` and `docs/league.md` for the draft and league systems in depth.
