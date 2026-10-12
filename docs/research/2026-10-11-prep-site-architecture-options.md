# Prep site architecture options: Svelte, Go, Cloudflare edge, Cloud Run

**Date:** 2026-10-11. **Status:** research for the founder's three decisions (section 8). Nothing here is built.
**Inputs:** the founder's other repo at `~/code/forever` (remote `foreversixty`), cited below as `forever/...`; this repo's code, cited by path; `pivot-draft-prep-site` memory; the superseded ground-zero spec (`docs/superpowers/specs/2026-09-19-ground-zero-architecture.md`); the batched-bots ledger (`docs/rebuild/ledgers/batched-bots.md`).

The founder's instruction: Svelte, Go, Cloudflare edge, containers on Cloud Run, "mimic what we have in foreversixty but don't use astro."

## 1. The Forever shape, precisely

**Static site at the edge.** Astro in static output, `build.format: 'file'`, every stylesheet inlined (`forever/web/astro.config.mjs`). Svelte 5 islands. The whole `dist/` is uploaded as Cloudflare Workers static assets: `assets.directory: ./dist`, `html_handling: auto-trailing-slash`, `not_found_handling: 404-page` (`forever/web/wrangler.jsonc`). The built site is 110 HTML files and 108 JS chunks totalling 924 KB (`forever/web/dist`). Pages read their data at build time by importing JSON (`forever/web/src/pages/bis/[class]/[spec].astro` imports `classes.json`, `active-build.json`, and calls `loadBisFile`). Pages that do not exist at build time (`/reports/<id>`, `/rankings/<slug>`, `/character/...`, `/guild/...`, `/sim/<id>`) are one static shell per prefix whose `<title>` and Open Graph tags the Worker rewrites with `HTMLRewriter` from the API's JSON (`forever/web/src/worker.ts`, `SHELL_ROUTES`; `forever/web/README.md` "The shells").

**The one Worker.** `wrangler.jsonc` sets `main: src/worker.ts` and `run_worker_first` to eight prefixes (`/b/*`, `/logs-data/*`, `/duckdb-runtime/*`, the four shells, `/sim/*`). Every other path is served from assets with no Worker invocation. The Worker proxies `/b/<id>` to the Go API forwarding only `Accept` and `Accept-Language`, strips `Set-Cookie` on the way back, and serves a 503 page on upstream failure (`forever/web/src/worker.ts`, `FORWARDED_HEADERS`, `unavailable`). It also serves report files out of the R2 bucket `foreversixty-logs` through the edge cache after a 60 s visibility check against the API (`VISIBILITY_TTL_MS`, `LOGS_DATA_PATH`).

**Build time versus runtime data.** `forever/web/scripts/sync-data.mjs` runs before `dev`, `check`, `test` and `build` (`pre*` hooks in `forever/web/package.json`). It copies `data/builds/<build>/...` into `public/data/<build>/` for islands to fetch at runtime, and mirrors three reference files into `src/data/generated/` for pages to import at build time. `FOREVER_DATA=fixture` publishes a checked-in fixture; a deploy (`CF_PAGES=1`) refuses the fixture. The data pipeline is Python; its workflow commits new builds to `main` as `forever-data-bot` (`forever/.github/workflows/data.yml`, the final `git add builds ... git push` step). That commit triggers the web workflow through its `paths: data/builds/**` filter (`forever/.github/workflows/web.yml`).

**Deploy flow per workflow.** `web.yml`: `build` (check, lint, format, unit tests, fixture build, upload `web-dist`) fans out to `build-real`, `e2e` sharded four ways, `lhci` sharded three ways, then `deploy` runs `make artifacts` for the Go wasm engine, `CF_PAGES=1 npm run build`, and `cloudflare/wrangler-action@v3 deploy` on a push to `main`. A "BUILD MODE" comment records that today `deploy` needs only `build`. `api.yml`: `test` (a Postgres service container, `go test -race -cover -p 1 ./...`), `image` (BuildKit build, a check that the binary reports the pinned engine sha), `deploy` (Workload Identity auth, push to `us-east1-docker.pkg.dev/foreversixty/api/api:<sha>`, `google-github-actions/deploy-cloudrun@v2` with `--memory=512Mi`, then `gcloud run jobs update` for seven jobs). `sim.yml` tests the Go engine with a 40 minute timeout and a 4.5 MB gzipped wasm budget (`forever/Makefile`, `WASM_BUDGET_MB`). Nightly schedules: `addon-data-release.yml` at 05:00 UTC, `bis.yml` at 06:23 UTC committing to `main`, `lhci-nightly` at 07:15 UTC.

**Cloud Run.** One image is the service and every job. `main.go` dispatches on `os.Args[1]`: `parse-report`, `sim-run`, `sim-validate`, `rating-backfill`, `data-addon`, `bnet-refresh`, `grant`, `revoke`, `stripe-setup`, `stripe-reconcile`, else `serve()` (`forever/api/cmd/api/main.go`). The Dockerfile builds `CGO_ENABLED=0` on `golang:1.25-alpine`, ships `gcr.io/distroless/static-debian12:nonroot`, and copies `data/builds` to `/data` so the API serves reference data from the image (`forever/api/Dockerfile`). Jobs are created once by hand with `gcloud run jobs create` at stated sizes (parse 2 CPU 2 GiB 30 m; sim 4 CPU 4 GiB; reconcile 1 CPU 512 MiB 5 m) and nightly ones are fired by Cloud Scheduler (`forever/api/README.md`, "The parse job", "The simulator's Cloud Run jobs"). The API itself executes jobs through the Cloud Run Admin API (`forever/api/internal/jobs/jobs.go`, `NewCloudRun`).

**Database and buckets.** Postgres is Neon: `DATABASE_URL` "may point at a pooler (e.g. Neon's PgBouncer endpoint)", `MIGRATE_DATABASE_URL` is the direct endpoint for golang-migrate's advisory lock, and the secrets are created from `<neon pooled url>` (`forever/api/README.md`). The client is `pgx/v5` with 33 migrations (`forever/api/go.mod`, `forever/api/internal/db/migrations`). R2 is written by the API with the S3 SDK (`forever/api/internal/r2`) and read by the Worker. A GCS bucket `foreversixty-addon-data` takes the nightly addon job's output.

**Auth and billing.** Sessions are an opaque `HttpOnly` cookie `fs_session` with double-submit CSRF: a readable `fs_csrf` cookie echoed in `X-CSRF-Token` (`forever/api/internal/auth/session.go`). Sign-in is Battle.net OAuth or an email magic link (`forever/api/internal/auth/handler.go`, `Mount`). The browser uses `credentials: 'include'` and reads no cookie (`forever/web/README.md`). Billing is Stripe: `POST /v1/billing/checkout`, `/portal`, `/webhook` (`forever/api/internal/billing/handler.go`); prices resolve from four lookup keys (`forever/api/internal/billing/gateway.go`). Entitlements are one table with a single writer and one question, `Can(userID, feature)` (`forever/api/internal/entitlements/store.go`; migration `0020_entitlements.up.sql`). A nightly `stripe-reconcile` job heals missed webhooks.

**Caching.** Every GET sets `Cache-Control` through `httpx.CachePublic` or `httpx.CachePrivate` and carries a weak `ETag` over the `data` field (`forever/api/internal/httpx/cache.go`; `forever/api/README.md` "Cache headers"). The caching spec's last step proxies the API domain through Cloudflare so public reads are served from the edge (`forever/docs/superpowers/specs/2026-09-23-caching-layer-design.md`, section 5).

**What the budgets enforce.** `forever/web/lighthouserc.json`: mobile 360x640, 4x CPU slowdown, 150 ms RTT, 1.6 Mbps, three runs, median. Performance 0.95 on static pages, 0.90 on island pages, 0.85 on the report shell. LCP 1700 ms default, 1900 on BiS pages, 2200 on the homepage. TBT 100 ms, 200 on the two heaviest shells. CLS 0.05 everywhere. Accessibility and SEO 0.95. `forever/web/scripts/check-island-size.mjs` fails `postbuild` when a standalone island passes its gzipped ceiling (planner 75 KB, report 140 KB, sim 90 KB, tools 70 KB), when a page island passes 16 KB, or when any asset passes Cloudflare's 25 MiB cap. Hydration is deliberate: 11 `client:load`, 5 `client:visible`, 4 `client:idle`, 2 of a custom `client:idle-after-load` that waits 800 ms after `load` (`forever/web/src/directives/idle-after-load.ts`). A warning from the same repo: `dist/bis/hunter/marksmanship.html` is 1.38 MB because the whole list is inlined.

Size of the thing being mimicked: 32,090 lines of Go in the API (35,187 of tests), 32,809 in the simulator, 84,216 of TypeScript, Svelte and Astro in the web.

## 2. The prep site mapped onto it

**Static pages, built nightly.**

| Surface | Count at launch | Source |
|---|---|---|
| Board, one page per format | 3 (`ppr`, `half`, `std`, `src/projections/preseason/board-formats.ts`) | `preseason_projections` under `commish_board_v9_<format>_12` (`src/projections/preseason/board-store.ts`) |
| Player pages | about 700 (the capsule sweep's board-relevant budget, `src/capsules/config.ts` `sweepGenerationBudget: 700`) | capsule, peek document, reasons, seasons (`src/capsules/peek-document.ts`) |
| Clubs | 32 | `nflverse` team tables, coaches (`src/db/schema.ts`) |
| ADP | 1 per format, 3 | `adp_snapshots` (`src/db/schema.ts:3356`) |
| Cheat sheet templates | a handful | rankings export (`scripts/rankings-export.ts`) |
| Front door, rules, legal, pricing | about 6 | copy |

Page count: build one player page per player, not one per format. Inline all three formats' numbers for that player (three rows of points, rank, value rank, tier) and let the format selector island switch them. That is about 750 pages, not 2,100, and the player page stays small. The board pages carry the first 100 rows inline and fetch the rest from a static JSON per format. Build time: Forever prerenders 110 pages in a normal CI job; SvelteKit's prerenderer at 750 pages with a 20 KB data file each is a two to four minute build. Nothing here needs incremental builds.

**Islands (Svelte 5, hydrated on demand).** The sheet editor (drag, notes, tags, CSV in and out; the inventory is `src/draft-hq/sheet`), local-first with IndexedDB as the write path and the API behind it (ground-zero spec section 7). Search over a static index of about 700 names and 32 clubs (`src/search/config.ts`: eight results, 120 ms debounce, fuzzy from four characters) runs fully in the browser with no endpoint. The format selector (`src/draft-hq/board/scoring-format-preference.ts`, `localStorage` key `commish.board.format`). The peek, hydrated from the stored peek document plus the player's static JSON (`hydratePeekDocument`, `src/capsules/peek-document.ts`). The account chip.

**Request-time API.** Accounts (WorkOS stays, `auth-is-workos` memory; today's seam is `src/lib/auth/current-user.ts`). The user's own sheet (`draft_sheets`, `draft_sheet_entries`, `src/db/schema.ts:3223`). Mock rooms (`mock_rooms`, `drafts`, `draft_actions`, `draft_room_facts`, `src/db/schema.ts:450` onward). The advisor during a mock (`src/draft-service/assistant`). Billing and entitlements. Rankings export for premium.

**Jobs.** The nightly projections run (`scripts/preseason-persist.ts` writes the three blended boards). Ingests (`scripts/ingest-adp.ts`, `roster-weeks-ingest.ts`, `odds-props-snapshot.ts`, the nflverse adapters under `src/projections/nflverse`). The capsule sweep (`src/jobs/defs/capsule-sweep-job.ts`), paced at 12 gateway calls a minute (`src/capsules/config.ts`), so a full board is one to two hours. Peek documents (`src/jobs/defs/peek-document-job.ts`). ADP snapshots. The job's last step publishes the site's data set and dispatches the site build, the way Forever's data bot commit triggers `web.yml`.

## 3. The Go question

The research core is TypeScript: `src/projections` is 57,440 lines plus 26,507 lines of tests in 127 files; `preseason` alone is 23,451, `market` 8,249, `nflverse` 6,397, `laws` 5,228, `model` 3,955. The draft engine is 3,014 lines with replay pins (`src/draft-engine/replay-pins.fixture.ts`). The survival simulation and advisor are 1,667 plus 1,235 lines (`src/draft-service/sim`, `src/draft-service/assistant`). Bots and the mock service are 2,565. The capsule writer is 8,781.

**(a) Port the core to Go.** Cost: the projections module is the size of Forever's whole API, and the tests are the specification. Re-validation means re-running every held-out backtest and scorecard (`scripts/register-grade.ts`, `scoring-format-scorecard.ts`, `calibration-report.ts`) and matching the stored v9 rows byte for byte, because the board's record (0.6839 and 0.7385 Spearman on 2023 and 2024, `src/projections/preseason/board.ts`) is a claim about those rows. What could silently change: floating point. Go's `math.Exp` and `math.Log` are pure Go; V8 uses fdlibm ports. Last-bit differences feed the isotonic pooling (`src/projections/isotonic.ts`) and every tie, and a tie that flips moves a rank. The engine uses 27 `Math.log`, 10 `Math.sqrt`, 6 `Math.exp`. The bot sampler is softmax over floats (`src/mock-draft/bots.ts`), so a pinned pick sequence can flip on one ulp. The RNG itself ports exactly (mulberry32 is uint32 arithmetic, `src/mock-draft/rng.ts`). A port is months of work and the product would launch with a model nobody has validated.

**(b) TypeScript core as a Cloud Run service beside a Go API.** Two languages, two images. The Forever shape allows it: the API is Go, the compute lane is whatever runs in a container. Cost: two runtimes to deploy, two sets of middleware, and the question of which one owns the room.

**(c) TypeScript as a build-time job, Go for the request-time API, bots and advisor as a TypeScript lane.** The nightly job runs the TypeScript core unchanged and emits the static data set. Go owns accounts, sheets, billing, entitlements, exports. The mock room and advisor run in a TypeScript container because the room's pick transaction runs the engine, the bot policy and the facts compute inside one commit (`DraftStore.applyAction` calls `MockBotDriver.botTurn` through every consecutive bot seat, `docs/rebuild/ledgers/batched-bots.md`).

**Recommendation: (c).** The nightly job is where the core already lives (`scripts/preseason-persist.ts`, `capsule-sweep-job.ts`), and a job has no latency requirement, so the language question never touches the visitor. Go gets the request-time surface that is small, new and stateless, which is the surface Forever's Go API already proves out: cookies, CSRF, Stripe, entitlements, Cloud Run job dispatch. The room lane is TypeScript at launch because the ledger's design is the product's smoothest result and porting it before launch re-does it. One Postgres, two images, one Cloudflare Worker that routes `/api/*` to Go and `/room/*` to the lane.

**If the founder wants Go everywhere eventually, port in this order.** First the draft engine: 3,014 lines of pure reducer with a byte-for-byte oracle in the replay pins. Second the bots and RNG: 2,565 lines, exact integer RNG, with a tolerance pin on the softmax draw. Third the survival simulation and advisor: 2,902 lines, CPU bound, and the one place Go pays, because 200 seeded continuations parallelize across goroutines. Never the projections fit; it is research tooling run offline and its tests are its validation. The capsule writer stays TypeScript; it is prompts and validators, not compute.

## 4. The mock draft room on this shape

**Batched bots make the room request-time only on the human's pick.** A 36-pick solo mock is three pick POSTs and one start (`docs/rebuild/ledgers/batched-bots.md`, measurement table). Bot picks are stamped at their reveal instant and the client reveals them on its own clock, corrected by the smallest observed offset. The dock is ready 9 ms after the human's turn begins. Nothing is due in the future, so no timer, no cron, no self-wake.

**Where the room state lives.** Postgres behind the Cloud Run lane. The log is `draft_actions`, the facts row is `draft_room_facts`, and correctness rests on the store's `FOR UPDATE` lock, the in-lock replay and `admitCommand` (ground-zero spec section 5; `src/draft-engine/admit.ts`). D1 and KV are the wrong shape: no transaction can hold the engine and the store together, and KV is eventually consistent. Durable Objects are the tempting edge answer: the engine, bots and advisor are pure TypeScript and would run in one object per room with the 200-run simulation inside the paid plan's CPU limit. But it moves the room off the one database, duplicates the data layer, and makes the room invisible to the Go API. Not at launch. It is the experiment for lobby mocks later.

**Cold starts.** The human's pick must not pay a Node cold start. Run the room lane with one minimum instance during draft season (August and September) and zero the rest of the year.

**Lobby mocks with several humans.** The batch already runs between any two humans (ledger, "Multi-human lobbies work the same"). What a lobby adds is a push channel for the other humans' picks: Server-Sent Events from Cloud Run (streaming is supported, request timeout up to 60 minutes) or a Durable Object relay. Scope ruling proposed: solo at launch; lobby and link rooms behind a flag after launch. The modes already exist in config (`src/mock-draft/config.ts`, `modes: ["solo", "lobby", "link"]`).

**Advisor cost per pick.** 200 runs (`src/draft-service/assistant/config.ts`, `runs: 200`); about 250 ms on Apple silicon after the pool index, 587 ms measured on Vercel for a 12-team room (`docs/research/2026-09-18-draft-room-performance-findings.md`), about 450 ms in a request (ledger). One compute per batch, so about 16 per solo mock, under 10 vCPU-seconds a mock. At Cloud Run's list rate that is a fraction of a cent, and 10,000 mocks a month is a few dollars.

## 5. Data

**Postgres.** Forever uses Neon through its pooled endpoint with the direct endpoint for migrations (`forever/api/README.md`). Commish uses Neon through Vercel today (`.env.example`, `DATABASE_URL_UNPOOLED`, `PRODUCTION_DATABASE_ENDPOINT`). Options:

| | Neon | Cloud SQL | Supabase |
|---|---|---|---|
| Fit with Cloud Run | public endpoint, pooler, scale to zero | same region, private IP, no cold path, always on | public endpoint, pooler |
| Go client | pgx, both repos' pattern | pgx | pgx |
| Migrations | direct endpoint needed | direct | direct |
| What it adds we do not need | nothing | nothing | auth, storage, realtime (WorkOS owns auth) |
| Known hazard | the 2026-09-07 data-transfer quota incident (`prod-db-is-for-backfills-only` memory) | cost floor, no branches | a second auth system to not use |

Recommend Neon for the app tables (accounts, sheets, rooms, entitlements) because both repos already run it and it costs nothing idle. The research tables are the nightly job's input and that job reads 13 seasons: `nflverse_roster_weeks`, `player_week_observations`, `player_crosswalk`, `player_capsules`, `player_peek_facts`, `player_peek_documents`, `adp_snapshots`, `preseason_rankings`, `preseason_projections`, `preseason_board_reasons`, `model_artifacts`, `register_*_rows`, `coaches`, `nfl_draft_picks`, the injuries, kicking and team defense weeks (`src/db/schema.ts:1862` onward). If the nightly read trips Neon's transfer quota again, move the research tables to Cloud SQL in `us-east1` beside the job and keep Neon for the app. Measure the job's bytes read once before deciding.

**What the build publishes as static JSON.** Per format: the board rows (rank, points, value rank, tier, reasons). Per player: the document the peek hydrates, the capsule, multi-season stats, ADP and the "drafters take him N picks later" figure. Clubs. The ADP table. The search index. Cheat sheet templates. A manifest with the board's `as_of` moment so every page can name its basis.

**What stays behind the API.** Sheets, rooms, facts, accounts, entitlements, exports, and whatever the new premium model gates. A static page cannot gate, so premium content is either an API read behind `Can()` or a signed asset; the Forever rule "every feature works without an account; an account only adds" (`forever/docs/superpowers/specs/2026-09-21-one-product-design.md`, section 0) and the Commish rule "premium is research only" both hold.

**How the build gets its data.** The nightly job writes the data set to a bucket keyed by board moment and dispatches the site workflow. A sync script copies it into the SvelteKit project before `build`, refuses a fixture on a production deploy, and fails loudly on a missing file, the `sync-data.mjs` contract.

## 6. Performance budgets to adopt

**Lighthouse CI.** Copy `forever/web/lighthouserc.json` wholesale: the mobile throttled profile, three runs, median, `assertMatrix` nested under `ci.assert`. Entries: static pages (board, player, club, ADP) at performance 0.95, LCP 1700 ms, TBT 100 ms, CLS 0.05; island pages (sheet, mock lobby) at 0.90 with no LCP assertion; the room shell at 0.85 with TBT 200 ms. Push runs audit one URL per matrix entry sharded three ways; the full list runs nightly (`forever/web/lighthouserc.push.cjs`).

**Island size checks.** Port `check-island-size.mjs` to the SvelteKit output. Budgets gzipped: sheet editor 60 KB, mock room 120 KB, search 10 KB, peek 15 KB, format selector 3 KB, account chip 8 KB. The 25 MiB asset cap stays. Add one Forever lacks: an HTML size cap of 200 KB per page, because its BiS page reached 1.38 MB.

**Lazy hydration in SvelteKit terms.** SvelteKit has no `client:*` directives and hydrates the whole page by default. For the static pages set `export const csr = false` in the route so they ship zero JavaScript, and mount islands by hand: a few hundred bytes of inline script that watches the island root with `IntersectionObserver` (visible), `requestIdleCallback` after `load` plus a delay (Forever's `idle-after-load`), or a one-shot `pointerdown`, `focusin`, `keydown` listener (the `client:interaction` idea), then dynamic-imports the component and calls Svelte 5's `mount()` onto the server-rendered markup. The markup must be complete before hydration so a tap on an unhydrated control still lands.

**What lightning fast means as numbers.** TTFB under 100 ms at p75 for static pages from the edge. LCP under 1.7 s on the throttled mobile profile and under 1.0 s on a real phone on 4G. INP under 200 ms at p75. CLS under 0.05. JavaScript on a board or player page: zero until an island is touched, then its budget. The mock room: every surface except the odds settles within 250 ms at p90 of the revealed pick, zero long tasks across a draft (`docs/design/2026-09-10-first-principles.md`, section 7). The baseline this replaces: the league app's `/players` sent 722 KB and 259 KB gzipped JS in 24 chunks (`docs/research/2026-09-18-draft-room-performance-findings.md`).

## 7. Cost per month at launch

List prices as of this writing; verify before committing.

| Item | Launch (draft season) | Off-season |
|---|---|---|
| Cloud Run, Go API, 512 MiB, scale to zero | $0 to $5 | $0 |
| Cloud Run, room and advisor lane, 1 vCPU, one minimum instance | $10 to $15 | $0 |
| Cloud Run jobs, nightly projections, capsule sweep, ingests (about 2 h of 1 vCPU a night) | $5 to $10 | $3 |
| Cloud Scheduler, Artifact Registry, GCS | $1 to $3 | $1 |
| Cloudflare Workers paid plan (assets free, Worker on dynamic prefixes only) | $5 | $5 |
| Postgres, Neon Launch | $19 to $25 | $19 |
| WorkOS AuthKit | $0 at launch volume | $0 |
| LLM capsules at $0.00153 a player (`src/capsules/config.ts`), 700 players, only changed facts regenerate | $5 to $30 | $5 |
| Stripe | per transaction | per transaction |
| **Total** | **$45 to $95** | **$30 to $35** |

Cloud SQL in place of Neon adds $10 to $50 depending on tier and removes the quota hazard.

## 8. Risks and the three decisions

**Risks.** Two languages meet at the room boundary; the contract between Go and the TypeScript lane must be one schema, generated, not two hand copies. A Node cold start on the human's pick; the minimum instance is the fix and it is seasonal. Neon's transfer quota under the nightly read; measure once. Svelte 5 depth is the same risk the ground-zero spec named. Premium gating on static pages: static cannot gate, so the premium model must be decided before the page inventory is final. The temptation of Durable Objects: a second data layer for one feature.

**Decision 1: the Go port scope.** Proposed: Go for accounts, sheets, billing, entitlements and exports at launch; the room lane and the nightly job in TypeScript; the engine, then bots, then advisor ported to Go after launch if the founder wants Go everywhere; the projections fit never.

**Decision 2: the database.** Proposed: Neon for app tables, with the research tables moved to Cloud SQL only if the nightly read measures past the quota. The alternative is Cloud SQL for everything from day one at a higher floor.

**Decision 3: lobby mocks at launch.** Proposed: solo only at launch, since it needs no push channel; lobby and link rooms behind a flag after launch, over SSE from Cloud Run or a Durable Object relay.
