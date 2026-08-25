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
                          # touching a gated directory (twenty-four of them, each held at 100% —
                          # the list lives in vitest.config.mts and docs/conventions.md's Tests
                          # section; a path-filtered run reports the others at 0%)
npm run lint              # lint
npm run typecheck         # type-check with no emit
npm run build             # production build — part of the verification gate for every step
npm start                 # run the production build (after npm run build)
npm run audit:verify      # walk every audit chain incrementally from its checkpoint; add --full
                          # for a from-genesis walk of every chain. Either walk also reconciles
                          # what it found against audit_chains and audit_chain_checkpoints, which
                          # is how deletion is detected at all. Exits non-zero and names the
                          # scope/sequence/event/reason on a broken chain — see
                          # docs/decisions/audit-and-integrity.md
npm run admin:grant       # grant or revoke operator (dispute-queue) access — the ONLY door
                          # users.is_admin opens through, run against the database host, never
                          # through a session: npm run admin:grant -- --user <userId> --by
                          # <granterUserIdOrBootstrap> [--revoke]. See
                          # docs/decisions/operators-and-moderation.md §1.
npm run integrity:sweep   # the multi-account detector's manual re-run for one league:
                          # npm run integrity:sweep -- --league <leagueId>. The join-time trigger
                          # (accepting an invite, joining a public league) already runs this after
                          # every new seat fills; this is for a league whose signals moved since,
                          # or whose trigger failed. See docs/decisions/operators-and-moderation.md §7.
npm run stats:correct     # re-read and re-settle a week that has already gone final — the operator
                          # path around the ingestion worker's own three-day correction window:
                          # npm run stats:correct -- --week <n> --by <operatorUserId>. Reserves
                          # against the same monthly request budget the worker draws from and
                          # fails closed on a denial. See docs/decisions/operators-and-moderation.md §10.
npm run trades:sweep      # the trade-fairness detector's manual re-run: raises a trade_fairness
                          # flag for every ACCEPTED trade over INTEGRITY_CONFIG.trade
                          # .fairnessFlagThreshold that has no flag yet, scoped to one league with
                          # npm run trades:sweep -- --league <leagueId> or every league when
                          # omitted. The remedy for the after-commit flag write's own honest gap
                          # (a process dying between an accept committing and its flag landing) —
                          # idempotent by construction, the same shape npm run integrity:sweep
                          # already uses. See docs/trades.md and
                          # docs/decisions/trades-and-fairness.md §6.
npm run money:reconcile   # the ledger's pooled balance against the bank's, plus the double-entry
                          # law, the user_available floor and escrow-by-league consistency —
                          # every check its own figure, never a boolean. Exits non-zero and names
                          # each drift to the cent; a clean run says so plainly. Level-triggered,
                          # no scheduler (this and the admin-room drift panel's own "Refresh"
                          # button, /app/admin/money/reconcile, are the only two callers).
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

**Prune docker volumes BY NAME, never blanket.** The docker daemon on a dev machine is shared with
sibling projects, so `docker volume prune` (or any unscoped `-v` teardown) reclaims space by
deleting volumes that belong to somebody else's stack. `docker-compose.yml` pins `name: fantasy`,
so this project's own volumes are `fantasy_*` and can be removed individually when a disk actually
fills up. That is the lesson from a real no-space incident, recorded here rather than left in a
plan's ledger.

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
script-side moderation door (`scripts/remove-review.ts`, retained beside the dispute queue's
in-product path) that stamps a review's `removedAt`/`removedByUserId`/`removalReason` rather than
deleting the row, refusing a review that is already removed; `npm run infra:down` stops the local
stack.

Two facts about the shared local stack worth knowing before a long verification session: the dev
database's named volume PERSISTS across `infra:down`/`infra:up` (by Compose design), so a database
that has lived through several phases of seeds and e2e runs carries state a fresh checkout would
not — sweeps and hardcoded test expectations can both be surprised by it, and `docker compose -p
fantasy down -v` (this stack's volumes only, never a blanket prune) is the reset when they are.
And if Docker itself runs out of disk mid-run, prune dangling volumes BY NAME after checking whose
they are — a blanket prune reaches every project on the machine.

Chat's "Add a GIF" button reads `GIF_PROVIDER` (default `none`, no button rendered, chat stays
text-and-emoji) and, when set to `giphy`, `GIPHY_API_KEY` (developers.giphy.com) — see
`.env.example`. Same fail-fast contract as `STATS_PROVIDER`: an unrecognized `GIF_PROVIDER` value
never falls back to `none`, it throws and names the valid choices.

The whole suite also runs through PgBouncer in transaction pooling mode as an explicit release
gate, rather than as the everyday default (a pooler in the path would slow down every one of the
suite's 4,000-plus tests and can turn a real regression into something that looks like a pooling
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

The seed also runs `seedFormatDemos` (Phase 3.5, Task 10), which fires all five of this phase's new
mechanisms through their real paths rather than hand-stamping the columns they write: a superflex
league, a slow-tier draft that skips and owes a pick, a draft drawn through the KDS slot-preference
step, and a sit-and-go league whose last seat fills and whose fill trigger sets a real kickoff —
the fifth (the median game) is its own already-scored `MEDIAN_DEMO_LEAGUE`, threaded onto the
same `finalizeWeek` loop the other season leagues already run. Every one of
these leagues stays small and immediately full on purpose: they are backstage proofs that a
mechanism fires for real, not additional demo rooms meant to be browsed or joined.

The seed's LAST step is `seedHouseCatalogDemo` (Phase 3.5 addendum, Task 15): it calls the real
`ensureHouseCatalog` reconciler to stock the house shelf, fills one `open_12` league's actual
shortfall through the real `joinPublicLeague` door with dedicated `dev_house_demo_NN` identities,
then calls the reconciler again so a real replacement league opens with a fresh edition — the same
"lobby is never empty" mechanism the running server's own ticker keeps proving, backstage rather
than left to happen on its own the first time someone opens `/browse`. Re-running the seed is safe
here too: the arc reads back each league's actual seat count rather than assuming an empty shelf,
so a second `npm run seed` reports `0 new seat(s)` and an identical shelf width.

The seed also grants **operator (dispute-queue) access** to that same account — team 1's owner,
`DEV_SEED_CLAIM_USER_ID` if you set it, else the seed's first placeholder user — through the real
`grantAdmin` writer, exactly what running `npm run admin:grant` by hand would produce (a real
`admin_action` audit event, a real notice, never a mock row). `npm run seed && npm run dev` lands
signed in as an operator with a working `/app/admin/queue` and no manual grant step. The detector
also runs for real during the seed, so the queue starts with real flags raised by the real sweep
rather than decorative rows — see `docs/decisions/operators-and-moderation.md` for the role and the
queue in full.

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

The manager identities the suite drives (`e2e/global-setup.ts` — six of them now: managers A
through D, a zero-league manager and a sign-out fixture) are STABLE, fixed-email test-directory
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

Read `docs/conventions.md` before working in this repo — it's the single source of truth for directory layout, naming conventions, and the rules every step of the build plan assumes. `docs/design-system.md` is its visual counterpart and is mandatory reading for any user-facing step — as of Phase 3.6 (v2) it carries both the retoned dark-and-light token system and the copy-register rules (no contractions, the named safety-net phrase, the single start-timing authority) every user-facing surface now follows; `docs/decisions/design-v2.md` is that phase's own closing decision record. See `docs/draft-engine.md`, `docs/draft-room.md`, `docs/draft-moderator.md` and `docs/league.md` for the draft and league systems in depth.
