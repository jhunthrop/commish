# Commish

A season-long, real-money fantasy football platform — see `docs/research/2026-08-16-beating-apex-strategy.md` for the product strategy and `plans/00-roadmap.md` for the full 9-phase build plan.

## Development

Copy `.env.example` to `.env.local` (gitignored) and fill in real WorkOS values before the
first run — every command below that touches Postgres reads its connection string from there.

```bash
npm install               # install dependencies
npm run infra:up          # start local Postgres x2 + PgBouncer x2 + Redis (docker compose)
npm run db:migrate        # apply the drizzle migrations (required before the first seed)
npm run seed              # seed players, dev leagues and the demo season league
npm run dev               # start the dev server

npm test                  # run the test suite once
npm run test:watch        # run tests in watch mode
npm run test:coverage     # run tests with coverage — verify UNFILTERED before merging any change
                          # touching src/scoring, src/draft-engine, src/draft-room/state,
                          # src/league, src/chat, src/matchmaking, src/stats or src/stats-pipeline
npm run lint              # lint
npm run typecheck         # type-check with no emit
npm run build             # production build — part of the verification gate for every step
npm start                 # run the production build (after npm run build)
npm run audit:verify      # walk every audit chain incrementally from its checkpoint; add --full
                          # for a from-genesis walk of every chain. Exits non-zero and names the
                          # scope/sequence/event/reason on a broken chain — see
                          # docs/decisions/audit-and-integrity.md
npm run e2e:install       # one-time: download the Playwright browser
npm run e2e               # browser end-to-end suite (needs a build + a WorkOS test key)
npm run e2e:ui            # same suite, in Playwright's interactive UI mode
```

`npm run infra:up` brings up all five docker-compose services: `postgres` (5432), `postgres-test`
(5433, tmpfs), `pgbouncer` (6432 → postgres, transaction pooling mode), `pgbouncer-test`
(6433 → postgres-test) and `redis` (6379). `DATABASE_URL` points at port **6432** (the pooler),
not 5432 — that is how the deployed app connects, and a pooler that is only in the path in
production is a pooler nobody has tested. Connecting directly to 5432 with `psql` is fine; it is
just not what the app itself does. See `docs/decisions/data-layer-hardening.md`.

`npm run db:migrate:test` applies the same migrations to the dedicated test database
(`docker-compose.yml`'s `postgres-test`, tmpfs-backed) that `npm test` runs against.
`npm run db:generate` regenerates a drizzle migration after a schema change;
`npm run db:studio` opens Drizzle Studio; `npm run tokens:build` regenerates
`src/design/tokens.css` from `src/design/tokens.ts`; `npm run stats:generate` regenerates the
mock stat dataset; `npm run stats:tank01:record` re-records the Tank01 fixtures
(`src/stats/tank01/fixtures/`) from the live API — needs `TANK01_API_KEY` in `.env.local`;
`npm run stats:ingest` runs the live-scoring ingestion worker for exactly one tick and exits,
printing what it found and what it cost against the monthly request budget — the way to see the
pipeline work without waiting on `STATS_INGESTION_CONFIG.pollIntervalMs` (thirty minutes), and
what to run first against a real `TANK01_API_KEY`; `npm run reviews:remove` is the review feed's
one moderation action, an operator-run script (`scripts/remove-review.ts`, no admin UI or staff
role exists) that stamps a review's `removedAt`/`removedByUserId`/`removalReason` rather than
deleting the row, refusing a review that is already removed; `npm run infra:down` stops the local
stack.

Chat's "Add a GIF" button reads `GIF_PROVIDER` (default `none`, no button rendered, chat stays
text-and-emoji) and, when set to `giphy`, `GIPHY_API_KEY` (developers.giphy.com) — see
`.env.example`. Same fail-fast contract as `STATS_PROVIDER`: an unrecognized `GIF_PROVIDER` value
never falls back to `none`, it throws and names the valid choices.

The whole suite also runs through PgBouncer in transaction pooling mode as an explicit release
gate, rather than as the everyday default (a pooler in the path would slow down every one of the
suite's 1,300-plus tests and can turn a real regression into something that looks like a pooling
artifact):

```bash
TEST_DATABASE_URL=postgres://commish:commish@localhost:6433/commish_test npm test
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

`npm run e2e` runs the Playwright suite in `e2e/` against a production build (`npm run build`
first) and the docker-compose Postgres/Redis. It authenticates by minting a real WorkOS
**test-directory** session and sealing it into the same `wos-session` cookie the app reads, so
it exercises the real middleware, the real callback and the real `getCurrentUser()` path.
There is deliberately no dev auth bypass: without an `sk_test_`-prefixed `WORKOS_API_KEY` the
suite refuses to start and names the variable that is missing. In CI the same suite runs in a
separate `e2e` job that stops with a visible warning when the repository has no WorkOS test
secrets, rather than passing without having checked anything.

The two managers the suite drives (`e2e/global-setup.ts`) are STABLE, fixed-email test-directory
identities, minted once and reused on every rerun, rather than a fresh random identity per run.
A fresh identity every run used to collide with the seed's own first-claim-sticks rule: run one
claims the seeded season league's team for whichever identity ran first, and that claim sticks
forever, so a second run minting a brand-new identity ended up authenticated as a manager who no
longer owned the team the seed had already handed to run one's identity. Re-running the whole
suite back to back, with no manual database reset in between, is expected to pass every time.

`npm run build` writes to `.next` by default. The e2e suite instead builds into an isolated
`.next-e2e` (`NEXT_DIST_DIR`, see `playwright.config.ts` and `next.config.ts`), so a `next dev`
server running against the same checkout at the same time never corrupts it. Running the suite
by hand needs the same var on the build step that precedes it:
`NEXT_DIST_DIR=.next-e2e npm run build && npm run e2e`. CI's `e2e` job does the same.

Read `docs/conventions.md` before working in this repo — it's the single source of truth for directory layout, naming conventions, and the rules every step of the build plan assumes. `docs/design-system.md` is its visual counterpart and is mandatory reading for any user-facing step. See `docs/draft-engine.md`, `docs/draft-room.md`, `docs/draft-moderator.md` and `docs/league.md` for the draft and league systems in depth.
