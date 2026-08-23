# Phase 3.5 ADDENDUM — House leagues: the platform's own front door

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**This is an addendum to `docs/superpowers/plans/2026-08-22-phase3p5-competitiveness.md`, not a second phase.** Its tasks are numbered **12 to 16** so they append to that plan's ledger without renumbering anything, and they assume **Tasks 1 to 11 are done**. Three of them are load-bearing here and are consumed rather than re-planned: the sit-and-go fill trigger (T7), the waiting room and the browse ordering (T8), and the create form's promoted "Who it's for" control (T9). Its rulings are numbered **28 onward**, continuing that plan's ledger. Task 16 extends Task 11's closing battery rather than running a second one.

**Goal:** Make the platform's own leagues the front door. The founder's ruling of 2026-08-22, verbatim: *"the house is a core feature. I want a view and join type of experience like FFPC and Apex. That's at the core of what we're trying to do."* Today every league on this platform is created by a member and waits for that member's friends. Phase 3.5 made a member-created public league fill better. This addendum makes the **platform** create the leagues, so the lobby is never empty: a visitor lands, sees a shelf of canonical open leagues with real draft times, takes a seat, and the moment a league fills a fresh one of the same rung opens behind it.

**Architecture:** Four strands. **(1) A house league is a league with no member commissioner, and the schema says exactly that.** `leagues.commissioner_user_id` becomes nullable and `NULL` means the platform commissions this league, which is the sentence `audit_events.actor_id` already tells about actions; `leagues.house_rung` names which catalog rung the league came from, and a CHECK constraint keeps the two columns from ever disagreeing. **(2) Authority stops being a string comparison.** The seven places that compare `commissionerUserId === userId` are refactored onto one function returning a discriminated union, so the compiler enumerates the ripples instead of a reviewer hoping to. **(3) The factory is a level-triggered reconciler, not an event hook.** It counts the open leagues per rung on the ticker that already runs `autoStartDueDrafts`, creates the difference through the real `createLeague` path, and gets its idempotence from a deterministic primary key rather than from a lock this stack forbids. **(4) The lobby grows a front door.** The house shelf is the first thing browse shows, a house card says who runs it and when it drafts, and T8's waiting room learns the one sentence a house league can promise that a member league cannot: another one opens the moment this one fills.

**Tech Stack:** Unchanged from the parent plan. TypeScript strict · Next.js 15 App Router · React 19 · Drizzle ORM over Postgres 17 (`drizzle-orm/postgres-js`) through PgBouncer in transaction mode · Redis 7 (Streams → SSE) · WorkOS AuthKit · Zod v4 · Vitest + happy-dom + @testing-library/react + vitest-axe · Playwright. **This addendum adds no dependency.**

**Spec:** The founder's ruling above, read against `docs/research/2026-08-20-game-types-and-lobby-strategy.md` §1 (Model A's *"drafts happen at fixed calendar slots; users buy a seat in a specific dated draft"* and Model C's filter-and-browse, which the house shelf combines) and §4.1's liquidity doctrine, whose central finding this addendum makes literal: *"Apex fills 1,000+ leagues/year partly because everything is 12-team full-PPR: every joiner is compatible with every open seat."* A platform-run catalog is that concentration mechanism stated as a product rather than hoped for as an emergent property. Also `docs/research/2026-08-16-beating-apex-strategy.md` §4.1's *"platform-owned commissioner functions for public leagues specifically: automated rule enforcement and dispute resolution, rather than handing commissioner powers to whichever stranger happened to create the league"* — the house league is that idea completed, because it is the league where there is no stranger to hand them to.

**Depends on** all of Phase 3, merged, **and on Phase 3.5's Tasks 1 to 11**. It does not depend on Phase 4, and ruling 41 names the one seam that waits for it.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the codebase's own rules, and this addendum restates them in full rather than pointing at the parent plan, because a worker executing Task 13 must not have to hold two documents open to know what binds it.

**From `docs/conventions.md`:**

- **Directive: no MVP.** *"I don't want an MVP. Let's work towards the end solution."* Phases sequence **scope**, not quality. Nothing gets built in a form a later phase plans to throw away — which is why the house's absence of a commissioner is a nullable column with a CHECK rather than a placeholder row somebody later has to delete, and why the factory is a reconciler that self-heals rather than a hook that must never miss.
- **Stack is pinned.** Postgres 17 via Drizzle ORM (`drizzle-orm/postgres-js`, `postgres` driver). Redis 7 Streams → Server-Sent Events is *"the one and only real-time mechanism."* Auth is WorkOS AuthKit: *"We do not roll our own auth."* Validation is Zod v4 (`z.email()`, not the deprecated `z.string().email()`).
- **`docker-compose.yml` pins a top-level `name: fantasy`**, so every git worktree resolves to the **same** Compose project. Run `npm run infra:up` from any worktree; they all talk to one shared stack.
- **Immutability.** Domain types are `readonly`; use `readonly T[]` / `Readonly<Record<…>>`. Update by spreading into new objects. Enforced for `src/domain/**` by `eslint-plugin-functional` (`functional/prefer-readonly-type`, `functional/immutable-data`, `functional/no-let`). **This addendum writes nothing into `src/domain`** (ruling 42) and therefore does not touch those rules, but `HOUSE_CATALOG` is an `as const` tree and `LeagueAuthority` is a `readonly` discriminated union regardless, because the directories it does write into are held to the same standard by review.
- **Timing — no ambient clock in domain/reducer code.** Anything time-dependent takes a `Clock` (`src/domain/timing.ts`) and calls `clock.now()`. Actions carry an explicit ISO `timestamp`. Tests inject a fixed clock. `Date.now()` / `new Date()` are only allowed at the outermost edge (route handlers, `current-user.ts`, `publisher.ts`, `src/draft-service/index.ts`'s `systemClock`). **The stagger is the sharpest test this rule has in this addendum**: the factory computes each new league's kickoff as an offset from an injected `clock.now()`, and `houseKickoffFor` is a pure function of `(now, rung, indexInShelf)` that reads no calendar of its own.
- **Identity — one seam, WorkOS underneath.** Server code reads "who is this" **only** via `getCurrentUser()` / `requireCurrentUser()` from `src/lib/auth/current-user.ts`. **`users.id` IS the WorkOS user id.** API and SSE routes never redirect — they return a JSON 401 themselves. **`teamId` and `weekNumber` are always resolved from the authenticated session and the server's own schedule, never from a request body.** This addendum adds **no** client-submitted payload at all: a visitor joins a house league through the public join route that already exists, and the factory takes no input from anybody.
- **Real-time — one mechanism.** Writes are plain HTTP: validate → persist to Postgres → then `getPublisher().publish(...)`. **Postgres is authoritative; publishing is best-effort and must never fail the write.** Delivery is Redis Streams over SSE, read with plain `XREAD BLOCK`. **Never `XREADGROUP`.** Event types are enumerated once in `src/lib/realtime/events.ts`. **This addendum adds no realtime event type** (ruling 42): a house league that opens has no members yet and therefore nobody subscribed to tell, and everything that happens to it afterward is already published by the paths that happen to it.
- **Draft state — the action log is the source of truth.** An in-progress draft's state is *derived*, by replaying `draft_actions` through the pure reducer in `src/draft-engine/`. Every accepted action is persisted before it is cached or published. **The reducer may read only the action log and prior state, never a module-level tunable** (`src/draft-engine/reduce.ts:9-14`, `admit.ts:10-26`). **This addendum does not touch `src/draft-engine` at all**: a house league's draft is an ordinary draft, and that is the point of it.
- **Client boundary.** Everything under `src/draft-room/**`, `src/league-room/**`, `src/chat-room/**`, `src/admin-room/**` and `src/account-room/**` is BROWSER code. Each talks to its service layer ONLY over the wire — never by importing `@/draft-engine`, `@/draft-service`, `@/league`, `@/league-service`, `@/chat-service`, `@/ai-advisor`, `@/review-service`, `@/identity-service`, `@/integrity`, `@/integrity-service`, `@/db`, `@/lib/realtime`, `@/lib/auth`, `@/lib/leagues`, `@/lib/llm`, `@/lib/api/respond`, `@/data/seed`, `@/stats-pipeline`, `@/stats` or `@/gifs` as VALUES. `import type` stays allowed. The exempt pure directories browser code MAY value-import are the eight already on the list: `src/chat`, `src/matchmaking`, `src/identity`, `src/help`, `src/reviews`, `src/moderation`, `src/trades`, `src/participation`. **This addendum adds no ninth** (ruling 42), which is exactly why the catalog lands in `src/matchmaking`. The rule is deliberately **not** applied to `src/app/**`.
- **API responses.** Every JSON route returns the envelope from `src/lib/api/respond.ts`: `{ ok: true, data }` or `{ ok: false, error }` with a meaningful HTTP status. Bodies are parsed with `parseJson(request, ZodSchema)`; a bad body is a 400 naming the field. **Error strings are user-facing plain language — never raw DB/exception text.**
- **Config over magic numbers.** Thresholds, limits, durations and key formats live in a `config.ts` next to the module that uses them (`LEAGUE_CONFIG`, `REALTIME_CONFIG`, `DRAFT_QUEUE_CONFIG`, `UI_CONFIG`, and twenty-one more). This addendum adds fields to `LEAGUE_CONFIG` and to `DRAFT_SERVICE_CONFIG` and adds **no new `config.ts`**, which is the parent plan's ruling 22 held. `house-catalog.ts` is a **vocabulary** module beside `src/matchmaking/config.ts` in exactly the way `src/domain/scoring.ts`'s `SCORING_PRESETS` is a vocabulary module and not a tunables file (ruling 37).
- **Tests. Test-first.** Tests live beside the code: `src/<feature>/**/*.test.ts`. Verification commands filter by directory: `npm test -- src/league-service`, never by a guessed filename. Integration tests hit the **real** test Postgres / Redis from docker-compose — not mocks. Use `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (`fileParallelism: false`).
- **The no-write-before-a-committed-refusal test class.** Plan C's Task 5 review caught a CRITICAL: a plain `return` after a status stamp committed a false `accepted` state. The standing rule since: **every refusal path of a transaction that has already written anything is asserted to have left the world unchanged.** This addendum adds **one** such transaction (the factory's spawn) and therefore one such helper — `expectNoHouseLeagueTookPlace` — asserted on **every** refusal path of that writer, not on a representative one.
- **FK-lock enumeration in every lock-order entry.** Plan C's final review found a real `40P01` deadlock caused by an `INSERT`'s implicit foreign-key `FOR KEY SHARE` that per-task lock proofs had waived, because parent-row locks are invisible at call sites. Binding: **every transaction this addendum adds or extends enumerates its implicit FK acquisitions by name in its own docblock**, and `src/integrity-service/lock-order.test.ts` grows one entry per writer it adds — **one** of them (the house spawn). The task that touches the suite **reads its current count off the file** rather than trusting a number written here, because the parent plan's Task 7 already moves that count and a plan quoting a count it did not measure is how a green test starts describing yesterday.
- **Coverage threshold: 100%** for the gated directories, configured in `vitest.config.mts` with `coverage.include` **and** a matching `thresholds` block (an `include` entry with no threshold is not a gate at all). **Twenty-one** gated directories, and the parent plan adds none. **This addendum adds none either** (ruling 42) and deliberately places all three of its new modules inside directories that are already gated: `src/matchmaking/house-catalog.ts` (gate 6) and `src/league-service/authority.ts` + `src/league-service/house-factory.ts` (gate 17). Verify with an **unfiltered** `npm run test:coverage` — a path-filtered coverage run reports the other gated directories at 0%.
- **Browser end-to-end** lives in `e2e/` and runs under Playwright against a production build and the real docker-compose stack (`npm run e2e`). It authenticates with a sealed WorkOS test-directory session. **There is no dev auth bypass and none may be added.** `playwright.config.ts` pins `workers: 1` and `fullyParallel: false`; a spec relying on suite order names the file it depends on in its own comment.
- **Two e2e disciplines this repo learned the hard way, and both bind every spec here.** **(a) The SSR fake:** a server-rendered control is visible and "stable" before React attaches its handler, so a click that lands pre-hydration is a silent no-op with no request on the wire. Every interaction assertion is **click-and-verify, retried** against a receipt the click itself produces (`e2e/league-lifecycle.spec.ts:140-160` is the pattern), and a discriminator is chosen that only the hydrated page can render — never one the server also paints. **(b) Hardcoded counts:** a spec that asserts an absolute row count is asserting the seed, not the behavior. Count assertions are **relative** (a delta across the action) or derived from the page, and a count that must be absolute names the seed line it depends on. **The house shelf is the sharpest instance of (b) in the product so far**, because the factory itself changes the row count between page loads; every count assertion in Task 15 is a delta or a page-derived number, never a literal.
- **Migrations.** `ADD COLUMN … NOT NULL` without a `DEFAULT` is acceptable only while the table is empty (pre-first-deploy); once deployed, add with a DEFAULT or backfill in a separate migration. **Index rebuilds hold ACCESS EXCLUSIVE and nothing in this repo uses `CONCURRENTLY`** — named for the deploy era as a runbook step, never a migration against a live database. This addendum ships **one** migration. It is the only migration in Phase 3.5 that is **not purely additive**: it drops a `NOT NULL` and adds a CHECK constraint, and Task 12 step 2 states both deploy-era consequences out loud rather than leaving them to be discovered.
- **Commits.** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Commit after every completed step; commit bodies explain *why* and record any deviation from the plan.
- **Environment.** `.env.example` is committed; `.env.local` is gitignored. Fail fast with a clear message when a required var is missing. **This addendum adds no environment variable** — the catalog is code, not deployment configuration, and ruling 37 says why.
- **Verification commands (every step):** `npm run typecheck && npm run lint && npm test && npm run build`

**From `docs/design-system.md`:**

- **No raw hex, no raw px, no arbitrary values in feature code.** `src/design/tokens.ts` is the only file allowed to contain a color literal.
- **Never a dead end.** Empty and error states always offer an action (`StatePanelProps.action` is required, not optional). **This addendum's hardest case is a house shelf with nothing on it** — a state that should be impossible once the factory runs, which is exactly why it must be designed: a shelf that is empty because the reconciler has not ticked yet offers the member-created public leagues that are open right now, rather than an apology.
- **Both themes are first-class.** Every surface is designed and tested in light and dark, via `inBothThemes` from `src/components/ui/test-utils.tsx`. **Mobile-first**, minimum viewport 360px. WCAG 2.2 AA.
- **Copy.** Plain language, active voice, specific. Errors say what happened and what to do next.
- **`Icon` is the one icon entry point. Feature code never imports `lucide-react` directly.** The eighteen `IconName`s on `main`, which the parent plan holds at eighteen: `trophy`, `users`, `clock`, `alert-triangle`, `inbox`, `refresh-cw`, `check`, `x`, `chevron-right`, `search`, `info`, `shield`, `flame`, `anchor`, `rocket`, `crown`, `bolt`, `clover`. **This addendum adds none** (ruling 42): `shield` is already the platform acting on its own and is the house league's mark wherever one is needed.
- **`PositionBadge` is the only way to render a position label; `SlotChip` is the only way to render a roster-slot letter that is not itself a position.**
- **Never set the display face on a paragraph.** It is a lettering face, not a reading face.
- Tunables for primitives live in `src/components/ui/config.ts` — never inline in a component.

**From `docs/decisions/data-layer-hardening.md`:**

- **Balance as rollup.** Any running total is a rollup row updated **in the same transaction** as each contributing write, over an append-only source table that stays the reconciliation source of truth. Never a `SUM()` on the read path. The threshold is unbounded growth: derive over a bounded set, roll up over an unbounded one. **The reconciler's count obeys it by staying bounded**: "how many open house leagues does rung R have" is a count over a handful of rows behind a partial index, not a scan of `leagues`.
- **PgBouncer transaction pooling forbids session state.** No `pg_advisory_lock`, no named prepared statements (`prepare: false` is unconditional), no `SET` outside a transaction, **no `LISTEN`/`NOTIFY`**. DDL goes through the direct port, never the pooler. **This binds the factory hardest**: it may not elect a leader, which is why two instances reconciling the same rung on the same tick is a case that is *resolved* rather than *prevented*, and the resolution is a primary-key conflict (ruling 35). It is the identical argument `autoStartDueDrafts` already makes for its guarded `UPDATE`: *"leader election among app instances is unavailable by construction … Exclusion therefore comes from the WRITE."*

**From `docs/decisions/audit-and-integrity.md` (Plan A's rulings, binding here):**

- **The audit append and the notice row are inside the business transaction and fail it; only the Redis frame is best-effort.** Every write in this addendum obeys it.
- **The lock order is one global order and the audit anchor is ALWAYS the last lock**, where "lock" includes an implicit foreign-key `FOR KEY SHARE`. The permitted sequence is: business rows → notice insert → `audit.record` → `attachAuditEvent` → commit → `deliverNotice`.
- **A transaction appends to at most one chain.** `recordAll` throws on a batch spanning two.
- **`audit_events` carries no foreign keys and nothing ever deletes a row.** `AUDIT_EVENT_TYPES` is a pg enum whose docblock states *"no later migration ever runs `ALTER TYPE … ADD VALUE`"* — the vocabulary is **frozen**, so the one new automated action here rides `system_action` with a `payload.action` code, exactly as Plan D's four and the parent plan's two do (ruling 36).
- **Deny by default, on every visibility dimension.** `SYSTEM_ACTION_VISIBILITY` is exhaustive over `SystemActionCode`; a code with no decision does not compile. This addendum adds one code and therefore one compile-forced answer.
- **The platform chain is a single row and stays one only because every platform-chain append is a short transaction** (`src/integrity-service/audit-logger.ts:23-43`, which warns that a caller appending platform events from a long or frequent transaction *"is the moment to shard the platform chain"*). Ruling 36 keeps the factory off it entirely.

**From `docs/decisions/enforcement-and-tiers.md` (Plan D's rulings, binding here):**

- **`drafts.kickoff_at` is a time a human chose, the ladder's anchor, and the auto-start's due date, all at once.** Plan D made the first two true and the parent plan's Task 7 added the third writer. **This addendum adds the fourth, and it is the first one where no human chose the time at all** — the catalog's stagger did. Ruling 38 states that out loud, and Task 16 documents it beside Task 11's own entry.
- **The platform presses start only in a public matchmade league** (`ENFORCED_LEAGUE_SQL`), because that is the league with no trustworthy human commissioner. **This addendum does not widen that predicate** (ruling 40): every house league is `is_public_matchmade = true`, so a house league is the *most* enforced league on the platform, not a carve-out from enforcement.
- **`autoStartDueDrafts` claims with a guarded status transition, never with a lock**, and both the human door and the platform door funnel through `store.startDraft`. The factory adds no third door and does not start drafts at all.
- **Enforcement is checked at three named doors** (join, creation, and the invite door's deliberate mechanism-based exemption). This addendum changes what happens at all three for house leagues specifically, and rulings 33 and 39 state each change with its reason.

**From `src/integrity/flag-only.test.ts` and `src/ai-advisor/advisory-only.test.ts` (the two structural contracts):**

- **Flags only.** No code path under `src/integrity`, `src/integrity-service`, `src/trades` or `src/participation` may take an action against an account, and `grantAdmin` must be **structurally unreachable** from the detector's import graph. The banned substrings in those four directories are `isAdmin`, `suspend`, `ban`, `restrict`, `disable`, `lock`, `deactivate`. **This addendum writes into none of those four directories except `src/integrity/system-actions.ts` and `src/integrity/notices.ts`**, and the words it adds there are checked against that list before they are written (ruling 40).
- **Advisory only.** No AI code path may write. Untouched here.

**Founder rules (binding, from founder memory and the phase ledgers):**

- **No em-dashes in user-facing copy**, and here that rule has teeth: `copyViolations` (`src/integrity/copy-rules.ts`) is one rulebook enforcing three rules — no em **or en** dash, nothing in `INTEGRITY_CONFIG.notices.accusatoryTerms`, nothing in `INTEGRITY_CONFIG.notices.passiveConstructions`. Five sweeps enforce it (`notices.test.ts`, `activity-view.test.ts`, `rendered-copy.test.tsx`, `room-copy.source.test.ts`, `script-copy.source.test.ts`), and Plan D's fix wave repaired the source sweep's template-literal blindness with a hand-walked parser. **Every user-facing sentence this addendum writes is swept by the machinery as repaired**, and the one new notice template is registry-derived so it is swept the commit it lands.
- **Persona-panel pass on every new user-facing surface**, marked as an explicit step. **Two panels in this addendum** (Tasks 12 and 14): a member of a house league discovering that the "Commissioner" row they expected to find is the platform, and a visitor deciding whether a league nobody they know runs is safe to sit down in.
- **Centralize UI primitives the first time.** No page-local visual mapping; extract to `src/components/ui/` and refactor the existing consumer in the same commit. **This addendum's one candidate is the house mark**, and ruling 42 rules against extracting it: it is `Icon name="shield"` plus a label, rendered in two places, and two is not three.
- **No mock data on real surfaces.** The seed produces genuinely factory-built house leagues, through the real reconciler, on a real tick (ruling 34 and Task 15).
- **Verification agents never write review artifacts and never commit.** Plan D's governance disclosure is now a standing dispatch rule; **every review dispatch in this addendum repeats it.**

---

## What is already true (read before touching anything)

Checked against `main` at `26da43e` plus the parent plan's Tasks 1 to 11 as planned. Several of these change the shape of this addendum.

| The founder's ruling assumes | Reality |
|---|---|
| A league can be owned by the platform | **False today, and this is the whole schema question.** `leagues.commissioner_user_id` is `text NOT NULL REFERENCES users(id)` with **no `ON DELETE` behavior** (`src/db/schema.ts:107-109`, `drizzle/0000_chilly_zemo.sql:102`). Every league has a member commissioner, and `createLeague` gives that member a team in the same transaction (`src/league-service/creation.ts:118`). |
| "The platform commissions this league" is a new idea | **It is three phases old and already has a name.** `enforcementAppliesTo`'s own docblock (`src/league-service/enforcement.ts:36-40`) calls it *"The one answer to 'is the platform this league's commissioner?'"* and answers it with `is_public_matchmade AND INTEGRITY_CONFIG.participation.enforceTierSegregation`. Auto-start, auto-lineup and trade auto-hold all already run on that answer. A house league is that predicate made **total**: today the platform runs the automated functions while a member keeps the discretionary ones; a house league is the league with no member to keep them. |
| The platform needs an identity to own leagues with | **The codebase has ruled the opposite twice.** `BOOTSTRAP_ACTOR` (`src/integrity-service/grant-admin.ts:16`) is a **sentinel string at the boundary** that collapses to `actorId: null, actorType: "system"` before it ever reaches storage (`grant-admin.ts:92-99`), and is fenced by a grep tripwire with exactly three callers (`seed-operator.test.ts:98-125`). `audit_events.actor_id` is nullable **and carries no foreign key at all**, deliberately (`src/db/schema.ts:656-662`), and `src/domain/audit.ts:71` states the invariant: *"Null only when `actorType` is `\"system\"`."* The platform's existing representation everywhere in this product is the **absence** of an identity, never a synthetic one. |
| A house identity could be exempted from the detectors | **There is no exemption mechanism anywhere in the integrity stack, and adding one would be the first of its kind.** `sweepLeagueForMultiAccounts` (`src/integrity-service/multi-account.ts:260`) has no exclusion field on `SweepDeps`; `sweepUnflaggedTrades` (`trade-fairness.ts:394`) has none; `verifyChainIntegrity` has none. Every "does not apply here" decision in this codebase is a **structural predicate** (`enforcementAppliesTo`, `ENFORCED_LEAGUE_SQL`, or the invite door simply never calling `tierJoinPrecondition`), never a set of exempted ids. |
| The house needs bot seats, like the mock lobby did | **No, and conflating the two would accidentally build the thing Phase 3.5 ruled out.** Ruling 25 rules the mock lobby out because `teams.user_id` is `NOT NULL` with a `(league_id, user_id)` unique index, so a seat no person occupies is unrepresentable. **A house league has twelve real human members.** What it lacks is a member *commissioner*, which is a different column on a different table. Ruling 43 keeps them apart. |
| Commissioner authority is one seam | **It is one seam and four bypasses.** `src/lib/leagues/membership.ts:44` is the documented one (*"The one place anything learns whether a user belongs to a league"*), and `src/app/api/leagues/_shared.ts:69` (`withCommissioner`) has **exactly one caller** in the whole product, the invites route. But `src/league-service/read.ts:90,209`, `src/league-service/home.ts:143,152`, `src/league-service/draft-schedule.ts:136` and `src/integrity-service/flags.ts:1475` each re-derive `commissionerUserId === userId` with their own query. **Seven equality comparisons in five modules, plus two reads that are not comparisons** (`read.ts:168`'s `find` for the commissioner's team, `invites.ts:194`'s join to `users`), across three seams. Task 12 collapses them. |
| Commissioner-with-no-team is an unhandled case | **Three places already handle it, which is a good omen and not a coincidence.** `src/lib/leagues/membership.ts:67` admits a member if `teamId !== null || isCommissioner`; `src/chat-service/chat.ts:146-148` says in a comment *"Display name is only the fallback for a teamless commissioner"*; and `src/league-service/invites.ts:212` already falls back to the literal `"Commissioner"` when the commissioner's `users` row does not come back. The product has been quietly ready for a league whose commissioner is not a teammate. |
| Adding a boolean column is the cheap answer | **The codebase has refused that exact move four times and wrote down why.** `src/league-service/enforcement.ts:42-46`: *"IT IS NOT A PER-LEAGUE DATABASE FLAG… a boolean column with no UI, no script and no caller that could ever set it would be the control wired to nothing this phase has refused four times."* Any column this addendum adds must have a writer, a reader and a surface on the day it lands. Ruling 30 shows all three for the one column it adds. |
| `createLeague` will need reworking to accept a chosen kickoff | **It already accepts one, and its docblock anticipated this caller by name.** `CreateLeagueInput.kickoffAt?` exists, and the reason recorded beside it is *"a caller who already has a real chosen time — a seed, a fixture, a future creation flow — should not have to create the league blind and immediately follow with `setDraftKickoff`."* The factory is that caller. The **only** thing it cannot reuse is the commissioner, which is Task 13 step 3's `owner` discriminant. |
| The seed's "through real services only" rule means the seed already creates leagues the way the factory should | **Not quite, and the difference is in the factory's favor.** `seedPublicLeagues` and `seedDevLeagues` write the `leagues` row by direct Drizzle upsert with a stable id, so that `npm run seed` is re-runnable; the *behaviors* (join, trade, lineup, auto-start, grant-admin) go through real services. The factory goes through `createLeague` itself, which is the only path that also writes the `league_created` audit event — so the house arc in Task 15 is a **stronger** seed than the arcs beside it, not a weaker one. |
| The lobby needs a new scheduler to keep leagues stocked | **It does not, and the parent plan already forbade adding one.** There is no cron, no queue and no jobs table: `src/instrumentation.ts` starts two `setInterval` loops and nothing else. `src/draft-service/ticker.ts:79-87` takes `autoStart` as an **injectable dep with a real default**, runs it first inside `tick()` with its own `try`/`catch` so a failed scan cannot skip the expiry scan (`ticker.ts:122-138`), and rate-limits its outcome reporting through `reportIfDue`. `src/draft-service/index.ts`'s own docblock states the rule: *"Task 7's auto-start rides this same ticker rather than a third `setInterval`."* A third dep on that same ticker is the shape this codebase already uses twice. |
| `listPublicLeagues` returns something a shelf can be added to | **It returns a flat `readonly PublicLeagueSummary[]`, not `BrowseBody`.** Task 14 changes that return type, and `PublicLeagueSummary` has **ten** fields today; the parent plan's Tasks 7 and 8 add two, so this addendum's is the **thirteenth**. `PUBLIC_LEAGUE_FIELDS` plus `browse.test.ts`'s wire assertion make every addition a deliberate disclosure decision that fails the build if it is not declared. |

---

## File Structure

**New — modules, all three inside an already-gated directory:**

| File | Responsibility |
|---|---|
| `src/matchmaking/house-catalog.ts` | `HOUSE_CATALOG`, `HouseRungName`, `HouseRung`, `houseLeagueName`, `houseKickoffFor`, `HOUSE_RUNG_LABEL`. The catalog, as data. Pure and browser-safe, which is why the house card can label a rung without a round trip. Gate 6. |
| `src/league-service/authority.ts` | `LeagueAuthority`, `leagueAuthority`, `isCommissionerOf`, `HOUSE_AUTHORITY_REFUSALS`. The one answer to "who commissions this league", as a discriminated union. Gate 17. |
| `src/league-service/house-factory.ts` | `ensureHouseCatalog`, `spawnHouseLeagueInTx`, `openHouseLeaguesQuery`, `HouseFactoryDeps`, `HouseFactoryOutcome`. The reconciler. Gate 17. |

**Modified — the schema and the seam:** `src/db/schema.ts` (`commissioner_user_id` nullable, `house_rung`, the CHECK, one partial index), `src/lib/leagues/membership.ts`, `src/league-service/read.ts`, `src/league-service/home.ts`, `src/league-service/draft-schedule.ts`, `src/league-service/invites.ts`, `src/integrity-service/flags.ts`, `src/app/api/leagues/_shared.ts`, `src/league-room/contract.ts`.

**Modified — the factory's host:** `src/draft-service/ticker.ts` (the third injectable dep), `src/draft-service/config.ts` (the reconcile interval and the per-run ceiling), `src/league-service/creation.ts` (the `owner` discriminant), `src/league-service/schemas.ts`, `src/league/config.ts`, `src/app/api/leagues/route.ts` (the one production caller of `createLeague`, which passes the `member` branch).

**Modified — the lobby:** `src/league-service/browse.ts` (the house query and the new return type), `src/matchmaking/contract.ts` (`PublicLeagueSummary`'s thirteenth field, `BrowseBody`), `src/matchmaking/filter.ts`, `src/league-room/components/public-league-list.tsx`, `waiting-room.tsx` (Task 8's, extended), `league-members-panel.tsx`, `src/app/browse/page.tsx`, `src/app/api/public/leagues/route.ts`, `src/help/glossary.ts`.

**Modified — integrity:** `src/integrity/system-actions.ts` (one code, one compile-forced visibility), `src/integrity/notices.ts` (one template), `src/integrity/test-support.ts` (`NOTICE_SAMPLES`), `src/integrity-service/lock-order.test.ts` (one writer).

**New migration:** `drizzle/0032_house_leagues.sql`.

**New docs:** `docs/decisions/house-leagues.md`.

**Modified docs:** `docs/conventions.md`, `docs/league.md`, `docs/decisions/enforcement-and-tiers.md`, `docs/decisions/formats-and-lobby.md` (the parent plan's own new doc), `plans/00-roadmap.md`, `README.md`.

**Modified seed and e2e:** `src/data/seed/index.ts` (+ its test), `e2e/formats-and-lobby.spec.ts` (the parent plan's own new spec, extended rather than joined by a second one).

---

## Task 12: A league with no member commissioner

This is the addendum's hardest ruling and it lands first, because Tasks 13 to 16 are all consumers of it. The founder's ruling needs a league the platform owns; the schema says every league has a member commissioner with a team. Three designs were weighed and the reasoning is in rulings 28 to 33.

**Files:**
- Create: `src/league-service/authority.ts` (+ its test), `drizzle/0032_house_leagues.sql`
- Modify: `src/db/schema.ts`, `src/lib/leagues/membership.ts` (+ its test), `src/league-service/read.ts` (+ its test), `src/league-service/home.ts` (+ its test), `src/league-service/draft-schedule.ts` (+ its test), `src/league-service/invites.ts` (+ its test), `src/integrity-service/flags.ts` (+ its test), `src/app/api/leagues/_shared.ts` (+ its test), `src/league-room/contract.ts`, `src/league-room/components/league-members-panel.tsx` (+ its test)

**Interfaces:**
- Consumes: `resolveLeagueMembership`, `requireLeagueMember`, `withCommissioner`, `NO_TEAM_MESSAGE`.
- Produces: `LeagueAuthority`, `leagueAuthority`, `isCommissionerOf`, `HOUSE_AUTHORITY_REFUSALS`, `leagues.house_rung`, a nullable `leagues.commissioner_user_id`.

- [ ] **Step 1: Write the failing authority tests**

```ts
// src/league-service/authority.test.ts
it("names the member who commissions a member league", () => {
  expect(leagueAuthority({ commissionerUserId: "u_alice", houseRung: null }))
    .toEqual({ kind: "member", userId: "u_alice" });
});

it("names the platform when a league came from the catalog", () => {
  expect(leagueAuthority({ commissionerUserId: null, houseRung: "open_12" }))
    .toEqual({ kind: "house", rung: "open_12" });
});

it("gives nobody commissioner powers in a house league, including an operator", () => {
  // An operator's authority is `users.is_admin` and it reaches the admin surface, not this one.
  // A house league has no commissioner seat for anybody to occupy, which is the point of it.
  const house = { commissionerUserId: null, houseRung: "open_12" } as const;
  expect(isCommissionerOf(house, "u_alice")).toBe(false);
  expect(isCommissionerOf(house, "u_operator")).toBe(false);
});

it("refuses to answer for a row whose two columns disagree, rather than guessing", () => {
  // The CHECK constraint makes this unreachable from Postgres. It is asserted anyway, because a
  // unit test constructs the shape by hand and a future reader needs the invariant stated in
  // TypeScript as well as in DDL.
  expect(() => leagueAuthority({ commissionerUserId: "u_alice", houseRung: "open_12" })).toThrow(/house_rung/);
  expect(() => leagueAuthority({ commissionerUserId: null, houseRung: null })).toThrow(/commissioner/);
});
```

```ts
// src/lib/leagues/membership.test.ts
it("lets a member of a house league in, and calls none of them commissioner", async () => {
  const result = await resolveLeagueMembership(db, houseLeagueId, "u_member");
  expect(result).toMatchObject({ ok: true, membership: { teamId: expect.any(String), isCommissioner: false } });
});

it("keeps a stranger out of a house league exactly as it keeps them out of any other", async () => {
  // `requireLeagueMember` admits on `teamId !== null || isCommissioner`. In a house league the
  // second disjunct is false for everybody, so the rule collapses to "do you have a team", which
  // is the correct rule and is reached without a special case.
  const result = await resolveLeagueMembership(db, houseLeagueId, "u_stranger");
  expect(requireLeagueMember(unwrap(result))).not.toBeNull();
});
```

- [ ] **Step 2: The migration, and the one non-additive statement in Phase 3.5**

`drizzle/0032_house_leagues.sql`, hand-written:

```sql
ALTER TABLE "leagues" ALTER COLUMN "commissioner_user_id" DROP NOT NULL;
ALTER TABLE "leagues" ADD COLUMN "house_rung" text;
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_house_commissioner_ck"
  CHECK (("house_rung" IS NULL) = ("commissioner_user_id" IS NOT NULL));
CREATE INDEX "leagues_house_rung_idx" ON "leagues" ("house_rung", "created_at") WHERE "house_rung" IS NOT NULL;
```

Four statements, and each needs its own sentence.

`DROP NOT NULL` is **metadata only** — Postgres clears `pg_attribute.attnotnull` and does not rewrite the table — but it still takes `ACCESS EXCLUSIVE` for the length of a catalog update. `ADD CONSTRAINT … CHECK` is the one statement here that **scans every existing row**, because Postgres validates before accepting. Both are trivial today (no deployed database; `leagues` holds seed rows only) and both belong in `docs/conventions.md`'s migration section as deploy-era runbook steps, exactly where the parent plan puts its index rebuilds. **The deploy-era form is `ADD CONSTRAINT … NOT VALID` followed by `VALIDATE CONSTRAINT` in a separate migration**, and Task 16 step 2 writes that down rather than leaving the next person to rediscover it.

The CHECK is what makes a nullable authority column safe, and it is not decoration. Ruling 28's whole defense of nullability is that `NULL` here means **exactly one thing**; tying the null-ness of `commissioner_user_id` to the presence of `house_rung` is what makes that true at the only layer that could make it false. `NULL` can never mean "we forgot", "the row is half written" or "the commissioner's account was deleted", because a row in any of those states does not commit.

The partial index carries `created_at` as its second column because the reconciler's count and the shelf's ordering both read house rows in creation order, and it is partial for the identical reason `leagues_public_browse_idx` is: `house_rung` is null for the overwhelming majority of leagues forever.

- [ ] **Step 3: The seam, and the seven comparisons that collapse into it**

`src/league-service/authority.ts`:

```ts
export type LeagueAuthority =
  | { readonly kind: "member"; readonly userId: string }
  | { readonly kind: "house"; readonly rung: HouseRungName };

export interface LeagueAuthorityRow {
  readonly commissionerUserId: string | null;
  readonly houseRung: string | null;
}

export function leagueAuthority(row: LeagueAuthorityRow): LeagueAuthority;
export function isCommissionerOf(row: LeagueAuthorityRow, userId: string): boolean;
```

`isCommissionerOf` is the only thing the six read sites call, and it is a total function over the union rather than an equality against a nullable string. That is the substantive safety argument for this design and it is worth stating precisely: **the failure direction of `league.commissionerUserId === userId` with a nullable left side is a silent authority grant** if the right side is ever widened to `string | null | undefined`, and that is the worst possible direction for an authorization check to fail. `isCommissionerOf` cannot fail that way, because the `house` branch returns `false` before any comparison happens.

The seven equality comparisons live at six line locations in five modules, and `read.ts:168` is a seventh location that is a `find` rather than a comparison. All of them are refactored in this step, listed so none is missed:

| Site | Today | After |
|---|---|---|
| `src/lib/leagues/membership.ts:44` | `league.commissionerUserId === userId` | `isCommissionerOf(league, userId)`; the select grows `houseRung` |
| `src/league-service/read.ts:90` (`listLeaguesForUser`) | same comparison | same replacement |
| `src/league-service/read.ts:168` (`commissionerTeamId`) | `teamRows.find(r => r.userId === league.commissionerUserId)?.id` | `null` for a house league, by the union's `house` branch, and the docblock at `:165` asserting a commissioner always has a team is **corrected** rather than deleted |
| `src/league-service/read.ts:209-210` | comparison, plus `commissionerUserId` on the body | `isCommissionerOf`, and the body field becomes `authority: LeagueAuthority` so the browser learns the house case from the type it already reads (`src/league-room/contract.ts:159,162`) |
| `src/league-service/home.ts:143,152` | two comparisons | two replacements |
| `src/league-service/draft-schedule.ts:136` | `row.commissionerUserId !== input.userId` inside a `FOR UPDATE` join | `!isCommissionerOf(row, input.userId)`, keeping the deliberate **404 rather than 403** so the route stays a non-oracle |
| `src/integrity-service/flags.ts:1475` | comparison, returns `null` on mismatch | `isCommissionerOf`, same `null` |

`src/league-service/invites.ts:194` is the eighth location and is also not a comparison: it looks the commissioner's `users` row up to render a display name. Under a nullable column that query does not type-check, which is the mechanism working — **the compiler asks the question rather than a reviewer noticing it.** Its answer is ruling 33: a house league cannot have invites at all, so the lookup is guarded by the authority union and `invitePreview` never reaches it. The `?? "Commissioner"` fallback at `:212` stays, because it defends a different case (a member league whose commissioner row is genuinely missing) and this addendum does not repurpose it into a lie about the house.

- [ ] **Step 4: The doors a house league closes, and the refusals that say so**

Two commissioner-only doors exist and have callers. Both **refuse** for a house league rather than moving to the operator console, and ruling 32 is the argument.

```ts
export const HOUSE_AUTHORITY_REFUSALS = {
  invite: "House leagues are open to everyone, so they don't use invite links. Share the league's page instead.",
  schedule: "Commish picks the draft time when a house league opens, because everyone here chose their seat around it.",
} as const;
```

- `withCommissioner` (`src/app/api/leagues/_shared.ts:69`, one caller: the invites route) keeps its 403 for a member league and returns `HOUSE_AUTHORITY_REFUSALS.invite` for a house one, so a house league's invite endpoint says something true instead of "Only the commissioner can do that" about a commissioner that does not exist.
- `setDraftKickoff` (`src/league-service/draft-schedule.ts:119`) gains `HOUSE_AUTHORITY_REFUSALS.schedule` beside its existing `KICKOFF_REFUSALS`. This is the parent plan's Task 7 rule generalized: a `when_full` draft's time may not be edited because nobody chose it, and a house draft's time may not be edited because the catalog chose it and twelve strangers picked a seat around it.

A third refusal — league settings — was drafted and **is not written**, because there is no league-settings write endpoint in the product and a refusal string with no caller is the control wired to nothing this codebase has refused five times. It is named here only so a reader knows the question was asked, and Task 16 step 3's inert sweep would catch it if somebody added it anyway.

- [ ] **Step 5: The members panel learns who runs the league**

`league-members-panel.tsx:52` renders the "Commissioner" badge by `team.ownerUserId === commissionerUserId`. In a house league no team matches, so the badge simply never renders, which is correct but silent. The panel gains one line above the roster instead: **"Run by Commish"**, with `Icon name="shield"`, sourced from the `authority` union on the league body rather than from a page-local check.

Two consumers correct themselves and are worth recording rather than editing. `src/league/next-action.ts:70` returns `"invite-managers"` only when `isCommissioner && filledTeams < teamCount`; in a house league the first conjunct is false for everybody, so a member of a filling house league falls through to `"open-draft-room"`, which is the right next action and is reached with no house branch at all. And `src/chat-service/chat.ts:146-148`'s teamless-commissioner fallback is never reached in a house league, because everybody who can post has a team.

- [ ] **Step 6: Persona panel — whose league is this**

Veteran, first-timer, commissioner, casual. The questions: does a first-timer joining a house league understand that no stranger can overrule them, which is the actual benefit; does a veteran read "no commissioner" as "no recourse", and if so what does the panel point them at (the candidate answer is the operator dispute path Phase 3 Plan B already shipped, and the panel decides whether the members panel names it); does a commissioner who runs their own leagues find the missing invite control confusing on a league they did not create; and does anybody read "Run by Commish" as marketing rather than as a fact about authority.

- [ ] **Step 7: Commit**

---

## Task 13: The catalog, and the factory that keeps it stocked

The founder's ruling has two halves. "View and join like FFPC and Apex" is a catalog: a shelf of canonical leagues with real draft times. "The lobby is never empty" is a factory: a fresh league opens when one fills. This task is both, and the factory being a **reconciler** is the decision that carries the rest.

**Files:**
- Create: `src/matchmaking/house-catalog.ts` (+ its test), `src/league-service/house-factory.ts` (+ its test)
- Modify: `src/league-service/creation.ts` (+ its test), `src/league-service/schemas.ts`, `src/league/config.ts`, `src/draft-service/ticker.ts` (+ its test), `src/draft-service/config.ts`, `src/app/api/leagues/route.ts`
- Modify: `src/integrity/system-actions.ts`, `src/integrity/test-support.ts`, `src/integrity-service/lock-order.test.ts` (+ their tests)

**Interfaces:**
- Consumes: `createLeague`, `LEAGUE_CONFIG.defaults`, `SCORING_PRESETS`, `ROSTER_SHAPES` (Task 1), `MATCHMAKING_CONFIG.sitAndGo` (Task 7), `AuditLogger`, `Clock`, `ENFORCED_LEAGUE_SQL`.
- Produces: `HOUSE_CATALOG`, `HouseRungName`, `HOUSE_RUNG_LABEL`, `houseKickoffFor`, `houseLeagueName`, `ensureHouseCatalog`, `spawnHouseLeagueInTx`, `openHouseLeaguesQuery`, `HouseFactoryDeps`, `HouseFactoryOutcome`, `LeagueOwner`, `CreateLeagueInput.owner`, `SystemActionCode["house_league_opened"]`.

- [ ] **Step 1: Write the failing catalog and factory tests**

```ts
// src/matchmaking/house-catalog.test.ts
it("staggers each open league of a rung by the rung's own spacing", () => {
  // Three leagues open at once, three hours apart, so a visitor at any hour of the evening
  // finds a draft they can actually attend. This is Model A's dated-draft mechanic, which is
  // the half of "like FFPC and Apex" that a browse page alone does not give you.
  const rung = HOUSE_CATALOG.rungs.open_12;
  expect(houseKickoffFor(NOW, rung, 0)).toBe(plusMinutes(NOW, rung.firstKickoffMinutes));
  expect(houseKickoffFor(NOW, rung, 2)).toBe(plusMinutes(NOW, rung.firstKickoffMinutes + 2 * rung.staggerMinutes));
});

it("keeps every staggered kickoff inside the window setDraftKickoff would accept", () => {
  // `LEAGUE_CONFIG.defaults.maxDraftDaysAhead` is 60 and `setDraftKickoff` refuses past it. A
  // catalog that could schedule beyond it would be the platform writing a time no human could
  // have written, which is a rule the platform gets to break only on purpose and not by drift.
  const widest = Math.max(...Object.values(HOUSE_CATALOG.rungs).map((r) => r.firstKickoffMinutes + (r.openAtOnce - 1) * r.staggerMinutes));
  expect(widest).toBeLessThan(LEAGUE_CONFIG.defaults.maxDraftDaysAhead * MINUTES_PER_DAY);
});

it("gives a sit-and-go rung no scheduled time at all, because filling is its schedule", () => {
  expect(HOUSE_CATALOG.rungs.sitandgo_12.startTrigger).toBe("when_full");
});

it("declares every rung against a tier the enforcement gate actually recognizes", () => {
  // A rung declared for a tier the join gate has never heard of is a shelf of leagues nobody
  // can be refused from, which is the segregation failing open.
  for (const rung of Object.values(HOUSE_CATALOG.rungs)) {
    expect(MATCHMAKING_CONFIG.experienceTiers).toContain(rung.experienceTier);
  }
});

it("keeps every rung on one canonical format, which is the whole liquidity argument", () => {
  const shapes = Object.values(HOUSE_CATALOG.rungs).map((r) => `${r.format}:${r.teamCount}:${r.scoringPreset}:${r.rosterShape}`);
  expect(new Set(shapes).size).toBe(1);
});
```

```ts
// src/league-service/house-factory.test.ts
it("opens a rung to its full width on a cold database", async () => {
  await ensureHouseCatalog(db, deps);
  expect(await openCountOf(db, "open_12")).toBe(HOUSE_CATALOG.rungs.open_12.openAtOnce);
});

it("opens exactly one more when one fills, so the shelf keeps its width", async () => {
  await ensureHouseCatalog(db, deps);
  const before = await openCountOf(db, "open_12");
  await fillLeague(db, await firstOpenHouseLeague(db, "open_12"));
  await ensureHouseCatalog(db, deps);
  expect(await openCountOf(db, "open_12")).toBe(before);
});

it("is a no-op on a shelf that is already full, and writes nothing at all", async () => {
  await ensureHouseCatalog(db, deps);
  const before = await snapshotOf(db);
  await ensureHouseCatalog(db, deps);
  await expectNoHouseLeagueTookPlace(db, before);
});

it("survives two instances reconciling the same rung on the same tick", async () => {
  // PgBouncer forbids advisory locks, so this is RESOLVED rather than PREVENTED: both
  // reconcilers compute the same next edition, therefore the same deterministic id, therefore
  // one INSERT wins the primary key and the other is a clean no-op. Two real connections,
  // because a single-connection test would prove nothing about the case this defends against.
  const [a, b] = await Promise.all([ensureHouseCatalog(dbOne, deps), ensureHouseCatalog(dbTwo, deps)]);
  expect(await openCountOf(db, "open_12")).toBe(HOUSE_CATALOG.rungs.open_12.openAtOnce);
  expect(a.opened.length + b.opened.length).toBe(HOUSE_CATALOG.rungs.open_12.openAtOnce);
});

it("counts a league that filled as closed, because a full league is not a seat", async () => {
  await ensureHouseCatalog(db, deps);
  await fillLeague(db, await firstOpenHouseLeague(db, "open_12"));
  expect(await openCountOf(db, "open_12")).toBe(HOUSE_CATALOG.rungs.open_12.openAtOnce - 1);
});

it("counts a league whose draft has started as closed, even with a seat still open", async () => {
  // `browseQuery` already refuses to list a league whose draft is not `scheduled`. The count
  // and the shelf must agree, or the factory restocks against a shelf nobody can see.
  await ensureHouseCatalog(db, deps);
  await startDraftOf(db, await firstOpenHouseLeague(db, "open_12"));
  expect(await openCountOf(db, "open_12")).toBe(HOUSE_CATALOG.rungs.open_12.openAtOnce - 1);
});

it("never reuses an edition number, so a replacement is never a resurrection", async () => {
  await ensureHouseCatalog(db, deps);
  const first = await firstOpenHouseLeague(db, "open_12");
  await fillLeague(db, first);
  await ensureHouseCatalog(db, deps);
  expect(await leagueIdsOf(db, "open_12")).toContain(first);
  expect(new Set(await leagueIdsOf(db, "open_12")).size).toBe(HOUSE_CATALOG.rungs.open_12.openAtOnce + 1);
});
```

- [ ] **Step 2: The catalog, as data, in the one directory the browser may read**

`src/matchmaking/house-catalog.ts` is pure, imports only types and browser-safe constants, and lands beside `src/matchmaking/config.ts` — the directory the client boundary already exempts, so `public-league-list.tsx` can render `HOUSE_RUNG_LABEL[rung]` by value-import exactly as it already value-imports `MATCHMAKING_CONFIG.stakeTiers`. That placement is the whole reason the catalog is not in `src/league`, which the boundary blocks.

```ts
export interface HouseRung {
  readonly experienceTier: ExperienceTier;
  readonly startTrigger: StartTrigger;
  /** How many of this rung stand open at once. The shelf's width. */
  readonly openAtOnce: number;
  /** Minutes from now to the first open league's kickoff. Ignored by a `when_full` rung. */
  readonly firstKickoffMinutes: number;
  /** Minutes between consecutive open leagues of this rung. Ignored by a `when_full` rung. */
  readonly staggerMinutes: number;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly scoringPreset: ScoringPresetName;
  readonly rosterShape: RosterShapeName;
  readonly medianGame: boolean;
  readonly stakeTier: number;
}

export const HOUSE_CATALOG = {
  rungs: {
    open_12:     { experienceTier: "experienced", startTrigger: "scheduled", openAtOnce: 3, firstKickoffMinutes: 180, staggerMinutes: 180, ...CANON },
    beginner_12: { experienceTier: "beginner",    startTrigger: "scheduled", openAtOnce: 2, firstKickoffMinutes: 240, staggerMinutes: 240, ...CANON },
    sitandgo_12: { experienceTier: "experienced", startTrigger: "when_full", openAtOnce: 1, firstKickoffMinutes: 0,   staggerMinutes: 0,   ...CANON },
  },
} as const;

export type HouseRungName = keyof typeof HOUSE_CATALOG.rungs;
export const HOUSE_RUNG_LABEL: Readonly<Record<HouseRungName, string>> = { … };
```

`CANON` is the one shared object every rung spreads, and Step 1's fifth test asserts every rung's format string is identical. That is §4.1's concentration doctrine enforced by a test rather than promised in a comment: **the rungs differ only in who may sit down and when the draft starts, never in what game gets played**, so every joiner is compatible with every open seat on the whole shelf. `CANON` reads `LEAGUE_CONFIG.defaults` for scoring and roster shape rather than restating them, so Task 1's half-PPR canon and Task 2's median toggle reach the catalog without a second place to change them. `HOUSE_RUNG_LABEL` is an exhaustive `Record` over `HouseRungName`, so a rung added without a label does not compile — the same shape `ROSTER_SHAPE_LABEL` and `TIER_COMPOSITION_LABEL` already use.

- [ ] **Step 3: `createLeague` learns that a league can have no owner**

`createLeague` takes `commissionerUserId: string` and unconditionally inserts that user's team at `creation.ts:118`. The factory has no user. So `CreateLeagueInput` swaps `commissionerUserId` + `teamName` for a discriminated `owner`:

```ts
export type LeagueOwner =
  | { readonly kind: "member"; readonly userId: string; readonly teamName: string }
  | { readonly kind: "house"; readonly rung: HouseRungName };
```

The transaction's `teams` insert happens only in the `member` branch; the `leagues` insert writes `commissionerUserId: null, houseRung: rung` in the `house` branch. This is a real change to a shipped function and it is the correct one, because the alternative is a second league-creation transaction that would drift from the first the day anything is added to a league at creation. `src/app/api/leagues/route.ts:36-37` is the one production caller and passes `{ kind: "member", userId, teamName }`; the audit event's `actorId` follows the same discriminant, which is how the factory's `league_created` event lands as `actorType: "system", actorId: null` with no new branch invented for it.

**The kickoff needs no change at all.** `CreateLeagueInput.kickoffAt?` already exists, and the reason recorded beside it names this caller: *"a caller who already has a real chosen time — a seed, a fixture, a future creation flow — should not have to create the league blind and immediately follow with `setDraftKickoff`."*

- [ ] **Step 4: The reconciler**

```ts
export async function ensureHouseCatalog(db: Db, deps: HouseFactoryDeps): Promise<HouseFactoryOutcome>;
```

For each rung: count the open leagues, compute the shortfall, create that many. **Open** is defined once, in `openHouseLeaguesQuery` (a query *builder*, so `src/db/index-plans.test.ts` can `EXPLAIN` it, which is this repo's idiom for every scan), and both halves of the definition matter — a league is open when its draft status is still `scheduled` **and** it has a free seat, which is exactly the pair `browseQuery` already uses. Step 1's last two tests pin each half, because a league that filled and a league that started are both off the shelf for different reasons and a count that knew only one of them would leave the lobby short precisely when it is busiest.

The shortfall is created **one league per transaction**, not all of them in one, and the reason is the lock order: each spawn is a short transaction ending with the audit anchor, and batching three would hold `leagues` row locks across three audit appends for no benefit. A partial failure leaves a partly restocked shelf, which the next tick finishes — the entire advantage of a reconciler over a hook, and worth naming: **this design has no missed-event failure mode, because it has no events.** The run is bounded by `DRAFT_SERVICE_CONFIG.maxHouseSpawnsPerRun`, following `maxDraftsPerTick` and `AUTO_SET_CONFIG.maxLeaguesPerRun`, and never throws past one rung's own failure, following `autoStartDueDrafts`.

**The factory has no refusal vocabulary, and its absence is a decision.** A `HOUSE_FACTORY_REFUSALS` constant was drafted alongside the two other refusal maps in this addendum and then removed: a refusal is a sentence said to a person, and nobody calls the reconciler. Its failure modes are *outcomes* — a shortfall it could not fill, a conflict it lost — reported on `HouseFactoryOutcome` and logged through the ticker's existing `reportIfDue`, exactly as `AutoStartOutcome.reason` already is. A user-facing string with no user is the same inert deliverable as a refusal with no caller.

**FK acquisitions, enumerated:** the `INSERT` into `leagues` takes **no parent lock at all** — its only FK, `commissioner_user_id`, is `NULL` for a house league, and a null FK acquires nothing, which is a small and pleasant consequence of ruling 28. The `INSERT` into `scoring_settings` takes `FOR KEY SHARE` on the new `leagues` row; the `INSERT` into `drafts` takes the same. **No `teams` insert happens at all.** The audit append is last, on the new league's own chain. `lock-order.test.ts` gains this writer with those FKs named, and the task **reads the suite's current entry count off the file** rather than trusting a number, because the parent plan's Task 7 already moves it.

- [ ] **Step 5: Idempotence is the primary key**

The new league's id is `house_${rung}_${edition}`, where `edition` is one more than the highest edition that rung has ever had — not the highest currently open, so an id is never reused and a replacement is never a resurrection (Step 1's last test). The insert is `ON CONFLICT (id) DO NOTHING`, and a zero-row result is a clean no-op the outcome reports rather than an error it throws.

This is ruling 35 and it deserves its sentence: **the idempotence mechanism is the table's existing primary key, so this addendum adds no unique index and needs no lock.** Two instances that race compute the same edition and therefore the same id, and Postgres arbitrates. It is the same reuse-if-exists stable-identity pattern the seed already uses everywhere, promoted to production code — which is also why Task 15's seed arc is three lines long.

- [ ] **Step 6: The tick, and where in it**

`ticker.ts` gains `reconcileHouse` as a third injectable dep, defaulting to the real `ensureHouseCatalog`, wrapped in its own `try`/`catch` exactly as `autoStart` is, and reported through the same rate-limited `reportIfDue`. It runs **after** `autoStart` and **before** the expiry scan, so a house league whose draft this very tick started is already off the shelf when the count is taken and its replacement opens on the same tick that emptied it.

It does not run every tick: the ticker fires once a second and a shelf does not change that fast, so `DRAFT_SERVICE_CONFIG.houseReconcileIntervalMs` gates it against the injected clock, and **both sides of that interval are tested** (a tick before it does not reconcile; a tick after it does), which is the property a tunable actually needs.

- [ ] **Step 7: The word, and the code**

`SYSTEM_ACTION_CODES` gains `house_league_opened`. `SYSTEM_ACTION_VISIBILITY` gives it `everyone`, because a league opening is a fact about a league nobody is in yet, and the first person to walk in should be able to read that the platform opened it and when. It rides `system_action` with `payload.action`, adding **no** `AUDIT_EVENT_TYPES` member, because that enum is frozen forever.

There is **no notice**, and the absence is deliberate: a notice is delivered to members, and a league that just opened has none. The one notice this addendum adds belongs to Task 14, where a member of a league that just filled is told a replacement is open.

The audit append goes on **the new league's own chain**, via `scopeFor(leagueId)` with a non-null league id. Ruling 36 is why: `audit-logger.ts:23-43` warns that the platform chain is a single row and stays one only while every platform-chain append is a short transaction, and a reconciler appending events on every interval forever is precisely the caller that warning names.

- [ ] **Step 8: The creation gate, and the one door the factory walks past**

`createLeague` calls `tierJoinPrecondition` before its transaction (`creation.ts:92`) to stop a veteran self-declaring a public beginner league. The factory does not pass through it, and ruling 39 is the argument: that gate exists because `leagues.experience_tier` is **self-declared by whoever creates the league**, and the abuse it prevents is a person declaring a tier they do not belong to in order to sit in it themselves. The platform declares the catalog and then sits in nothing, so there is no person whose tier could be checked and nothing the check would prevent.

The gate that does the real work here is untouched: `publicJoinPrecondition` (`join.ts:184`) refuses a veteran from `beginner_12` with the same predicate and the same sentence it uses on any other beginner league, and `recordTierBlockedJoin` records the refusal exactly as it already does. The `owner` discriminant is what keeps this from being a bypass flag: a `house` branch has no `userId` for a gate to check, and a `member` branch cannot name a rung, so neither shape can express the abuse.

- [ ] **Step 9: Commit**

---

## Task 14: The front door

The factory is invisible until the lobby leads with it. This is §4.1's hybrid lobby with the house shelf on top, and it is where the founder's "view and join" actually happens.

**Files:**
- Modify: `src/league-service/browse.ts` (+ its test), `src/matchmaking/contract.ts`, `src/matchmaking/filter.ts` (+ its test), `src/league-room/components/public-league-list.tsx` (+ its test), `waiting-room.tsx` (+ its test), `src/app/browse/page.tsx`, `src/app/api/public/leagues/route.ts`, `src/help/glossary.ts` (+ its test)
- Modify: `src/integrity/notices.ts`, `src/integrity/test-support.ts` (+ their tests)

**Interfaces:**
- Consumes: `listPublicLeagues`, `browseQuery`, `PUBLIC_LEAGUE_FIELDS`, `HOUSE_CATALOG`, `HOUSE_RUNG_LABEL`, `Countdown` (Task 8), `hasOpenSeat`.
- Produces: `PublicLeagueSummary.houseRung`, `BrowseBody.house`, `listPublicLeagues`'s new return type, the house shelf, one notice template.

- [ ] **Step 1: Write the failing shelf tests**

```ts
it("puts the house shelf and the member leagues in separate lists", async () => {
  const body = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
  expect(body.house.every((l) => l.houseRung !== null)).toBe(true);
  expect(body.leagues.every((l) => l.houseRung === null)).toBe(true);
});

it("orders the shelf by the draft a visitor can attend soonest", async () => {
  const { house } = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
  expect(house.map((l) => l.draftAt)).toEqual([...house.map((l) => l.draftAt)].sort());
});

it("still shows the member leagues when the shelf is empty, rather than an apology", async () => {
  // Never a dead end, in the form this addendum makes possible: the reconciler has not run yet.
  await removeHouseLeagues(db);
  const body = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
  expect(body.house).toEqual([]);
  expect(body.leagues.length).toBeGreaterThan(0);
});

it("refuses to let a filter hide the shelf", () => {
  // Parent ruling 1: every filter axis is a way for an open seat to become invisible to somebody
  // who would have taken it. `houseRung` is a field on a card and is NOT a `BrowseFilter` member,
  // and this is the test that keeps it that way.
  expect(Object.keys(EMPTY_BROWSE_FILTER)).not.toContain("houseRung");
});

it("declares the new field on the wire, or fails", () => {
  // `PUBLIC_LEAGUE_FIELDS` plus this assertion are why adding a field to a public, unauthenticated
  // read is a deliberate disclosure decision rather than a diff nobody reviewed.
  expect(PUBLIC_LEAGUE_FIELDS).toContain("houseRung");
});
```

- [ ] **Step 2: The shelf, as a second list rather than a sort key**

`listPublicLeagues` changes its return type from `readonly PublicLeagueSummary[]` to `BrowseBody`, which gains `house: readonly PublicLeagueSummary[]` beside its existing `leagues`. The house half runs as its own query against `leagues_house_rung_idx` rather than as an `ORDER BY` clause bolted onto the member half. Two reasons, and the second is load-bearing.

The mechanical reason: the parent plan's Task 8 already ordered the member list by seats-remaining, and a house-first sort would fight that ordering for the top rows. The product reason: **a shelf and a list are different promises.** The shelf says "these are ours, they draft on time, and there is always another one"; the list says "these are open leagues other people started". Collapsing them into one ordered list makes the house's promise unreadable, and that promise is what the founder's ruling is about.

`PublicLeagueSummary` gains `houseRung: string | null` as its **thirteenth** field (ten today, plus Task 7's and Task 8's), on the same disclosure reasoning `draftAt`, `scoringLabel`, `compositionCategory` and `startTrigger` each established: who runs a league is a fact about the league, not about any person in it.

The shelf's ordering is **soonest draft first**, a different rule from the member list's seats-remaining-first and correct for a different reason: the member list's job is to fill leagues that are nearly full, and the shelf's job is to hand a visitor the draft they can actually attend tonight. It reads straight off the partial index's second column.

- [ ] **Step 3: The card, and the sentence a house league can say that no other league can**

A house card renders `HOUSE_RUNG_LABEL[rung]`, `Icon name="shield"` with **"Run by Commish"**, its draft time or Task 8's **"Starts as soon as it fills"** for the sit-and-go rung, and Task 8's fill line in words. It does **not** render a progress bar, for the reason `public-league-list.tsx`'s own docblock gave and the parent plan's ruling 16 upheld.

The one new sentence goes under the shelf rather than on every card, so it is said once: **"A new league opens as soon as one fills, so there is always a seat."** It is the factory's user-visible contract, and it is allowed to be printed only because Task 13 makes it true by construction.

- [ ] **Step 4: The waiting room learns the house case**

Task 8 built four states for a filling league. A house league adds no state and changes one: in the filling state, the "Invite someone" action a member league offers cannot be honored here (ruling 33), so a house league's waiting room offers the two actions it can — see the rest of the shelf, or stay and watch the seats fill. That substitution is the "never a dead end" rule doing exactly what it exists for, on the one surface where the obvious action is unavailable.

`NOTICE_TEMPLATES` gains **one** template, delivered to the members of a house league that just filled: **"Your league is full and the draft is next. A new house league is open if you want a second team."** It is registry-derived so `copyViolations` sweeps it the commit it lands, `NOTICE_SAMPLES` gains its sample, and it has a caller in this task, which is what keeps Task 16's inert sweep green.

- [ ] **Step 5: Glossary**

`house league` joins `GLOSSARY`: "A league Commish runs. Everyone joins the same way, the rules are the same in every one, and a new one opens whenever one fills." `InfoTip` at the shelf heading and beside the members panel's "Run by Commish" line is how it reaches the page, and `helpLevel="guided"` prints it inline for the managers who asked for that.

- [ ] **Step 6: Persona panel — sitting down at a table nobody owns**

First-timer first, then casual, veteran, commissioner. The questions: does "Run by Commish" read as safer or stranger than a named commissioner to somebody who has never played for money; does a casual player understand that every league on the shelf plays the same game, which is the reason any of them fits; does the veteran believe "there is always a seat" or read it as marketing, and if the latter, does naming the mechanism help or hurt; and the commissioner's, which is the sharpest: **"If nobody runs it, who fixes a problem?"** — which the panel answers by deciding whether the shelf, the card, or the members panel is where the operator dispute path gets named.

- [ ] **Step 7: Commit**

---

## Task 15: The seed, and the walk

Every mechanism above is correct today and fires for nobody. This task is short on purpose: the factory is a reconciler, so seeding it is running it.

**Files:**
- Modify: `src/data/seed/index.ts` (+ its test)
- Modify: `e2e/formats-and-lobby.spec.ts` (Task 10's spec, extended)

- [ ] **Step 1: One arc, through the real reconciler**

`src/data/seed/index.ts` calls `ensureHouseCatalog` with the seed's own clock and audit logger, then fills one league of one rung through the **real** `joinPublicLeague`, then calls `ensureHouseCatalog` again. What a founder sees locally is a shelf at full width, one league that filled, and its replacement standing behind it with a real staggered kickoff and a real `house_league_opened` event on its own chain. Nothing is stamped by hand.

This arc is **stronger than the seed arcs beside it**, and the difference is worth recording. `seedPublicLeagues` and `seedDevLeagues` write their `leagues` row by direct Drizzle upsert so that `npm run seed` stays re-runnable, which means no `league_created` audit event is written for those leagues. The house arc goes through `createLeague` itself and therefore produces the audit event too — and it stays re-runnable anyway, because `ensureHouseCatalog` is idempotent by construction (ruling 35) rather than by upsert. **The seed adds no house fixture module**: the production code already has the property the seed would otherwise have had to arrange.

- [ ] **Step 2: The browser walk, folded into Task 10's spec**

`e2e/formats-and-lobby.spec.ts` gains one journey rather than a second file, because it already authenticates, already has the browse page, and a second spec would duplicate its fixtures: **a visitor lands on browse, the house shelf is present, they take the last open seat in a house league in one session, and the shelf in the other session shows a replacement that was not there before.**

Both e2e disciplines bind it and the second is unusually sharp here. Every interaction is click-and-verify, retried, against a receipt only the hydrated page produces. And **every count assertion is a delta**, never a literal: the shelf's width is read from the page before the join and compared after, because the factory itself changes the row count between page loads and a hardcoded three would be asserting the catalog rather than the behavior. The spec names `HOUSE_CATALOG.rungs` in a comment as the thing it deliberately does **not** assert against.

- [ ] **Step 3: Commit**

---

## Task 16: Docs, and the battery Task 11 now has to run

This task does not run a second closing battery. It **extends Task 11's**, which is the last thing to run in the worktree before the merge.

- [ ] **Step 1: The decision doc**

`docs/decisions/house-leagues.md`, written to the code that shipped rather than to this plan: the three-way schema weighing and why the nullable column with a CHECK won, the discriminated union and the seven comparisons it replaced, the reconciler-versus-hook argument and the missed-event failure mode it does not have, primary-key idempotence under a stack that forbids leader election, the catalog's one-canonical-format invariant and the test that enforces it, and the two commissioner doors with what each now says. Every ruling below that survived contact gets a section; every one that changed gets the correction, not the original.

- [ ] **Step 2: Drift**

`docs/conventions.md` (the directory map's three new files; the gate count stays **twenty-one** and the doc says why no gate joined; the migration section gains the `NOT VALID` / `VALIDATE CONSTRAINT` deploy-era note Task 12 step 2 owes it). `docs/league.md` (a league may have no member commissioner, and what that changes for a member). `docs/decisions/enforcement-and-tiers.md` (the **fourth** writer of `kickoff_at`, and the first with no human behind it; the creation gate's house branch, ruling 39). `docs/decisions/formats-and-lobby.md` (the parent plan's own new doc, which gains the shelf beside the sit-and-go trigger it already describes). `plans/00-roadmap.md` (the Phase 3.5 row Task 11 adds gains this addendum's file name, so a reader who finds "house league" in a commit message can find out what it was). `README.md`.

- [ ] **Step 3: The inert-deliverable sweep, extended**

Task 11 step 4 walks four lists. This addendum adds three: every `HouseRungName` is reachable from the shelf; every `SystemActionCode` added here has a publisher; every field added to `PublicLeagueSummary` renders on a card. **This addendum declares no name it does not wire** — if the sweep finds one, the name comes out rather than the sweep being loosened, which is the answer this loop has now given seven times. **This addendum's own self-review already applied it twice**, and both are recorded rather than quietly dropped: Task 12 step 4's `settings` refusal was named, found to have no endpoint to refuse at, and not written; and Task 13 step 4's `HOUSE_FACTORY_REFUSALS` was drafted, found to have no person to say a sentence to, and replaced by outcome reporting.

- [ ] **Step 4: The closing battery, extended**

Task 11 step 5's battery runs once, at the end, and gains these:

- **Three** migrations applied forward from a cold stack, not two — `0030`, `0031` and `0032` — and `0032`'s CHECK constraint asserted to reject a hand-written contradictory row, because a constraint nobody has ever seen refuse anything is a constraint nobody has tested.
- `npm run seed` **twice**, with the house shelf's width identical after the second run: the reconciler's idempotence proved against a real database rather than against a mock.
- `npm run audit:verify -- --full` over every chain, **including the per-league chains the factory created**, with first-verification-per-chain satisfied.
- The lock-order suite green at whatever count the file itself declares once this addendum's one new writer joins the parent plan's three. **The executing engineer reads that number off the file and does not trust one written here.**
- `npm run test:coverage` unfiltered with **twenty-one** gates at 100%.
- The whole suite routed **through PgBouncer**, and the two-instance reconciler test (Task 13 step 1) green there specifically, because that test's entire premise is a stack with no advisory locks.
- `npm run e2e` **twice**, green both times.

- [ ] **Step 5: Commit**

---

## Open questions, self-ruled

Numbered **28 onward**, continuing the parent plan's ledger rather than restarting it, so a reader who finds "ruling 34" in a commit message finds exactly one thing. Every judgment call this addendum makes, with the reasoning that would have to be wrong for the ruling to be wrong.

28. **`leagues.commissioner_user_id` becomes nullable, and `NULL` means the platform commissions this league.** This is the same sentence `audit_events.actor_id` already tells: that column is nullable, carries **no foreign key at all**, and `src/domain/audit.ts:71` states the invariant as *"Null only when `actorType` is `\"system\"`."* The codebase's existing representation of "the platform did this and there is no user row for it" is the **absence** of an identity, and a house league applies that answer to a second column. The standard objection to a nullable authority column is that null is ambiguous — it can mean "no commissioner", "not loaded" or "we forgot" — and the objection is correct, which is why the CHECK constraint in Task 12 step 2 is not decoration: `("house_rung" IS NULL) = ("commissioner_user_id" IS NOT NULL)` means a row in any of those other states does not commit. A pleasant second-order consequence, recorded because it is real and not merely rhetorical: a null FK acquires no `FOR KEY SHARE`, so the factory's `leagues` insert takes no parent lock at all. This is wrong only if a league could legitimately have neither a member commissioner nor a catalog rung, which is a league nothing in the product can create and nothing in the product could render.

29. **No house `users` row, and the honest concession first: it would have been the smallest diff.** A synthetic commissioner user would satisfy the `NOT NULL` FK, and all seven `=== userId` comparisons would keep compiling and would return `false` for every real person, which is the correct behavior. It is rejected anyway, on three grounds. **(a) `users.id` IS the WorkOS user id** — the Global Constraints say so and the identity seam is built on it; a row whose id names no WorkOS user makes the one invariant `getCurrentUser()` depends on false, and every path that assumes a `users` row is a person who can sign in becomes conditionally wrong with no compiler help. **(b) The exemption surface is unbounded and there is no mechanism for it.** There is no allowlist anywhere in the integrity stack: `SweepDeps` has no exclusion field, `sweepUnflaggedTrades` has none, the chain verifier has none, and every "does not apply here" decision in this codebase is a structural predicate rather than a set of ids. A house user would be the first exempted identity in the product's history, and the flag-only contract makes that worse rather than better — a detector may only *flag*, never act, so an un-exempted house identity could not be blocked by anything; it would simply generate advisory noise forever in the one surface whose entire value is signal. **(c) `BOOTSTRAP_ACTOR` is the precedent that would be cited for it, and it argues the other way**: it is a sentinel string at a boundary that collapses to `(null, "system")` before storage, fenced by a grep tripwire with exactly three callers. The codebase has already decided what a non-human actor looks like here, and it does not look like a row. The concession stands: option (a) is genuinely cheaper today and genuinely worse in every quarter after.

30. **No `created_by_house` boolean, because `house_rung` carries the same fact and more of it.** A boolean plus a nullable commissioner column would encode one fact twice and would be free to disagree; `house_rung` is not redundant with anything, because the reconciler must know *which* rung a league belongs to in order to count the shelf and the card must know it in order to label one. `house_rung IS NOT NULL` is the house predicate, and it has all three things `enforcement.ts:42-46` demands of a new column on the day it lands: a writer (`spawnHouseLeagueInTx`), a reader (`openHouseLeaguesQuery` and `browseQuery`) and a surface (the shelf and the members panel). The refused pattern is a flag nothing sets; this is a column three things need.

31. **Authority becomes a discriminated union read through one function, and the seven comparisons are refactored in the same task.** `isCommissionerOf` is total over `LeagueAuthority` and returns `false` on the `house` branch before comparing anything, so the failure direction that matters — a nullable left side silently granting authority to a widened right side — is not merely unlikely, it is unreachable. Doing this in the same task as the nullability is not tidiness: nullability without it would leave seven comparisons that all still compile and each mean something slightly different. This is wrong only if the union's `house` branch will one day need to name somebody, which ruling 32 argues it never will.

32. **A house league's commissioner-only doors refuse; they are not re-homed to the operator console.** The tempting design is an operator surface that can do to a house league whatever a commissioner does to theirs. It is rejected because the discretionary commissioner powers are precisely the ones a public league must not have: `beating-apex-strategy.md` §4.1 asks for *"automated rule enforcement and dispute resolution rather than handing commissioner powers to whichever stranger happened to create the league"*, and an operator holding those powers is the same trust problem with a better-paid stranger. What the operator surface already has is the right thing and it is already built: the moderation queue, the flag resolution path, and the dispute handling Phase 3 Plan B shipped. So the operator gains **no new house control in this addendum**, and the one thing a running catalog genuinely needs — retiring or widening a rung — is a code change to `HOUSE_CATALOG`, which is ruling 37's whole point. This is wrong if a house league can reach a state only a discretionary human decision resolves, which is the state the moderation stack exists to catch and which would be a finding against the moderation stack rather than an argument for a commissioner.

33. **A house league cannot issue invites at all, and this is a security property rather than a simplification.** The invite door is the product's one deliberate mechanism-based exemption from tier segregation (`INTEGRITY_CONFIG`: *"The invite door is exempt by design and asks neither this switch nor the predicate"*). That exemption is safe in a member league because a commissioner invites people they know. In a house league it would be a hole straight through the segregation the `beginner_12` rung exists to provide: an invite link to a beginner house league is a veteran's way past `publicJoinPrecondition`. So the door is closed structurally — `invitePreview` and `createInvite` never reach a house league — rather than gated with a condition somebody could later loosen. A pleasant consequence: `invites.ts:194`'s lookup of the commissioner's `users` row does not type-check under a nullable column, so the compiler raises this question rather than a reviewer having to.

34. **The factory is a level-triggered reconciler on the existing ticker, not an edge-triggered hook in the join transaction.** The obvious design spawns the replacement inside `joinLeagueInTx`, right beside Task 7's fill trigger, on the tick of the twelfth seat. It is rejected on three counts. **(a) A failure to spawn would fail a stranger's join** — the audit append and the notice row are inside the business transaction by Plan A's rule, so a factory error inside the join transaction rolls back the seat somebody just took. **(b) It has a missed-event failure mode and a reconciler does not.** An edge trigger that does not fire leaves the shelf permanently short with nothing to notice; a level trigger that misses a tick fixes itself on the next one. **(c) A join is the wrong place to pay for a league creation** — three inserts and an audit append on a stranger's latency, for a thing nobody is waiting on. The cost is that a replacement appears within one reconcile interval rather than instantly, measured against a shelf that still has other open leagues on it. This is wrong only if a rung routinely runs to zero within one interval, which is an `openAtOnce` problem and is tunable without a redesign.

35. **Spawn idempotence is the primary key, not a new unique index and not a lock.** PgBouncer transaction pooling forbids `pg_advisory_lock`, so leader election is unavailable by construction and two instances reconciling the same rung on the same tick is a case that must be *resolved* rather than *prevented* — the identical position `autoStartDueDrafts` is in, and it resolves with a guarded `UPDATE`. A deterministic id (`house_${rung}_${edition}`) plus `ON CONFLICT (id) DO NOTHING` resolves this one with the index `leagues` already has. The alternative, a unique index on `(house_rung, edition)`, would add an index to enforce a uniqueness the primary key already expresses. The test that matters runs on **two real connections**, because a single-connection test proves nothing about the case this defends against.

36. **The factory's audit append lands on the new league's own chain, never the platform chain.** `audit-logger.ts:23-43` states that the platform chain is a single row and stays one *only* because every platform-chain append is a short transaction, and warns that a caller appending platform events frequently *"is the moment to shard the platform chain."* A reconciler appending events on every interval forever is precisely that caller. Routing through `scopeFor(leagueId)` with a non-null league id keeps the factory off the contended row entirely and puts each event where its readers will be: the members who eventually join that league. A league's own chain then begins with the event that created the league, which reads better than it was designed to.

37. **The catalog is code in `src/matchmaking/house-catalog.ts`, with founder-vetoable defaults, and not an environment variable or a database table.** Three properties argue for code and each rules an alternative out. It must be **browser-safe**, because the card labels a rung and the client boundary blocks `src/league` and `src/league-service`; `src/matchmaking` is on the eight-directory exempt list and is already gated at 100%, so the catalog lands there and no ninth exemption is created. It must be **type-checked against the rest of the product** — a rung names a scoring preset, a roster shape, an experience tier and a start trigger, and every one is a union the compiler can check, which a `.env` string and a jsonb row cannot. And it must be **reviewable**, because the catalog *is* the product: changing `openAtOnce` from 3 to 8 changes what the lobby is, and that belongs in a commit with a reason in its body rather than in a deploy variable nobody reviews. It is a vocabulary module in the same sense `SCORING_PRESETS` is one (*"Adding a preset means adding it here and nowhere else"*), which is why it does not violate the parent plan's no-new-config-file ruling. The founder veto is exercised the way every other product constant in this repo is: edit the value, read the test that pins it.

38. **The launch catalog is one canonical family across three rungs, and the rungs differ only in who may sit down and when the draft starts.** §4.1's finding is that Apex fills leagues *because* every joiner fits every open seat, and the failure it names is fragmenting the pool across formats. So a test asserts every rung's `format:teamCount:scoringPreset:rosterShape` string is identical, and the two axes that do vary are the one that exists to keep people apart on purpose (`experienceTier`) and the one that serves two genuinely different appetites for waiting (`startTrigger`). The `sitandgo_12` rung ships at `openAtOnce: 1` rather than zero, because a rung that never spawns is a control wired to nothing and this codebase has refused that five times; one live pod keeps the mechanism honest and is small enough not to split the evening's fill population. **The stagger is the FFPC/Apex mechanic the founder named**: a visitor at any hour of the evening finds a draft they can attend, which is the entire reason Model A's dated drafts work, and a test keeps the widest stagger inside the 60-day window `setDraftKickoff` would accept from a human.

39. **The factory walks past the creation-time tier gate, and this is not a bypass.** `tierJoinPrecondition` at `creation.ts:92` exists because `leagues.experience_tier` is self-declared by whoever creates the league, and the abuse it prevents is a person declaring a tier they do not belong to in order to sit in it. The platform declares the catalog and then sits in nothing, so there is no person whose tier could be checked and nothing the check would prevent. The gate that does the real work is untouched: `publicJoinPrecondition` refuses a veteran from `beginner_12` with the same predicate and the same sentence it uses on any other beginner league. The `owner` discriminant is what keeps this from being a flag somebody could set — a `member` branch cannot name a rung and a `house` branch has no `userId` — so neither shape can express the bypass.

40. **House leagues are the most enforced leagues on the platform, and no detector gains an exemption.** Every house league is `is_public_matchmade = true`, so `enforcementAppliesTo` is true for all of them: auto-start runs, auto-lineup runs, trade auto-hold runs, tier segregation runs. The multi-account detector sweeps a house league's twelve members exactly as it sweeps any league's, which is correct and is the strongest argument for it — `beating-apex-strategy.md` §4.1 says multi-account detection *"matters more here than anywhere else in the product"* precisely because nobody in a stranger league has the context to catch it. And the exemption a house *user* would have needed is not merely declined here, it is **unnecessary**: there is no house row for a detector to sweep, which is ruling 29's benefit arriving.

41. **Stakes attach to a rung, and that is the Phase 4 seam. Nothing is built for it.** FFPC's catalog is a price list — a rung *is* a price point — and `HouseRung.stakeTier` already exists in the catalog type as the cosmetic integer the browse card already renders, unchanged and still worth nothing (`MATCHMAKING_CONFIG.stakeDisclosure` still says so). The seam is named so Phase 4 adds a payout structure to a **rung** rather than a pricing concept to the lobby: the catalog is the natural home for an entry fee, a rake and a payout table because it is already the thing that decides what a league is. This addendum writes no money field, no payout row and no disclosure change, and the parent plan's ruling 26 already ruled two-layer prizes out for the same phase.

42. **This addendum adds no realtime event type, no icon, no coverage gate, no exempt directory, and no UI primitive.** No realtime type, because a league that opens has no subscribers and everything afterward is published by paths that already publish. No icon, because `shield` already means the platform acting on its own, which is exactly what a house league is. No gate and no ninth exempt directory, because all three new modules land inside directories already gated at 100% and `src/matchmaking` is already exempt, which is why the catalog is there. No primitive, because "Run by Commish" is an `Icon` and a label rendered in two places, and the founder rule extracts at three.

43. **The house league is not the mock lobby, and ruling 25's obstacle must not be borrowed.** Ruling 25 rules the public mock-draft lobby out because `teams.user_id` is `NOT NULL` with a `(league_id, user_id)` unique index, so a seat no person occupies cannot exist, and building one means a first-class non-human participant reaching the roster, the chat, the audit log, the activity feed and the review feed. **None of that applies here.** A house league has twelve real human members in twelve ordinary teams; `teams` is untouched by this addendum and no non-human seat is created. What a house league lacks is a member *commissioner*, which is a nullable column on `leagues`. Conflating the two is the single most likely way this addendum could accidentally build the thing Phase 3.5 deliberately deferred, so it is written down: **no seat, no bot, no synthetic participant, and `teams` keeps its `NOT NULL`.** Ruling 25 stands unamended and the mock lobby stays ledgered to Phase 6.

---

## Self-review

**The founder's ruling, clause by clause:**

| Clause | Where |
|---|---|
| "the house is a core feature" | Tasks 12 to 14. It is a schema change, a factory and the lobby's first shelf, not a seeded fixture |
| "a view and join type of experience like FFPC and Apex" | Task 14's shelf over Task 13's catalog: dated drafts on a stagger (Model A), browsed and picked with fill status visible (Model C), which is the hybrid §4.1 asked for |
| "the lobby is never empty because a fresh house league spawns whenever one fills" | Task 13's reconciler, and ruling 34 explains why a reconciler keeps that promise where a hook would only usually keep it |
| "member-created leagues coexist" | Task 14 step 2 keeps them as their own list, with the parent plan's Task 8 ordering untouched |
| "the house lobby is the front door" | Task 14 step 2: the shelf is first, and parent ruling 1 keeps it un-filterable so it cannot be hidden |

**The schema question, answered against its three named candidates:**

| Candidate | Ruling |
|---|---|
| A system "house" `users` row | **Rejected**, ruling 29, with the concession that it is the smallest diff. Breaks the `users.id` IS the WorkOS id invariant, and needs the first detector exemption in the product's history, in a stack whose every "does not apply" is a structural predicate |
| Nullable commissioner columns | **Adopted**, ruling 28, and its known defect (null is ambiguous) is closed by a CHECK constraint rather than argued away. `audit_events.actor_id` is the in-codebase precedent for exactly this sentence |
| `leagues.created_by_house` boolean, commissioner functions routed to the operator surface | **Half adopted, half rejected.** The column is adopted in a better form (`house_rung`, ruling 30, which carries the same fact plus the rung the reconciler and the card both need). The routing is rejected, ruling 32: the doors refuse, because handing discretionary commissioner powers to an operator is the trust problem §4.1 names, with a better-paid stranger |

**Precedents weighed, each with what it actually says:** `BOOTSTRAP_ACTOR` (a boundary sentinel, not a row, fenced by a grep tripwire with three callers) argued **against** a house user. `audit_events.actor_id` (nullable, no FK, null means system) argued **for** the nullable column. `enforcementAppliesTo`'s *"is the platform this league's commissioner?"* argued that this is a three-phase-old idea being completed rather than a new one. `enforcement.ts:42-46`'s refusal of a per-league flag with no writer set the bar `house_rung` had to clear, and it clears it. The flag-only contract argued against any identity a detector would have to be told to skip. `chat.ts:146-148`'s teamless-commissioner comment, `membership.ts:67`'s admission rule and `invites.ts:212`'s `?? "Commissioner"` fallback showed the product was already half-ready. `createLeague`'s `kickoffAt?` docblock named this caller before it existed.

**Right-sizing:** five tasks, sixteen rulings, one migration, three new modules, one new system-action code, one new notice template, one new `PublicLeagueSummary` field, zero new config files, zero new gates, zero new icons, zero new realtime types, zero new e2e specs, and **two names deleted during this plan's own self-review** for having no caller. The parent plan is eleven tasks and five new modules; this is an addendum and reads like one.

**Composition with Tasks 1 to 11, stated so nothing is silently assumed:** Task 13's `CANON` reads `LEAGUE_CONFIG.defaults`, which **Task 1** sets to half-PPR and **Task 2** gives a median toggle, so the catalog inherits the canon rather than restating it. Task 13's `sitandgo_12` rung writes `start_trigger = 'when_full'`, the column **Task 7** creates, and its leagues fire through **Task 7's** fill trigger with no second mechanism. Task 14's shelf sits above the list **Task 8** reordered, and its waiting-room change extends **Task 8's** component. Task 12's `setDraftKickoff` refusal sits beside **Task 7 step 5's**. Task 15 extends **Task 10's** seed and **Task 10's** spec. Task 16 extends **Task 11's** battery, **Task 11's** decision doc and **Task 11's** roadmap row. **If Tasks 1 to 11 are not merged, every one of those is a dangling reference**, which is why this addendum is numbered rather than standalone.

**Placeholder scan:** no `TODO`, no `TBD`, no "handle errors appropriately", no "similar to Task N", no step whose expected output is unstated. Every file in the File Structure tables appears in a task's Files block. Three places name a helper the executing engineer writes to taste rather than showing it in full — `houseLeagueName`'s body (Task 13 step 2), `openHouseLeaguesQuery`'s SQL (Task 13 step 4) and the shelf component's body (Task 14 step 3) — and each names the existing file in this repo whose shape it copies (`src/league/terms.ts`, `src/league-service/browse.ts`'s `browseQuery`, `src/league-room/components/public-league-list.tsx`). Two numbers are deliberately **not** written here and are read off the file instead: the lock-order suite's entry count and the seed's own shelf width.

**Type consistency:** `HouseRungName` is derived from `keyof typeof HOUSE_CATALOG.rungs` rather than declared twice; `HOUSE_RUNG_LABEL` is an exhaustive `Record` over it, so a rung added without a label is a compile error, matching `ROSTER_SHAPE_LABEL`, `MEDIAN_RESULT_LABEL`, `TIER_COMPOSITION_LABEL` and every other label map in the product. `LeagueAuthority` and `LeagueOwner` are `readonly` discriminated unions declared once each. `HouseRung` reuses `ExperienceTier`, `DraftFormat`, `StartTrigger`, `ScoringPresetName` and `RosterShapeName` rather than restating any of them as strings, which is what makes the compiler able to check a catalog entry at all. `Date` appears only at the Drizzle edge; the catalog's times are ISO strings, the discipline `AuditEvent`, `IntegrityFlag` and `TradeProposal` all keep. Nothing here declares a second type named for something that already has one: a **rung** is not a **tier** and shares no word with `users.experience_tier`, `leagues.experience_tier` or `participationTier`, which `src/participation/tier.ts:1-13` warns is already three meanings and does not need a fourth.

**Boundary check:** `src/matchmaking/house-catalog.ts` is pure, imports only types and browser-safe constants, and is value-imported by `src/league-room/**` legally, because `src/matchmaking` is one of the eight exempt directories — and that legality is the reason it is there rather than in `src/league`. `src/league-service/authority.ts` and `house-factory.ts` import `@/db` and are server-side; `src/league-room/**` reaches `LeagueAuthority` as a serialized field on the league body, exactly as it already reaches `isCommissioner`. `src/draft-service/ticker.ts` importing `@/league-service/house-factory` is a new edge from `draft-service` to `league-service`, and it is the same edge `auto-start.ts` already has to `@/league-service/enforcement`. `src/app/**` is exempt by design. Nothing under `src/**` imports `scripts/**` or `e2e/**`, and this addendum adds no script.

**Founder rules:** two persona panels, each a marked step, split by audience because a person deciding whether to sit down at a table nobody owns and a person discovering the table they already sat at is owned by nobody are two different moments with two different fears. Every user-facing string quoted here is em-dash and en-dash free, active, and free of `accusatoryTerms` and `passiveConstructions`. No new icon, no new primitive, no mock data on a real surface. Nothing is built in a shape a later phase throws away: `house_rung` is what a Phase 4 payout structure attaches to (ruling 41), `LeagueAuthority` is what a Phase 6 moderator escalates against, and the reconciler is the shape a wider catalog grows rungs into.

**Four things this addendum deliberately does not do.** It does not add a **bot, a mock lobby, or any non-human seat**, and ruling 43 says why borrowing ruling 25's obstacle here would be a category error. It does not add a **browse filter axis**, because the shelf is a list and not a facet, and parent ruling 1 says a filter is how a pool fragments. It does not give an **operator any new power over a league**, because that is the trust problem restated rather than solved (ruling 32). And it does not touch **money**: `stakeTier` stays the cosmetic integer it already is, the disclosure is unchanged, and ruling 41 names the seam without opening it.

## The founder-gated bucket, unchanged

Nothing in this addendum is blocked on any of it. Listed so no task quietly assumes one arrived.

| Gate | What this addendum ships without it |
|---|---|
| Platform-verified client IP + Redis-shared limiter counters (LAUNCH-BLOCKING since Phase 2 Plan C) | `INTEGRITY_CONFIG.multiAccount.weights.ip` stays **0**, untouched. The house shelf rides the existing browse read and its per-IP ceiling is unchanged |
| An email sender | In-app delivery only. One new notice type, not emailable, and the catalog still says so honestly with no switch beside it |
| A production scheduler | The factory rides the in-process ticker that already runs `autoStartDueDrafts`, as a third injectable dep with the same `try`/`catch` and the same rate-limited reporting. Rulings 34 and 35 are what make that safe without leader election |
| A banking partner and gaming counsel (Phase 4) | Stakes stay cosmetic on a rung, and ruling 41 records the seam as scope rather than difficulty |
| An object store, Fly.io, managed Postgres/Redis, Sentry | Unrelated to every task here |
