# Phase 3 — Plan split

**Spec:** `plans/phase-3-trust-and-integrity.md` (6 steps)
**Roadmap:** `plans/00-roadmap.md` — Phase 3 must land before Phase 4, because money and anti-collusion tooling ship together.
**Written:** 2026-08-20, on `main` at `e0cce93` (Phase 2 Plans A, B and C merged; Plan D founder-gated and still pending).

This file does one job: it says which of Phase 3's 6 steps land in which plan, which Phase 2 residuals each plan absorbs, and what the founder has to decide before a plan can finish. It is not itself an implementation plan. Each plan gets its own file written in full writing-plans discipline when its turn comes.

**Nothing below assumes Phase 2 Plan D landed.** Every plan here is buildable, testable and mergeable against `docker-compose.yml` alone. Where a surface would be better with deployed infra, the plan ships the local-only form and the gate is named in the founder-gated bucket at the end — the same discipline Plan A used for the Tank01 key and Plan C used for the GIF key.

---

## First: what Phase 1 and Phase 2 already delivered

The Phase 3 spec was drafted in August against a Phase 1 that had not been built and a Phase 2 that had not been scoped. Six of its assumptions are already satisfied, three are satisfied *differently* than the spec words them, and three of its preconditions **do not exist at all**. All twelve are stated here rather than being quietly re-done or quietly skipped.

### Already satisfied

| Spec item | Status | Evidence in the codebase today |
|---|---|---|
| **Step 1 — "Drizzle schema for `audit_events` (SQLite)"** | **Satisfied differently.** SQLite was never shipped. | `docs/conventions.md` pins Postgres 17 via `drizzle-orm/postgres-js` through PgBouncer in transaction pooling mode. `audit_events` is a `pg-core` table with `BEFORE UPDATE`/`BEFORE DELETE` triggers (a Postgres trigger function, not a SQLite trigger) and Postgres composite indexes. The pooler constraint binds it: no `pg_advisory_lock`, no session `SET`, no `LISTEN`/`NOTIFY` in the verification job. |
| **Step 1 — the append-only, tamper-evident pattern** | **Precedented three times over.** | `draft_actions` is already the one true append-only log (`bigserial` id, `sequence` int with `uniqueIndex(draftId, sequence)` as a DB-level backstop against concurrent appends, `jsonb` payload, explicit clock-injected `timestamp` — this is the shape `audit_events` should copy, including the unique-sequence backstop). `reviews` removal is a stamp, never a delete, with the no-re-stamp invariant in the `UPDATE`'s own `WHERE removed_at IS NULL`. `review_reports` is insert-only on its composite PK. `src/db/schema.ts:506` says outright: *"Phase 3 owns the real audit log."* |
| **Step 1 — the transaction discipline for the verification checkpoint** | **Already written down, and written down *because of this step*.** | `docs/decisions/data-layer-hardening.md`'s balance-as-rollup convention: a running total over an unbounded append-only source is a rollup row updated **in the same transaction** as the write it summarizes, never a `SUM()` on the read path, and the append-only table stays the reconciliation source of truth. Its own rationale names this phase: *"Phase 4 introduces a payment ledger and Phase 3 an audit log, and both are the shape that invites `SELECT sum(amount)` on every read. Writing the convention after those tables exist means retrofitting it."* `audit_chain_checkpoint` is a rollup by that definition and inherits the rule. |
| **Step 1 — the notification vocabulary** | **The catalog exists; the sender does not.** | `NOTIFICATION_CATALOG`, `NotificationChannel`, `channelStatus()` and `deliverableChannels()` (`src/identity/notifications.ts`) are four topics in plain language, each naming the real `RealtimeEventType`s that fire it, and `notifications.test.ts` checks the catalog against the runtime `REALTIME_EVENT_TYPES` array so a topic can never describe a notification the product does not publish. `notifyAffectedMember` extends this, it does not invent it. `channelStatus.email` is `"not-connected"` and stays that way until Phase 2 Plan D ships a sender. |
| **Step 3 — "reuse the existing analyzer, do not reimplement it"** | **Structurally guaranteed already.** | `tradeBalance(giving, receiving)` (`src/ai-advisor/valuation.ts`) is a pure, deterministic, LLM-free function that takes two valued sides and nothing else. `docs/advisor.md` already calls it *"the platform's trade-fairness / collusion detector, not an advisor helper"*, and `src/ai-advisor/trade.ts:48` names this phase: *"the same pure function the platform's later collusion/trade-fairness sweep runs."* Its `flags` (`empty_side`, `uneven_player_count`, `value_gap_over_threshold`) are machine-readable reasons designed for exactly this escalation. Step 3's "only one function computes trade fairness" exit criterion is satisfied by construction. |
| **Step 5 — the public/private discriminator** | **Exists, with an index built on it.** | `leagues.is_public_matchmade` (boolean, notNull, default false, `drizzle/0010`), plus the partial index `leagues_public_browse_idx` on `createdAt WHERE is_public_matchmade`. Step 5's matched public-vs-private test pair has a real flag to flip. |
| **Step 5 — the eligibility rules to reuse for invalid roster moves** | **Exists, 100% covered, and already enforced at one seam.** | `src/league/` owns lineup eligibility; `setLineup` (`src/league-service/lineups.ts`) is the only member-facing roster write and already takes `FOR SHARE` on the `stat_weeks` row to close a read-validate-write hole against the ingestion worker. |
| **Step 5 — "the missed lineup deadline"** | **Already a defined moment.** | Phase 2 Plan B made lineups lock at kickoff for the whole week, warned in advance (`src/league/week-status.ts`, `isWeekLocked`). Step 5's auto-set has a precise trigger instead of needing to invent one. |
| **Step 6 — the matchmaking filter to extend** | **Exists on both sides of the wire.** | `src/matchmaking/` (`normalizeBrowseFilter`, `matchesBrowseFilter`, `hasOpenSeat`, `stakeTierLabel`, `MATCHMAKING_CONFIG`, `PublicLeagueSummary`) is pure, browser-safe and 100% covered; the SQL half is `browseQuery`/`listPublicLeagues` (`src/league-service/browse.ts`) served by the partial index. `PublicLeagueSummary` is the field-by-field privacy boundary of the app's one unauthenticated league read, so a tier label added to browse has an existing contract to be added to rather than a new one to invent. |
| **Step 6 — the enforcement point for a tier-blocked join** | **Named and isolated.** | `publicJoinPrecondition` (`src/league-service/join.ts`) is the gate `joinPublicLeague` runs before `joinLeagueInTx`; it already answers 404 rather than 403 for a non-public league to avoid an existence oracle. The tier block is one more precondition there, not a new join path — and it must keep the non-oracle discipline. |
| **Step 6 — the tier vocabulary** | **Two enums already ship it as a label.** | `experience_tier` (`beginner` \| `experienced`) is on **both** `users` (self-reported at sign-up, editable via `PATCH /api/profile`) and `leagues` (self-declared per league, read by the browse filter and rendered on `/browse`). `EXPERIENCE_TIER_LABEL` (`src/identity/config.ts`) is the one copy vocabulary. What ships today is the *label*; what does not is anything computed, verified, or enforced. See the collision warning below. |
| **Step 1's "one file for every threshold"** | **Satisfied differently, by a stronger convention.** | There is no `src/config/` directory and there will not be one. The repo convention is a `config.ts` colocated with the module that consumes it, exporting one documented SCREAMING_SNAKE object — 22 of them today (`LEAGUE_CONFIG`, `CHAT_CONFIG`, `MATCHMAKING_CONFIG`, `STATS_INGESTION_CONFIG`, …). Phase 3 ships **`src/integrity/config.ts` exporting `INTEGRITY_CONFIG`**, which satisfies the spec's actual requirement (one documented home, no inline magic numbers) without forking the convention. Every threshold the spec names as `src/config/integrity.ts` means a field on `INTEGRITY_CONFIG`. |

### Three preconditions the spec assumes and the product does not have

These are not scope creep. Each one is load-bearing for a step the spec has already committed to, and each is absorbed by a named plan below rather than discovered mid-execution.

| Missing precondition | Which step needs it | What actually exists |
|---|---|---|
| **A trade.** No `trades`/`trade_proposals` table, no propose/accept/reject path, no execution. | Step 3 subscribes to `TRADE_ACCEPTED`. Step 5 auto-**holds** a trade. Neither can exist. | `TradeProposal`/`TradeSide`/`isBalancedProposal` (`src/domain/trade.ts`), whose own docblock says *"Nothing in this phase executes one — no table stores it, no service applies it."* `plans/phase-9-dynasty-and-keeper-depth.md` Step 3 states the gap plainly: *"Phase 3 Step 3 subscribes to a `TRADE_ACCEPTED` audit event and assumes a trade accept/reject flow already exists somewhere. Neither Phase 1 nor Phase 3 ever actually builds it."* Phase 9 is four phases away and Phase 3 must precede Phase 4. **Plan C builds the general trade path** (players only; Phase 9 adds pick assets as a case, not a fork). |
| **An admin role.** No `isAdmin`, no `requireAdmin`, no `/admin` route, no permission helper anywhere in `src/`, `drizzle/` or `scripts/`. | Step 4 gates the whole dashboard on it. | Deliberately absent, three times cited as "ruling 18". The only authz axis beyond league membership is `leagues.commissioner_user_id`, checked by plain equality. Even `scripts/remove-review.ts --by <operatorUserId>` takes an arbitrary id with nothing to verify it against. **Plan B builds the role**, minimal boolean, no RBAC framework, per the spec's own out-of-scope list. |
| **A per-user notification delivery path.** All 10 `REALTIME_EVENT_TYPES` are league-**broadcast**; there is no user-targeted event and no persisted notification row. | Step 1's `notifyAffectedMember`, called by Steps 4, 5 and 6. | The realtime layer (`src/lib/realtime/`) delivers to everyone subscribed to `league:<id>:events`. A member-affecting integrity notice cannot ride that: a trade held for fairness review must not broadcast to the league. **Plan A builds the durable per-user notification row plus one new registered event type**, and `notifications.test.ts` will force it to be registered properly rather than smuggled in. |

### Two naming collisions that must be resolved before code, not after

1. **`experienceTier` already means two different things and Step 6 adds a third.** `users.experience_tier` is a self-reported, unverified sign-up answer that drives `helpLevel` defaults and first-run path ordering. `leagues.experience_tier` is a self-declared league label rendered on public browse. Step 6's tier is a *computed, enforced* participation fact. Three meanings on one word, one of which blocks a join, is how a future reader ships the wrong one. Plan D names the computed one distinctly (e.g. `participationTier` / `PARTICIPATION_TIER`) and states the relationship between all three in `docs/decisions/`. The spec's `NEW`/`EXPERIENCED` casing also does not match the shipped `beginner`/`experienced` enum; the shipped spelling wins.
2. **`src/integrity/notifications.ts` versus `src/identity/notifications.ts`.** Both will exist. `identity` owns the descriptive catalog a user reads on their profile; `integrity` owns the copy templates for system-triggered actions. Plan A states the division in one docblock on each, and the denylist test the spec asks for lives with the templates.

---

## The split

Four sequential plans. The ordering rule is **never ship a detector before its consumer**: a `PENDING_REVIEW` flag with no queue to land in, or an event type nothing publishes, is the inert-deliverable class this loop has now caught five times. Each plan below is mergeable on its own and leaves the product observably better for a real user on the day it merges.

---

### Plan A — The audit spine and the league activity feed

**Spec steps:** **1** in full, plus the **member-visible half of Step 4** (the league activity feed).

**One-line scope:** the tamper-evident `audit_events` chain, the `AuditLogger` that is the only way to write it, checkpointed and full-walk verification, the per-user notification primitive every later plan calls, `INTEGRITY_CONFIG`, and the member-facing activity feed that makes all of it visible to an ordinary league member the day it merges.

**Why the activity feed moves here from Step 4.** The spec files it under Step 4 because both are UI over the audit trail, but its dependency is Step 1 alone — it needs no flag, no admin role and no detector. Landing it here is what keeps Plan A from being pure infrastructure: strategy §4 promises members *"a transparent per-league audit log"*, and this is the plan that can deliver it. Step 4's admin queue and the allowlist test that compares the two views stay in Plan B, where the admin view exists to compare against.

**Task-shape sketch (~11 tasks):**
- The `AuditEvent` domain type and the canonical serialization, pure and clock-injected, with the genesis constant in `INTEGRITY_CONFIG`. Hash-chain construction tested before any persistence exists.
- `audit_events` migration: `pg-core` table, the two composite indexes the scaling review named (`(leagueId, occurredAt)`, `(actorId, eventType, occurredAt)`), the unique-sequence backstop `draft_actions` established, and the `BEFORE UPDATE`/`BEFORE DELETE` trigger function. Tested by raw SQL that bypasses Drizzle entirely.
- **The chain-scope ruling** (see risks): one global chain versus one chain per league, decided and recorded before `AuditLogger` is written.
- `AuditLogger.record` — the only exposed method, no update/delete/upsert, appended inside the caller's transaction.
- `verifyChainIntegrity` as a checkpointed incremental walk over an `audit_chain_checkpoint` rollup row, written per the balance-as-rollup convention; `verifyFullChainIntegrity` as a separate from-genesis walk, invoked by an operator script (`scripts/verify-audit-chain.ts`, mirroring `scripts/ingest-once.ts`), never on a request path.
- The incremental-behavior test the spec asks for: a call-count assertion proving only the new events were re-hashed.
- The subscriber layer, additive, wired into every mutation that exists today: draft-pick commit (`src/draft-service/commit.ts`), lineup writes (`setLineup`), seat creation (`joinLeagueInTx`/`acceptInvite`), and review removal (`removeReview`, whose `RemovalRecord` is a proto-audit-event already). **`TRADE_*` event types are defined and reserved, published by nobody until Plan C** — the same precedent `score.update` set when it stayed reserved through Phase 1 and was turned on in Phase 2 Plan B. Plan A's exit criteria must name Plan C as their consumer.
- `SESSION_STARTED`, recorded at `/callback` (`src/lib/auth/user-sync.ts`), the one place a sign-in is observable — there is no `sessions` table and there will not be one.
- The notification primitive: a durable per-user notification row, one newly registered `RealtimeEventType` for user-targeted delivery, `notifyAffectedMember(leagueId, userId, notificationType, context)`, the copy templates, and the accusatory-language denylist test.
- `/app/leagues/[leagueId]/activity` — the member feed, per-`eventType` field allowlist defined up front, reachable by any league member via `requireLeagueMember`, full loading/empty/error state coverage, a11y pass, 360px, **persona-panel step**.
- Docs sweep: `docs/decisions/audit-and-integrity.md` (the chain-scope ruling, the write-ordering ruling, the field allowlist), `conventions.md` directory map and coverage-gate count, `src/integrity` joins the gated dirs (14 → 15).

**Interfaces consumed from Phase 1/2:** `requireCurrentUser`/`getCurrentUser`, `requireLeagueMember`, the `Clock` seam, `createDb`/`createTestDb` and the `FOR UPDATE` transaction precedent, `getPublisher()`/`REALTIME_EVENT_TYPES`, `NOTIFICATION_CATALOG` and `deliverableChannels()`, `draft-service`'s commit seam, `league-service/lineups`, `review-service`'s `RemovalRecord`, the design-system primitives.

**Risks:**
- **Chain-head contention is the plan's central design risk.** `eventHash = sha256(previousEventHash + …)` makes every append serialize on one row. This codebase already holds `SELECT … FOR UPDATE` on a draft row per action and runs an ingestion worker that writes concurrently; a single global chain puts a second, cross-cutting serialization point in front of both and introduces a lock-ordering class the pooler cannot help with. A per-league chain (every event already carries `leagueId`) removes it, at the cost of a genesis per league and an extra chain for the league-less events (`SESSION_STARTED`, platform `ADMIN_ACTION`). Decide with a written ruling and a concurrency test, not by default.
- **Audit-write failure semantics are the opposite of the publish rule.** `docs/conventions.md` says publishing is best-effort and must never fail the write. An audit event must not be silently lost. Same flow, opposite requirement: the audit append goes *inside* the business transaction (fail together), while the notification and the realtime frame stay best-effort *after* it. Write it down; it is the rule every later plan copies.
- The `audit_events` table is the fastest-growing table in the system and lands before there is any retention or partitioning policy. The indexes are specified; the growth policy is not. Name it as a Phase 8 item rather than inventing one here.
- `notifications.test.ts` couples the catalog to `REALTIME_EVENT_TYPES`; adding a user-targeted event type without extending the catalog honestly will fail that test, which is the desired outcome, not an obstacle to route around.

**Prerequisites: none.** Local Postgres and Redis only.

---

### Plan B — The operator surface: detection, the dispute queue, and moderation

**Spec steps:** **2** (multi-account detection) and the **admin half of 4** (role, queue, resolution). Plus the Phase 2 moderation residuals that need exactly this role and this queue, and have been waiting for it by name.

**One-line scope:** the first authz axis beyond league membership, the review queue that turns a `PENDING_REVIEW` flag into a recorded decision, the multi-account detector that first fills it, and the three moderation gaps Phase 2 deliberately left for this phase — chat removal, the report queue's first consumer, and the post-window stat-correction operator path.

**Why moderation lands here and not in its own plan.** Phase 2 Plan C's ruling 18 refused to build a smaller moderation surface first *precisely so* it would not have to be reconciled with this one: *"building one here would mean building the thing Phase 3 already plans to own, then reconciling two of them."* Chat removal, review-report triage and flag resolution are the same three primitives — a role, a queue, a stamped irreversible decision written to the audit log — applied to three record types. Splitting them across plans is what produces two of them.

**Task-shape sketch (~14 tasks):**
- The minimal `isAdmin` boolean on `users` plus a `requireAdmin` seam beside `requireCurrentUser`, gating every route in this plan. Explicit test that a non-admin session reaches nothing. No RBAC framework, per the spec's out-of-scope list.
- Session/device signal capture: coarse self-reported client signals and the request IP recorded on the `SESSION_STARTED` event Plan A already writes. **No paid fingerprinting vendor** (spec's out-of-scope list).
- The three pure similarity heuristics as independently unit-tested functions with hand-computed expected values, then the weighted combination and `MULTI_ACCOUNT_FLAG_THRESHOLD`, all in `INTEGRITY_CONFIG`.
- The league-bounded comparison (never platform-wide), the `MultiAccountFlag` write at `PENDING_REVIEW`, and the `FLAG_RAISED` audit event.
- The flag-only contract test: no function in `src/integrity/**` reaches any account-action API — the same shape as `advisory-only.test.ts`, which already proves this class of constraint in this codebase.
- The known-false-positive tests (shared device, shared IP, family in one league) asserting a flag *is* produced and naming that as correct.
- `DisputeQueue` read model over every flag type, filtered by status, oldest-first; the admin list and detail views with full context and the relevant audit trail.
- `resolveFlag(flagId, decision, adminNote)` — fixed decision enum, one-way, only from `PENDING_REVIEW`, never mutating the flag or any audit record; every resolution writes its own `FLAG_RESOLVED` audit event.
- The allowlist proof the spec asks for: raw similarity scores present in the admin detail view, absent from Plan A's member activity feed over the same underlying events.
- **Residual — the review report queue's first consumer:** `review_reports` rows have been accumulating with nothing that reads them. They join the same queue as a flag type, and `removeReview` becomes an in-product resolution action instead of only `scripts/remove-review.ts`. The script stays (it is the pattern this tooling mirrors) but stops being the only path.
- **Residual — the chat content-removal path.** Larger than the review gap and named as such in `identity-and-trust.md`: a posted message or GIF cannot be deleted, hidden or reported by anyone. Ships as a report affordance plus a removal **stamp** on `chat_messages`, mirroring `reviews` exactly (author, text, remover, reason and time all preserved; the no-re-stamp guard in the `UPDATE`'s own `WHERE`), the removed state rendered rather than vanished, and the author told in the operator's own words. **Migration trap:** `chat_messages_league_id_idx` is hand-written with `INCLUDE (body)` because `drizzle-kit generate` silently drops the clause; any migration touching this table must be checked against `src/db/index-plans.test.ts`'s `pg_indexes` assertion.
- **Residual — the post-final stat-correction operator path.** Phase 2 Plan B's sweep covers the most recent settled week for 3 days (`STATS_INGESTION_CONFIG.correctionWindowDays`) and its ledger records that *"older revisions need Phase 3's operator path."* The machinery is already idempotent and recompute-and-overwrite — `persistTick`, `finalizeWeek` and the `stat_weeks.version` bump all exist and, in the decision doc's own words, were *"only missing a caller."* This is that caller: an audited, budget-reserving operator action to re-read a named settled week, with `SYSTEM_ACTION` on the audit trail and `notifyAffectedMember` for every manager whose settled result changed. A retroactive standings change that nobody is told about is the exact failure the notification primitive exists to prevent.
- Persona-panel step on the member-facing halves (the chat report affordance, the removed-message state, the correction notice). The admin views are operator surfaces, not persona surfaces.

**Interfaces consumed from Phase 1/2:** Plan A's `AuditLogger`, `notifyAffectedMember` and activity feed; `review-service` (`reportReview`, `removeReview`, `RemovalRecord`, `REMOVAL_REASON_VALUES`, `removalPhraseFor`); `chat-service` (`postMessage`, `listMessages`) and `src/chat` (`mergeMessages`, `ChatMessageView`, `CHAT_CONFIG`); `stats-pipeline` (`examinationWindow`, `correctionCandidate`, `persistTick`, `finalizeWeek`, the Redis budget ledger); `src/lib/auth/current-user.ts`; the rate-limit helpers in the four `_shared.ts` files.

**Risks:**
- **The IP signal is forgeable today, and the consequence here is worse than a bypassed rate limiter.** All four existing IP reads key on `X-Forwarded-For`, which their own docblock calls caller-controlled and rotatable; `identity-and-trust.md` records fixing it as LAUNCH-BLOCKING for Phase 2 Plan D. A rate limiter keyed on a forgeable header loses a speed bump. A *multi-account flag* keyed on one lets an attacker manufacture suspicion against another member's account. Ship the IP heuristic behind an `INTEGRITY_CONFIG` weight that is **zero until the platform-verified client IP exists**, with a test pinning that the device and behavioral signals alone can still cross the threshold, and record the flip as a Plan D release gate.
- `ACCOUNT_RESTRICTED` is in the spec's resolution enum, and nothing in this product can restrict an account. An enum value with no implementation is a control wired to nothing — the same class ruling 11 refused. Founder decision below; absent an answer, ship the enum without it.
- The false-positive cost is real and the spec is right to make it a code-level constraint rather than a policy note. The tests that assert flags fire for roommates must be named so no future reader "fixes" them.
- This plan adds the product's first admin surface. It is the highest-value target in the codebase and it is being built before Phase 2 Plan D's security hardening. Treat `requireAdmin` and the queue routes as a security-review surface in their own right.

**Prerequisites: none.** An admin account is seeded locally (`src/data/seed/`); production admin bootstrapping is a founder gate, not a build gate.

---

### Plan C — Trades: execution first, then fairness flagging

**Spec steps:** **3** in full, plus the trade-execution precondition Steps 3 and 5 both assume and no phase before Phase 9 ever builds.

**One-line scope:** the trade the product has been analyzing since Phase 1 but has never been able to make — propose, accept, reject, withdraw, and an atomic no-partial roster transfer — and then the automatic post-acceptance fairness flag that turns the existing `tradeBalance` into the platform's collusion detector without adding one line of scoring logic.

**Why trade execution is Phase 3's and not deferred to Phase 9.** Phase 9 is four phases out and gated behind Phases 4-8; Phase 3 must precede Phase 4. Shipping Step 3 without it produces a `TradeFairnessFlagService` subscribed to an event nothing publishes, and Step 5's auto-hold has nothing to hold. Phase 9's own plan already anticipates this ordering, building `executeTrade` behind a presence check *"since this phase may run before or after Phase 3."* Building the general path here, players-only, with `TradeAsset` shaped so Phase 9's `DraftPickAsset` is an added case rather than a fork, is what keeps there from being two trade systems.

**Task-shape sketch (~11 tasks):**
- Read `src/domain/trade.ts` and `src/ai-advisor/valuation.ts` and pin their exact exported shapes before writing a test. `TradeProposal` already exists as a pure type; this plan persists it, it does not redefine it.
- The `trade_proposals` migration and lifecycle status, following `draft_actions`' discipline: the proposal is the record, status transitions are appends where they can be, and every transition writes an audit event.
- Propose / withdraw / reject, each authenticated through the league membership seam with `teamId` resolved from the session, never from the body.
- `executeTrade` — one transaction, row-locked, all-or-nothing across both sides, reusing `src/league/`'s roster eligibility rather than re-deriving it; a simulated mid-flight failure rolls back both sides. Grep-verifiable as the only function that performs a trade roster swap.
- Interaction with the week lock and the ingestion worker: a trade landing mid-week against locked lineups and a live `stat_weeks` row is the same read-validate-write hazard `setLineup` already closes with `FOR SHARE`. Reuse that, do not invent a second answer.
- The `TRADE_PROPOSED`/`TRADE_ACCEPTED`/`TRADE_REJECTED` audit events Plan A reserved, now published.
- The trade UI: propose against a leaguemate's roster, review the existing advisor's verdict before accepting, act on an inbound proposal. Reuses `AdvisorPanel`'s existing surface rather than building a second one — and keeps the advisory-only constraint intact: the AI never accepts anything, a human does. Full state coverage, a11y, 360px, **persona-panel step**.
- `TradeFairnessFlagService` on the `TRADE_ACCEPTED` event, calling `tradeBalance` with system-supplied valuations, writing a `TradeFairnessFlag` at `PENDING_REVIEW` into Plan B's existing queue with the analyzer's own `flags` stored verbatim.
- The reuse-not-drift test: the same trade produces an identical verdict through the member-facing advisor route and through the automatic post-acceptance trigger.
- **The threshold-ordering task.** `ADVISOR_CONFIG` already carries `evenDelta` (3) and `lopsidedDelta` (12) on the value-gap scale, with deliberately lenient boundary semantics documented in `docs/advisor.md`. `TRADE_FAIRNESS_FLAG_THRESHOLD` and (in Plan D) `TRADE_AUTO_HOLD_THRESHOLD` sit on that same scale. That is four thresholds on one axis, and the spec only asks for an invariant test between two of them. Write the invariant across all four, in one place, failing loudly on any misordering.
- Docs: `docs/trades.md` or a section in `docs/advisor.md` — the one place the propose → analyze → accept → flag sequence is described end to end.

**Interfaces consumed from Phase 1/2:** `src/domain/trade.ts`; `tradeBalance`, `valuePlayers`, `assembleAdvisorContext`, `ADVISOR_CONFIG` and `AdvisorPanel`; `src/league/` roster eligibility; `roster_slots` writers in `draft-service/commit.ts` and `league-service`; `isWeekLocked`/`weekStatusFor`; Plan A's `AuditLogger` and `notifyAffectedMember`; Plan B's `DisputeQueue`.

**Risks:**
- **Scope creep in two directions.** Toward Phase 9 (draft-pick assets, dynasty, trade calculator) and toward general roster management (add/drop and waivers **do not exist in this product at all** — there is no free agency, a roster is fixed from draft to season end). Both stay out. But note the consequence for Plan A's event vocabulary: `ROSTER_MOVE` today means draft picks, lineup changes and trades, and nothing else. Say so in the type's docblock rather than letting a reader assume waivers are covered.
- **Step 3 evaluates post-acceptance; Step 5 must intercept pre-commit.** A trade that already completed cannot be "held." `docs/advisor.md` even describes the future sweep as running over every *proposed* trade. The resolution: evaluate inside the accept transaction, where a score at or beyond the auto-hold threshold sets a `HELD` status instead of executing, and a score merely past the flag threshold executes and flags after commit. Plan C must build the accept path with that seam already present, or Plan D has to reopen it.
- The advisory-only constraint (`advisory-only.test.ts` fails the build on any write verb under `src/ai-advisor/**`) means the flag writer lives outside that directory. That is correct and should stay enforced.
- Trades are the single largest new *product* surface in this phase, and every trade is a two-party negotiation about money-adjacent value. Persona weight is high; budget for a real panel round, not a checkbox.

**Prerequisites: none.**

---

### Plan D — Automated enforcement, participation tiers, and the commissioner's clock

**Spec steps:** **5** (automated rule enforcement for public leagues) and **6** (experience-tier segregation). Plus the Phase 2 commissioner-scheduling residuals, which are the same problem the spec is already solving, and the verified-played-here signal, which needs the same participation data Step 6 computes.

**One-line scope:** the platform acting as commissioner where no trustworthy human one exists — enforcing lineups, holding lopsided trades, starting drafts on time, and keeping newcomers out of veterans' public leagues — with every automated action audited *and* explained to the member it affected.

**Why the scheduling residuals belong here.** Strategy §4.1's premise for Step 5 is *"platform-owned commissioner functions for public leagues specifically… rather than handing commissioner powers to whichever stranger happened to create the league."* A public matchmade league has no one who will reliably press start. `drafts.kickoff_at` already exists but is auto-computed from `LEAGUE_CONFIG.defaults.draftDaysFromCreation` at creation, never chosen and never shown; `POST /api/drafts/[draftId]/start` exists, is commissioner-only and correct, and **no UI in the product calls it** — the route is reachable only by curl or `scripts/drive-dev-draft.ts`. Phase 2's persona panel filed this as a product gap: *"a joiner cannot learn when the draft is."* Making the draft start on time is the most mechanical platform-owned commissioner function there is.

**Task-shape sketch (~13 tasks):**
- The participation read model: a completed-league / completed-season count per account, derived from league and week state, the single source both the tier and the verified badge read. Recomputed on a defined trigger (public-league join attempt), not continuously.
- `computeParticipationTier(accountId)` and `EXPERIENCE_TIER_CONTEST_COUNT_CUTOFF` in `INTEGRITY_CONFIG`, one platform-wide constant with **no state-conditional branching**, documented as a conservative default rather than any one state's figure (TN: 51 vs 500+; MS: 1,000+). Boundary tests one below, exactly at, one above.
- The naming ruling and its doc entry: how the computed participation tier relates to `users.experience_tier` (self-reported, drives help level) and `leagues.experience_tier` (self-declared, drives browse). Three facts, three names, one document.
- Tier as a default always-visible browse filter and a visible per-league tier composition label, extending `matchmaking/filter.ts` and `PublicLeagueSummary` rather than building a parallel filter — and keeping the unauthenticated browse contract's privacy boundary intact.
- Enforcement at `publicJoinPrecondition`, keeping its non-oracle discipline, plus the `TIER_BLOCKED_JOIN` notification. Matched test proving private leagues are unaffected.
- `PublicLeagueEnforcementPolicy`, activating only on `is_public_matchmade`, with the matched public-vs-private test pair the spec requires.
- Missed-deadline lineup auto-set on the existing kickoff lock, strategy chosen by `MISSED_DEADLINE_LINEUP_STRATEGY`, reusing `src/league/`'s eligibility so the auto-set lineup is legal by construction.
- Trade auto-hold at `TRADE_AUTO_HOLD_THRESHOLD` through the seam Plan C left in the accept transaction, plus the invariant test extending Plan C's ordering assertion.
- Automatic rejection of mechanically invalid roster moves in public leagues, reusing the eligibility rules, with a clear user-facing reason.
- Every automated action: a `SYSTEM_ACTION` audit event with `actorType: SYSTEM` **and** a `notifyAffectedMember` call in the same flow, with the `LINEUP_AUTO_SET`, `TRADE_HELD_FOR_REVIEW` and `TIER_BLOCKED_JOIN` templates passing Plan A's accusatory-language denylist.
- **Residual — the commissioner's clock.** A commissioner-chosen `kickoff_at` on league creation and editable before the draft; the draft time surfaced everywhere a prospect decides (league terms, browse card, invite preview — all of which already render `leagueTerms`, so this is a field on an existing panel); a commissioner "Start the draft" control that finally calls the route that has existed since Phase 1; and, for public matchmade leagues only, automatic start at `kickoff_at` as the platform-owned commissioner function. The auto-start rides `instrumentation.ts`'s existing ticker singleton pattern and must be idempotent across instances — `drafts.status` and the `drafts_league_id_idx` unique constraint are what make that safe.
- **Residual — the verified-played-here review signal.** `identity-and-trust.md` records the gap and the missing definition: *"a 'verified' badge needs a definition of what verification means (one league completed? one season scored?) that this plan did not receive."* The participation read model above is that definition's data. The badge is one field on `ReviewView` and one element in the feed row; the definition is a founder decision, below.
- Persona-panel step covering all of it — a blocked join, an auto-set lineup and a held trade are three of the most emotionally loaded moments this product can produce, and every one of them lands on a member who did not ask for it.

**Interfaces consumed from Phase 1/2:** `leagues.is_public_matchmade` and `leagues_public_browse_idx`; `publicJoinPrecondition`, `joinPublicLeague`, `joinLeagueInTx`; `src/matchmaking/` and `league-service/browse.ts`; `leagueTerms` (`src/league/terms.ts`) and `LeagueTermsPanel`, already rendered on both the invite preview and league home; `setLineup`, `isWeekLocked`, `weekStatusFor`; `getDraftStore().startDraft`, `drafts.kickoffAt` and the draft-engine clock-tightening selectors that read it; `instrumentation.ts`'s singleton pattern; `LEAGUE_CONFIG.defaults`; Plan A's audit and notification primitives; Plan B's queue (everything ambiguous still escalates there); Plan C's fairness score.

**Risks:**
- **This plan is where the product first tells a real person "no."** A blocked join, a rejected roster move, a silently changed lineup. Every one needs the notification and the copy discipline more than it needs the enforcement.
- **Enforcement lands before the tier data is trustworthy.** The participation count is derived from a product where, today, almost no league has ever completed a season. A cutoff over an empty history classifies everyone as new. Consider a documented grandfathering rule and make the cutoff's config-driven-ness genuinely load-bearing.
- The draft auto-start is a scheduler. The existing ticker is a dev singleton started by `instrumentation.ts`; a production scheduler is Phase 2 Plan D's concern. Build it so the local form is real (the ticker starts a scheduled draft in dev, provably) and the production form is a deployment decision, not a rewrite.
- Step 5's rollback story (per-league feature flag) and Step 6's (segregation behind a flag, tier computed but inert) are both in the spec and both worth keeping — this is the plan most likely to need one.

**Prerequisites: none.**

---

## Cross-plan dependency graph

```
main @ e0cce93  (Phase 2 Plans A, B, C merged; Plan D founder-gated, pending)
   │
   ▼
Plan A  Step 1 + the member activity feed          no founder resources
   │    audit chain · AuditLogger · verification · notifyAffectedMember · INTEGRITY_CONFIG
   │
   ▼
Plan B  Step 2 + Step 4 (admin half) + moderation  no founder resources
   │    isAdmin · DisputeQueue · resolveFlag · chat removal · report consumer · stat corrections
   │
   ▼
Plan C  Step 3 + trade execution                   no founder resources
   │    trade_proposals · executeTrade · TradeFairnessFlagService (reuses tradeBalance)
   │
   ▼
Plan D  Step 5 + Step 6 + the commissioner's clock  no founder resources
        enforcement policy · participation tier · draft scheduling · verified badge
```

Strictly sequential, and the reason is the same at each arrow: **B needs A's audit log and notification primitive; C needs B's queue for its flags to land in; D needs C's accept transaction for its auto-hold seam and B's queue for its escalations.** The spec's own graph allows Steps 2, 3 and 6 to run in parallel once Step 1 lands, and that would be true if the three missing preconditions did not exist. They do, and they chain.

Two narrower parallelism options if the loop wants speed: Plan D's scheduling residual (commissioner-chosen kickoff, the start control) touches league-creation and draft-service files that Plans B and C do not, and could run as a separate worktree alongside either. And Plan B's stat-correction operator path touches only `stats-pipeline` and could be lifted out. Sequential is the safer default, as it was in Phase 2.

---

## The Phase 2 residuals, and which plan absorbs each

| Residual | Where it was ledgered | Absorbed by |
|---|---|---|
| Moderation surface proper: a triage queue, a role that can act from inside the product, an audit trail beyond the removal row (ruling 18) | `docs/decisions/identity-and-trust.md`, Plan C ledger | **Plan B** |
| Chat has no content-removal path at all — not for the author, the commissioner or the operator; larger than the review gap | `identity-and-trust.md` ("Phase 3's moderation surface owns chat, not just reviews") | **Plan B** |
| The GIF picker is an open moderation surface opened without a removal path, against the reactions precedent of keeping the set closed | Plan C Task 10 panel, ledgered for Phase 3 by name | **Plan B** — GIFs ride `chat.message` and occupy one `chat_messages` row, so the chat removal stamp covers them with no second path. The **pg-13 ceiling itself is a founder decision**, below. |
| The review report queue has no consumer — `review_reports` rows accumulate and nothing reads them | `identity-and-trust.md`, schema docblock | **Plan B** |
| No appeal path for a removed review; `--reason` is author-facing copy with no reply channel | `identity-and-trust.md` | **Plan B** scope, **founder decision** on whether an appeal exists at all |
| Post-final stat corrections outside the 3-day window, or to any week but the most recent settled one, need an operator path | Plan B ledger ("older revisions need Phase 3's operator path"), `live-scoring-pipeline.md` §10 | **Plan B** |
| Draft date/time is not a commissioner-facing concept — `kickoff_at` is auto-computed, never chosen, never shown; a joiner cannot learn when the draft is | Plan C Task 8 panel (PRODUCT GAP for the founder roadmap) | **Plan D** |
| No UI starts a draft — the commissioner-only route exists and nothing calls it | Phase 1 residual, re-raised in Plan C Task 8 | **Plan D** |
| The verified-played-here review signal — a badge needing a definition of verification | Plan C Task 9 panel backlog ("Phase 3 trust") | **Plan D**, on the same participation read model as the tier |
| Payout structure is not a domain concept | Plan C Task 8 panel, same PRODUCT GAP entry | **Not Phase 3.** It is Phase 4's ledger. Recorded here so it is not mistaken for something this phase dropped. |
| Activity cues on member avatars (presence/last-active) | Plan C ledger | **Not Phase 3.** Needs a realtime presence channel; the taxonomy stays closed. |
| XFF limiter keying + Redis-shared limiter counters (LAUNCH-BLOCKING) | `identity-and-trust.md`, binds Phase 2 Plan D | **Stays Phase 2 Plan D.** But it now also gates Plan B's IP heuristic weight — see the founder-gated bucket. |
| R3-1 (wedge counter per-process), R3-2 (live-mode ceiling assertion), stale comments | Plan B ledger | **Not Phase 3.** Phase 2 follow-ups, unrelated to integrity. |
| Custom avatar upload, email notification delivery | `identity-and-trust.md`, carved out with their one-line changes | **Stays Phase 2 Plan D.** Email being unavailable is why Plan A's notifications are in-app only. |
| Persona backlogs (tone-sharing presets, glossary wiring, help-level hide-vs-quiet, em-dash lint, enum-keyed labels) | Plans B and C ledgers | **Not Phase 3.** Carried for founder triage. |

---

## Founder decisions

None of these block a plan from **starting**. Each one blocks a specific task from **finishing honestly**, and each has a stated default so the loop does not stall. The defaults are what ships if no answer arrives; every one of them is reversible by config or by a one-field change, deliberately.

| # | Decision | Blocks | Default if unanswered |
|---|---|---|---|
| 1 | **The pg-13 ceiling.** `GIPHY_CONFIG.rating: "pg-13"` is an engineering default, not a reviewed content policy. Is it the right ceiling for a real-money product with real leagues talking in real chat rooms? | Plan B's moderation scope (what "removable" means) | Keep pg-13, document it as unreviewed, and make the removal path cover GIFs identically to text. |
| 2 | **What is removable.** Abuse only, as Phase 2 scoped reviews? Or also spam, off-topic, and doxxing? The closed reason set is the policy in code form. | Plan B's `REMOVAL_REASON_VALUES` for chat | Mirror `reviews`' existing closed set exactly; one vocabulary, two record types. |
| 3 | **Who can remove.** Operator only, matching ruling 18? Or can a private league's commissioner remove in their own league? A stranger-created public league's "commissioner" is exactly who §4.1 says not to trust. | Plan B's authz shape | Operator only. Commissioner removal in private leagues is a later, additive decision. |
| 4 | **Is there an appeal?** A removed review's author is told and told the operator's own words, with no reply channel. Same question now for chat. | Plan B | No appeal path; the removal notice states what was removed and why, and stops there. |
| 5 | **What `ACCOUNT_RESTRICTED` does.** The spec's resolution enum contains it; nothing in this product can restrict an account, and the spec also forbids this phase taking any account action. | Plan B's `resolveFlag` enum | Ship the enum **without** it. `NO_ACTION`, `WARNED_USER`, `TRADE_REVERSED` only. An enum value with no implementation is a control wired to nothing. |
| 6 | **Trade governance.** Does an accepted trade execute immediately, or sit in a veto window? Is there a commissioner approval step in private leagues, or a league vote? This is a league-settings question, not an integrity one, and Plan C has to pick something. | Plan C's proposal lifecycle | Immediate execution on acceptance, no veto window, integrity flagging after the fact — the shape Step 3 and Step 5 are already written against. |
| 7 | **The experience-tier cutoff number.** TN separates <51 from 500+ contests; MS marks 1,000+. §4.1 says one platform-wide default, not a state toggle. What is our number? | Plan D's `EXPERIENCE_TIER_CONTEST_COUNT_CUTOFF` | A conservative single-digit cutoff, config-driven, with a documented grandfathering note — no league on this platform has completed a season yet, so any statutory figure classifies the entire user base as new. |
| 8 | **What "verified" means** for the review badge: one league completed? one season scored? one league completed *as a paying entrant* (which does not exist until Phase 4)? | Plan D's verified-played-here badge | One completed season in one league. Stated on the badge's own tooltip so a reader knows what it claims. |
| 9 | **The missed-deadline lineup strategy.** `REPEAT_PREVIOUS_WEEK` or `BEST_LEGAL_LINEUP`? The first is predictable and sometimes obviously wrong (an injured starter); the second is better and looks like the platform playing your team. | Plan D | `REPEAT_PREVIOUS_WEEK`, with the notification saying exactly that. Predictability beats optimality when the platform is acting without consent. |
| 10 | **What happens to a held trade.** Does a `TRADE_HELD_FOR_REVIEW` expire if no admin reviews it? Both managers are waiting on a human. | Plan D | No expiry, but the held trade is visible to both parties with its status and stays at the top of Plan B's queue. |
| 11 | **How far back a stat correction may reach**, and whether a corrected week re-settles standings retroactively once managers have already seen a result. | Plan B's correction operator path | Operator-chosen week with no hard limit, always re-settling, always notifying every affected manager. The machinery is already idempotent; the policy is what needs an owner. |
| 12 | **Who the operators are, and how `isAdmin` is granted** in a deployed environment (an env allowlist? a migration? a script?). | Plan B's production usefulness, not its build | A DB flag set by a guarded operator script, mirroring `scripts/remove-review.ts`'s shape. Locally, seeded. |

---

## The founder-gated bucket

**Nothing in Plans A through D is blocked on it.** These are the things that get *better* when Phase 2 Plan D lands, listed so no plan quietly assumes one of them arrived.

| Gate | Which plan is affected | What ships without it |
|---|---|---|
| Platform-verified client IP (Fly's proxy overwriting `X-Forwarded-For`) + Redis-shared limiter counters — already LAUNCH-BLOCKING from Phase 2 Plan C | Plan B's multi-account IP heuristic | The heuristic ships with its `INTEGRITY_CONFIG` weight at zero and a test proving device + behavioral signals alone can still cross the threshold. **Flipping that weight is a Plan D release gate**, recorded alongside the `STATS_MONTHLY_REQUEST_BUDGET` gate. |
| An email sender (`channelStatus.email` → `"live"`) | Plan A's `notifyAffectedMember`, called by B, C and D | In-app delivery only, over the durable notification row and the activity feed. The catalog already says email is not connected, honestly, with no toggle beside it. |
| A production scheduler | Plan A's `verifyFullChainIntegrity` cadence; Plan D's draft auto-start | Both ship as a real local mechanism — an operator script for the chain walk, the existing `instrumentation.ts` ticker for the draft start — with the production cadence as a deploy-time configuration, not a rewrite. |
| Production admin bootstrapping | Plan B | Seeded locally; the grant mechanism is decision #12. |
| A Giphy or Tenor key | Plan B's GIF moderation | Irrelevant to the build: the picker is off without a key, and GIFs occupy one `chat_messages` row either way, so the removal stamp covers them the day a key arrives. |
| Any real account action tied to money holds | Nothing in this phase | Explicitly out of scope per the spec. This phase's detection produces a review flag and never an account action, enforced by test. |

---

## Founder rules binding all four plans

- **No MVP.** End-state choices from day one. Phases sequence scope, not quality. Nothing here ships in a form a later phase plans to throw away — which is exactly why Plan C builds the general trade path rather than a flag-shaped stub, and why Plan B builds one moderation surface rather than a smaller one to be reconciled later.
- **No em-dashes in user-facing copy.** Not in component text, not in error strings, not in notification templates, not in seed data. This phase writes more system-authored copy than any before it.
- **Persona-panel pass on every new user-facing surface**, marked as an explicit step in the plan that ships it. Plan D's surfaces are the highest-stakes in the product: a blocked join, an auto-set lineup, a held trade.
- **Centralized primitives always.** No raw hex, no raw px, no one-off component duplicating something in `src/components/ui/`.
- **Config beside its module.** `src/integrity/config.ts` exporting `INTEGRITY_CONFIG`, following the 22 existing `config.ts` files — not a new `src/config/` tree.
- **Test-first, real Postgres and Redis, 100% on gated directories.** `src/integrity` joins the coverage gates (14 today), with both an `include` entry and its own `thresholds` block — an `include` entry with no thresholds block measures nothing.
