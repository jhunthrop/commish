# The prep site: product and architecture spec

Date 2026-10-12. Status: binding for the rebuild. Supersedes `docs/superpowers/specs/2026-09-19-ground-zero-architecture.md`, `...-live-room-service-design.md` and `docs/rebuild/lane-brief.md`. Decided under the founder's autonomy grant of 2026-10-11 ("You have autonomy here but don't make lazy mvp decisions, always build for the long-term."). Inputs: the three research reports in `docs/research/2026-10-11-prep-site-*.md`, the approved design authority in `docs/design/mocks/2026-10-12-commish/`, the mock room rethink in `docs/design/2026-10-12-mock-room-rethink.md`, and the founder's foreversixty repo as the operational shape.

## 1. What the product is

A fantasy football draft prep site. Everything on it answers one question for a drafter: who do I take, and why. The parts, in the order a drafter meets them:

1. **The board** per format (PPR, half, standard, TE premium, superflex, two flex, dynasty and best ball as roster-rule variants, auction values from points over replacement), ranked by our projections with tiers and the drop to the next tier printed on the strip. Free.
2. **A page per player** with the projection and its basis, the range of outcomes (floor, median, ceiling), the written capsule, where drafters take him, and the verb Add to my sheet. Free.
3. **ADP** as a page with its sources named, and **our record**: the public accuracy of our projections against the held-out season, updated as the season plays. Free.
4. **Mock drafts**: a solo room against bots with no clock, a lobby with people, and the report (`docs/design/2026-10-12-mock-room-rethink.md`). Free, with the advisor.
5. **Your sheet**: rank, tier, tag, note, drag, import, export, print. Free.
6. **Comparison, strength of schedule, the clubs index.** Free.
7. **The Draft Pass** ($39 a season, non-renewing): the advisor beside a live draft on another host, custom-scoring boards from your league's exact rules, every format. **The Membership** ($99 a year or $14.99 a month, annual shown first): the pass plus full-depth reasoning per player, the range of outcomes in full, the sheet synced to a live draft, early access to the nightly run. **The Group Draft Pass** per league. One-click cancellation, a reminder before any renewal. Never gated: the prose, the projection, the standard boards. Never: contests, sportsbook bundles, ads. Prices are set in 2027 against the 2026 record.

Not at launch, by design: league sync, start and sit, waivers, trades, lineups, content, a native app.

The copy rules carry unchanged: no em-dashes, no semicolons, no competitor names on a screen, no tips or explainer text, fantasy words not trading words, every number names its basis in the same view, prose is written by the grounded writer and never templated.

## 2. The shape

Four lanes of code in one repository, the shape of foreversixty without Astro:

```
web/        SvelteKit, the whole site, on Cloudflare Workers static assets
api/        Go, one module, two commands: api (request API) and room (live rooms)
research/   TypeScript, the research core carved out of src/: the nightly job and the advisor lane
infra/      the Cloud Run, Cloudflare, Neon and GitHub Actions definitions
```

`src/`, `app/`, `drizzle/` for app tables, `next.config.*`, every React component, every Next route, Vercel and its cron are deleted at cutover (§10). Nothing is ported file by file. What moves is the research core and the draft engine, and the engine moves by port, not by copy.

### 2.1 web: SvelteKit on Cloudflare

- **One SvelteKit app** with `adapter-cloudflare`, served as Workers static assets with one Worker for the few request-time routes. The nightly pages (boards, players, ADP, the record, clubs, comparison, strength of schedule) are **prerendered** at build from the nightly data, so they are static files at the edge with no runtime cost and the tightest budgets. The user pages (sheet, mock, lobby, report, account, pass) are **client-rendered** routes that talk to the Go API over `api.trycommish.app`.
- **Nightly data** lands as versioned JSON in an R2 bucket under its run id (`runs/2026-10-12T05/boards/ppr-12.json`, `players/<id>.json`, `adp.json`, `record.json`). The nightly job ends by dispatching the web workflow, which builds against that run id and deploys. Every nightly page prints its run date in the top bar. Build time with about 750 player pages, each inlining all formats, is budgeted at under four minutes and measured in CI.
- **Search** is client side over a nightly index (`index.json`, name, team, position, id), under 60 KB gzipped, loaded on first focus.
- **Tokens and primitives** come from `docs/design/mocks/2026-10-12-commish/tokens.css` and `system.html`, as Svelte components in `web/src/lib/ui/`: the shell (rail, top bar, search, theme switch), the row, the face, the position pill, the tier strip, the value cell, the gap chip, the chip and chip group, the verb and the quiet button, the panel, the since strip, the call panel, the score bug. No page-local visual mapping, ever (`centralize-ui-primitives-first-time`).
- **Budgets in CI**, as foreversixty does: Lighthouse on the board, a player page, the mock room and the sheet on every push, with LCP under 1.2 s on the prerendered pages and 2.0 s on the user pages at the throttled mobile profile, total JS under 60 KB gzipped on a nightly page and under 180 KB on the room, CLS under 0.05. A failed budget fails the deploy.
- **Theme** is the three-state switch (Auto, Light, Dark) remembered per browser, and the server never guesses.

### 2.2 api: Go on Cloud Run

One Go module `api/` with internal packages in the foreversixty shape (`auth`, `billing`, `entitlements`, `db`, `httpx`, `metrics`, `jobs`, `config`) plus the product's own: `sheets`, `leagues` (saved league settings), `mocks`, `rooms`, `draft` (the engine port), `bots`, `sim`, `exports`, `adp`.

Two commands from one image:

- **`api`**: the stateless request API. Accounts and sessions (WorkOS AuthKit, `auth-is-workos`), saved leagues, sheets (CRUD, import, export, print view data), mock creation and the solo room's picks, the report, entitlements, billing webhooks, exports. Scales to zero outside the season.
- **`room`**: the live room service. One goroutine per lobby owns its clock, WebSocket to the clients with session affinity, state as an action log in Postgres with the same semantics as today's `draft_actions`, minimum one instance from July through September so a clock never waits on a cold start, and a sweep that adopts rooms whose instance died. The solo room is the same reducer with no clock, so `api` answers it directly: a human pick resolves every bot pick to the next human turn in one transaction and returns the whole batch, stamped with no delay.

Request shape: a consistent envelope (`ok`, `data`, `error`, `meta` for pages) and OpenAPI in `api/openapi.yaml`, generated types for the web lane, rate limits on every endpoint, parameterized queries only, secrets from the environment validated at start.

### 2.3 research: Python, migrated now

Revised 2026-10-12 after the founder's ruling ("we'll still need all of the data and models we were previously using. We can use python for that", then "no let's migrate it now - it is what it is"). The research lane is Python, in the shape of foreversixty's `data/` lane: one `research/` project (Python 3.13, `uv`, `pyproject.toml`) with packages `pipeline` (every ingest: nflverse, the stats provider, schedules, rosters, the crosswalk, ADP sources, coaches), `model` (the fit, validation, backtests, the decide layer with survival and the pick recommendation), `capsules` (the grounded writer and its rejection pass), `nightly` (the chain and the run format), and `advisor` (the request-time HTTP service for `api` and `room`). Numeric work uses numpy, pandas and scipy; the schema stays the existing `research` schema in Neon, with alembic taking over from Drizzle at a baseline revision equal to the current state.

The oracle is the TypeScript core as it stands on main at the ruling, carved out by Lane 2 into `research-ts/` so it runs on its own: every ingest is switched only after a parallel run matches the TypeScript ingest row for row on the same inputs, and the Python fit replaces the TypeScript fit only after it reproduces the stored projections for every player-week of the 2026 register within a stated tolerance, with the differences listed by cause. The register carries an `implementation` tag per run, and the accuracy record page states the switch date, because the held-out claim is only honest if the switch is visible. `research-ts/` is deleted once every parity gate has passed and the Python nightly has produced seven clean runs.

Two entry points, as before: `nightly`, a Cloud Run Job on a schedule, and `advisor`, a small HTTP service called only by `api` and `room`, under 50 ms per call at p90, measured. The projections fit is never ported to Go.

### 2.4 The engine port

The draft engine, the bots and the continue/room-odds sim are ported to Go in `api/internal/{draft,bots,sim}` before launch, because the room service owns the clock and one engine must serve both rooms and the report. The oracles: `src/draft-engine/replay-pins.fixture.ts` (60 bot picks, 24 delays, 60 clock autopicks for seed 20260912, byte for byte), a frozen fixture of 1,000 continue runs from a recorded room, and every 2026 mock log replayed to the same final state. mulberry32 and FNV-1a are reproduced exactly, and the weighted draw's float arithmetic is checked against the pins before anything else is written. The advisor, the survival and the why stay TypeScript at launch (§2.3) and are ported after, in that order.

### 2.5 Data

- **Neon Postgres**, one database, two schemas. `app` is owned by Go and migrated with goose from `api/migrations`: accounts, sessions, leagues, sheets, sheet rows, mocks, mock actions, rooms, room actions, entitlements, billing events, exports, lobby picks (the start of our own ADP). `research` is owned by the TypeScript core and migrated with Drizzle from `research/drizzle`: everything the nightly job reads and writes. Neither lane writes the other's schema. Production is for one-shot backfills and one verification read (`prod-db-is-for-backfills-only`); every measurement runs against a dev branch.
- **R2** for the nightly runs and exports. **No file-sourced data at runtime** anywhere (`no-file-sourced-data-at-runtime`): the web build reads a run from R2, the API reads tables.
- **Headshots** from the provider's public URLs at launch, behind an image route with caching, so a provider change is one line.

### 2.6 Auth, billing, entitlements

- WorkOS AuthKit, session cookie on the apex domain so `trycommish.app` and `api.trycommish.app` share it. The web lane never holds a secret.
- Stripe behind an entitlements table exactly as foreversixty does: a feature is a snake_case string (`live_draft_advisor`, `custom_scoring`, `full_reasoning`, `range_of_outcomes`, `synced_sheet`, `early_run`), `Can(account, feature)` answers from the table and nothing else, and a webhook, a grant and a group purchase all look identical from there. The Draft Pass is a one-time payment tagged with its season and expires at the season's end with no renewal. The Membership is a subscription with the annual price shown first, one-click cancellation on the account page, and an email seven days before any renewal. The Group Draft Pass is a purchase by a commissioner that mints N pass grants for a league, claimed by link.

### 2.7 The Draft Pass's live draft

The one piece of new engineering: reading a draft in progress on another host. Sleeper first, because its draft and picks endpoints are public by draft id and need no sign-in, which makes a polling companion a request-time feature: paste the draft link, the advisor runs against the host's picks with our board and your sheet. ESPN and Yahoo require the drafter's own session, so they are a browser extension lane that ships after Sleeper, measured on a real draft of each before it is sold. The pass page says which hosts work today, by name of the host, which is a mechanism and not a competitor claim.

## 3. The mock rooms

Specified in `docs/design/2026-10-12-mock-room-rethink.md`. The targets to measure: solo pick round trip under 50 ms p90 including the batch, lobby fill under 90 seconds, the report's 200 runs under 300 ms, reconnect after a tab close under two seconds, a leaver replaced by a bot before the next clock expires.

## 4. The nightly run and the record

The nightly job is the product's heartbeat. It runs at 05:00 UTC, writes every artifact under one run id, and fails the run (and keeps the previous run live) if validation gates fail: the held-out backtest does not regress, every board has every roster slot filled to the depth the format needs, every player page has a capsule with every pull figure found word for word in its prose, every number carries its basis. The record page is written from the same run: our projections against the season to date, by position, against ADP as the comparison a drafter already trusts, with the method on the page. Early access to a run (Membership) is the run id unlocked an hour before the public build.

## 5. Performance, the founder's reason for the stack

Measured, not asserted. Each lane carries a budget and a measurement in CI, and the ledger records the number with its basis. The board's first paint under 1.2 s on throttled mobile from a cold cache, the mock room usable under 2 s, the sheet's drag at 60 fps on a mid phone, the API's p90 under 100 ms for every read, the room's pick broadcast under 150 ms p90 from pick to every client. Edge-prerendered pages are the first lever, the Go API the second, and the client bundle budget the third.

## 6. What does not change

The research core's science and its held-out discipline, `launch-2027-data-year-2026`, Tank01 as the only stats source with no mock data, nflverse as the only recurring charted source, the capsule writer and its rules, WorkOS, the honest-data rules, the persona panel on every surface, measurement before fixing. The league platform stays reachable at the tag `league-platform-final`.

## 7. Lanes

Each lane is a worktree with its own ledger. Gates during the build are `svelte-check` or `go vet` and `go build`, the sub-second source guards, and the lane's measurement. No new test suites and no suite runs during build phases (founder, 2026-09). The full suite runs once at cutover. Dependencies run left to right.

| Lane | Builds | Depends on | Founder provides |
|---|---|---|---|
| 0 Tokens and primitives | `web/` skeleton with adapter-cloudflare, `tokens.css` as Svelte tokens, the primitives list in §2.1, a system page that renders every primitive in both themes, Lighthouse config | nothing | nothing |
| 1 Infra | Cloudflare zone and Workers project, Cloud Run services (`api`, `room`, `advisor`), the Cloud Run Job (`nightly`), Artifact Registry, Neon database with the two schemas, R2 bucket, GitHub Actions per lane with path filters and a Postgres service at 5433 for Go tests, secrets | nothing | Cloudflare account and the `trycommish.app` zone, a GCP project with billing, a Neon project, Stripe products in test mode, WorkOS redirect URIs for the new domain |
| 2 TypeScript oracle | `research-ts/`: the TypeScript core carved out so it runs on its own, a nightly entry point writing a run locally, the advisor server, the job inventory (`JOBS.md`), the import guard. Not deployed. Deleted after parity. | nothing | nothing |
| 2P Python research lane | `research/` in four phases: A ingests and schema with row-for-row parity, B the fit, validation and backtests with register parity, C the decide layer, the capsule writer with the two defect fixes, the advisor service, D the nightly chain, the run format to R2, the image, the Cloud Run Job, the schedule, the web build dispatch | 2 for the oracle, 1 for the deploy | nothing |
| 3 Go API | accounts, sessions, leagues, sheets, entitlements, billing, exports, OpenAPI, the envelope, rate limits | 1 | Stripe webhook secret |
| 4 Engine port | `draft`, `bots`, `sim` in Go against the pins and the 1,000-run fixture, the solo pick batch, the report's 200 runs | 3 for persistence | nothing |
| 5 Nightly surfaces | board per format, player page, ADP, the record, clubs, comparison, strength of schedule, search, prerender from a run | 0, 2 | nothing |
| 6 Rooms | the room service, the solo room, the lobby, the report, setup and saved leagues, the advisor call | 0, 3, 4 | nothing |
| 7 Your sheet | the sheet with rank, tier, tag, note, drag, import, export, print, and its seeding of the room queue | 0, 3 | nothing |
| 8 Draft Pass | Sleeper live draft companion, custom scoring import, the pass and membership pages, checkout, the group pass | 3, 5, 6, 7 | Stripe live keys at launch |
| 9 Cutover | delete every Next.js file, retire Vercel, DNS to Cloudflare, the full suite, the first nightly run in production, the ledger's measurements | all | the DNS change |

Lane 0, Lane 2 and Lane 2P phase A start now. Lane 1 starts when the founder has provisioned the accounts in the table, and Lanes 3 to 7 fan out behind it.

## 8. Open questions resolved here

- Monorepo, not a new repository: the research core, the migrations, the design docs and the memory of why stay in one history. The old `src/` is deleted in Lane 9, not moved aside.
- One Go image, two services, so the room's minimum instance does not keep the API warm for nothing.
- Prerender, not edge SSR, for the nightly pages: a nightly product has a nightly build.
- Two schemas in one Neon database, not two databases: the lobby picks feed the research ADP and a join should not cross a network.
- Sleeper first for the live draft, by the shape of its API, not by preference.
- Lobbies at launch, per the founder on 2026-10-12.

## 9. What the build must settle, carried from the mocks

Board-wide tiers (projections lane, Lane 2). Kickers and defenses in the mock pool (Lane 4). Handle length and the account-name filter for lobbies (Lane 3). The report's basis sentence re-measured with the archetype bots (Lane 6). The board's Basis panel, kept until the persona panel calls it a tip (Lane 5).

## 10. Cutover

Lane 9 runs when Lanes 5, 6 and 7 are measured and the nightly job has produced seven consecutive clean runs on the dev branch. The order: freeze `src/`, run the full suite once on the new lanes, point DNS at Cloudflare, run the first production nightly, verify by behavior on the live site, delete `src/`, `app/`, the Next config and Vercel from the repository in one commit, tag `prep-site-launch`.
