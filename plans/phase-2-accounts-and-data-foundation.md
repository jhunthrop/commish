# Blueprint: Commish — Phase 2: Accounts & Data Foundation

**Objective:** Harden the Phase 1 prototype into something production-shaped — real user accounts and authenticated sessions retrofitted through every Phase 1 feature, a stats-data provider seam that decouples the app from the mock dataset, production-grade persistence (indexed, pooled, locked, backed up, and observable), a live-scoring ingestion pipeline ready for a real vendor swap, a hardened and load-tested deployment, a cross-league user dashboard, baseline auth/session security, and a set of product/UX gaps a review found silently dropped (onboarding, avatars, chat depth, an unfiltered review feed) — while still deliberately deferring real money, native apps, and licensed data contracts to later phases.

**Depends on:** Phase 1 (`plans/fantasy-mvp-prototype.md`) — all steps complete. This phase assumes Phase 1's domain model, scoring engine, draft engine, live draft room, league management, chat, and AI advisory/moderator scaffolding all exist and work against Phase 1's SQLite + mock-data stack.

> **Step-number reconciliation:** this file was drafted against an earlier draft of Phase 1 that had 9 steps. After an adversarial review, Phase 1 was rewritten to 11 steps (a user/identity stub, `docs/conventions.md`, and a matchup/schedule model were added at Step 1; the combined draft-room step was split into snake and auction steps; an end-to-end integration step was added at the end). Any "Phase 1 Step N" reference in this file for N ≥ 4 may be off by one or more — see the mapping table in `plans/00-roadmap.md` before treating a specific step number here as literal.

> **Revision note (v2):** v1 had 7 steps. A full adversarial scaling/production-readiness review and a full adversarial UX-completeness review (`docs/research/2026-08-16-scaling-review.md`, `docs/research/2026-08-16-ux-review.md`) assigned this phase eleven findings the roadmap's "Scaling & UX review" section names explicitly: multi-instance draft-write safety, indexes + a balance-rollup convention, PgBouncer + a pool-sizing formula, backups/PITR/DR, a Redis cache layer, graceful SIGTERM + split health checks, a CDN, general API rate limiting (the plan's own promised-but-never-built "future security-hardening phase," fixed here), structured logging/error tracking/uptime monitoring, an owned live-scoring ingestion pipeline, a load-testing gate, and four product/UX gaps (onboarding, avatars, chat depth, review feed). **v2 adds ten new steps and renumbers the file from 7 steps to 17** — see the Dependency Graph below for the full new order. A repo-wide search at the time of this revision found no other phase file references a specific "Phase 2 Step N"; all cross-phase references are to "Phase 2" as a whole. That said, if a downstream phase file is later found to cite a specific step number from the old 1–7 sequence, translate it through this table: old Step 1 → **Step 1** (unchanged), old Step 2 (accounts) → **Step 4**, old Step 3 (retrofit identity) → **Step 5**, old Step 4 (stats adapter) → **Step 6**, old Step 5 (dashboard) → **Step 8**, old Step 6 (deployment) → **Step 9**, old Step 7 (auth/session hardening) → **Step 11**.

**Source strategy doc:** `docs/research/2026-08-16-beating-apex-strategy.md` (Sections 4, 4.1, 4.2, 5)

**Model tier defaults:** *strongest* for steps with high blast-radius or irreversible-if-wrong risk (the Postgres migration, the auth primitives, data-layer locking/pooling, backups/DR, and the live-scoring pipeline — mistakes in any of these propagate everywhere downstream or are catastrophic to recover from). *default* for everything else; each step below states its own tier explicitly.

---

## Pre-flight

- [x] Confirmed Phase 1's stack as the baseline this phase modifies: TypeScript strict, Next.js 15 App Router, Vitest, Redis Streams fanned out over SSE (no Socket.io, no managed pub/sub vendor — see Phase 1's "Real-time & event architecture" section), SQLite via Drizzle ORM in Phase 1's local dev, mock NFL player dataset.
- [x] Confirmed Phase 1 has no auth/session concept at all — every "current user" reference in league/team/draft/chat code is an implicit assumption with nothing backing it. This is the primary gap this phase closes.
- [x] Read strategy doc §5 (Technical Architecture) for the data-licensing and hosting framing this phase's judgment calls are grounded in.
- [x] Read `docs/research/2026-08-16-scaling-review.md` and `docs/research/2026-08-16-ux-review.md` in full for this revision — every new step below traces back to a named finding (C1–C6, I1–I10 in the scaling review; C1–C9, I1–I10 in the UX review).

## Explicitly Out of Scope for This Phase

These remain deferred to later phases, consistent with Phase 1's scoping and the strategy doc's own phasing:

- Real entry fees, prize payouts, FBO/agent-of-payee payment infrastructure (strategy doc §3).
- KYC/AML/OFAC screening, tax withholding, 1099 generation.
- State-by-state legal geofencing enforcement (strategy doc §2).
- **Selecting and contracting a real licensed stats vendor** (SportsDataIO, SportRadar, Genius Sports — strategy doc §5). This is a real-world business/legal decision, not a coding task, and it is explicitly deferred to Phase 8. This phase's Step 6 only builds the adapter seam, and Step 7 the ingestion pipeline against that seam, that a real vendor integration would plug into later.
- Native iOS/Android apps — still web only.
- Full production-grade security (WAF, formal penetration testing, bug bounty program, SOC2-style controls). Step 11 in this phase covers auth-specific baseline hardening and Step 12 covers general API rate limiting/edge hardening — both appropriate before any real user credentials are collected in production. **Fix (I7):** a prior revision of this file deferred WAF/pen-testing/bug-bounty scope to an unnamed "future, dedicated security-hardening phase" that a review found was never actually created anywhere in the 8-phase plan. That scope is now explicitly folded into **Phase 8's go-live checklist** — not a phantom phase — while the part of I7 that was actually buildable now (general API rate limiting beyond the auth endpoints) is built in Step 12.
- Dynasty/keeper draft support and true real-time AI production load — both remain Phase 6/Phase 9 concerns per the roadmap; this phase's Step 13 load-testing scenario for AI exercises only Phase 1's mechanical auto-pick fallback under concurrency, not real inference load.

## A note on what this phase unblocks

**Phase 3 (Trust & Integrity) depends on this phase's real accounts, not a stub.** Multi-account detection — one of the strategy doc's highest-leverage integrity features (§4.1, §4.2) — requires a real, persistent, authenticated user identity to correlate against (device fingerprints, payment methods, behavioral signals tied to a durable account record). An anonymous or stubbed session model would give Phase 3 nothing real to detect duplicates *of*. Step 4 and Step 5 below are what make Phase 3 possible at all; do not let either get descoped or half-finished. **Phase 4 (Payments) also depends on this phase's data-layer hardening (Step 2) and backup/DR posture (Step 3) being solid before real money exists** — the scaling review is explicit that backups/DR must land before Phase 4, not after, and that the balance-as-rollup convention Step 2 documents is the pattern Phase 4's ledger must follow rather than reinventing.

## Dependency Graph

- Step 1 (Postgres migration & persistence hardening) → depends on: Phase 1
- Step 2 (Data-layer hardening: indexes, rollup convention, per-draft locking, PgBouncer) → depends on: 1
- Step 3 (Backups, PITR & disaster-recovery runbook) → depends on: 1
- Step 4 (User accounts, authentication & sessions) → depends on: 1
- Step 5 (Retrofit authenticated identity: league / team / draft / chat) → depends on: 4
- Step 6 (Stats-data provider adapter interface) → depends on: Phase 1
- Step 7 (Live-scoring ingestion pipeline & read-heavy caching) → depends on: 2, 6
- Step 8 (Multi-league user dashboard) → depends on: 5
- Step 9 (Deployment & hosting) → depends on: 1, 2, 4
- Step 10 (Observability: logging, error tracking, uptime monitoring) → depends on: 9
- Step 11 (Auth/session security hardening) → depends on: 4, 5, 9
- Step 12 (Deployment hardening: SIGTERM, health checks, CDN, general rate limiting) → depends on: 9, 11
- Step 13 (Load testing: named Sunday-concurrency scenarios) → depends on: 2, 3, 7, 9, 10, 12
- Step 14 (First-run onboarding flow) → depends on: 5, 8
- Step 15 (Avatar & profile customization) → depends on: 4
- Step 16 (Chat depth: GIFs & voice messages) → depends on: 5
- Step 17 (In-product unfiltered review feed) → depends on: 4

**Parallel opportunities:** Steps 2, 3, 4, and 6 all only need Step 1 or Phase 1 directly, so they can run concurrently. Step 5 needs only Step 4. Step 6 (the adapter seam) has no dependency on accounts/Postgres at all and can run the entire time everything else is in progress, same as in v1. Steps 14, 15, 16, and 17 (the product/UX steps) only need accounts (Step 4) or accounts + identity retrofit (Step 5) and touch disjoint files from the infra steps, so all four can run in parallel with each other and with most of the infra work once their narrow dependencies land. Step 13 (load testing) is the one true closing joining point in this phase — it needs the data layer, backups, live-scoring/caching, deployment, observability, and deployment-hardening all done to produce a meaningful result, so treat nothing above it as "Sunday-ready" until it passes.

---

## Step 1 — Postgres migration & persistence hardening

**Model tier:** strongest (schema migration correctness and data-loss risk; every later step in this phase builds on this one)
**Depends on:** Phase 1 (Step 1's Drizzle + SQLite schema)
**Parallel with:** Step 2, Step 3, Step 4, Step 6

### Context brief
Phase 1 deliberately chose SQLite via Drizzle for a zero-dependency local prototype, and that was the right call for a solo-dev demo. It stops being the right call here, for two concrete reasons rather than reflexive "always use Postgres" habit: (1) this phase adds real concurrent multi-user writes — authenticated sessions, live draft picks, and chat messages happening simultaneously — which runs directly into SQLite's single-writer lock; (2) Step 9's hosting choice (a persistent container, not serverless) still doesn't make multi-instance SQLite free — sharing one SQLite file safely across more than one running instance needs extra machinery (e.g., LiteFS) that Postgres's client-server model gives you for free. Drizzle's schema syntax is close enough between its SQLite and Postgres dialects that this is a bounded, mechanical migration — not a rewrite of the data layer's shape, just its dialect and connection.

If this were staying a single-instance, low-concurrency internal tool indefinitely, SQLite would still be defensible — say so explicitly in the decision note below so a future engineer doesn't assume this was cargo-culted.

### Tasks
- [ ] Add a Postgres driver (`pg` or a provider's serverless-friendly driver) and switch Drizzle's schema definitions from `sqlite-core` to `pg-core` types, preserving Phase 1's exact table/column semantics for `League`, `Team`, `Roster`
- [ ] Stand up a local Postgres for dev parity (docker-compose service) and a managed Postgres for the deployed environment (Fly Postgres, colocated with the Step 9 hosting choice, or Neon as a host-agnostic alternative reachable via a plain connection string — either works since Drizzle only needs a connection string, document whichever is chosen)
- [ ] Write a one-time data-migration script (`scripts/migrate-sqlite-to-postgres.ts`) that reads any existing Phase 1 SQLite dev/test data and inserts it into Postgres, preserving IDs and foreign-key relationships
- [ ] Generate and apply Drizzle migrations (`drizzle-kit generate`, `drizzle-kit migrate`) against the local Postgres instance
- [ ] Audit every Phase 1 call site that touched the DB (league/team/roster persistence, draft-state persistence if any was added, chat history persistence) for dialect-specific SQL that silently diverges between SQLite and Postgres (e.g., autoincrement semantics, boolean representation, date/time handling) and fix each one
- [ ] Add connection pooling sized conservatively for now — do not leave connections unbounded. **This is a placeholder, not the final answer:** a review found no documented sizing methodology or pooling middleware anywhere in the original plan; Step 2 below adds PgBouncer and a formal, documented connection-pool sizing formula. This task exists only so the raw driver-level pool isn't left at library defaults in the interim between this step and Step 2
- [ ] Port Phase 1's persistence-layer tests to run as integration tests against a real (dockerized) Postgres instance rather than a mock, per the user's global testing rules requiring real integration tests for database operations
- [ ] Write a short inline decision note (e.g. `docs/decisions/postgres-migration.md`) recording the reasoning above, so it reads as a deliberate call, not a default

### Verification
```bash
docker compose up -d postgres
npm run db:migrate
npm test -- db
npm run typecheck
npm run build
```

### Exit criteria
- All Phase 1 persistence integration tests pass against real (dockerized) Postgres; zero runtime dependency on SQLite remains
- The one-time migration script round-trips a seeded Phase 1 SQLite dataset into Postgres with referential integrity intact
- `npm run build` succeeds with Postgres as the only DB dependency

### Rollback
This step has broad blast radius across the persistence layer — revert as a single commit range, not partially. Keep the last Phase 1 SQLite-based build tagged so a full rollback path exists if the migration surfaces a blocking issue mid-phase.

---

## Step 2 — Data-layer hardening: indexes, balance-rollup convention, per-draft locking & PgBouncer

**Model tier:** strongest (concurrency correctness and connection-pooling correctness both have high blast radius; everything downstream that needs to scale horizontally depends on this landing correctly)
**Depends on:** Step 1
**Parallel with:** Step 3, Step 4, Step 6

### Context brief
A review (scaling review C4, C5, I10) found three related data-layer gaps that all matter before Step 9's deployment, or later phases' higher write volume, make them dangerous: (1) Phase 1's fix for the durable draft-action log (persist every accepted action, replay to reconstruct state) covers *durability* — surviving a restart — but not *concurrent-writer safety*. With ≥2 app instances, which Step 9's hosting choice makes possible, a pick landing on instance A is invisible to instance B until its next read, and nothing serializes two instances racing to write the same draft's next action. (2) Zero indexes exist anywhere in the schema, and the pattern most likely to get copied forward into Phase 3's audit log and Phase 4's payment ledger — computing a running total as a full `SUM()` over history rows on every read — was never caught before those tables exist. The fix belongs here, as an established convention those later phase files can follow, not as a retrofit after Phase 4 ships with the bug already baked in. (3) Connection pooling was left as "size it later" in Step 1, with no documented formula, which becomes dangerous exactly when Step 9's hosting scales out, since connection demand grows with instance count in precisely the high-load scenario (Sunday) where scaling out is most needed.

### Tasks
- [ ] Add a per-draft row lock: extend Phase 1 Step 4's draft session store so every accepted action acquires `SELECT ... FOR UPDATE` on the draft's row (or a dedicated `draft_locks` row keyed by `draftId`) inside the same transaction that validates and persists the action — this makes "replay the action log" the single-writer path across any number of app instances, not just across restarts
- [ ] Add a two-instance concurrent-write test: fire two simultaneous "make the next pick" requests from simulated separate app instances (two Node processes, or two `supertest` app instances sharing one Postgres/Redis) against the same draft, and assert exactly one is accepted and the other is correctly rejected/retried — never silently double-applied
- [ ] Add a two-instance visibility test proving a pick made via simulated instance A is correctly visible to a client reading through simulated instance B
- [ ] Add indexes for every hot read path introduced so far: `Session(token)`, `Session(userId)`, `Team(userId)`, `Team(leagueId)`, league-membership lookups, chat messages (if persisted per Phase 1 Step 8) by `(leagueId, createdAt)`, and `draft_actions(draftId, timestamp)` — verify each with `EXPLAIN ANALYZE` against a seeded dataset large enough to be representative, confirming an index scan, not a sequential scan
- [ ] Document the balance-as-rollup convention as an explicit architectural rule in `docs/decisions/data-layer-hardening.md`, even though no ledger table exists yet in this phase: any running total (a future payment-ledger balance in Phase 4, an audit-event count in Phase 3, a season point total) must be maintained as a rollup row updated in the same transaction as each contributing write, with the append-only source table remaining the reconciliation source of truth — never a full `SUM()`/table scan on the read path. State the rule clearly enough that a future phase's own file can follow it without re-deriving it (this file does not edit those other phase files — another process owns cross-file reconciliation)
- [ ] Apply the rollup convention to the one aggregate-style read this phase already has: Step 8's multi-league dashboard query (every league a user belongs to). Profile it against a seeded multi-league dataset and, if it scans more than necessary at that scale, add the appropriate index or a maintained rollup rather than leaving an unindexed join in place
- [ ] Add PgBouncer in transaction-pooling mode in front of Postgres (docker-compose service locally; a colocated or managed instance in production) and point the app's Drizzle connection string at PgBouncer, not Postgres directly
- [ ] Document a connection-pool sizing formula in the same decision doc: `pool_size_per_instance = (postgres_max_connections − reserved_superuser_connections) / expected_max_instances`, plus a separate, smaller PgBouncer pool reserved for batch/background jobs (e.g. Step 7's stats-ingestion worker) so a batch job can never starve the request path of connections
- [ ] Write a test confirming the app functions correctly against PgBouncer in transaction-pooling mode specifically — transaction pooling is a known trap for session-level features (prepared statements, advisory locks held outside a single transaction); confirm the `SELECT ... FOR UPDATE` lock above is scoped entirely within one transaction, since that's exactly the pattern transaction pooling breaks if done wrong

### Verification
```bash
docker compose up -d postgres pgbouncer
npm run db:migrate
npm test -- db/locking
npm test -- db/indexes
npm test -- db
npm run typecheck
```

### Exit criteria
- The two-instance concurrent-write test proves exactly one of two simultaneous actions against the same draft wins; the other is rejected/retried, never double-applied
- `EXPLAIN ANALYZE` confirms index usage (not a sequential scan) on every hot path listed above
- The full persistence test suite, including the per-draft lock test, passes running against PgBouncer in transaction-pooling mode
- `docs/decisions/data-layer-hardening.md` documents both the rollup convention and the pool-sizing formula

### Rollback
Locking wraps existing draft-store transactions from Step 1/Phase 1 Step 4 — revert to the pre-lock transaction boundary if issues surface. PgBouncer sits in front of the connection string as an infrastructure change; reverting to a direct Postgres connection string requires only a config change, no code change.

---

## Step 3 — Backups, point-in-time recovery & disaster-recovery runbook

**Model tier:** strongest (data-loss risk; a restore procedure that's wrong is discovered during a real incident, which is exactly the failure this step exists to prevent before it can happen)
**Depends on:** Step 1
**Parallel with:** Step 2, Step 4, Step 6

### Context brief
A review (scaling review C6) found zero database backup, point-in-time-recovery, or disaster-recovery plan anywhere across all 8 phases, and called it the most serious omission after the concurrency/durability findings for a product that becomes real-money and regulated two phases from now: losing the ledger later would mean being unable to tell users what they're owed, unable to reconcile to the FBO account, and unable to file 1099s — a regulatory incident, not just an outage. The review is explicit this must land **before Phase 4 introduces real money, not after** — this phase is the last safe point to build and actually drill it, while the schema is still small and the drill is cheap.

### Tasks
- [ ] Enable automated daily base backups plus continuous WAL archiving against the Step 1 Postgres instance (a managed provider's built-in offering if using Fly Postgres/Neon/an RDS-equivalent; otherwise `pgBackRest`/`wal-g` self-managed) — target RPO ≤ 5 minutes, RTO ≤ 1 hour, both stated as explicit numbers, not aspirational language
- [ ] Write a restore runbook (`docs/runbooks/postgres-restore.md`): step-by-step, written for someone who has never done this before — provision a fresh instance, restore the base backup, replay WAL to a target point in time, verify row counts/checksums against a known-good snapshot, cut the app over
- [ ] Actually execute the runbook once against a seeded, production-shaped dataset (not a trivial empty DB): restore into a scratch instance and verify the restored data matches expected values. A written-but-never-run runbook is exactly the kind of artifact that fails when actually needed, so execution is a required task here, not optional documentation
- [ ] Decide and document Redis's persistence policy explicitly — currently undecided per the review: enable AOF persistence for the production Redis instance Step 9 provisions, since it holds in-flight draft-cache state and stream data that's expensive (though not catastrophic, since Postgres remains authoritative per Phase 1's degradation rule) to lose
- [ ] Add a recurring quarterly restore-drill cadence (a calendar reminder or CI-scheduled job stub is sufficient here; only the first drill's results are required as this step's exit criterion) — record the cadence decision in the runbook itself
- [ ] Record backup/restore configuration and the executed drill's results in `docs/decisions/backup-and-dr.md`, including the actual measured restore time compared against the stated RTO target

### Verification
```bash
npm run backup:trigger   # or provider CLI equivalent, documented in the runbook
# manual: execute docs/runbooks/postgres-restore.md against a scratch instance end-to-end
```

### Exit criteria
- Automated daily backups and WAL archiving are running and verified (a successful backup appears in provider logs/storage)
- The restore runbook has been executed at least once against production-shaped seeded data, with restored row counts and checksums verified against the source
- Measured restore time is recorded and compared against the stated RTO target
- Redis AOF persistence is enabled and documented
- This drill's results are recorded as the baseline Phase 8's go-live gate re-checks before real money goes live

### Rollback
Backup/restore infrastructure is additive and out-of-band from the application — no application code depends on it, so there's nothing in the app to roll back; only provider-specific backup configuration would be reverted if it causes trouble.

---

## Step 4 — User accounts, authentication & sessions

**Model tier:** strongest (security-critical; mistakes in credential handling or session validation are costly and easy to get subtly wrong)
**Depends on:** Step 1
**Parallel with:** Step 2, Step 3, Step 6

### Context brief
Phase 1 never built a login. Every feature from the live draft room onward implicitly assumed "the current user" exists, with no auth step behind it. This step is scoped narrowly to the auth primitives themselves — accounts, credential storage, session issuance/validation, and a single `getCurrentUser()` seam — not to retrofitting Phase 1's features to use them (that's Step 5, kept separate because it touches many files and deserves its own focused pass).

### Tasks
- [ ] Choose a credentials-based (email + password) auth approach built on a well-tested library rather than hand-rolled crypto (e.g., a Lucia-style session pattern, or Auth.js/NextAuth's Credentials provider) — reuse a proven implementation for password hashing and session-token generation rather than writing either from scratch
- [ ] Define a `User` table/type: id, unique validated email, hashed password (argon2id), display name, created_at — plaintext passwords are never persisted or logged
- [ ] Define a `Session` table: session token, user id (FK), expiry, created_at, and room for IP/user-agent metadata that Step 11's hardening will use
- [ ] Implement sign-up, log-in, and log-out routes/server actions with input validation at the boundary (email format, minimum password strength), failing fast with clear error messages
- [ ] Implement `getCurrentUser(): Promise<User | null>` and `requireAuth()` server-side helpers that read and validate the session cookie against the DB — this exact signature is the seam Step 5 threads through every Phase 1 feature, so get it right once here
- [ ] Write tests first (TDD, per the user's global workflow) for: successful sign-up, duplicate-email rejection, wrong-password rejection, expired-session rejection, valid-session success
- [ ] Skip OAuth/social login in this phase — email+password proves the seam sufficiently; note it as a natural, non-blocking later extension

### Verification
```bash
npm test -- auth
npm run lint
npm run typecheck
```

### Exit criteria
- A user can sign up, log in, and log out end-to-end against the real Postgres-backed session store
- A test asserts the stored password value is a hash, never the raw input
- `getCurrentUser()` returns `null` for an expired/invalid session and the correct `User` for a valid one, both under test

### Rollback
Additive on top of Step 1's schema — nothing yet consumes `getCurrentUser()` (that starts in Step 5), so this step can be disabled or reverted without touching league/draft/chat code.

---

## Step 5 — Retrofit authenticated identity through league / team / draft / chat

**Model tier:** default (mechanical plumbing, but wide-reaching — treat the audit list as the actual spec)
**Depends on:** Step 4
**Parallel with:** Step 6, Step 9

### Context brief
The seam exists after Step 4, but every Phase 1 feature was built against an implicit, unauthenticated "current user." This step goes back through league creation/joining, team ownership, live-draft-room seat assignment, and chat sender identity, and wires in the real authenticated user everywhere Phase 1 assumed, mocked, or hardcoded one. This is its own step — not folded into Step 4 — because it touches many existing files across Phase 1's surface area and needs its own focused test pass rather than being buried inside the auth-primitives work.

### Tasks
- [ ] Audit every Phase 1 code path that referenced "the current user" implicitly (team ownership on league join, draft-seat assignment, chat message sender identity, roster/lineup edit permission checks) and write the list down explicitly before changing anything — this list is the completion checklist for this step
- [ ] Add a `userId` foreign key to `Team` (owning user); enforce at creation that only an authenticated user can create a team, and that user becomes its owner
- [ ] Gate league-management actions (create league, invite, edit lineup, propose trade) behind `requireAuth()` plus an explicit ownership/membership check — a user may only act on a team they own
- [ ] Wire real user identity into the Phase 1 live draft room: a drafter's seat is tied to an authenticated `userId`, not an anonymous SSE connection; reconnect/resume logic must re-associate state by user id, not by a transient connection identifier
- [ ] Wire real user identity into league chat: sender identity comes from the validated session, never from a client-supplied display name
- [ ] Write authorization tests proving: a user cannot edit another user's team's lineup, cannot make a draft pick on another user's turn, cannot post chat messages as another user
- [ ] Update Phase 1's seed/test-fixture data to include real seeded user accounts so Phase 1's existing test suites keep passing under the authenticated model — expect to touch multiple existing Phase 1 test files, not just add new ones

### Verification
```bash
npm test
npm run lint
npm run typecheck
npm run build
```

### Exit criteria
- Every Phase 1 feature (league management, draft room, chat) now operates on the real authenticated user; a repo-wide search for Phase 1's placeholder "current user" pattern returns zero matches
- Authorization tests prove a user cannot act on another user's team, draft turn, or chat identity
- The full Phase 1 regression suite passes against the authenticated model

### Rollback
Broad-reaching by design — revert as a single unit (its own commit range). A partial rollback would leave some features authenticated and others not, which is a worse and more confusing state than either extreme.

---

## Step 6 — Stats-data provider adapter interface

**Model tier:** default
**Depends on:** Phase 1 (Step 1's domain model and mock dataset)
**Parallel with:** Steps 1, 2, 3, 4, 5, 8, 9

### Context brief
**Selecting and contracting an actual licensed stats vendor (SportsDataIO, SportRadar, Genius Sports — strategy doc §5) is a real-world business and legal decision, not a coding task, and it is out of scope for this phase entirely — it's deferred to Phase 8.** What this step builds instead is the seam: a `StatsProvider` interface that Phase 1's mock dataset satisfies today, so that swapping in a real licensed feed later is a config/adapter change, not a rewrite of the scoring engine or player-pool UI. Step 7 builds the ingestion/polling/fan-out pipeline against this seam; that pipeline logic does not belong here, since this step is scoped to the interface and its mock implementation only.

### Tasks
- [ ] Define a `StatsProvider` interface (e.g. `src/services/stats-provider/types.ts`) with methods shaped around what Phase 1's scoring engine and domain types actually consume — e.g. `getPlayerStatLine(playerId, week): Promise<StatLine>`, `getWeeklyStatLines(week): Promise<StatLine[]>`, `getPlayerMeta(playerId): Promise<PlayerMeta>` — not a speculative superset of a future vendor's full API
- [ ] Implement `MockStatsProvider`, wrapping Phase 1's existing `mock-players.json` behind this interface with no behavior change to scoring or UI output
- [ ] Add provider selection via config/env var (e.g. `STATS_PROVIDER=mock`), defaulting to mock, failing fast with a clear typed error if an unimplemented provider name is selected — configuration over hardcoding
- [ ] Refactor every Phase 1 call site that read `mock-players.json` directly to go through `StatsProvider` instead — zero remaining direct file reads outside `MockStatsProvider`'s own implementation
- [ ] Write contract tests against the `StatsProvider` interface itself (not `MockStatsProvider`'s internals), so a future real implementation can be verified against the same suite unchanged
- [ ] Write the explicit deferral note (e.g. `docs/decisions/stats-provider-adapter.md`) stating this step only guarantees the seam exists; vendor selection, contracting, and pricing are Phase 8 business decisions

### Verification
```bash
npm test -- stats-provider
npm run lint
npm run typecheck
```

### Exit criteria
- The scoring engine and player-pool UI consume stats exclusively through `StatsProvider`
- The contract test suite passes against `MockStatsProvider` and is generic enough to run unchanged against a future real provider
- Setting `STATS_PROVIDER` to an unimplemented value fails fast with a clear error rather than silently falling back to mock data

### Rollback
Purely additive interface layer over existing mock data — safe to revert without affecting scoring or draft logic, since behavior is unchanged, only the access path moved.

---

## Step 7 — Live-scoring ingestion pipeline & read-heavy caching layer

**Model tier:** strongest (highest-load path in the entire product; a scoping bug here reproduces the exact peak-Sunday outage pattern the review warned about)
**Depends on:** Step 2 (indexes/rollup convention, PgBouncer), Step 6 (stats-provider adapter)
**Parallel with:** Step 4, Step 5, Step 8, Step 9

### Context brief
A review (scaling review C1) found the live-scoring ingestion and fan-out pipeline unowned across all 8 phases: Step 6's `StatsProvider` builds only a pull seam, with no polling cadence, fan-out design, or scoping, and flagged this as the single highest-load path in the entire product — a naive "recompute every roster on every stat tick" implementation is O(leagues × teams × starters) per tick, which at 5,000 leagues is roughly 60,000 roster recomputations at the exact moment of the week with the highest concurrency. The same review (I6) separately found no caching layer anywhere: every read, including standings/matchup views recomputed from raw stat lines on every page view, hits Postgres directly, so read load scales with refresh rate rather than user count. Both problems share one fix, so this step builds them together, against `MockStatsProvider` (the only provider Step 6 wires up), so the pipeline's mechanics are proven and load-tested (Step 13) well before Phase 8 swaps in a real vendor feed.

### Tasks
- [ ] Build a dedicated ingestion worker (a separate process/queue consumer, not inline in a request handler) that polls `StatsProvider.getWeeklyStatLines(week)` on a configurable cadence (`STATS_POLL_INTERVAL_MS`, not hardcoded)
- [ ] Delta-diff each poll against the previously seen stat lines (keep the prior tick's snapshot, e.g. in Redis) so only players whose stats actually changed trigger any downstream work
- [ ] Build an inverted `playerId → affected rosters` index (maintained incrementally as rosters change, not rebuilt from scratch per tick) so a stat change for one player only recomputes the specific rosters that own that player, never a full leagues × teams scan
- [ ] Batch the resulting score-update events per league and publish them through Phase 1's existing `publishEvent`/Redis Streams mechanism (a `score.update` event type, added to `docs/conventions.md`'s taxonomy) — reuse the one broadcast mechanism, don't invent a second transport
- [ ] Add a Redis-cached computed-score layer keyed by `(leagueId, week, statsVersion)`, where `statsVersion` is bumped by the ingestion worker on each delta — reads (standings, matchup views) check this cache first and only recompute on a version mismatch
- [ ] Extend the cache to the other read-heavy, rarely-changing data the review named: player/ranking data and per-league `ScoringSettings`, both cached with an explicit write-through invalidation path on update, not a blind TTL that could serve stale scoring settings mid-week
- [ ] Write a test simulating a multi-tick season update against `MockStatsProvider`'s deterministic dataset, asserting: only rosters containing a changed player are recomputed (assert via a call-count/instrumentation hook, not just final correctness), cache hits outnumber cache misses on repeated standings reads within the same `statsVersion`, and a cache miss after a version bump returns the newly correct value
- [ ] Add an explicit degradation rule matching Phase 1's Redis-outage convention: if the cache is unavailable, reads fall back to computing from Postgres directly (slower, still correct) rather than failing — add a test for this fallback path
- [ ] Document the design (worker cadence, delta-diff strategy, inverted-index shape, cache-key scheme) in `docs/decisions/live-scoring-pipeline.md` so Phase 8's real-vendor swap only changes the `StatsProvider` implementation, not this pipeline

### Verification
```bash
npm test -- src/stats-pipeline
npm run lint
npm run typecheck
```

### Exit criteria
- A simulated multi-tick update against the deterministic mock season only recomputes rosters actually affected by a changed player, verified by an instrumented call-count assertion
- Repeated standings/matchup reads within the same `statsVersion` are served from cache, verified by a cache-hit assertion
- A cache-unavailable simulation still returns correct (if slower) results, never an error
- The design doc exists and is specific enough that swapping `MockStatsProvider` for a real vendor adapter later requires no change to the worker, index, or cache logic

### Rollback
The ingestion worker and cache are additive layers over existing read paths — reverting falls back to direct Postgres reads (Step 1/Step 2's behavior), correct but slow; safe to revert independently of the rest of the phase.

---

## Step 8 — Multi-league user dashboard

**Model tier:** default
**Depends on:** Step 5
**Parallel with:** Step 6, Step 9

### Context brief
Phase 1 built per-league views (standings, matchups, draft room, chat) but never a cross-league "home." Now that Step 5 gives every team a real owning user, this step can answer "every league I'm in" honestly and render the dashboard Phase 1 never had — the Sleeper/Apex-style landing page a user sees right after logging in. Step 2 already profiled this step's own cross-league query for the rollup/indexing convention — read that step's findings before assuming the naive query is fine at scale.

### Tasks
- [ ] Build a `/dashboard` route behind `requireAuth()`, used as the landing page after login
- [ ] Query and render every league the current user belongs to (via their owned teams): league name, format, current standing/record snapshot, and a next-relevant-action prompt (e.g. "set your lineup," "you're on the clock")
- [ ] Handle the zero-leagues case explicitly for a brand-new user, with a clear call-to-action rather than a blank or broken page
- [ ] Link each dashboard league card into that league's existing Phase 1 views (standings, matchup, chat) — this step is a new entry point, not a rebuild of those views
- [ ] Add a basic "leave league" affordance only if it's trivial given the existing data model; skip it if it requires new domain concepts Phase 1 doesn't already have — avoid over-engineering a feature that wasn't asked for
- [ ] Seed a test user belonging to at least 3 leagues of mixed format for manual and automated verification

### Verification
```bash
npm test -- dashboard
npm run lint
npm run typecheck
npm run dev   # manual: log in as the multi-league seeded user, confirm the dashboard lists exactly their leagues
```

### Exit criteria
- A user belonging to N leagues sees exactly those N leagues on their dashboard; an explicit authorization test proves no other user's leagues leak in
- The zero-leagues state renders a usable empty state, not an error
- Each dashboard league card correctly navigates into that league's existing views

### Rollback
Additive route/view on top of Step 5's ownership model — safe to revert without touching per-league feature code.

---

## Step 9 — Deployment & hosting

**Model tier:** default
**Depends on:** Step 1, Step 2, Step 4
**Parallel with:** Step 5, Step 6, Step 8

### Context brief
Phase 1 never left localhost. This step picks a concrete host and gets the app reachable publicly. The choice here isn't the default "just use Vercel" — Phase 1's real-time layer is Redis Streams fanned out over long-lived SSE streams (deliberately not Socket.io or a managed realtime SaaS vendor, to avoid an unjustified third-party dependency — see Phase 1's "Real-time & event architecture" section). That still needs a **persistent process**: an SSE response has to stay open for the duration of a draft or a live-scoring session (potentially hours), and a persistent Redis consumer connection needs somewhere to live — Vercel's serverless functions have execution-time limits that don't suit either of those, regardless of protocol. **Fly.io** runs the whole app as one persistent container, holding both the open SSE streams and the Redis connection with zero architectural rework, and its persistent volumes/co-located Postgres options also pair naturally with Step 1's persistence choice. This step also provisions a production Redis instance (Fly's own Redis offering or a lightweight managed option like Upstash) — the same real-usage principle applies as with Postgres: it's infrastructure the product genuinely needs, not an optional extra. **Note:** this step provisions horizontally-scalable infrastructure (multiple app instances behind Fly's load balancer), which is exactly what makes Step 2's per-draft locking and PgBouncer work load-bearing rather than theoretical — deploy Step 2 before scaling this out past one instance. Redis's persistence policy (AOF) was decided in Step 3; provision the production instance to match.

### Tasks
- [ ] Provision a production Redis instance (AOF persistence enabled, per Step 3's decision) and containerize the app (`Dockerfile`) running Next.js with its SSE Route Handlers and Redis connections, as Phase 1 built it
- [ ] Configure `fly.toml`: app name, region, Postgres attachment (Fly Postgres or an external managed provider via a secret-stored connection string — either works per Step 1), routed through Step 2's PgBouncer, and an HTTP health check
- [ ] Add a `/api/health` route that checks DB connectivity, for Fly's health checks and future uptime monitoring. **Interim only:** a review found a single DB-only health check is blind to a dead Redis connection, the most likely partial failure — Step 12 below splits this into proper liveness/readiness endpoints; this task's job is just to get a working baseline in place for this step's own verification
- [ ] Move all secrets (DB connection string, session secret, any future stats-provider API keys) into Fly secrets/environment variables — zero secrets committed to the repo
- [ ] Document the deploy flow (`fly deploy`) in `docs/deployment.md`, and add a GitHub Actions workflow that runs lint/typecheck/test before allowing a deploy, if not already present
- [ ] Explicitly verify long-lived SSE streams survive Fly's proxy without being buffered or killed early, with a manual two-browser-window live draft/chat test against the deployed URL — this is exactly the thing that would silently break on the wrong host or behind a misconfigured proxy buffer, so don't just assume it works
- [ ] Record the Fly.io-over-Vercel reasoning inline (e.g. `docs/decisions/hosting.md`) so it reads as a deliberate call tied to Phase 1's Redis Streams/SSE choice, not a default

### Verification
```bash
docker build -t fantasy-app .
fly deploy --config fly.toml
curl https://<app>.fly.dev/api/health
# manual: two-browser-window live draft/chat test against the deployed URL (same check as Phase 1 Step 4, now against real infra)
```

### Exit criteria
- The app is reachable at a real public URL, not just localhost
- `/api/health` correctly reports DB connectivity status
- A live draft and chat session works correctly between two real (non-localhost) clients against the deployed instance
- No secrets are committed to the repository; all are sourced from Fly secrets/environment variables

### Rollback
Fly supports rollback to the previous release image (`fly releases`, `fly deploy --image <previous>`); tag the previous working release before every deploy so this is always available.

---

## Step 10 — Observability: structured logging, error tracking & uptime monitoring

**Model tier:** default
**Depends on:** Step 9
**Parallel with:** Step 11

### Context brief
A review (scaling review I9) found the only instrumentation anywhere across all 8 phases is AI-specific cost metering and a basic DB-connectivity health check — no error tracking, no APM, no external uptime monitoring, no alerting, no structured logging. This step wires in the baseline every later phase (and Step 13's load test) needs to actually observe what's happening, using Step 9's deployed environment as the target for the externally-facing pieces.

### Tasks
- [ ] Add structured logging (JSON logs, not console.log strings) across API routes, Step 7's ingestion worker, and the draft session store, with a trace-ID convention: generate/propagate a request-scoped ID through each log line so a single request or draft action can be followed across log entries
- [ ] Integrate an error-tracking service (e.g. Sentry) capturing unhandled exceptions server- and client-side, tagged with the trace ID above
- [ ] Add external uptime monitoring (a third-party or self-hosted checker) polling the Step 9 `/api/health` endpoint from outside the deployed environment, with alerting on failure — **update the monitored endpoint when Step 12 splits health checks into liveness/readiness**, so this monitor ends up pointed at the readiness endpoint, not the interim one
- [ ] Build a golden-signals dashboard (whatever the chosen provider supports — Grafana, the error tracker's own dashboarding, or a managed metrics vendor) surfacing: SSE connection count, Redis stream lag, DB pool utilization (PgBouncer's own stats), p95 request latency, and active-draft count
- [ ] Wire alerting for at least the highest-signal conditions: error-tracking spike, uptime-check failure, DB pool exhaustion
- [ ] Document the observability stack choice and alert thresholds in `docs/decisions/observability.md`

### Verification
```bash
npm test -- src/lib/logging
npm run lint
npm run typecheck
# manual: trigger a deliberate error in a dev/staging deploy, confirm it appears in the error tracker with the correct trace ID
```

### Exit criteria
- A request can be traced end-to-end through structured logs via its trace ID
- A deliberately triggered error appears in the error-tracking dashboard within a reasonable delay
- The uptime monitor correctly alerts when the health endpoint is taken down (verified by a manual/staged test)
- The golden-signals dashboard renders all five named metrics with real (not placeholder) data

### Rollback
Purely additive instrumentation — logging/error-tracking/monitoring can be disabled via config without touching application logic.

---

## Step 11 — Auth/session security hardening

**Model tier:** default
**Depends on:** Step 4, Step 5, Step 9
**Parallel with:** nothing directly, but Step 10 and Step 12 don't block on this beyond what's noted in their own dependencies

### Context brief
Scoped deliberately narrow for this phase: baseline hardening appropriate before any real user credentials exist in production, not full production security theater. Rate limiting, CSRF protection, and secure cookie flags — not a WAF, not a formal pen test, not a bug bounty program. **Fix (I7):** an earlier revision of this step deferred that broader scope to an unnamed "future, dedicated security-hardening phase" that a review found was never actually created anywhere in the 8-phase plan — a promise with nothing behind it. That scope now explicitly belongs to **Phase 8's go-live checklist**, named directly rather than gestured at. The part of that same finding that *was* buildable now — general API rate limiting beyond just these auth endpoints — is built in Step 12, which generalizes this step's rate limiter rather than duplicating it.

### Tasks
- [ ] Add rate limiting to sign-up, log-in, and any password-related endpoints — a token-bucket or sliding-window limiter keyed by IP and by email, backed by Postgres or an in-memory store appropriate at this scale (don't introduce Redis solely for this unless it's already justified elsewhere — avoid over-engineering). **Note for Step 12:** implement this as a reusable limiter function/middleware, not endpoint-specific inline logic, since Step 12 generalizes this exact pattern repo-wide rather than building a second one
- [ ] Add CSRF protection to all state-changing auth and account routes, using whatever CSRF pattern the Step 4 auth library already supports natively before hand-rolling one
- [ ] Set secure session cookie flags for production — `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict` where it doesn't break legitimate flows) — and verify this specifically against the Step 9 deployed (HTTPS) environment, since cookie behavior differs under plain HTTP
- [ ] Add brute-force lockout/backoff on repeated failed logins for a single account, independent of IP-based limiting, since IP limiting alone doesn't stop a distributed attempt against one account
- [ ] Write tests proving: rate limiting triggers past its threshold, a request without a valid CSRF token is rejected, and session cookies carry the correct flags in a production-mode build
- [ ] Explicitly document what's out of scope rather than silently omitting it: full WAF/DDoS protection, formal penetration testing, and a bug bounty program are deferred to **Phase 8's go-live checklist** (not a phantom future phase — see the fix note above)

### Verification
```bash
npm test -- security
npm run lint
npm run typecheck
# manual: script >threshold rapid login attempts against the Step 9 deployed instance, confirm rate limiting engages
```

### Exit criteria
- Automated tests prove rate limiting, CSRF rejection, and secure cookie flags all function correctly
- A scripted brute-force attempt against a single account is measurably slowed or blocked, not allowed at full speed
- Deferred security items are explicitly documented as belonging to Phase 8's go-live checklist, not just absent from the codebase

### Rollback
Each control (rate limiter, CSRF middleware, cookie flags, lockout logic) is independently toggleable — revert the specific control causing trouble rather than the whole step if only one misbehaves.

---

## Step 12 — Deployment hardening: graceful shutdown, health checks, CDN & general rate limiting

**Model tier:** default
**Depends on:** Step 9, Step 11
**Parallel with:** Step 10

### Context brief
Three related findings from the scaling review land together here because they're all "make the deployed environment actually production-shaped" work that extends Step 9 and Step 11 rather than duplicating either: **I5** (no graceful SIGTERM handling, and a health check blind to a dead Redis connection), **I4** (no CDN in front of static assets, and single-region-as-a-single-failure-domain never acknowledged), and the buildable half of **I7** (no general API rate limiting beyond the auth endpoints Step 11 covers).

### Tasks
- [ ] Add graceful SIGTERM handling: on receiving SIGTERM, stop accepting new connections, allow in-flight requests and open SSE streams a bounded drain window to finish, then exit — a review found a rolling deploy currently drops every live SSE connection and, per Step 2's per-draft locking, could abandon an in-progress draft write mid-transaction without this
- [ ] Split the Step 9 `/api/health` endpoint into **liveness** (process is up, no dependency checks — used for restart decisions) and **readiness** (DB via PgBouncer, and Redis, both reachable — used to decide whether to route traffic to this instance); a review found the original single health check only verified DB connectivity and was blind to a dead Redis connection, the most likely partial failure
- [ ] Update Step 9's `fly.toml` (or equivalent) to use the new readiness endpoint for traffic routing and the liveness endpoint for restart/crash detection; update Step 10's uptime monitor to point at the readiness endpoint
- [ ] Put a CDN in front of all static assets (Next.js's static build output, and any uploaded avatar/media assets from Step 15/Step 16) — this also functions as a basic edge/DDoS layer for those routes, addressing I7's edge-protection half
- [ ] Write a short decision note acknowledging single-region deployment as an accepted risk for now (multi-region Postgres is out of scope), including a documented, even if manual, region-failure playbook — matching I4's finding that this tradeoff was never acknowledged anywhere
- [ ] Generalize Step 11's auth-endpoint rate limiter into repo-wide middleware: a Redis-backed rate limiter (token-bucket or sliding-window, reusing the pattern Step 11 already established rather than inventing a second one) applied to all API routes, not just auth, plus a per-user/per-IP concurrent-SSE-connection cap
- [ ] Write tests proving: the readiness endpoint correctly reports unhealthy when Redis is unreachable (simulate), the rate limiter rejects past its threshold on a non-auth route, and a SIGTERM sent mid-request allows that request to complete before the process exits (an integration test against a real signal, not a mock)

### Verification
```bash
npm test -- src/middleware/rate-limit
npm test -- src/api/health
npm run lint
npm run typecheck
# manual: send SIGTERM to a running dev server mid-request, confirm graceful drain in logs
```

### Exit criteria
- The readiness endpoint correctly fails when Redis is down while liveness stays healthy, verified by a test
- A SIGTERM during an in-flight request/SSE stream results in a clean drain, not a dropped connection, verified by a test
- Rate limiting is verified to function on a non-auth API route
- Static assets are served through the CDN in the deployed environment, verified by checking response headers against the deployed URL
- The single-region risk-acceptance note exists and includes a manual failover playbook

### Rollback
Each control (SIGTERM handler, split health checks, CDN, rate-limit middleware) is independently toggleable, matching Step 11's existing per-control rollback pattern — revert the specific control causing trouble.

---

## Step 13 — Load testing: named Sunday-concurrency scenarios

**Model tier:** default
**Depends on:** Step 2, Step 3, Step 7, Step 9, Step 10, Step 12
**Parallel with:** nothing — this is the closing step in this phase and needs everything above it done to produce a meaningful result

### Context brief
A review (scaling review C2) found no load testing exists in any phase: the entire concurrency evidence base for the whole product is a two-client integration test and a manual two-browser check, and Phase 1's ~200ms fan-out latency claim is asserted, never measured. This step is placed last in this phase deliberately, since it's the proof that validates every other step above actually holds up under load rather than just under a unit test — and per the roadmap, it's re-run again as a Phase 8 go-live gate before real money is at stake.

### Tasks
- [ ] Choose a load-testing tool (e.g. k6 or Artillery) and add it as a dev/CI-only dependency, with config-driven scenario definitions (no hardcoded target URLs — point at local, staging, or the Step 9 deployed environment via env var)
- [ ] Define and implement named scenarios matching the review's list: **(1) Sunday live-scoring ramp** — simulate concurrent SSE connections ramping toward 10,000, reading Step 7's score-update stream; **(2) 200 simultaneous live drafts**, each with realistic pick cadence, exercising Step 2's per-draft locking under real concurrency; **(3) reconnect storm** — a large batch of clients disconnecting and reconnecting within a short window, exercising `Last-Event-ID` resume; **(4) an AI-moderator burst**, reusing Phase 1 Step 6's mechanical fallback path under concurrent drafts (real AI production inference load is Phase 6's concern; this scenario proves the mechanical auto-pick path holds up, not the LLM path)
- [ ] Define explicit pass/fail thresholds per scenario in config, not as magic numbers buried in a script — e.g. p95 fan-out latency under 200ms, zero dropped SSE connections during the reconnect storm beyond the deliberate disconnect, zero double-applied draft actions under the 200-draft scenario, DB pool utilization staying under a defined ceiling
- [ ] Run each scenario against a staging-equivalent environment (Step 9's deployed infra, not localhost) and record the results
- [ ] Fix or file explicit follow-up work for any threshold miss before considering this step complete — a load test that runs and is ignored is equivalent to not having one
- [ ] Record results in `docs/decisions/load-test-results.md`, including the measured (not asserted) fan-out latency Phase 1 originally claimed, so that claim is now backed by evidence
- [ ] Wire the same scenarios into CI as an on-demand (not per-PR, given cost/time) workflow, and explicitly document them as the gate to be re-run before Phase 8's go-live sign-off

### Verification
```bash
npm run load-test -- --scenario=sunday-ramp
npm run load-test -- --scenario=concurrent-drafts
npm run load-test -- --scenario=reconnect-storm
npm run load-test -- --scenario=ai-burst
```

### Exit criteria
- All four named scenarios run against the deployed Step 9 environment with recorded, timestamped results
- Every defined pass/fail threshold is met, or has an explicit documented follow-up if not — this step does not silently ship a known failure
- The Phase 1 ~200ms fan-out latency claim is now backed by a measured result, not just asserted
- The load-test workflow is callable on demand from CI and documented as the Phase 8 go-live re-run gate

### Rollback
Test tooling and scenario scripts only — no application code changes; safe to remove without affecting the running app.

---

## Step 14 — First-run onboarding flow

**Model tier:** default
**Depends on:** Step 5, Step 8
**Parallel with:** Step 15, Step 16, Step 17

### Context brief
A review (UX review C5) found the plan assumed total fantasy fluency and, as originally written, had no first-run onboarding at all. Phase 1's Step 7 already fixed the narrower half of this finding (a commissioner can now actually create a league in under a minute via sensible defaults), but a full onboarding fork — branching by experience level, surfacing the invite mechanism, and coaching a brand-new user through their first empty states — was never built anywhere. This step builds that fuller flow, landing a freshly-signed-up user (Step 4/Step 5) somewhere better than a bare Step 8 dashboard with zero leagues.

### Tasks
- [ ] Build a first-run fork immediately after sign-up: ask the user's self-reported experience level (`User.experienceTier`, the field Phase 1 Step 1 already defined and Phase 1 Step 10 already filters public leagues on) and branch the guidance shown next accordingly — a first-timer sees a short explainer of how a draft/league works, an experienced user skips straight to action
- [ ] Surface both paths a new user actually has next, using components already built rather than inventing new ones: create a league (Phase 1 Step 7's flow) or join one via an invite link/code (also Step 7) or browse public leagues (Phase 1 Step 10) — this step is a routing/coaching layer over existing flows, not a rebuild of any of them
- [ ] Extend Step 8's zero-leagues dashboard empty state (already the UX review's own template example of doing this right) with the onboarding fork's guidance, rather than treating them as two disconnected features
- [ ] Add a lightweight, skippable interactive walkthrough or annotated tour of the draft room's key controls (pick clock, queue, chat) shown the first time a user enters any draft room, dismissible and never shown again after the first dismissal (state persisted per user)
- [ ] Apply Phase 1 Step 1's design-system standing rule to this flow explicitly: loading/empty/error states designed, an a11y pass, keyboard-only completability, plain-language copy review
- [ ] Write tests proving: a new first-timer user sees the guided path, a new experienced user sees the fast path, and the draft-room tour is shown exactly once per user

### Verification
```bash
npm test -- src/onboarding
npm run lint
npm run typecheck
npm run dev   # manual: sign up as a fresh user, walk both experience-tier branches
```

### Exit criteria
- A brand-new user reaches either "create," "join via invite," or "browse public leagues" within the onboarding fork without needing outside explanation
- The draft-room tour is shown exactly once per user, verified by a test
- The flow passes the same design-review/a11y/copy-review bar Phase 1's standing rule requires of every user-visible surface

### Rollback
Additive routing/coaching layer over existing Phase 1 Step 7/Step 10 flows and Step 8's dashboard — safe to revert without touching any of those underlying features.

---

## Step 15 — Avatar & profile customization

**Model tier:** default
**Depends on:** Step 4
**Parallel with:** Step 14, Step 16, Step 17

### Context brief
A review (UX review I3) found avatar/profile customization was never scheduled anywhere, despite being, in the review's own words, "the cheapest identity/delight lever available in a social product where users stare at opponents' names all season." This step adds it directly to the Step 4 `User` model.

### Tasks
- [ ] Add an `avatarUrl` field (plus a small set of preset built-in avatar options requiring no upload) to the Step 4 `User` schema
- [ ] Build upload support for a custom avatar image: client-side crop/resize, server-side validation (file type, size limit — config-driven, not a magic number), storage in an object store (colocated with, and served through, Step 12's CDN rather than the app server)
- [ ] Provide a curated set of preset avatars/mascots as a zero-effort default option, so a user isn't forced through an upload flow just to have an identity
- [ ] Render the chosen avatar everywhere a user's identity currently shows as text-only: dashboard, draft room seats, chat, standings, the review feed (Step 17) — audit these call sites explicitly, matching the audit-list pattern Step 5's retrofit uses
- [ ] Apply Phase 1 Step 1's design-system standing rule: loading/error states for avatar upload/display, a11y (alt text, keyboard-operable upload control), copy review
- [ ] Write tests proving: an oversized/wrong-type upload is rejected with a clear error, a valid upload round-trips and displays correctly, and a user with no chosen avatar falls back to a sensible default (never a broken image)

### Verification
```bash
npm test -- src/profile
npm run lint
npm run typecheck
```

### Exit criteria
- A user can select a preset avatar or upload a custom one, and it renders correctly across every surface audited above
- Invalid uploads are rejected with a clear, user-facing error, not a silent failure or raw error code
- Every user always renders with some avatar (preset default, chosen preset, or upload) — never a blank/broken image state

### Rollback
Additive field + UI on the Step 4 `User` model — a null/missing `avatarUrl` already falls back to the default, so this is safe to disable without breaking identity display elsewhere.

---

## Step 16 — Chat depth: GIFs & voice messages

**Model tier:** default
**Depends on:** Step 5
**Parallel with:** Step 14, Step 15, Step 17

### Context brief
A review (UX review I2) found the strategy doc names GIFs and voice in chat four separate times as a differentiator, and Phase 1 Step 8 quietly reduced this to text + emoji reactions with no later phase ever picking the deferred scope back up. This step is that pickup, extending Phase 1 Step 8's chat rather than rebuilding it.

### Tasks
- [ ] Add a `GifProvider` adapter interface (mirroring the `StatsProvider` pattern from Step 6 — config over hardcoding, one seam, not a direct third-party call scattered through UI code), backed by a real GIF search API (e.g. Giphy or Tenor) behind an API-key env var, with a clear typed error if unconfigured rather than a broken search box
- [ ] Add a GIF picker to the chat composer (search, preview, send), rendering the sent GIF inline in the message stream via the existing chat event type taxonomy (add `chat.gif` per `docs/conventions.md`'s convention, reusing Phase 1 Step 8's SSE delivery, not a new transport)
- [ ] Add voice messages: client-side recording (with a clear permission-request UX, not a silent browser prompt), upload to the same object store Step 15 uses, a waveform-or-duration-only player in the message stream, server-side size/duration limits (config-driven)
- [ ] Add a `chat.voice` event type to the taxonomy alongside `chat.gif`
- [ ] Apply Phase 1 Step 1's design-system standing rule: loading state while a GIF search or voice upload is in flight, an error state if either fails (with a retry, not a dead end), a11y (captions/transcripts are explicitly out of scope for this prototype step — note that deferral rather than silently omitting it), keyboard operability for the GIF picker
- [ ] Write tests proving: a GIF search-and-send round-trips through the two-SSE-client pattern Phase 1 Step 8 established, a voice message round-trips the same way, and chat degrades to text-only (not broken) if `GifProvider` is unconfigured

### Verification
```bash
npm test -- src/chat
npm run lint
npm run typecheck
```

### Exit criteria
- Two connected clients see a sent GIF and a sent voice message in real time, verified by an automated two-SSE-client test matching Phase 1 Step 8's existing pattern
- Chat remains fully functional (text + emoji) if the GIF provider is unconfigured, verified by a test
- Voice messages respect a documented size/duration limit, enforced server-side, not just in the UI

### Rollback
Additive message types and composer affordances on top of Phase 1 Step 8's existing chat — reverting removes the GIF/voice UI and event types without touching text chat or reactions.

---

## Step 17 — In-product unfiltered review feed

**Model tier:** default
**Depends on:** Step 4
**Parallel with:** Step 14, Step 15, Step 16

### Context brief
A review (UX review C7) found the strategy doc names an unfiltered, embedded review feed three separate times as a direct trust-signal counter to Apex's curated testimonials page, and no phase ever scheduled it. The whole point is that it's unfiltered by rating — a curated/cherry-picked version would defeat the trust signal it's meant to create.

### Tasks
- [ ] Define a `Review` model: authenticated author (Step 4's `User`), rating, text body, created_at — one review per user, config-driven (allow edits to an existing review rather than unlimited duplicates, not a hardcoded assumption)
- [ ] Build a review-submission form, gated behind `requireAuth()` (Step 4), with plain-language validation (minimum/maximum length, no raw error codes)
- [ ] Build the public feed view: sorted newest-first, no editorial filter on rating — every submitted review appears, including negative ones, by design
- [ ] Add moderation limited strictly to spam/abuse, not rating-based curation: a report affordance, an admin removal action, and log every removal (author, moderator, reason, timestamp) — reuse Step 10's structured logging for this rather than building a separate audit system, since Phase 3 owns the full audit-log infrastructure and this is a lightweight interim, not a duplicate of that later work
- [ ] Render the reviewer's avatar (Step 15) and display name next to their review
- [ ] Apply Phase 1 Step 1's design-system standing rule: loading/empty/error states (an empty feed needs a real empty state, not a blank page), a11y, copy review
- [ ] Write tests proving: a submitted review appears in the feed regardless of its rating (including a 1-star review), a removed review is excluded from the public feed but its removal is logged, and a user cannot submit more than the configured number of reviews without going through the edit path

### Verification
```bash
npm test -- src/reviews
npm run lint
npm run typecheck
npm run dev   # manual: submit a negative review, confirm it appears unfiltered in the feed
```

### Exit criteria
- A negative (low-rating) review appears in the public feed exactly like a positive one — verified by a test asserting no rating-based filtering exists in the feed query
- Spam/abuse removal is logged with author, moderator, reason, and timestamp
- The feed's empty state, loading state, and error state are all designed, not just the happy path

### Rollback
Standalone new feature/table — safe to revert without affecting accounts, leagues, or chat.

---

## Post-Phase

Once this phase is complete, real authenticated user identity exists and is threaded through every Phase 1 feature; persistence is production-grade — indexed, connection-pooled, safe under multi-instance concurrent writes, backed up with a drilled restore path, and cached where reads are heavy; a live-scoring ingestion pipeline is built and proven against the mock provider, ready for a real vendor swap; the deployed environment is observable, gracefully drainable, and fronted by a CDN; a load test has produced recorded, evidence-backed concurrency numbers rather than an asserted claim; and a first round of product/UX gaps a review found silently dropped (onboarding, avatars, chat depth, the review feed) are shipped. **Phase 3 (Trust & Integrity) builds directly on this phase's real accounts** — see "A note on what this phase unblocks" above — and should not begin until Steps 4 and 5 here are solid, since its multi-account detection work has nothing meaningful to correlate against otherwise. **Phase 4 (Payments) additionally depends on this phase's Step 2 (data-layer/rollup convention) and Step 3 (backups/DR) being solid** before real money is introduced, per the scaling review's explicit sequencing requirement.
