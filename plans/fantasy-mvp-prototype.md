# Blueprint: Commish — Phase 1: Production Foundation

> **Revision note (v6) — "no MVP" directive:** mid-execution of Step 1, the founder directed: *"I don't want an MVP. Let's work towards the end solution."* This phase is hereby reframed from "prototype with deliberately disposable layers" to **production foundation**: the phases still sequence *scope* (real money, tax, native apps still come later, and the external business blockers — data license, banking partner, counsel — are unchanged), but nothing in this phase may be built in a form that a later phase plans to throw away. Concrete changes:
> - **Postgres + Redis via Docker Compose from Step 1** — not SQLite. This supersedes every "SQLite in Phase 1, migrate in Phase 2" statement below (not individually rewritten yet — this note wins where they conflict), and obsoletes Phase 2's migration step. Forcing factor beyond the directive: `better-sqlite3`'s native binding segfaults on this dev machine (exit 139) and `node-gyp` silently no-op rebuilds; Postgres's pure-JS wire-protocol driver avoids native compilation entirely.
> - **Real auth architecture in Step 1**, not the seeded cookie dev-login stub — Phase 2's auth step then extends (hardening, rate limiting) rather than replaces.
> - A full de-MVP reconciliation pass over this file and Phase 2 is the next planning task; until then, read every "prototype-only" qualifier below through this note.

**Objective:** Build a software-only prototype of the core "Beating Apex" product experience — the unified draft engine, scoring, league management, social layer, AI draft moderator, and AI advisory layer — with no real money movement, no regulated infrastructure, and no native mobile apps. Prove the UX differentiation thesis from `docs/research/2026-08-16-beating-apex-strategy.md` before any regulated build-out.

**Source strategy doc:** `docs/research/2026-08-16-beating-apex-strategy.md` (Sections 4, 4.1, 4.2, 5)

**Revision note (v5):** v2 fixed the gaps an adversarial review found (no user/identity model, a false parallelism claim, an unowned matchup/schedule model, draft results never persisted into a season, no shared conventions artifact). v3 moved off Socket.io (a reflexive default, not a justified choice) to Postgres `LISTEN`/`NOTIFY` + SSE. v4 replaced that with **Redis Streams** as the single, permanent broadcast mechanism for draft, chat, and (later) live scoring — chosen because it natively provides both durable append and replay-on-reconnect as one capability, rather than the hand-built bridge `LISTEN`/`NOTIFY` required. **v5 fixes a correctness bug a full scaling/UX review found in v4: the delivery mechanism must be plain `XREAD`, not `XREADGROUP`** — consumer groups partition entries across their members (one consumer gets each entry), which is the wrong primitive for broadcast (every viewer must see every event). Same architecture, corrected primitive. That same review also found the draft session store (Step 4) doesn't survive more than one app instance or a restart, and that Phase 1 never actually built a way to create a league (Step 7) — both fixed below; see `docs/research/2026-08-16-scaling-review.md` and `docs/research/2026-08-16-ux-review.md` for the full reviews and `00-roadmap.md` for the remaining prioritized backlog across all 8 phases. See **Real-time & event architecture** below for the full real-time reasoning; see `docs/conventions.md` (Step 1) for the single source of truth downstream steps must read first.

**Mode:** Direct (no git repository detected at plan time). GitHub CLI is authenticated (`jhunthrop`), so a remote repo can be created once local history exists. **`git init` and a commit after every completed step are mandatory in this revision**, not optional — every step's "Rollback" section depends on it.

**Stack decisions (pinned — record verbatim in `docs/conventions.md` in Step 1):**
- Next.js **15.x** (App Router), React **19.x**, Node **22 LTS**, TypeScript strict mode
- Vitest for unit/integration tests; **@testing-library/react + jsdom** for component tests
- **Real-time transport: Redis Streams, fanned out over Server-Sent Events** from a Next.js Route Handler (Node runtime, streaming). No Socket.io, no managed realtime SaaS (Ably/Pusher/PartyKit) — Redis is a standard, self-hostable building block, in the same category as Postgres itself, not a specialized vendor dependency
- SQLite via Drizzle ORM, driver: **`better-sqlite3`** — unchanged from earlier revisions; the relational-database choice (Phase 1 prototype: SQLite, Phase 2: migrates to Postgres) is a separate decision from the broadcast-layer choice and isn't affected by moving to Redis Streams. **Redis is a new local-dev dependency regardless of the relational DB** — run a real local Redis from Step 1 (e.g. via Docker Compose); there's no lightweight in-process stub worth building for it, since Redis itself is already the lightweight option
- LLM client: a single shared module, provider and env var pinned in Step 1 — justified third-party dependency, no viable self-hosted alternative for conversational AI at this team's scale
- Mock NFL player dataset — no licensed real-time stats feed (SportsDataIO/SportRadar) in this phase; that's also a justified future third-party dependency (no way to self-source licensed real-time NFL stats)

### Real-time & event architecture (why, not just what)

**The requirement is broadcast fan-out, not bidirectional sockets.** A draft pick, a chat message, a bid — every one of these is naturally a *write* (client submits, server validates and decides the outcome authoritatively) plus a *broadcast* (everyone else finds out). Nothing in this product needs a client to push to another specific client directly, and nothing needs sub-16ms round trips — these are discrete, occasional events, not a continuous stream.

- **Writes:** plain HTTP via Next.js Route Handlers — validate, persist to Postgres, done. Normal validation, normal error handling, no special transport.
- **Broadcast, after a successful write:** the application appends the event to a Redis Stream (`XADD`) — one stream per league, e.g. key `league:<id>:events`. Postgres never needs a trigger or a side `events` table for this; Redis Streams *is* the durable, replayable log, and it's the same mechanism whether the event is a draft pick, a chat message, or (later) a live scoring update.
- **Delivery to browsers:** an SSE Route Handler reads the relevant stream with a plain **`XREAD BLOCK`** — deliberately not a consumer group (`XREADGROUP`), which **partitions** entries across the consumers in a group so each entry reaches exactly one of them, not all of them. A 12-person draft needs every one of the 12 browsers to see every pick — that's broadcast, and `XREAD` (not `XREADGROUP`) is the primitive that does it, with no group-cleanup burden (`XGROUP DESTROY`/`XAUTOCLAIM`) to hand-build later. Each SSE connection tracks its own read cursor (the last entry ID it delivered) independently.
- **Reconnect is no longer a bespoke "refetch everything" rule** — the browser's `EventSource` automatically sends the `Last-Event-ID` header on reconnect; the SSE handler resumes its `XREAD` from that ID, and Redis Streams replays exactly what was missed. Full-state refetch becomes a fallback only for the edge case where a client was disconnected longer than the stream's retention window, not the default path every step has to hand-build.
- **Retention is bounded**, not permanent — Streams are trimmed (e.g. `MAXLEN`/time-based) since their job is live delivery and short-gap catch-up, not the permanent historical record. Postgres (plus Phase 3's audit trail) remains the system of record for anything that needs to be kept forever, e.g. for tax/compliance/dispute purposes.
- **Perceived "real-time" feel comes from two things, neither of which is the transport:** (1) optimistic UI on the acting client — the user's own action renders instantly, before any server round trip; (2) fanout latency to everyone else, which Redis Streams → SSE keeps comfortably under the ~200ms threshold where humans perceive a delay, for this event frequency.
- **Native apps (Phase 7) consume the same SSE stream** with plain `URLSession` (iOS) / OkHttp (Android) — no vendor realtime SDK dependency; Redis's role is entirely server-side.

---

## Pre-flight

- [x] Checked for git repository — not present. `git init` is now a **mandatory** Step 1 task, not a recommendation.
- [x] Checked `gh auth status` — authenticated as `jhunthrop`, no repo created yet.
- [x] Checked for existing plans — none besides this file at plan-write time.
- [x] Checked project memory — empty, no prior constraints recorded.
- [x] Read source strategy doc for scope — confirmed against Sections 4, 4.1, 4.2, 5.
- [x] Adversarial review completed on v1 — all CRITICAL and IMPORTANT findings incorporated into this v2; MINOR findings incorporated where they change step tasks, noted inline otherwise.

## Explicitly Out of Scope for This Blueprint

Deferred to later phases (see `plans/00-roadmap.md` once written) because they require real business/legal action outside a coding session:

- Real entry fees, prize payouts, FBO/agent-of-payee payments infrastructure
- KYC/AML/OFAC screening, tax withholding, 1099 generation
- State-by-state legal geofencing enforcement
- Licensed real-time stats data feeds — this phase uses a static, deterministic mock dataset
- Native iOS/Android apps — web only in this phase
- Production hosting/deployment
- Real user authentication (passwords, OAuth, sessions with real security) — this phase uses a **deliberately trivial prototype identity mechanism** (seeded users, cookie-based dev login, no passwords). Real auth is built in the next phase.

## Dependency Graph (adjacency list — unambiguous for a cold-start agent)

- Step 1 → depends on: nothing
- Step 2 (scoring engine) → depends on: 1
- Step 3 (draft engine core) → depends on: 1
- Step 4 (live draft room — snake) → depends on: 1, 3
- Step 5 (auction draft room + reconnect hardening) → depends on: 1, 3, 4
- Step 6 (AI draft moderator) → depends on: 3, 4
- Step 7 (league management + scoring display) → depends on: 1, 2
- Step 8 (social layer / league chat) → depends on: 1, 4
- Step 9 (AI advisory layer) → depends on: 2, 7
- Step 10 (public league matchmaking) → depends on: 1, 7
- Step 11 (end-to-end integration) → depends on: 3, 4, 7 (minimum; exercises the full draft→season seam)

**Parallel opportunities once their dependencies are met:** Step 2 ∥ Step 3 (both only need 1). Step 7 ∥ {3, 4, 5, 6} (Step 7 no longer needs the draft engine directly — see Step 1's roster-eligibility fix below). Step 6 ∥ Step 7 ∥ Step 8 ∥ Step 10 (none of these share files with each other). Step 9 and Step 10 can run in parallel with each other.

---

## Step 1 — Project scaffold, domain model & shared conventions

**Model tier:** strongest (architecture-defining; every later step reads `docs/conventions.md` produced here first)
**Depends on:** nothing
**Parallel with:** nothing (everything else depends on this)

### Context brief
This is a brand-new, empty project directory (`/Users/jh/code/fantasy`) containing only a research doc. No code exists yet. This step is intentionally larger than a typical Step 1 because the adversarial review found that leaving decisions like identity, real-time transport, roster-eligibility ownership, and file/test conventions "for later" caused every downstream step to guess independently and build incompatible things. Everything a fresh agent executing Steps 2–11 needs to know without reading any other step lives in `docs/conventions.md`, produced here.

### Tasks
- [ ] `git init`; commit after this step and after every subsequent step (**mandatory**, not optional)
- [ ] Scaffold Next.js **15.x** (App Router, TypeScript strict) with `package.json` `name: "commish"` (the product name, domain `commish.ly`), pin exact dependency versions (Next 15.x, React 19.x, Drizzle ORM latest, `better-sqlite3`, Vitest, @testing-library/react, jsdom)
- [ ] Add a `typecheck` npm script (Next's scaffold doesn't ship one) and confirm `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all exist and run clean on the empty scaffold
- [ ] Configure ESLint strict + an immutability rule (e.g. `functional/prefer-readonly-type` or equivalent) so `readonly`/`Readonly<T>`/`ReadonlyArray<T>` on domain types is enforced, not just aspirational
- [ ] Configure Vitest with a jsdom environment and @testing-library/react for component tests (needed by Steps 4, 5, 6, 7, 8, 9, 10)
- [ ] Set up a local Redis instance for dev (Docker Compose) and a shared Redis client module (`src/lib/realtime/redis.ts`); define the Stream key-naming convention (e.g. `league:<id>:events`) and the `eventType` taxonomy (e.g. `draft.pick`, `chat.message`) in `docs/conventions.md`. **No consumer groups** — record this explicitly as a convention, since `XREADGROUP` partitions entries across consumers rather than broadcasting to all of them, which is the wrong primitive here
- [ ] Build a shared `publishEvent(leagueId, eventType, payload)` helper (`src/lib/realtime/publish.ts`) that `XADD`s to the correct stream, and a bounded-retention policy (e.g. `MAXLEN ~` trim) — this is the only way any feature writes to a stream, so the taxonomy stays consistent
- [ ] Build a shared SSE Route Handler helper (`src/lib/realtime/subscribe.ts`) that a later step can point at any league's stream: opens a streaming response, reads the request's `Last-Event-ID` header (or defaults to the stream's current end, for a fresh connection), loops on `XREAD BLOCK` from that cursor, and forwards new entries to the client, updating its own cursor as it goes — this is the one and only real-time mechanism for the whole project; no later step may introduce Socket.io, a managed pub/sub vendor, consumer groups, or a second transport
- [ ] If Redis publishing ever fails for an accepted write (e.g. `XADD` errors), that must **never** fail the underlying write — the write is already committed and authoritative in Postgres; publishing is best-effort, with a full-state refetch as the client-side fallback. Enforce this ordering in `publishEvent` and add a test that a simulated Redis outage doesn't roll back or reject an otherwise-valid write
- [ ] Define core domain types in `src/domain/`, one file per cohesive group, all `readonly`: `User` (id, displayName, experienceTier), `Player`, `Team`, `Roster`, `League` (include `format: 'snake' | 'auction'` and `stakeTier` — cosmetic/mock only, no real money — since Step 10 filters on both and Step 3 only implements these two formats), `ScoringSettings` (persisted **per-league**, not global — Step 9 depends on this), `Draft`, `DraftPick`, `Matchup`, `Week`/`Schedule`
- [ ] Define `src/domain/roster-eligibility.ts`: pure functions `eligibleSlotsForPosition`, `validateLineup`, `validateRosterAdd` — this is **owned here**, not in Step 3, specifically so Step 7 can depend on it without depending on the draft engine (this fixes a false-parallelism claim from the v1 review)
- [ ] Define `src/domain/timing.ts`: every stateful action (draft picks, bids, timer expiry) carries an explicit `timestamp` field; no domain or reducer code may call `Date.now()` directly — tests inject a fake clock. State this rule in `docs/conventions.md` since Steps 3, 4, 5, 6 all touch timers
- [ ] Set up Drizzle ORM + SQLite (`better-sqlite3`) with schema for `User`, `League`, `Team`, `Roster`, `ScoringSettings`, `Matchup`/`Week`, plus a `draft_actions` table (`id`, `draftId`, `action` (JSON), `timestamp`) — draft-in-progress state is **not** in-memory-only (a review found that loses all state on any restart, with no recovery path, exactly during a paid live draft); every accepted action is persisted here durably, and current state is derived by replaying it (owned by Step 4, using this table). **Completed** draft results and season/matchup state are also persisted here since Step 7 and Step 11 both read them
- [ ] Build a mock NFL player dataset generator: ~250 real player names/positions/teams, with a **full, deterministic 17-week season** of stat lines (fixed PRNG seed, generated once and committed as a static JSON artifact — not regenerated per run, since Steps 2, 6, 7, 9 all assert against exact values)
- [ ] Establish `src/data/seed/` with one `npm run seed` entry point; this is the **only** seeding mechanism — Steps 7 and 10 add seed functions here rather than inventing their own
- [ ] Build the deliberately trivial prototype identity mechanism: seed a handful of `User` rows, a cookie-based dev-login page (pick a seeded user, no password), one server helper `getCurrentUser()` and one client hook `useCurrentUser()`. This is the **only** identity mechanism in this phase — every later step's "the current user" language refers to this
- [ ] Add a single shared LLM client module `src/lib/llm/`: pick one provider (Anthropic via `@anthropic-ai/sdk`), one env var (`ANTHROPIC_API_KEY`), and export `isLLMEnabled()` — Steps 6 and 9 both consume this rather than each building their own client
- [ ] **Design-system foundation** — a UX-completeness review found zero shared visual/interaction foundation anywhere in the original plan, meaning every UI step (4, 5, 7, 8, 10) would have invented its own styling, with dark mode and accessibility never designed at all. Build this now, before any feature UI exists, since retrofitting it later is far more expensive than starting with it:
  - Pin a styling approach (e.g. Tailwind + CSS custom properties) in `docs/conventions.md`
  - Define `src/design/tokens.ts` + CSS variables: **light and dark palettes defined together from day one** (semantic roles — surface/border/text-primary/text-muted/positive/negative/warning/accent — never a raw hex in feature code), spacing scale, type scale, radii, and motion durations/easings (with a `prefers-reduced-motion` fallback honored everywhere)
  - A `ThemeProvider` (system/light/dark, defaulting to system, persisted per user)
  - Shared UI primitives in `src/components/ui/`: Button, Input, Select, Modal, Toast, Card, Table, Avatar, **Skeleton, EmptyState, ErrorState** (each requires a next-action affordance, never a dead end) — each with a render test
  - One icon system, one `<Icon>` wrapper — no ad-hoc inline SVG in feature code
  - **Mobile-first breakpoints, minimum supported viewport 360px** — a review found no responsive requirement anywhere in the original plan despite native apps not arriving until Phase 7; every real user before then is on a phone browser. Add "renders and is fully operable at 360px width" to the exit criteria of every UI step from here on (Steps 4, 5, 7, 8, 10)
  - **Accessibility baseline, not deferred:** add `eslint-plugin-jsx-a11y` (strict) alongside the immutability rule; add `vitest-axe` to the test setup; adopt WCAG 2.2 AA as the stated bar, with automated contrast checks on every token pair
  - Write `docs/design-system.md` — read alongside `docs/conventions.md` by every UI-building step from here on
- [ ] Write `docs/conventions.md` covering: directory map, module boundaries, the Redis Stream key-naming convention and `eventType` taxonomy (plain `XREAD`, never consumer groups — state the reason inline so nobody "helpfully" reintroduces `XREADGROUP` later), env var names, the identity helper API, the timing rule, the seed entry point, the test-file naming convention (**every step's tests live under `src/<feature>/**/*.test.ts`, and each step's verification command filters by directory, e.g. `npm test -- src/scoring`, not by a guessed filename**), the pinned dependency versions, and this standing rule: **every step that ships a user-visible surface additionally requires, before it's complete: a design review against `docs/design-system.md`; loading/empty/error/success states all designed, not just the happy path; an automated a11y check plus a keyboard-only walkthrough of the primary flow; and a plain-language copy review — no raw error codes or unexplained jargon surfaced to a user**
- [ ] Every context brief in Steps 2–11 must open by reading `docs/conventions.md` (and, for UI steps, `docs/design-system.md`) first — this is stated once here and assumed from here on
- [ ] Write a smoke test proving domain types, the mock dataset, the DB schema, and the identity helper all import/compile/run cleanly together

### Verification
```bash
npm run lint
npm run typecheck
npm test -- src/domain
npm run build
```

### Exit criteria
- Clean `npm run build` with zero type errors
- `docs/conventions.md` and `docs/design-system.md` exist and are complete enough that Steps 2–11 need no other context beyond them, this file, and the strategy doc
- Every UI primitive renders correctly in both light and dark theme, verified by a test
- Every defined token pair passes WCAG 2.2 AA contrast, verified by an automated check
- Domain types are `readonly` and the ESLint immutability rule fails the build on a deliberately-introduced mutation (verify this once, then revert the test mutation)
- The mock season dataset is deterministic — regenerating it twice produces byte-identical output — and is committed, not generated at build time
- A trivial "create league, add team, log in as seeded user" round-trip test passes against SQLite
- First git commit exists

### Rollback
Delete the scaffold and re-run — this step has no dependents yet to break.

---

## Step 2 — Scoring engine

**Model tier:** default
**Depends on:** Step 1
**Parallel with:** Step 3

### Context brief
Read `docs/conventions.md` first. Every later feature — league management, the AI advisor, the draft engine's pick-value hints — needs a single source of truth for "how many fantasy points did this player score." This step is pure, deterministic logic with no UI and no network. `ScoringSettings` is persisted per-league (Step 1's schema) — this module reads settings, it doesn't own their storage.

### Tasks
- [ ] Write tests first for `computeFantasyPoints(statLine, scoringSettings): number` covering standard, PPR, half-PPR, and TE-premium presets
- [ ] Implement `ScoringSettings` as fully configurable (no magic numbers — every stat category's point value is data, not code)
- [ ] Implement the scoring function(s) to pass those tests
- [ ] Add `scoreRoster(roster, week, scoringSettings): number`, reading the Step 1 deterministic season dataset for the given week
- [ ] Table-driven tests: missing stat categories, zero-stat players (bye week/DNP), negative-value stats (fumbles, INTs)
- [ ] Add a Vitest coverage threshold scoped to `src/scoring` (not the whole repo) enforcing full branch coverage on this module specifically

### Verification
```bash
npm test -- src/scoring --coverage
npm run lint
npm run typecheck
```

### Exit criteria
- Coverage threshold enforced and passing for `src/scoring` specifically
- At least 4 scoring presets verified against hand-computed expected values

### Rollback
Isolated module — safe to revert independently of any other step.

---

## Step 3 — Draft engine core (state machine)

**Model tier:** strongest (concurrency-sensitive, highest correctness risk in the whole prototype)
**Depends on:** Step 1
**Parallel with:** Step 2

### Context brief
Read `docs/conventions.md` first. This is the single biggest UX wedge against Apex (strategy doc §1.1, §4): one system that runs snake and auction drafts natively, with no hand-off to a third-party tool the way Apex hands auctions to ESPN. Build this as **headless logic first** — a pure reducer with no network or UI. This step **consumes** `src/domain/roster-eligibility.ts` from Step 1; it does not own or reimplement roster-construction rules. Timer state follows Step 1's timing rule: actions carry an explicit `timestamp`, the reducer never calls `Date.now()`.

### Tasks
- [ ] Write tests first for the draft state machine: turn order (snake: reverses each round; auction: nomination + bidding), pick validation (via `validateRosterAdd`/`validateLineup` from Step 1, not reimplemented), and timer-expiry transitions driven by injected timestamps
- [ ] Implement `DraftEngine` as a pure reducer: `(state, action) => newState`, actions like `MAKE_PICK`, `NOMINATE`, `BID`, `TIMER_EXPIRE`, every action carrying a `timestamp`
- [ ] Implement auction-specific logic: nomination order, **config-driven bid increment** (not a magic number — league-configurable), "won" resolution on timer expiry
- [ ] **Auto-tightening pick clock** — a UX review found this named explicitly in the strategy doc (§4: "auto-tightening slow-draft clocks, not multi-day email drafts... hours shrinking to a minute as kickoff nears") as the direct answer to Apex's own worst weakness (a 5-day email draft), and the original plan built only a single flat timer. Implement a config-driven schedule (`DRAFT_CLOCK_SCHEDULE`: an ordered array of `{ untilHoursBeforeKickoff, pickSeconds }`, e.g. 8h → 4h → 1h → 10m → 60s), evaluated per pick against the league's kickoff timestamp. Table-driven tests across each boundary
- [ ] No persistence *in this step* — this remains pure in-memory reducer logic plus its test suite; a durable, replay-based session store that uses this reducer during a live draft is Step 4's responsibility, not this one's. (The reducer's existing design — pure, action-based, every action carrying a `timestamp` — is exactly what Step 4's durability fix needs: replaying a persisted action log through this same function reconstructs state deterministically)

### Verification
```bash
npm test -- src/draft-engine
npm run lint
npm run typecheck
```

### Exit criteria
- A full mock snake draft (12 teams, 15 rounds) runs end-to-end via the reducer with correct turn order and no invalid picks accepted
- A full mock auction draft runs end-to-end with correct nomination order and budget enforcement
- Every invalid-action case (already-picked player, exceeding roster slots via `validateRosterAdd`, bidding after timer expiry) has an explicit test asserting rejection
- The reducer contains zero calls to `Date.now()` or any other ambient clock
- The same draft run at four different simulated distances from kickoff produces four different per-pick clock durations, per the auto-tightening schedule

### Rollback
Pure logic module, no side effects — safe to revert without touching persisted data.

---

## Step 4 — Live draft room UI (snake)

**Model tier:** default
**Depends on:** Step 1, Step 3
**Parallel with:** nothing directly, but Steps 6, 7, 8 build on this once it's done and don't block each other

### Context brief
Read `docs/conventions.md` first. This is the demoable "wow" moment for snake drafts specifically — auction gets its own step next, since bundling both into one step was too large for one PR. The real-time transport (Redis Streams over SSE, via Step 1's shared `publishEvent`/`subscribe` helpers) is already decided; this step wires it up, it doesn't choose it. Keep the boundary firm: no draft-rule logic belongs in a React component — if a rule seems to be missing, that's a Step 3 gap to fix there, not something to patch here. **The acting client updates optimistically** (render the pick immediately on submit, reconcile against the server response) — this is what makes the draft feel instant; the SSE stream is what makes it feel instant for everyone *else* watching.

### Tasks
- [ ] Write component/integration tests first, including an automated **two-SSE-client integration test** (headless, no real browser needed — two subscribers against Step 1's SSE helper) that drives a full mock snake draft and asserts both see synced state — this is the primary machine-checkable proof, not a manual step
- [ ] Build a **durable, replay-based draft session store** (not an in-memory-only one — a review found that loses all state on any process restart, with no recovery path, during what could be a paid live draft): on each accepted action, validate it against the current state (reconstructed by replaying Step 1's `draft_actions` table through Step 3's reducer, or a cached materialization of the same), then persist the action row and *only after that succeeds* apply it to the in-memory cache and publish it. Materialized state can be cached (in-memory is fine for Phase 1's single-instance scope) as long as the persisted action log — not the cache — is treated as the actual source of truth; that's what makes a crash/restart recoverable and is also the design Phase 2 will extend for multi-instance safety. Expose `commitDraftResults(draftId) → persisted rosters`, which writes into Step 1's `Team`/`Roster` tables when a draft completes — this function is the seam between "a draft happened" and "a season exists," and nothing else in this phase owns it
- [ ] Add a crash-recovery test: persist a partial sequence of actions, simulate a restart (drop the in-memory cache, don't drop the table), and assert the store correctly reconstructs the exact same state by replaying the action log
- [ ] Wire the draft room to Step 1's `publishEvent`/`subscribe` helpers, publishing `draft.pick`/`draft.nominate`/`draft.bid`/`draft.timer_expire` events (per `docs/conventions.md`'s taxonomy) so all connected clients see picks as they happen
- [ ] Build the snake draft board UI: player pool (searchable/filterable), team rosters filling in live, pick clock countdown, **the current auto-tightening clock tier and when it next shortens** (Step 3's schedule is only a feature if the user can see it — e.g. "picks shorten to 10 minutes in 2h 14m"), using `docs/design-system.md`'s primitives (loading/empty/error states included, not just the happy path)
- [ ] **Draft-pick landing moment** — a UX review found zero motion/celebration design anywhere in the original plan despite the strategy doc's entire thesis being that this category is emotionally flat and a competitor should feel different. Add a brief landing animation when a pick registers on the board, with a distinct celebratory treatment for the acting user's own pick; respect `prefers-reduced-motion`
- [ ] **Read-only, large-format draftboard view** (`/draft/<id>/board`) — named twice in the strategy doc ("draft-party TV casting") and never scheduled in the original plan. Designed for 10-foot TV viewing: oversized type, full pick-history grid, current-pick spotlight, no interactive controls, reachable by URL so it can be cast from any laptop/browser today without native support
- [ ] Handle disconnect/reconnect: the browser's native `EventSource` auto-reconnects on drop and automatically sends `Last-Event-ID`, with no code required for either part; the SSE Route Handler resumes its `XREAD` from that ID, so events missed during the gap are replayed automatically rather than lost — a full-state refetch is only needed as a fallback if the gap outlasted the stream's retention window

### Verification
```bash
npm test -- src/draft-room
npm run lint
npm run typecheck
npm run dev   # manual: two-browser-window live draft smoke test, in addition to the automated two-SSE-client test above
```

### Exit criteria
- The automated two-SSE-client integration test completes a full mock snake draft with correctly synced state
- Reconnecting mid-draft restores correct state from the server-side session store, verified by an automated test, not just manual observation
- The crash-recovery test passes: state reconstructed purely from the persisted action log matches the state before the simulated restart
- `commitDraftResults` correctly persists a completed draft into Step 1's roster tables, verified by a test that drafts, commits, then reads rosters back from the DB

### Rollback
UI + session-store layer — reverting doesn't touch Step 3's engine or its tests.

---

## Step 5 — Auction draft room UI + reconnect/resync hardening

**Model tier:** default
**Depends on:** Step 1, Step 3, Step 4
**Parallel with:** Step 6, Step 7, Step 8 (once this and Step 4 are both done)

### Context brief
Read `docs/conventions.md` first. This was split out of what was originally one oversized "live draft room" step — auction drafting has enough distinct UI (nomination, live bidding, budget tracking) to be its own PR-sized unit, and it reuses the session store and transport Step 4 already built rather than inventing new infrastructure.

### Tasks
- [ ] Write tests first, including a two-SSE-client integration test for a full mock auction draft
- [ ] Build the auction-specific UI: current nomination, live bid amount and bidder, time remaining on the current bid, remaining budget per team
- [ ] Extend (not duplicate) Step 4's session store and `commitDraftResults` to handle auction-drafted rosters — same persistence seam, same function
- [ ] Harden reconnect/resync for the auction case specifically: a dropped connection mid-bid must not let a user miss that a bid war happened, and must not desync remaining-budget state

### Verification
```bash
npm test -- src/draft-room
npm run lint
npm run typecheck
npm run dev   # manual: two-browser-window live auction draft smoke test
```

### Exit criteria
- The automated two-SSE-client integration test completes a full mock auction draft with correctly synced state and correct budget enforcement
- `commitDraftResults` correctly persists an auction-drafted league the same way it does a snake-drafted one

### Rollback
UI layer only — reverting doesn't touch Step 3's engine, Step 4's session store, or their tests.

---

## Step 6 — AI draft moderator (mock/stub mode)

**Model tier:** default
**Depends on:** Step 3, Step 4
**Parallel with:** Step 7, Step 8, Step 10

### Context brief
Read `docs/conventions.md` first. Strategy doc §4.1: this replaces Apex's live human moderator — someone who staffs public drafts for the first two rounds to chase down slow drafters. Build the mechanical fallback first (pre-draft ranked queue, auto-pick on timer expiry) since that's what actually guarantees a draft finishes even with zero AI involvement. Layer conversational nudges on top using Step 1's shared `src/lib/llm/` module, and make sure the system works correctly with `isLLMEnabled()` false — degrade to rules-only, never fail.

### Tasks
- [ ] Implement a pre-draft ranked queue per user (an ordered list: "if it's my turn and I haven't picked, take the highest-ranked available player from this list")
- [ ] Implement auto-pick-on-timer-expiry wired to Step 3's `TIMER_EXPIRE` action, pulling from the queue
- [ ] Implement a nudge scheduler using a **config value** (`DRAFT_NUDGE_THRESHOLD_PCT`, not a hardcoded 75%) for when to surface an in-room prompt before the timer expires
- [ ] Wire a conversational nudge through `src/lib/llm/` (Step 1) behind `isLLMEnabled()` — if false, the nudge is a static reminder message, not a broken feature
- [ ] Write a test that runs the same draft scenario under both `isLLMEnabled()` states and asserts the mechanical outcome (every pick gets made correctly) is identical either way

### Verification
```bash
npm test -- src/draft-moderator
npm run lint
npm run typecheck
```

### Exit criteria
- A user who never manually picks still gets every pick made correctly from their queue, every round, with no manual intervention
- The test asserting identical mechanical behavior with and without `isLLMEnabled()` passes

### Rollback
Additive to Steps 3/4 — can be disabled via `isLLMEnabled()` without touching the underlying engine.

---

## Step 7 — League management & scoring display

**Model tier:** default
**Depends on:** Step 1, Step 2
**Parallel with:** Steps 3, 4, 5, 6 (needs Step 1's roster-eligibility and domain model, and Step 2's scoring engine — not the draft engine or live draft room directly)

### Context brief
Read `docs/conventions.md` first. This is the season-long backbone: once a league has drafted rosters (seed these directly via `src/data/seed/` for this step's own tests — no need to run a live draft to test league management), render standings, matchups, and roster/lineup management using Step 2's scoring engine and Step 1's `Matchup`/`Week` schema and roster-eligibility functions.

### Tasks
- [ ] **Build the league-creation flow — a review found no step in this phase built one, meaning as originally planned a commissioner could not actually create a league.** Name, format (snake/auction), team count, scoring preset (standard/PPR/half-PPR/TE-premium), roster slots — every field has a sensible default so the whole flow is completable in well under a minute by accepting defaults (advanced settings collapsed behind a disclosure, not on the primary path). Persists a `League`/`ScoringSettings` row and makes the creator its first `Team`
- [ ] Build a shareable invite mechanism (link + short code) so a commissioner can actually get others into the league they just created — nothing in this phase built this either
- [ ] Write tests first for a round-robin schedule generator: given N teams and W weeks, produce a valid `Matchup`/`Week` schedule (this schema exists from Step 1; this step is the first to populate it)
- [ ] Build roster/lineup-setting UI: starters vs. bench, using `validateLineup` from Step 1's `roster-eligibility.ts` (reused, not reimplemented)
- [ ] Build a standings table (wins/losses/points-for, sortable), computed from completed `Matchup` results
- [ ] Build a weekly matchup view rendering both teams' starting lineups and **final scores from the mock weekly stats dataset** (there is no live/in-progress data source in this phase — don't imply otherwise in the UI copy)
- [ ] **Matchup-win / standings celebration moment** — matching Step 4's draft-pick celebration; a review found no delight/motion design anywhere in the original league-management surfaces either. A brief celebratory treatment when a user's matchup result flips to a win, and on the standings view for a clinched playoff spot; respects `prefers-reduced-motion`
- [ ] Add a seeder to `src/data/seed/` (Step 1's single seeding entry point): a realistic 12-team league with a full generated season of matchups, for manual and automated verification

### Verification
```bash
npm test -- src/league
npm run lint
npm run typecheck
npm run dev   # manual: browse the seeded league's standings and a matchup
```

### Exit criteria
- A user can go from logged in to a created, invitable league in a small number of interactions by accepting defaults — verified by a test that counts the interactions
- Standings correctly reflect win/loss records computed from weekly matchup scores
- Setting an invalid lineup (wrong position in a slot) is rejected with a clear reason via `validateLineup`, not a silent failure
- The round-robin schedule generator produces a valid schedule for at least one automated test case (12 teams, 14 weeks)

### Rollback
Independent subsystem — safe to revert without touching the draft engine or scoring module.

---

## Step 8 — Social layer (league chat)

**Model tier:** default
**Depends on:** Step 1, Step 4
**Parallel with:** Step 6, Step 7, Step 10

### Context brief
Read `docs/conventions.md` first. Strategy doc §1.2/§4: the Sleeper-proven thesis — the actual reason people play is social, and no real-money-league competitor has built this in. Keep this deliberately small: text chat + reactions is enough to prove the thesis. This reuses Step 1's SSE subscribe helper (the one and only real-time mechanism in this project) with `chat.message`/`chat.reaction` event types per `docs/conventions.md`'s taxonomy.

### Tasks
- [ ] Write tests first for a per-league chat channel over the shared SSE subscribe helper
- [ ] Basic message send/receive, timestamps, sender identity (via Step 1's `getCurrentUser()`)
- [ ] Simple emoji reactions on messages
- [ ] Persist chat history to SQLite (new table, added to Step 1's Drizzle schema in this step) so it survives a page reload

### Verification
```bash
npm test -- src/chat
npm run lint
npm run typecheck
```

### Exit criteria
- Two users in the same league see each other's messages in real time, verified by an automated two-SSE-client test
- Chat history persists across a reload

### Rollback
Additive UI feature, isolated from scoring/draft logic.

---

## Step 9 — AI advisory layer prototype (start/sit + trade analyzer)

**Model tier:** strongest for the prompt/context-assembly design, default for surrounding plumbing
**Depends on:** Step 2, Step 7
**Parallel with:** Step 10

### Context brief
Read `docs/conventions.md` first. Strategy doc §4.2: the differentiation isn't "we have AI" (FantasyPros' Coach AI, RotoBot, and even the NFL's own assistant already exist) — it's that this advisor already has the user's exact roster, league scoring settings (Step 1/2), and opponent, with no sync step. Build the context-assembly layer as carefully as the LLM call itself. **Trade execution is explicitly out of scope for this step** — the analyzer accepts a `TradeProposal` object (define this type here; nothing else in this phase constructs one beyond a minimal test/form input) and returns an assessment, it never executes a trade.

### Tasks
- [ ] Define `TradeProposal` in `src/domain/` (not persisted or executable in this phase — a plain input type)
- [ ] Build a context-assembly function: given a team + week, gather roster, opponent roster, per-league `ScoringSettings` (Step 1/2), and recent stat trends from the mock dataset into a structured payload
- [ ] Implement a start/sit advisor using Step 1's `src/lib/llm/` module: takes the assembled context + a lineup question, returns a recommendation with reasoning
- [ ] Implement a trade analyzer: takes a `TradeProposal` + both teams' context, returns a fairness assessment with reasoning — **design this to be reusable later as the platform's own collusion/trade-fairness detector (strategy doc §4.1)**, not a one-off single-purpose function
- [ ] Advisory-only by design: no code path lets the AI submit a lineup or accept a trade without an explicit human confirmation action — this is a legal constraint (strategy doc §4.2), not just a UX choice, verified by a test that no advisor function has write access to roster/trade state
- [ ] Degrade gracefully when `isLLMEnabled()` is false (same pattern as Step 6)

### Verification
```bash
npm test -- src/ai-advisor
npm run lint
npm run typecheck
```

### Exit criteria
- Start/sit recommendations are demonstrably specific to the league's actual per-league scoring settings — a test asserts a PPR league and a standard league get different advice for the same roster
- A static-analysis or test-level check confirms no advisor function has a code path that mutates lineup or trade state directly

### Rollback
Additive endpoint(s), no dependents yet — safe to disable independently.

---

## Step 10 — Public league browse/matchmaking UI

**Model tier:** default
**Depends on:** Step 1, Step 7
**Parallel with:** Step 6, Step 8, Step 9

### Context brief
Read `docs/conventions.md` first. Strategy doc §4.1, grounded in real usage: Apex's actual public-join flow is filter-and-browse (skill level, game mode, stake tier → matching open leagues), not blind auto-assignment — replicate that pattern. Stake tier is cosmetic/mock (Step 1's `League.stakeTier` field — no real entry fees exist in this phase). **Filter by `format` using only `'snake' | 'auction'`** — the two formats Step 3 actually implements; do not surface dynasty or best-ball as joinable, since the draft engine can't run them yet.

### Tasks
- [ ] Build a league-listing filter UI: `User.experienceTier`, `League.format` (snake/auction only), `League.stakeTier` (Step 1's domain fields — this step is the first to build UI for them)
- [ ] Build the matching open-leagues list, showing fill status transparently (e.g. "8/12 joined")
- [ ] Implement join flow: select a league from the filtered list, join as the current user (via `getCurrentUser()`), land in that league's roster/dashboard
- [ ] Add seed data to `src/data/seed/` (Step 1's entry point): several mock public leagues at different fill levels, formats, and experience tiers

### Verification
```bash
npm test -- src/matchmaking
npm run lint
npm run typecheck
npm run dev   # manual: filter, browse, and join a mock public league
```

### Exit criteria
- Filtering by experience tier and format correctly narrows the visible league list
- Joining a league correctly updates its fill count and adds the user's team, verified by a test that joins then re-queries fill state

### Rollback
Additive UI on top of Step 7's league model — safe to revert independently.

---

## Step 11 — End-to-end integration

**Model tier:** default
**Depends on:** Step 3, Step 4, Step 7 (minimum — exercises the full draft→season seam; also touches 5, 6, 8, 9, 10 if present)
**Parallel with:** nothing — this is the closing step that proves every prior step's seams actually connect

### Context brief
Read `docs/conventions.md` first. The v1 review found that a completed draft (Step 4) and a season/standings view (Step 7) were never actually proven to connect — the prototype could demo each in isolation without ever proving `commitDraftResults` correctly hands off into a real season. This step is that proof, as a real automated test, not a manual walkthrough.

### Tasks
- [ ] Write an automated integration test: run a full headless mock snake draft through Step 3's engine and Step 4's session store, call `commitDraftResults`, then load the resulting league in Step 7's standings/matchup view and assert the rosters match what was drafted
- [ ] Repeat for a full auction draft (Step 5)
- [ ] If Steps 6, 8, 9, 10 are present, add one smoke-level assertion each confirming they operate correctly against a league produced by this real draft→commit→season pipeline (not just seeded fixtures) — this catches drift between "what Step 1 seeds for isolated testing" and "what an actual draft produces"

### Verification
```bash
npm test -- src/integration
npm run lint
npm run typecheck
```

### Exit criteria
- A single test suite run proves: draft → commit → standings/matchup view, for both snake and auction, end to end, with no manual steps
- Any feature built against seeded fixtures alone (Steps 6–10) is also exercised at least once against real draft output in this step

### Rollback
Test-only step — nothing to roll back beyond the test files themselves.

---

## Post-Blueprint: Next Phases (not part of this plan)

Once this prototype demonstrates the core UX thesis, subsequent phases cover: real accounts/data foundation, trust & integrity at scale, payments (FBO/agent-of-payee), tax & regulatory compliance automation, AI productionization, native mobile apps, and legal/launch readiness. See `plans/00-roadmap.md`.
