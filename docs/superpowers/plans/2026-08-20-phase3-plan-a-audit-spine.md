# Phase 3 Plan A — The Audit Spine and the League Activity Feed

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give this product a tamper-evident record of everything that happens in a league, make writing to that record the only way a mutation is allowed to happen, and put the readable half of it in front of an ordinary league member on the day it merges.

**Architecture:** Four strands. **(1) The chain.** `audit_events` is an append-only table whose every row carries the hash of the row before it, so a retroactive edit breaks a link a verifier can find. Appends are serialized per chain by `SELECT … FOR UPDATE` on an anchor row in `audit_chains` — the same row-lock mechanism `draft_actions` already uses for drafts, because PgBouncer transaction pooling forbids advisory locks — and that anchor row is also the chain's rollup in the sense `docs/decisions/data-layer-hardening.md` means: head sequence and head hash, updated in the same transaction as the append it summarizes, over an append-only source that stays the reconciliation truth. There is **one chain per league** plus **one platform chain**, ruled with the write-contention math in ruling 1. **(2) The seam.** `AuditLogger` exposes `record` and `recordAll` and nothing else — no update, no delete, no upsert — and both take the caller's `DbTx`, because an audit event that can commit separately from the write it records is worthless. Eight existing writes are wired to it in this plan; the rest of the vocabulary is declared and reserved with its consuming plan named. **(3) Verification.** `verifyChainIntegrity` walks forward from a per-scope checkpoint in batches; `verifyFullChainIntegrity` walks from genesis; neither runs on a request path, and `scripts/verify-audit-chain.ts` is the only caller today. A broken chain stops the checkpoint and exits the script non-zero. It never stops the product, and it never repairs itself. **(4) The visible half.** A durable `member_notices` row is what a system-triggered action says to the member it affected, delivered live over a **per-user** Redis stream key so a private notice can never ride a league broadcast, and `/app/leagues/[leagueId]/activity` renders the member-visible slice of the chain through a deny-by-default, per-`eventType` field allowlist.

**Tech Stack:** TypeScript strict · Next.js 15 App Router · React 19 · Drizzle ORM over Postgres 17 (`drizzle-orm/postgres-js`) through PgBouncer in transaction mode · Redis 7 (Streams → SSE) · WorkOS AuthKit · Zod v4 · `node:crypto` (sha256, no new dependency) · Vitest + happy-dom + @testing-library/react + vitest-axe · Playwright.

**Spec:** `plans/phase-3-trust-and-integrity.md` — **Step 1** in full (lines 64–105), plus the **member-visible half of Step 4** (line 198's league activity feed and line 199's allowlist proof, whose admin half stays in Plan B). Phase split, the three structural findings, the naming-collision flags and the founder-decision defaults: `docs/superpowers/plans/2026-08-20-phase3-overview.md`.

**Depends on Plan B, C and D for nothing.** This is the first plan of the phase and nothing in the phase exists yet. It also **does not depend on Phase 2 Plan D**: no deployed URL, no email sender, no production scheduler, no object store. The two places Plan D's resources would change behavior are named and are each a config value or a caller, not undelivered code: `INTEGRITY_CONFIG.verification.fullVerifyIntervalHours` (the cadence a production scheduler would run `scripts/verify-audit-chain.ts` on — the script is real and runnable today), and `deliverableChannels()` staying `["in_app"]` until an email sender exists.

**Consumers this plan ships for, by name.** Plan B reads `AuditLogger`, `notifyAffectedMember` and the activity feed, and publishes `flag_raised` / `flag_resolved` / `admin_action`. Plan C publishes `trade_proposed` / `trade_accepted` / `trade_rejected` / `roster_move`. Plan D publishes `system_action` from its enforcement policy and adds three notice types. Every reserved-but-unpublished name in this plan names its plan in its own docblock, the way `score.update` named Phase 2 Plan B while it sat reserved through Phase 1.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the codebase's own rules.

**From `docs/conventions.md`:**

- **Directive: no MVP.** *"I don't want an MVP. Let's work towards the end solution."* Phases sequence **scope** (money, tax, native apps come later), not quality. Nothing gets built in a form a later phase plans to throw away.
- **Stack is pinned.** Postgres 17 via Drizzle ORM (`drizzle-orm/postgres-js`, `postgres` driver). Redis 7 Streams → Server-Sent Events is *"the one and only real-time mechanism"*. Auth is WorkOS AuthKit: *"We do not roll our own auth."* Validation is Zod v4 (`z.email()`, not the deprecated `z.string().email()`).
- **`docker-compose.yml` pins a top-level `name: fantasy`**, so every git worktree resolves to the **same** Compose project. Run `npm run infra:up` from any worktree; they all talk to one shared stack.
- **Immutability.** Domain types are `readonly`; use `readonly T[]` / `Readonly<Record<…>>`. Update by spreading into new objects. Enforced for `src/domain/**` by `eslint-plugin-functional` (`functional/prefer-readonly-type`, `functional/immutable-data`, `functional/no-let`).
- **Timing — no ambient clock in domain/reducer code.** Anything time-dependent takes a `Clock` (`src/domain/timing.ts`) and calls `clock.now()`. Actions carry an explicit ISO `timestamp`. Tests inject a fixed clock. `Date.now()` / `new Date()` are only allowed at the outermost edge (route handlers, `current-user.ts`, `publisher.ts`).
- **Identity — one seam, WorkOS underneath.** Server code reads "who is this" **only** via `getCurrentUser()` / `requireCurrentUser()` from `src/lib/auth/current-user.ts`. `users.id` **is** the WorkOS user id. API and SSE routes never redirect — they return a JSON 401 themselves.
- **Real-time — one mechanism.** Writes are plain HTTP: validate → persist to Postgres → then `getPublisher().publish(...)`. **Postgres is authoritative; publishing is best-effort and must never fail the write.** Delivery is Redis Streams over SSE, read with plain `XREAD BLOCK`. **Never `XREADGROUP`.** Event types are enumerated once in `src/lib/realtime/events.ts`. No Socket.io, no managed realtime vendor, no second transport — ever.
- **Draft state — the action log is the source of truth.** An in-progress draft's state is *derived*, by replaying `draft_actions` through the pure reducer in `src/draft-engine/`. Every accepted action is persisted before it is cached or published, and `teamId` is always resolved from the authenticated session, never from a request body.
- **Client boundary.** Everything under `src/draft-room/**`, `src/league-room/**`, `src/chat-room/**` and `src/account-room/**` is BROWSER code. Each talks to its service layer ONLY over the wire — never by importing `@/draft-engine`, `@/draft-service`, `@/league`, `@/league-service`, `@/chat-service`, `@/ai-advisor`, `@/review-service`, `@/identity-service`, `@/db`, `@/lib/realtime`, `@/lib/auth`, `@/lib/leagues`, `@/lib/llm`, `@/lib/api/respond`, `@/data/seed`, `@/stats-pipeline`, `@/stats` or `@/gifs` as VALUES. `import type` stays allowed. The rule is deliberately **not** applied to `src/app/**`. Exempt pure directories that browser code MAY value-import: `src/chat/**`, `src/matchmaking/**`, `src/identity/**`, `src/help/**`, `src/reviews/**`. **This plan adds `@/integrity` and `@/integrity-service` to the blocked list, not the exempt one** (ruling 14).
- **API responses.** Every JSON route returns the envelope from `src/lib/api/respond.ts`: `{ ok: true, data }` or `{ ok: false, error }` with a meaningful HTTP status. Bodies are parsed with `parseJson(request, ZodSchema)`; a bad body is a 400 naming the field. **Error strings are user-facing plain language — never raw DB/exception text.**
- **Config over magic numbers.** Thresholds, limits, durations, key formats live in a `config.ts` next to the module that uses them (`LEAGUE_CONFIG`, `REALTIME_CONFIG`, `DRAFT_QUEUE_CONFIG`, `UI_CONFIG`, `MATCHMAKING_CONFIG`, `STATS_INGESTION_CONFIG`, …). No inline literals for tunables. **This plan adds the 23rd: `INTEGRITY_CONFIG` in `src/integrity/config.ts`**, which is what the spec's `src/config/integrity.ts` means in this repo (ruling 24).
- **Tests.** **Test-first.** Tests live beside the code: `src/<feature>/**/*.test.ts`. Verification commands filter by directory: `npm test -- src/integrity`, never by a guessed filename. Integration tests hit the **real** test Postgres / Redis from docker-compose — not mocks. Use `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (`fileParallelism: false`).
- **Coverage threshold: 100%** for the gated directories, configured in `vitest.config.mts` with `coverage.include` **and** a matching `thresholds` block (an `include` entry with no threshold is not a gate at all). **Fourteen** gated directories on `main` today: `src/scoring`, `src/draft-engine`, `src/draft-room/state`, `src/league`, `src/chat`, `src/matchmaking`, `src/stats`, `src/stats-pipeline`, `src/identity`, `src/help`, `src/reviews`, `src/gifs`, `src/identity-service`, `src/review-service`. **This plan adds two** (Task 11, ruling 14). Verify with an **unfiltered** `npm run test:coverage`.
- **Browser end-to-end** lives in `e2e/` and runs under Playwright against a production build and the real docker-compose stack (`npm run e2e`). **There is no dev auth bypass and none may be added.**
- **Any step shipping a user-visible surface additionally requires:** a design review against `docs/design-system.md`; loading/empty/error/success states all designed; an automated a11y check plus a keyboard-only walkthrough of the primary flow; a plain-language copy review; renders and operates at 360px width.
- **Migrations.** `ADD COLUMN … NOT NULL` without a `DEFAULT` is acceptable only while the table is empty (pre-first-deploy, as in `drizzle/0001`); once deployed, add with a DEFAULT or backfill in a separate migration.
- **Commits.** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Commit after every completed step; commit bodies explain *why* and record any deviation from the plan.
- **Environment.** `.env.example` is committed; `.env.local` is gitignored. Fail fast with a clear message when a required var is missing (see `db/client.ts`, `realtime/redis.ts`).
- **Verification commands (every step):** `npm run typecheck && npm run lint && npm test && npm run build`

**From `docs/design-system.md`:**

- **No raw hex, no raw px, no arbitrary values in feature code.** `src/design/tokens.ts` is the only file allowed to contain a color literal.
- **Never a dead end.** Empty and error states always offer an action (`StatePanelProps.action` is required, not optional, and `EmptyState`/`ErrorState` inherit that).
- **Both themes are first-class.** Every surface is designed and tested in light and dark, via `inBothThemes` from `src/components/ui/test-utils.tsx`. **Mobile-first**, minimum viewport 360px. WCAG 2.2 AA.
- **Copy.** Plain language, active voice, specific. Errors say what happened and what to do next.
- **`Icon` is the one icon entry point. Feature code never imports `lucide-react` directly.** `IconName`s on `main` today: `trophy`, `users`, `clock`, `alert-triangle`, `inbox`, `refresh-cw`, `check`, `x`, `chevron-right`, `search`, `info`, `shield`, `flame`, `anchor`, `rocket`, `crown`, `bolt`, `clover`. **This plan adds none**: every glyph the activity feed and the notice inbox need is already in the map (Task 10).
- **`PositionBadge` is the only way to render a position label; `Sticker` is the only way to render a position-pigmented tile.** Nothing else may reach for `bg-pos-*` directly.
- **Never set the display face on a paragraph.** It is a lettering face, not a reading face.
- Tunables for primitives live in `src/components/ui/config.ts` — never inline in a component.

**From `docs/decisions/data-layer-hardening.md`:**

- **Balance as rollup.** Any running total is a rollup row updated **in the same transaction** as each contributing write, over an append-only source table that stays the reconciliation source of truth. Never a `SUM()` on the read path. The threshold is unbounded growth: derive over a bounded set, roll up over an unbounded one. **`audit_events` is the unbounded append-only source; `audit_chains` is its rollup, and this plan is the phase that convention was written for.**
- **PgBouncer transaction pooling forbids session state.** No `pg_advisory_lock`, no named prepared statements (`prepare: false` is unconditional), no `SET` outside a transaction, no session-scoped temp tables, **no `LISTEN`/`NOTIFY`**. DDL goes through the direct port, never the pooler.

**Founder rules (binding, from the phase overview and founder memory):**

- **No em-dashes in user-facing copy.** Not in component text, not in error strings, not in notice templates, not in seed data. Source comments and this plan's own prose may use them; the codebase already does. **This phase writes more system-authored copy than any before it**, so Task 7 turns the rule into a test over the one file that is nothing but copy.
- **Persona-panel pass on every new user-facing surface**, marked as an explicit step. The controller runs the panel (high-stakes veteran, social casual, commissioner, first-timer); the plan only marks where. **One panel in this plan** (Task 10), covering the activity feed and the notice inbox together, because they are one reader's one question: what happened, and what did the platform do to me.
- **Centralize UI primitives the first time.** No page-local visual mapping; extract to `src/components/ui/` and refactor the existing consumer in the same commit.
- **No mock data on real surfaces.** An activity feed with a seeded example row is mock data. An empty feed with a real empty state is not.

---

## What is already true (read before touching anything)

| The spec assumes | Reality on `main` today (`c2aef31`) |
|---|---|
| A Drizzle schema for `audit_events` **(SQLite)** | SQLite was never shipped. `docs/conventions.md` pins Postgres 17 via `drizzle-orm/postgres-js` through PgBouncer in transaction pooling mode. `audit_events` is a `pg-core` table, the triggers are a plpgsql function plus two `BEFORE` row triggers, and the pooler constraint binds every design choice below: no `pg_advisory_lock`, no session `SET`, no `LISTEN`/`NOTIFY`. |
| The append-only, tamper-evident pattern is new here | It is precedented three times. `draft_actions` is `bigserial` id + `sequence` int with `uniqueIndex(draftId, sequence)` as a DB-level backstop against concurrent appends, `jsonb` payload, explicit clock-injected `timestamp`. `reviews` removal is a stamp with the no-re-stamp invariant in the `UPDATE`'s own `WHERE`. `review_reports` is insert-only on a composite PK. `src/db/schema.ts:506` already says *"Phase 3 owns the real audit log."* **`audit_events` copies `draft_actions`' shape, including the unique-sequence backstop.** |
| Every threshold lives in `src/config/integrity.ts` | There is no `src/config/` directory and there will not be one. Twenty-two `config.ts` files sit beside the modules that read them. Ruling 24: `src/integrity/config.ts` exporting `INTEGRITY_CONFIG` satisfies the spec's actual requirement (one documented home, no inline magic numbers). |
| `verifyChainIntegrity` can recompute every hash on every run | The scaling review (`docs/research/2026-08-16-scaling-review.md`, C5) found this makes tamper detection decorative, because nobody could afford to run it. Task 4 is checkpointed and batched, and its incremental behavior is asserted by a call count on an injected hash function, not assumed. |
| `notifyAffectedMember` needs a notification system | The **catalog** exists (`NOTIFICATION_CATALOG`, `NotificationChannel`, `channelStatus()`, `deliverableChannels()` in `src/identity/notifications.ts`) and `notifications.test.ts` checks it against the runtime `REALTIME_EVENT_TYPES` array so a topic can never describe a notification the product does not publish. The **sender** does not exist, and neither does any user-targeted delivery: all ten realtime event types are league-**broadcast** on `league:<id>:events`. Task 7 and Task 8 build the durable row and the per-user key; the catalog gains one honest topic. |
| The audit log is admin-only | Strategy §4 promises members *"a transparent per-league audit log"* and the UX review found nothing lets a member see one. Tasks 9 and 10 are that view, and they need no admin role, no flag and no detector — only Step 1. |
| A trade exists to audit | It does not. No `trades` table, no propose/accept path, no execution. `TradeProposal`/`tradeBalance` are pure types and a pure function with no persistence. `trade_*` and `roster_move` are declared and reserved here; **Plan C is what publishes them** (overview, Plan C). |
| An admin exists to write `admin_action` | There is no `isAdmin`, no `requireAdmin`, no `/admin` route anywhere in `src/`, `drizzle/` or `scripts/`. **Plan B builds the role**; `admin_action`, `flag_raised` and `flag_resolved` are reserved here. |
| A session row exists to hang `SESSION_STARTED` on | There is no `sessions` table and there will not be one (`data-layer-hardening.md` calls indexing it *"a category error in the spec"*). WorkOS AuthKit owns sessions; `users.id` IS the WorkOS user id. The one observable sign-in moment is `syncUserFromWorkOS` at `/callback`, and that is where Task 6 records it. |
| The `SESSION_STARTED` event carries device and IP signals | Not in this plan. All four existing IP reads key on `X-Forwarded-For`, which their own docblock calls caller-controlled and rotatable, and `identity-and-trust.md` records fixing it as LAUNCH-BLOCKING for Phase 2 Plan D. Ruling 20: Plan A records the sign-in and no signals; Plan B adds the signals with the IP weight at zero. |
| Adding a realtime event type is free | `src/identity/notifications.test.ts` couples `NOTIFICATION_CATALOG` to `REALTIME_EVENT_TYPES`. Adding `notice.created` without extending the catalog honestly **will** fail that test. That is the desired outcome, not an obstacle to route around. |
| `audit_events` can carry foreign keys to `users` and `leagues` | It cannot, and this is not a preference. `leagues` cascades to nine tables today; a cascade is a `DELETE`, and the append-only trigger would reject it, so an FK would make deleting a league impossible **and** an FK without the trigger would make deleting a league silently delete its audit history. Ruling 7: no foreign keys on `audit_events`, stated in the table's own docblock. |

---

## File Structure

**New — the integrity rule layer (`src/integrity/**`, joins the coverage gate as the 15th):**

| File | Responsibility |
|---|---|
| `src/integrity/config.ts` | `INTEGRITY_CONFIG`: the genesis hash, the hash version, the platform scope id, verification batch size and cadence, activity page size, the notice inbox size and the accusatory denylist. Every tunable this phase reads starts here; Plans B, C and D add fields, never new files. |
| `src/integrity/canonical.ts` | `canonicalSerialize(value)` — sorted-key JSON with a rejecting encoder. The one place bytes are decided, and the reason a hash is reproducible. |
| `src/integrity/chain.ts` | `GENESIS_HASH`, `scopeFor`, `normalizeInstant`, `computeEventHash`, `linkEvent`, `verifyLinkedRun`. Pure, no I/O, no clock. |
| `src/integrity/notices.ts` | `NoticeType`, `NOTICE_TEMPLATES`, `renderNotice`, `ACCUSATORY_TERMS`. Every word a system-triggered action says to a member, in one file. **This is the module that resolves the `integrity/notifications` vs `identity/notifications` collision by not being called that (ruling 11).** |
| `src/integrity/activity-view.ts` | `ActivityRow`, `ACTIVITY_VISIBILITY` (an exhaustive `Record<AuditEventType, …>`), `activityRowFor(event, viewer)`. The per-`eventType` field allowlist, deny by default. |

**New — the integrity service layer (`src/integrity-service/**`, joins the coverage gate as the 16th):**

| File | Responsibility |
|---|---|
| `src/integrity-service/audit-logger.ts` | `AuditLogger`, `createAuditLogger`, `getAuditLogger`. `record(tx, input)` and `recordAll(tx, inputs)`, both appends, both inside the caller's transaction. |
| `src/integrity-service/verify.ts` | `verifyChainIntegrity`, `verifyFullChainIntegrity`, `verifyAllChains`, `ChainVerificationResult`. |
| `src/integrity-service/notify.ts` | `notifyAffectedMember(tx, input)`, `deliverNotice(notice)`, `listNotices`, `markNoticesRead`. |
| `src/integrity-service/activity.ts` | `listLeagueActivity(db, input)` — the paged, allowlisted, name-resolved read the activity page renders. |
| `src/integrity-service/schemas.ts` | `activityQuerySchema`, `markNoticesReadSchema`. |

**New — types:** `src/domain/audit.ts` (`AUDIT_EVENT_TYPES`, `AuditEventType`, `AuditActorType`, `JsonValue`, `AuditEvent`, `AuditEventInput`). Types and a runtime array only; `src/domain/**` stays I/O-free and `readonly`.

**New — routes and pages:**

| File | Responsibility |
|---|---|
| `src/app/api/notices/route.ts` | `GET /api/notices` — the caller's own notices, never anyone else's. |
| `src/app/api/notices/read/route.ts` | `POST /api/notices/read` — stamp them read. |
| `src/app/api/notices/stream/route.ts` | `GET /api/notices/stream` — SSE over the caller's own stream key. |
| `src/app/api/notices/_shared.ts` | The notices rate limiter singleton and its test reset, mirroring `src/app/api/profile/_shared.ts`. |
| `src/app/app/leagues/[leagueId]/activity/page.tsx` | The member-visible league activity feed. |

**New — client (`src/account-room/**` and `src/league-room/**`, both existing client-boundary directories):**

| File | Responsibility |
|---|---|
| `src/account-room/contract.ts` (modify) | `NoticeView`, `NoticesBody` — the wire shapes. |
| `src/account-room/hooks/use-notices.ts` | The inbox's fetch plus its `notice.created` subscription. |
| `src/account-room/components/notice-inbox.tsx` | The header inbox: a count, a panel, a read stamp. |
| `src/league-room/components/activity-feed.tsx` | The feed list, presentational, rendered by the page from `ActivityRow`s. |

**New — script:** `scripts/verify-audit-chain.ts` (+ the `audit:verify` npm script), mirroring `scripts/ingest-once.ts`'s shape: real mechanism, run by hand today, scheduled by Plan D.

**New — decision doc:** `docs/decisions/audit-and-integrity.md`.

**New migrations:** `drizzle/0019_audit_spine.sql` (hand-finished for the triggers, exactly as `0018` was hand-finished for `INCLUDE (body)`), `drizzle/0020_member_notices.sql`.

**Modified:** `src/db/schema.ts`, `src/db/test-db.ts`, `src/db/index-plans.test.ts`, `src/lib/realtime/events.ts`, `src/lib/realtime/config.ts`, `src/lib/realtime/publish.ts`, `src/lib/realtime/subscribe.ts`, `src/lib/realtime/sse.ts`, `src/identity/notifications.ts`, `src/lib/auth/user-sync.ts`, `src/identity-service/profile.ts`, `src/review-service/reviews.ts`, `src/league-service/creation.ts`, `src/league-service/join.ts`, `src/league-service/lineups.ts`, `src/draft-service/store.ts`, `src/draft-service/instance.ts`, `src/components/app-shell/app-header.tsx`, `src/components/ui/icon.tsx`, `src/league-room/components/league-home.tsx`, `eslint.config.mjs`, `vitest.config.mts`, `package.json`, `e2e/league-lifecycle.spec.ts`, `docs/conventions.md`, `docs/design-system.md`, `README.md`.

---

## Task 1: The chain, before there is a table — canonical bytes, one hash, one link

Everything in this phase rests on two functions that have no database, no clock and no network: the one that turns an event into bytes, and the one that turns bytes into the hash that links it to the event before it. They are built and tested first, in memory, exactly as the spec's first task demands ("Write tests first for hash-chain construction, chain verification, and tamper detection before writing any implementation").

The hard part is not sha256. It is that **the verifier re-derives the hash from a row read back out of Postgres**, so every byte that goes into the hash has to survive a round trip through `jsonb` and `timestamptz` unchanged. Sorted keys are why `jsonb`'s key reordering cannot matter. `normalizeInstant` is why a `+02:00` timestamp cannot matter. The rejecting encoder is why a `Date`, a `NaN`, a `bigint`, a 2^53+1 integer or a NUL character in a string cannot silently become a chain that fails verification a month later on a row nobody can explain.

**Files:**
- Create: `src/domain/audit.ts`
- Create: `src/integrity/config.ts`
- Create: `src/integrity/canonical.ts`, `src/integrity/canonical.test.ts`
- Create: `src/integrity/chain.ts`, `src/integrity/chain.test.ts`
- Modify: `eslint.config.mjs` (add `@/integrity` and `@/integrity-service` to `SERVER_ONLY_MODULE_GROUPS`)

**Interfaces:**
- Consumes: nothing. This task has no dependencies inside the repo beyond `node:crypto`.
- Produces:
  - `const AUDIT_EVENT_TYPES: readonly [...]` and `type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number]` (the `REALTIME_EVENT_TYPES` precedent: the array is the source, the union is derived)
  - `type AuditActorType = "user" | "system"`
  - `type JsonValue`, `type JsonObject`
  - `interface AuditEvent` and `interface AuditEventInput`
  - `const GENESIS_HASH: string`, `scopeFor(leagueId: string | null): string`, `normalizeInstant(iso: string): string`
  - `computeEventHash(event: HashableEvent): string`, `type HashFn = (event: HashableEvent) => string`
  - `linkEvent(input: AuditEventInput, anchor: ChainAnchor, eventId: string): AuditEvent`
  - `verifyLinkedRun(events, from, hash?): RunVerification`
  - `canonicalSerialize(value: JsonValue): string`
  - `INTEGRITY_CONFIG`

Task 2 stores these fields as columns; Task 3's `AuditLogger` is the only caller of `linkEvent`; Task 4's verifier is the only caller of `verifyLinkedRun`.

- [ ] **Step 1: Write the failing canonical-serialization test**

Create `src/integrity/canonical.test.ts`. The hostile and round-trip cases lead, because they are the file's whole reason for existing:

```ts
import { describe, expect, it } from "vitest";
import { canonicalSerialize } from "./canonical";

describe("canonicalSerialize", () => {
  it("sorts object keys, so two objects that differ only in key order are the same bytes", () => {
    // THE reason this function exists. `jsonb` does not preserve key order, so a payload
    // hashed as written and re-hashed as read back would otherwise never match.
    expect(canonicalSerialize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalSerialize({ a: 2, b: 1 })).toBe(canonicalSerialize({ b: 1, a: 2 }));
    expect(canonicalSerialize({ outer: { z: [1, { y: true, x: null }], a: "s" } })).toBe(
      '{"outer":{"a":"s","z":[1,{"x":null,"y":true}]}}',
    );
  });

  it("preserves array order, because an array is ordered data and an object is not", () => {
    expect(canonicalSerialize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("emits no whitespace and no trailing separators", () => {
    expect(canonicalSerialize({ a: [], b: {} })).toBe('{"a":[],"b":{}}');
  });

  it("escapes strings the one way JSON does", () => {
    expect(canonicalSerialize('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
    expect(canonicalSerialize("héllo 🏈")).toBe('"héllo 🏈"');
  });

  it("refuses every value a hash cannot survive a Postgres round trip with", () => {
    // Each one is named rather than covered by a type guard the reader has to trust, and each
    // message says which path failed so a caller can fix the payload rather than guess.
    const cases: readonly [unknown, string][] = [
      [undefined, "undefined"],
      [Number.NaN, "NaN"],
      [Number.POSITIVE_INFINITY, "Infinity"],
      [9007199254740993, "an unsafe integer"],       // > 2^53, loses precision on read-back
      [10n, "a bigint"],
      [new Date("2026-08-20T00:00:00.000Z"), "a Date"],
      [new Map(), "a Map"],
      [new Set(), "a Set"],
      [() => 1, "a function"],
      [Symbol("s"), "a symbol"],
      ["null byte: \u0000", "a NUL character"],       // Postgres cannot store it in jsonb or text
    ];
    for (const [value, fragment] of cases) {
      expect(() => canonicalSerialize({ field: value } as never)).toThrow(new RegExp(fragment));
    }
  });

  it("names the path of the offending value, however deep", () => {
    expect(() => canonicalSerialize({ a: { b: [0, { c: Number.NaN }] } } as never)).toThrow(/a\.b\[1\]\.c/);
  });

  it("refuses a cycle rather than overflowing the stack", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalSerialize(cyclic as never)).toThrow(/cycle/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/integrity`
Expected: FAIL — `Cannot find module './canonical'`.

- [ ] **Step 3: Write `src/integrity/canonical.ts` and `src/domain/audit.ts`**

```ts
// src/domain/audit.ts
/**
 * The audit vocabulary, as a runtime array with the union derived from it — the same shape
 * `REALTIME_EVENT_TYPES` uses, and for the same reason: the pg enum, the visibility record and
 * the reserved-consumer test all iterate it, and a union declared separately from its list is
 * two things to keep in step.
 *
 * SPELLING. The spec (`plans/phase-3-trust-and-integrity.md` Step 1) writes these in
 * SCREAMING_SNAKE. Every enum shipped in `src/db/schema.ts` is lowercase snake_case, and the
 * phase overview already ruled the same way once ("the shipped spelling wins", on
 * beginner/experienced vs NEW/EXPERIENCED). The mapping is one-to-one and mechanical.
 */
export const AUDIT_EVENT_TYPES = [
  /** Published by Plan A. */
  "league_created",
  /** Published by Plan A, from BOTH doors into a league (invite accept and public join). */
  "member_joined",
  /** Published by Plan A. `actorType: "system"` when the clock ran out and the queue picked. */
  "draft_pick",
  /** Published by Plan A, at the transaction that turns a finished draft into a season. */
  "draft_completed",
  /** Published by Plan A, from `setLineup` — the product's only member-facing roster write. */
  "lineup_change",
  /**
   * A roster change that is NEITHER a draft pick NOR a lineup change. Today that means exactly
   * one thing: the player transfer a trade performs. There is no free agency in this product,
   * no waivers and no add/drop, so nothing else can produce one. RESERVED — Plan C publishes it.
   */
  "roster_move",
  /** RESERVED — Plan C publishes these three, from the trade lifecycle it builds. */
  "trade_proposed",
  "trade_accepted",
  "trade_rejected",
  /** RESERVED — Plan B publishes these two, from its detector and its resolution action. */
  "flag_raised",
  "flag_resolved",
  /** RESERVED — Plan B publishes this, from the admin surface it builds. */
  "admin_action",
  /**
   * The platform acting on its own. Plan A publishes exactly one kind (a failed chain
   * verification); Plan D's enforcement policy is what makes it common.
   */
  "system_action",
  /** Published by Plan A, at `/callback`. Carries no IP and no device signal — see ruling 20. */
  "session_started",
  /** Published by Plan A, from the profile write path. */
  "profile_updated",
  /** Published by Plan A, from the review removal stamp. */
  "review_removed",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/** Who did it. `system` means the platform, and the audit row looks otherwise identical. */
export type AuditActorType = "user" | "system";

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** One row of the chain, exactly as it is stored and exactly as it is hashed. */
export interface AuditEvent {
  readonly eventId: string;
  /** Which chain this row belongs to: a league id, or `INTEGRITY_CONFIG.chain.platformScope`. */
  readonly chainScope: string;
  /** 1-based position in this chain. Unique per scope at the database level. */
  readonly sequence: number;
  readonly eventType: AuditEventType;
  /** Null only when `actorType` is `"system"`. */
  readonly actorId: string | null;
  readonly actorType: AuditActorType;
  /** Null for a platform-scoped event. Never a foreign key — see ruling 7. */
  readonly leagueId: string | null;
  readonly payload: JsonObject;
  /** ISO-8601, normalized to UTC milliseconds by `normalizeInstant` before it is hashed. */
  readonly occurredAt: string;
  readonly previousEventHash: string;
  readonly eventHash: string;
  readonly hashVersion: number;
}

/**
 * What a caller supplies. `chainScope`, `sequence`, `previousEventHash`, `eventHash`,
 * `hashVersion` and `eventId` are all decided by `AuditLogger` — a caller that could choose its
 * own scope could put a league's event on the platform chain by accident, and a caller that
 * could choose its own hash could put anything anywhere.
 */
export interface AuditEventInput {
  readonly eventType: AuditEventType;
  readonly actorId: string | null;
  readonly actorType: AuditActorType;
  readonly leagueId: string | null;
  readonly payload: JsonObject;
  readonly occurredAt: string;
}
```

```ts
// src/integrity/config.ts
/**
 * Every tunable this phase reads. The spec asks for `src/config/integrity.ts`; this repo puts a
 * `config.ts` beside the module that consumes it (22 of them today) and this is the 23rd — the
 * spec's actual requirement is one documented home with no inline magic numbers, which this
 * satisfies without forking the convention. Plans B, C and D add FIELDS here, never new files.
 */
export const INTEGRITY_CONFIG = {
  chain: {
    /** Only sha256 is implemented. Named so the hashed `hashVersion` below has a meaning. */
    hashAlgorithm: "sha256",
    /**
     * Part of the hashed bytes, and stored on every row. An audit chain is the one structure
     * where you can never change the algorithm without a way to tell old rows from new ones,
     * and one integer bought at the start is cheaper than a migration that cannot be written.
     * The verifier refuses a row whose version is not this one rather than guessing.
     */
    hashVersion: 1,
    /**
     * The first `previousEventHash` in every chain. `sha256("commish:audit:chain:v1")`, NOT a
     * run of zeros: a column that defaulted to zeros, or an uninitialised buffer, must not
     * accidentally validate as "this is the first event".
     */
    genesisHash: "3899de638fb205d16aa18269aaecee607dafe3eea5e9218004f5d1cb2e91343f",
    /**
     * The scope id for events with no league: a sign-in, a profile edit, a review removal, a
     * platform-level admin action. A reserved word rather than a uuid so it is legible in a
     * query, and no league id can ever collide with it (league ids are `crypto.randomUUID()`).
     */
    platformScope: "platform",
  },
  verification: {
    /**
     * Rows per query during a chain walk. The full walk is unbounded by definition, so it pages;
     * loading a million-row chain into memory to verify it is the same class of mistake as
     * re-hashing it on every run.
     */
    batchSize: 500,
    /**
     * The spec's `AUDIT_FULL_VERIFY_INTERVAL_HOURS`. Nothing reads it today: the full walk is
     * invoked by `scripts/verify-audit-chain.ts`, run by hand. It is the number a production
     * scheduler is configured with, and Plan D is the plan that has one.
     */
    fullVerifyIntervalHours: 24,
  },
  /** The member-facing activity feed. */
  activity: { pageSize: 50 },
  notices: {
    /** How many of a member's own notices the inbox holds. Bounded on purpose — see ruling 22. */
    inboxSize: 20,
    /**
     * Words a notice may never contain. A notice explains what the platform did; it never
     * suggests the member did something wrong. Enforced by a test over `NOTICE_TEMPLATES`
     * (Task 7), because a rule about copy is only real if something checks the copy.
     */
    accusatoryTerms: ["violation", "violated", "suspected", "abuse", "cheating", "broke the rules", "illegal", "penalty", "offense"],
  },
} as const;
```

```ts
// src/integrity/canonical.ts
import type { JsonValue } from "@/domain/audit";

/**
 * The bytes a hash is taken over: JSON with object keys sorted and no whitespace.
 *
 * Sorted keys are not a style choice. The verifier re-derives an event's hash from the row it
 * reads back out of Postgres, and `jsonb` does not preserve key order (it stores an object as a
 * sorted, deduplicated map). Hashing `JSON.stringify(payload)` would therefore produce one
 * digest on write and, for the same data, a different one on read.
 *
 * Everything this encoder refuses, it refuses because it would not survive that same round trip:
 * a `Date` becomes a string, `NaN`/`Infinity` become `null`, an integer past 2^53 loses digits,
 * and a NUL character cannot be stored in a Postgres `jsonb` or `text` value at all. Failing at
 * the write, with the path named, is the only version of this that a reader can act on.
 */
export function canonicalSerialize(value: JsonValue): string {
  return write(value, "", new Set());
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return "a bigint";
  if (typeof value === "function") return "a function";
  if (typeof value === "symbol") return "a symbol";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (!Number.isFinite(value)) return "Infinity";
    return "an unsafe integer";
  }
  if (value instanceof Date) return "a Date";
  if (value instanceof Map) return "a Map";
  if (value instanceof Set) return "a Set";
  return "not canonical JSON";
}

function refuse(path: string, value: unknown): never {
  throw new Error(`Audit payload cannot be hashed: ${path === "" ? "the value" : path} is ${describe(value)}.`);
}

function write(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) refuse(path, value);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) refuse(path, value);
    return String(value);
  }
  if (typeof value === "string") {
    if (value.includes("\u0000")) throw new Error(`Audit payload cannot be hashed: ${path} contains a NUL character.`);
    return JSON.stringify(value);
  }
  if (typeof value !== "object") refuse(path, value);
  const object = value as object;
  if (seen.has(object)) throw new Error(`Audit payload cannot be hashed: ${path} closes a cycle.`);
  const nested = new Set(seen).add(object);
  if (Array.isArray(object)) {
    return `[${object.map((item, index) => write(item, `${path}[${index}]`, nested)).join(",")}]`;
  }
  if (Object.getPrototypeOf(object) !== Object.prototype) refuse(path, object);
  const keys = Object.keys(object as Record<string, unknown>).sort();
  const entries = keys.map((key) => {
    const child = (object as Record<string, unknown>)[key];
    const childPath = path === "" ? key : `${path}.${key}`;
    if (child === undefined) refuse(childPath, child);
    return `${JSON.stringify(key)}:${write(child, childPath, nested)}`;
  });
  return `{${entries.join(",")}}`;
}
```

Note `new Set(seen)` rather than add/delete around the recursion: a shared mutable set would refuse a diamond (the same frozen sub-object referenced twice at different paths), which is legal JSON and not a cycle.

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/integrity`
Expected: PASS.

- [ ] **Step 5: Write the failing chain test**

Create `src/integrity/chain.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { AuditEvent, AuditEventInput } from "@/domain/audit";
import { INTEGRITY_CONFIG } from "./config";
import { GENESIS_HASH, computeEventHash, linkEvent, normalizeInstant, scopeFor, verifyLinkedRun } from "./chain";

const AT = "2026-08-20T17:00:00.000Z";

const input = (over: Partial<AuditEventInput> = {}): AuditEventInput => ({
  eventType: "league_created",
  actorId: "user_alice",
  actorType: "user",
  leagueId: "league_1",
  payload: { name: "Sunday Money", teamCount: 12 },
  occurredAt: AT,
  ...over,
});

describe("scopeFor", () => {
  it("is the league for a league event and the reserved platform id otherwise", () => {
    expect(scopeFor("league_1")).toBe("league_1");
    expect(scopeFor(null)).toBe(INTEGRITY_CONFIG.chain.platformScope);
  });
});

describe("normalizeInstant", () => {
  it("normalizes to UTC milliseconds, which is exactly what timestamptz gives back", () => {
    // The hash is taken over the NORMALIZED string, so `occurred_at` read back out of Postgres
    // re-hashes to the stored digest. An offset spelling or microsecond precision would not.
    expect(normalizeInstant("2026-08-20T19:00:00+02:00")).toBe("2026-08-20T17:00:00.000Z");
    expect(normalizeInstant("2026-08-20T17:00:00.123456Z")).toBe("2026-08-20T17:00:00.123Z");
    expect(normalizeInstant(AT)).toBe(AT);
  });

  it("refuses a string that is not an instant, rather than hashing Invalid Date", () => {
    expect(() => normalizeInstant("last tuesday")).toThrow(/not a valid instant/);
  });
});

describe("computeEventHash", () => {
  it("matches a pinned vector, so a refactor cannot silently change the canonical form", () => {
    // Pinned, not computed by the test: if this value changes, every chain in every database
    // stops verifying, and that has to be a deliberate `hashVersion` bump rather than a diff
    // nobody noticed. Recomputed from the documented canonical form in the plan.
    expect(
      computeEventHash({
        eventId: "evt_1",
        chainScope: "league_1",
        sequence: 1,
        eventType: "league_created",
        actorId: "user_alice",
        actorType: "user",
        leagueId: "league_1",
        payload: { name: "Sunday Money", teamCount: 12 },
        occurredAt: AT,
        previousEventHash: GENESIS_HASH,
        hashVersion: INTEGRITY_CONFIG.chain.hashVersion,
      }),
    ).toBe("8be562573461ecdf41a002e65a8096536f813d05c0a779a0bef462575ce1ccfd");
  });

  it("changes when any hashed field changes", () => {
    const base = linkEvent(input(), { headSequence: 0, headHash: GENESIS_HASH }, "evt_1");
    for (const mutated of [
      { ...base, actorId: "user_mallory" },
      { ...base, eventType: "member_joined" as const },
      { ...base, occurredAt: "2026-08-20T17:00:00.001Z" },
      { ...base, payload: { name: "Sunday Money", teamCount: 13 } },
      { ...base, previousEventHash: GENESIS_HASH.replace("3", "4") },
      { ...base, sequence: 2 },
    ]) {
      expect(computeEventHash(mutated)).not.toBe(base.eventHash);
    }
  });
});

describe("linkEvent", () => {
  it("starts a chain at sequence 1 with the genesis hash behind it", () => {
    const first = linkEvent(input(), { headSequence: 0, headHash: GENESIS_HASH }, "evt_1");
    expect(first.sequence).toBe(1);
    expect(first.previousEventHash).toBe(GENESIS_HASH);
    expect(first.chainScope).toBe("league_1");
    expect(first.hashVersion).toBe(INTEGRITY_CONFIG.chain.hashVersion);
  });

  it("links the next event to the one before it", () => {
    const first = linkEvent(input(), { headSequence: 0, headHash: GENESIS_HASH }, "evt_1");
    const second = linkEvent(input({ eventType: "member_joined" }), { headSequence: first.sequence, headHash: first.eventHash }, "evt_2");
    expect(second.sequence).toBe(2);
    expect(second.previousEventHash).toBe(first.eventHash);
  });

  it("normalizes the instant it was given, so what is hashed is what is stored", () => {
    const event = linkEvent(input({ occurredAt: "2026-08-20T19:00:00+02:00" }), { headSequence: 0, headHash: GENESIS_HASH }, "evt_1");
    expect(event.occurredAt).toBe(AT);
  });
});

describe("verifyLinkedRun", () => {
  const chain = (count: number): readonly AuditEvent[] => {
    const events: AuditEvent[] = [];
    for (let i = 0; i < count; i += 1) {
      const head = events[i - 1];
      events.push(linkEvent(input(), { headSequence: head?.sequence ?? 0, headHash: head?.eventHash ?? GENESIS_HASH }, `evt_${i + 1}`));
    }
    return events;
  };

  it("accepts an empty run and reports the anchor unchanged", () => {
    const result = verifyLinkedRun([], { headSequence: 0, headHash: GENESIS_HASH });
    expect(result).toEqual({ valid: true, hashed: 0, through: { headSequence: 0, headHash: GENESIS_HASH } });
  });

  it("accepts an honest run and reports its new head", () => {
    const events = chain(3);
    const result = verifyLinkedRun(events, { headSequence: 0, headHash: GENESIS_HASH });
    expect(result).toEqual({ valid: true, hashed: 3, through: { headSequence: 3, headHash: events[2]!.eventHash } });
  });

  it("catches an edited payload at the row it was edited on", () => {
    const events = [...chain(3)];
    events[1] = { ...events[1]!, payload: { name: "Sunday Money", teamCount: 99 } };
    const result = verifyLinkedRun(events, { headSequence: 0, headHash: GENESIS_HASH });
    expect(result).toEqual({
      valid: false,
      hashed: 2,
      break: { reason: "hash_mismatch", eventId: "evt_2", sequence: 2 },
    });
  });

  it("catches a row whose stored hash was rewritten to match its edited payload", () => {
    // The interesting tamper: the attacker recomputed the row's OWN hash, so `hash_mismatch`
    // passes. The link to the next row is what fails, which is the entire point of a chain.
    const events = [...chain(3)];
    const forged = { ...events[1]!, payload: { name: "Sunday Money", teamCount: 99 } };
    events[1] = { ...forged, eventHash: computeEventHash(forged) };
    const result = verifyLinkedRun(events, { headSequence: 0, headHash: GENESIS_HASH });
    expect(result.valid).toBe(false);
    expect(result).toMatchObject({ break: { reason: "link_mismatch", eventId: "evt_3", sequence: 3 } });
  });

  it("catches a deleted row as a sequence gap", () => {
    const events = chain(3);
    const result = verifyLinkedRun([events[0]!, events[2]!], { headSequence: 0, headHash: GENESIS_HASH });
    expect(result).toMatchObject({ break: { reason: "sequence_gap", eventId: "evt_3", sequence: 3 } });
  });

  it("catches a row written under a hash version this build does not implement", () => {
    const events = [...chain(1)];
    events[0] = { ...events[0]!, hashVersion: 99 };
    const result = verifyLinkedRun(events, { headSequence: 0, headHash: GENESIS_HASH });
    expect(result).toMatchObject({ break: { reason: "version_mismatch", eventId: "evt_1", sequence: 1 } });
  });

  it("stops hashing at the first break instead of walking the rest", () => {
    const events = [...chain(5)];
    events[1] = { ...events[1]!, payload: { tampered: true } };
    const hash = vi.fn(computeEventHash);
    const result = verifyLinkedRun(events, { headSequence: 0, headHash: GENESIS_HASH }, hash);
    expect(result.valid).toBe(false);
    expect(hash).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm test -- src/integrity`
Expected: FAIL — `Cannot find module './chain'`.

- [ ] **Step 7: Write `src/integrity/chain.ts`**

```ts
import { createHash } from "node:crypto";
import type { AuditEvent, AuditEventInput } from "@/domain/audit";
import { canonicalSerialize } from "./canonical";
import { INTEGRITY_CONFIG } from "./config";

export const GENESIS_HASH = INTEGRITY_CONFIG.chain.genesisHash;

/** The head of one chain: what the next event links to. Stored as the `audit_chains` row. */
export interface ChainAnchor {
  readonly headSequence: number;
  readonly headHash: string;
}

/** Exactly the fields that go into the digest. Nothing else about an event is hashed. */
export type HashableEvent = Omit<AuditEvent, "eventHash">;
export type HashFn = (event: HashableEvent) => string;

/**
 * Which chain an event belongs to. Derived from the league id and never passed in, so a caller
 * cannot put a league's event on the platform chain (or a stranger's league's chain) by accident.
 */
export function scopeFor(leagueId: string | null): string {
  return leagueId ?? INTEGRITY_CONFIG.chain.platformScope;
}

/**
 * The instant, spelled the one way a `timestamptz` read back from Postgres spells it: UTC, three
 * fractional digits, `Z`. The hash is taken over this, so a caller passing `+02:00` or
 * microseconds produces a row that still verifies. Without it, verification would fail on a row
 * nobody could explain, weeks after the write.
 */
export function normalizeInstant(iso: string): string {
  const millis = Date.parse(iso);
  if (Number.isNaN(millis)) throw new Error(`Audit event time "${iso}" is not a valid instant.`);
  return new Date(millis).toISOString();
}

export function computeEventHash(event: HashableEvent): string {
  const canonical = canonicalSerialize({
    actorId: event.actorId,
    actorType: event.actorType,
    chainScope: event.chainScope,
    eventId: event.eventId,
    eventType: event.eventType,
    hashVersion: event.hashVersion,
    leagueId: event.leagueId,
    occurredAt: event.occurredAt,
    payload: event.payload,
    previousEventHash: event.previousEventHash,
    sequence: event.sequence,
  });
  return createHash(INTEGRITY_CONFIG.chain.hashAlgorithm).update(canonical, "utf8").digest("hex");
}

/** Turns an input plus a chain head into the row that will be stored. The only writer's helper. */
export function linkEvent(input: AuditEventInput, anchor: ChainAnchor, eventId: string): AuditEvent {
  const hashable: HashableEvent = {
    eventId,
    chainScope: scopeFor(input.leagueId),
    sequence: anchor.headSequence + 1,
    eventType: input.eventType,
    actorId: input.actorId,
    actorType: input.actorType,
    leagueId: input.leagueId,
    payload: input.payload,
    occurredAt: normalizeInstant(input.occurredAt),
    previousEventHash: anchor.headHash,
    hashVersion: INTEGRITY_CONFIG.chain.hashVersion,
  };
  return { ...hashable, eventHash: computeEventHash(hashable) };
}

/**
 * `checkpoint_mismatch` is never returned by `verifyLinkedRun` — it is emitted by Task 4's
 * service-level verifier when the row a checkpoint claims to have verified no longer hashes to
 * what the checkpoint recorded. It lives in this union so there is one vocabulary for "how the
 * chain is broken" rather than two.
 */
export type ChainBreakReason = "sequence_gap" | "link_mismatch" | "hash_mismatch" | "version_mismatch" | "checkpoint_mismatch";

export interface ChainBreak {
  readonly reason: ChainBreakReason;
  readonly eventId: string;
  readonly sequence: number;
}

export type RunVerification =
  | { readonly valid: true; readonly hashed: number; readonly through: ChainAnchor }
  | { readonly valid: false; readonly hashed: number; readonly break: ChainBreak };

/**
 * Walks a contiguous run of events forward from a known-good anchor. Pure: the caller decides
 * where the run came from (a checkpoint, or genesis) and how big it is.
 *
 * `hash` is injected so the incremental-verification test can COUNT the work (Task 4's spec
 * requirement). It defaults to the real function, so no production call site passes it.
 */
export function verifyLinkedRun(events: readonly AuditEvent[], from: ChainAnchor, hash: HashFn = computeEventHash): RunVerification {
  let anchor = from;
  let hashed = 0;
  for (const event of events) {
    if (event.hashVersion !== INTEGRITY_CONFIG.chain.hashVersion) {
      return { valid: false, hashed, break: { reason: "version_mismatch", eventId: event.eventId, sequence: event.sequence } };
    }
    if (event.sequence !== anchor.headSequence + 1) {
      return { valid: false, hashed, break: { reason: "sequence_gap", eventId: event.eventId, sequence: event.sequence } };
    }
    if (event.previousEventHash !== anchor.headHash) {
      return { valid: false, hashed, break: { reason: "link_mismatch", eventId: event.eventId, sequence: event.sequence } };
    }
    const recomputed = hash(event);
    hashed += 1;
    if (recomputed !== event.eventHash) {
      return { valid: false, hashed, break: { reason: "hash_mismatch", eventId: event.eventId, sequence: event.sequence } };
    }
    anchor = { headSequence: event.sequence, headHash: event.eventHash };
  }
  return { valid: true, hashed, through: anchor };
}
```

`eslint.config.mjs`: add two entries to `SERVER_ONLY_MODULE_GROUPS`, with the reasoning inline —

```js
  // `@/integrity` reads `node:crypto` (chain.ts) and is imported by Postgres-backed callers;
  // `@/integrity-service` is Postgres-backed outright. Unlike `@/identity`, `@/chat`,
  // `@/matchmaking`, `@/help` and `@/reviews`, NEITHER half is browser-safe, so both are blocked
  // rather than one being exempt. Client code needs neither: a notice carries the copy it
  // delivered (ruling 12) and an activity row arrives already rendered, so the browser renders
  // strings the server decided. `import type` stays allowed, which is how `NoticeView` and
  // `ActivityRow` reach `src/account-room/**` and `src/league-room/**`.
  "@/integrity",
  "@/integrity-service",
```

- [ ] **Step 8: Run the whole suite and the gate commands**

Run: `npm test -- src/integrity && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/domain/audit.ts src/integrity eslint.config.mjs
git commit -m "feat(integrity): the audit vocabulary, canonical bytes and the hash chain

The chain is built and proved with no database in the picture, because everything else in this
phase is downstream of two pure functions being right.

Sorted-key serialization is not a style preference: jsonb does not preserve key order, so a
payload hashed as written and re-hashed as read back would never match. Same reasoning for
normalizeInstant — timestamptz hands back UTC milliseconds, so that is the spelling the hash is
taken over. The encoder refuses Date, NaN, bigint, unsafe integers and NUL for the same reason:
each one changes across a Postgres round trip, and failing at the write with the path named is
the only version a reader can act on.

The pinned hash vector is deliberate. If it ever changes, every chain in every database stops
verifying, and that must be a hashVersion bump rather than a diff nobody noticed."
```

---

## Task 2: The tables, the triggers, and the proof the database itself refuses an edit

Three tables and one plpgsql function. `audit_events` is the append-only source; `audit_chains` is its rollup and, in Task 3, its lock; `audit_chain_checkpoints` is verification's own state, deliberately a separate table so the verifier never takes a lock the appender is waiting on (ruling 18).

Drizzle Kit generates the tables and the indexes. It does **not** generate triggers, so `0019` is finished by hand after generation, exactly the way `0018` was finished by hand for `INCLUDE (body)` — and, exactly like `0018`, `src/db/index-plans.test.ts` is what proves the end state, by reading `pg_indexes` and `pg_trigger` back out of the catalog rather than trusting the SQL.

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0019_audit_spine.sql` (generated, then hand-finished)
- Modify: `src/db/test-db.ts` (`truncateAll`)
- Modify: `src/db/index-plans.test.ts`
- Create: `src/db/audit-append-only.test.ts`

**Interfaces:**
- Consumes: `AUDIT_EVENT_TYPES` and the `AuditEvent` field names from Task 1.
- Produces: `auditEvents`, `auditChains`, `auditChainCheckpoints` Drizzle tables; `auditEventTypeEnum`, `auditActorTypeEnum`.

- [ ] **Step 1: Write the failing append-only test**

Create `src/db/audit-append-only.test.ts`. It writes its rows with raw SQL and attacks them with raw SQL, so it proves a property of the DATABASE and never of `AuditLogger`, which does not exist yet:

```ts
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "./test-db";
import { GENESIS_HASH } from "@/integrity/chain";

const db = createTestDb();

async function seedOneEvent(): Promise<void> {
  await db.execute(sql`
    INSERT INTO audit_events
      (event_id, chain_scope, sequence, event_type, actor_id, actor_type, league_id, payload, occurred_at, previous_event_hash, event_hash, hash_version)
    VALUES
      ('evt_1', 'platform', 1, 'session_started', 'user_alice', 'user', NULL, '{"via":"callback"}'::jsonb,
       '2026-08-20T17:00:00.000Z', ${GENESIS_HASH}, 'deadbeef', 1)
  `);
}

describe("audit_events is append-only at the database", () => {
  beforeEach(async () => {
    await truncateAll(db);
    await seedOneEvent();
  });

  it("refuses an UPDATE issued as raw SQL, outside any application code", async () => {
    await expect(db.execute(sql`UPDATE audit_events SET payload = '{"via":"tamper"}'::jsonb`)).rejects.toThrow(/append-only/);
    const [row] = await db.execute<{ payload: { via: string } }>(sql`SELECT payload FROM audit_events`);
    expect(row?.payload.via).toBe("callback");
  });

  it("refuses a DELETE issued as raw SQL", async () => {
    await expect(db.execute(sql`DELETE FROM audit_events`)).rejects.toThrow(/append-only/);
    const [row] = await db.execute<{ count: string }>(sql`SELECT count(*) AS count FROM audit_events`);
    expect(row?.count).toBe("1");
  });

  it("refuses an UPDATE that changes nothing, because a no-op edit is still an edit", async () => {
    await expect(db.execute(sql`UPDATE audit_events SET payload = payload`)).rejects.toThrow(/append-only/);
  });

  it("still allows the append itself", async () => {
    await db.execute(sql`
      INSERT INTO audit_events
        (event_id, chain_scope, sequence, event_type, actor_id, actor_type, league_id, payload, occurred_at, previous_event_hash, event_hash, hash_version)
      VALUES ('evt_2', 'platform', 2, 'profile_updated', 'user_alice', 'user', NULL, '{}'::jsonb,
              '2026-08-20T17:01:00.000Z', 'deadbeef', 'cafebabe', 1)
    `);
    const [row] = await db.execute<{ count: string }>(sql`SELECT count(*) AS count FROM audit_events`);
    expect(row?.count).toBe("2");
  });

  it("refuses a second row at the same (scope, sequence), the draft_actions backstop", async () => {
    // The anchor row lock (Task 3) is the mechanism; this unique index is the backstop that
    // turns a bug in that lock into a rejected append rather than a forked chain.
    await expect(
      db.execute(sql`
        INSERT INTO audit_events
          (event_id, chain_scope, sequence, event_type, actor_id, actor_type, league_id, payload, occurred_at, previous_event_hash, event_hash, hash_version)
        VALUES ('evt_x', 'platform', 1, 'profile_updated', 'user_bob', 'user', NULL, '{}'::jsonb,
                '2026-08-20T17:02:00.000Z', ${GENESIS_HASH}, 'f00d', 1)
      `),
    ).rejects.toThrow(/audit_events_scope_sequence_idx/);
  });

  it("lets the rollup row be updated, because a rollup is not the record", async () => {
    await db.execute(sql`INSERT INTO audit_chains (scope, head_sequence, head_hash) VALUES ('platform', 1, 'deadbeef')`);
    await db.execute(sql`UPDATE audit_chains SET head_sequence = 2, head_hash = 'cafebabe' WHERE scope = 'platform'`);
    const [row] = await db.execute<{ head_sequence: number }>(sql`SELECT head_sequence FROM audit_chains WHERE scope = 'platform'`);
    expect(row?.head_sequence).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/db/audit-append-only`
Expected: FAIL — `relation "audit_events" does not exist`.

- [ ] **Step 3: Add the tables to `src/db/schema.ts`**

```ts
export const auditEventTypeEnum = pgEnum("audit_event_type", AUDIT_EVENT_TYPES);
export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "system"]);
```

(`AUDIT_EVENT_TYPES` is imported from `@/domain/audit` — the same relationship `weekStatusEnum` has with `WeekStatus`. A pg enum is the right shape here precisely because the vocabulary is **fixed by the spec and declared in full today**: no later plan adds a value, so no later migration has to run `ALTER TYPE … ADD VALUE`. Contrast `member_notices.notice_type` in Task 7, which every later plan extends and which is therefore `text`.)

```ts
/**
 * THE audit log. Append-only in three independent ways, because one of them being wrong is the
 * whole failure mode: `AuditLogger` exposes no update or delete (Task 3), the database rejects
 * UPDATE and DELETE with a trigger even from a raw client (`0019`), and every row carries the
 * hash of the row before it so an edit that got past both is still detectable (Task 4).
 *
 * NO FOREIGN KEYS, deliberately, and this is the one table in the schema where that is true.
 * `leagues` cascades to nine tables; a cascade is a DELETE, so an FK to `leagues` would either be
 * rejected by the append-only trigger (making a league undeletable) or, without the trigger,
 * would let deleting a league silently delete the record of what happened in it. The audit trail
 * of a deleted league is exactly the audit trail you want to still have. `actor_id` is the same
 * argument for `users`. Referential integrity here is the hash chain's job, not the planner's.
 *
 * `chain_scope` is the league id, or `INTEGRITY_CONFIG.chain.platformScope` for an event with no
 * league. One chain per scope: see `docs/decisions/audit-and-integrity.md` for the contention
 * math that ruled against a single global chain.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    eventId: text("event_id").primaryKey(),
    chainScope: text("chain_scope").notNull(),
    sequence: integer("sequence").notNull(),
    eventType: auditEventTypeEnum("event_type").notNull(),
    actorId: text("actor_id"),
    actorType: auditActorTypeEnum("actor_type").notNull(),
    leagueId: text("league_id"),
    payload: jsonb("payload").$type<JsonObject>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    previousEventHash: text("previous_event_hash").notNull(),
    eventHash: text("event_hash").notNull(),
    hashVersion: integer("hash_version").notNull(),
  },
  (t) => [
    /**
     * The `draft_actions_draft_sequence_idx` pattern, for the same reason: the anchor row lock
     * is what serializes appends, and this is the database's own backstop if that lock is ever
     * wrong. A bug then costs a rejected append, never a forked chain. It is also the index the
     * verifier and the activity feed both read by, since both walk one scope in sequence order.
     */
    uniqueIndex("audit_events_scope_sequence_idx").on(t.chainScope, t.sequence),
    /** The scaling review's first composite (C5): the per-league, time-ranged read. */
    index("audit_events_league_occurred_idx").on(t.leagueId, t.occurredAt),
    /** The scaling review's second: Plan B's per-actor, per-type behavioral read. */
    index("audit_events_actor_type_occurred_idx").on(t.actorId, t.eventType, t.occurredAt),
  ],
);

/**
 * One row per chain: its head, and the lock every append to that chain takes.
 *
 * This IS the rollup `docs/decisions/data-layer-hardening.md` requires. `head_sequence` is the
 * count of events in the chain and `head_hash` is the link the next one attaches to, both
 * advanced in the SAME transaction as the append they summarize — never after it, never in a
 * job. `audit_events` remains the reconciliation source: this row can be rebuilt from it, and
 * `verifyFullChainIntegrity` is the function that does exactly that.
 *
 * There is deliberately no separate `event_count` column: `head_sequence` already is it, and a
 * second copy of one number is a second thing that can disagree.
 */
export const auditChains = pgTable("audit_chains", {
  scope: text("scope").primaryKey(),
  headSequence: integer("head_sequence").notNull().default(0),
  headHash: text("head_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Verification's own state, in its OWN table rather than as columns on `audit_chains`.
 *
 * If the checkpoint lived on the anchor row, advancing it would take a row lock on the row every
 * append is waiting for, so a chain walk would block every write to that league for its whole
 * duration. Two tables cost one more row and buy the property that the verifier and the writer
 * never contend at all.
 */
export const auditChainCheckpoints = pgTable("audit_chain_checkpoints", {
  scope: text("scope").primaryKey().references(() => auditChains.scope),
  verifiedThroughSequence: integer("verified_through_sequence").notNull().default(0),
  verifiedThroughHash: text("verified_through_hash").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Generate the migration, then finish it by hand**

```bash
npm run db:generate            # writes drizzle/0019_audit_spine.sql with the three tables and two enums
```

Append the trigger DDL to the generated file, with the comment that explains why it is not generated:

```sql
--> statement-breakpoint
-- HAND-WRITTEN, appended after `drizzle-kit generate`. Drizzle has no trigger builder, exactly as
-- it has no `INCLUDE` builder (see 0018's note). A future migration that recreates this table must
-- re-add these two triggers by hand, the same way; `src/db/index-plans.test.ts` reads pg_trigger
-- back out of the catalog so a migration that forgets fails the build rather than the audit.
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not permitted on this table', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
```

`TRUNCATE` is deliberately **not** blocked (ruling 26): a statement-level `BEFORE TRUNCATE` trigger would break `truncateAll` and therefore every integration test in this repo, and `TRUNCATE` already requires table ownership, which is a privilege level that can also `DROP TABLE` and `ALTER TABLE … DISABLE TRIGGER`. Blocking it would buy nothing against an attacker who already has it, and would cost the test suite.

Then run the migrations against both databases:

```bash
npm run db:migrate && npm run db:migrate:test
```

- [ ] **Step 5: Add the new tables to `truncateAll`**

In `src/db/test-db.ts`, extend the `TRUNCATE` list. Order matters only for readability (`CASCADE` handles the rest), so the three audit tables go first, as the newest layer:

```ts
    TRUNCATE TABLE
      audit_chain_checkpoints, audit_chains, audit_events,
      review_reports, reviews,
      chat_reactions, chat_messages,
      ...
```

- [ ] **Step 6: Run the append-only test and watch it pass**

Run: `npm test -- src/db/audit-append-only`
Expected: PASS, all six cases.

- [ ] **Step 7: Assert the indexes and the triggers exist, in the gate that already reads the catalog**

Add to `src/db/index-plans.test.ts`, beside its existing `pg_indexes` assertions:

```ts
it("carries both composite indexes the scaling review named, plus the sequence backstop", async () => {
  const rows = await db.execute<{ indexname: string; indexdef: string }>(
    sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'audit_events'`,
  );
  const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));
  expect(byName.get("audit_events_scope_sequence_idx")).toMatch(/UNIQUE.*\(chain_scope, sequence\)/);
  expect(byName.get("audit_events_league_occurred_idx")).toMatch(/\(league_id, occurred_at\)/);
  expect(byName.get("audit_events_actor_type_occurred_idx")).toMatch(/\(actor_id, event_type, occurred_at\)/);
});

it("carries the append-only triggers, so a migration that recreates the table cannot drop them", async () => {
  const rows = await db.execute<{ tgname: string }>(sql`
    SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_events'::regclass AND NOT tgisinternal
  `);
  expect(rows.map((row) => row.tgname).sort()).toEqual(["audit_events_no_delete", "audit_events_no_update"]);
});
```

- [ ] **Step 8: Run everything**

Run: `npm test -- src/db && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/db drizzle
git commit -m "feat(db): audit_events, its rollup anchor, and the append-only triggers

Three independent defenses, because relying on one is the failure mode: no mutating method on
the service (Task 3), a database trigger that rejects UPDATE and DELETE even from psql, and a
hash chain that catches an edit that somehow got past both.

No foreign keys on audit_events, and that is a decision rather than an omission. leagues cascades
to nine tables; a cascade is a DELETE, so an FK would either make a league undeletable (the
trigger rejects the cascade) or make deleting a league delete the record of what happened in it.

audit_chains is the rollup data-layer-hardening.md asks for, updated in the same transaction as
the append it summarizes. The checkpoint is a separate table so a chain walk never takes a lock
an append is queued behind.

TRUNCATE is not blocked: it needs table ownership, which can also DROP and DISABLE TRIGGER, so
blocking it buys nothing against anyone who has it and would break truncateAll for every
integration test in the repo."
```

---
## Task 3: `AuditLogger` — the only writer, and the row lock that makes a chain safe under two writers

This is the task the chain-scope ruling is decided in, and the ruling is recorded in the module's own docblock as well as in Task 11's decision doc. The short version, with the arithmetic:

**One chain per league, plus one platform chain.** A single global chain would mean every append in the product takes the same row lock, and because the append lives **inside the caller's business transaction** (it has to; see the same-transaction contract below), the lock is held for the whole business transaction rather than for the append. That makes the product's total write throughput `1 / (mean business transaction duration)` — with a draft pick's transaction measured in the 5 to 20ms range, a ceiling around 50 to 200 writes per second for the entire platform, reached by roughly a thousand leagues drafting at once on a Sunday evening. It also creates a lock-ordering hazard that spans every writer in the codebase: `applyAction` already holds `drafts FOR UPDATE`, `setLineup` holds `stat_weeks FOR SHARE`, `joinLeagueInTx` holds `league_invites` then `leagues`, and a global chain head would sit underneath all three at once. Per-league chains reduce contention to contention that already exists — a draft is already single-writer per draft, and twelve managers setting lineups on a Sunday morning at ~15ms each is not a queue.

The league-less events (`session_started`, `profile_updated`, `review_removed`, and Plan B's platform-level `admin_action`) go on one platform chain, which is acceptable for one reason that must stay true: **every platform-chain append is a short transaction by construction.** A sign-in at 20 per second against a ~2ms transaction is 4% utilization of one row. If a later plan ever wants to append a platform event from inside a long transaction, that is the moment to shard the platform chain, and the docblock says so.

**Files:**
- Create: `src/integrity-service/audit-logger.ts`, `src/integrity-service/audit-logger.test.ts`
- Create: `src/integrity-service/test-support.ts`

**Interfaces:**
- Consumes: `linkEvent`, `scopeFor`, `GENESIS_HASH`, `ChainAnchor` (Task 1); `auditEvents`, `auditChains` (Task 2); `DbTx` from `@/db/client`.
- Produces:
  - `interface AuditLogger { record(tx, input): Promise<AuditEvent>; recordAll(tx, inputs): Promise<readonly AuditEvent[]> }`
  - `createAuditLogger(deps: { readonly newId: () => string }): AuditLogger`
  - `getAuditLogger(): AuditLogger` — the process-wide instance, mirroring `getPublisher()`
  - `tamperWithAuditEvent(db, eventId, patch): Promise<void>` (test support)

Tasks 5 and 6 are its only production callers; Task 4 verifies what it wrote.

- [ ] **Step 1: Write the failing logger test**

Create `src/integrity-service/audit-logger.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditChains, auditEvents, leagues, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { AuditEventInput } from "@/domain/audit";
import { GENESIS_HASH, computeEventHash } from "@/integrity/chain";
import { createAuditLogger } from "./audit-logger";

const db = createTestDb();
/** A SECOND pool, so a test can hold one transaction open and race another against it. */
const other = createTestDb();

let counter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(counter += 1)}` });

const input = (over: Partial<AuditEventInput> = {}): AuditEventInput => ({
  eventType: "league_created",
  actorId: "user_alice",
  actorType: "user",
  leagueId: "league_1",
  payload: { name: "Sunday Money" },
  occurredAt: "2026-08-20T17:00:00.000Z",
  ...over,
});

beforeEach(async () => {
  await truncateAll(db);
  counter = 0;
});

describe("AuditLogger.record", () => {
  it("starts a league's chain at genesis and advances its anchor in the same transaction", async () => {
    const event = await db.transaction((tx) => logger.record(tx, input()));

    expect(event).toMatchObject({ chainScope: "league_1", sequence: 1, previousEventHash: GENESIS_HASH });
    const [anchor] = await db.select().from(auditChains).where(eq(auditChains.scope, "league_1"));
    expect(anchor).toMatchObject({ headSequence: 1, headHash: event.eventHash });
  });

  it("links the second event to the first", async () => {
    const first = await db.transaction((tx) => logger.record(tx, input()));
    const second = await db.transaction((tx) => logger.record(tx, input({ eventType: "member_joined" })));
    expect(second.previousEventHash).toBe(first.eventHash);
    expect(second.sequence).toBe(2);
  });

  it("puts a league-less event on the platform chain, and keeps the two apart", async () => {
    await db.transaction((tx) => logger.record(tx, input()));
    const session = await db.transaction((tx) =>
      logger.record(tx, input({ eventType: "session_started", leagueId: null, payload: {} })),
    );
    expect(session).toMatchObject({ chainScope: "platform", sequence: 1, previousEventHash: GENESIS_HASH });
  });

  it("re-hashes to the stored digest after a Postgres round trip, for every shape a payload can take", async () => {
    // THE test the canonical encoder exists for. If jsonb key reordering, timestamptz precision
    // or float representation ever changed the bytes, verification would start failing on rows
    // nobody edited, and this is where that is caught.
    const payload = {
      zebra: "last alphabetically, first in insertion order",
      nested: { z: [1, 2.5, -0.5, { b: false, a: null }], a: "" },
      unicode: "héllo 🏈 \" \\ \n",
      empties: { obj: {}, arr: [] },
      big: 9007199254740991,
    };
    const written = await db.transaction((tx) =>
      logger.record(tx, input({ payload, occurredAt: "2026-08-20T19:00:00.123456+02:00" })),
    );

    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.eventId, written.eventId));
    expect(row).toBeDefined();
    expect(
      computeEventHash({
        eventId: row!.eventId,
        chainScope: row!.chainScope,
        sequence: row!.sequence,
        eventType: row!.eventType,
        actorId: row!.actorId,
        actorType: row!.actorType,
        leagueId: row!.leagueId,
        payload: row!.payload,
        occurredAt: row!.occurredAt.toISOString(),
        previousEventHash: row!.previousEventHash,
        hashVersion: row!.hashVersion,
      }),
    ).toBe(row!.eventHash);
  });

  it("refuses a payload it cannot hash, before anything is written", async () => {
    await expect(
      db.transaction((tx) => logger.record(tx, input({ payload: { when: new Date() } as never }))),
    ).rejects.toThrow(/cannot be hashed/);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect(await db.select().from(auditChains)).toHaveLength(0);
  });
});

describe("AuditLogger.recordAll", () => {
  it("writes a linked run under one anchor lock", async () => {
    const events = await db.transaction((tx) =>
      logger.recordAll(tx, [input(), input({ eventType: "member_joined" }), input({ eventType: "draft_pick" })]),
    );
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(events[1]!.previousEventHash).toBe(events[0]!.eventHash);
    expect(events[2]!.previousEventHash).toBe(events[1]!.eventHash);
    const [anchor] = await db.select().from(auditChains).where(eq(auditChains.scope, "league_1"));
    expect(anchor).toMatchObject({ headSequence: 3, headHash: events[2]!.eventHash });
  });

  it("writes nothing for an empty batch, and takes no lock", async () => {
    const events = await db.transaction((tx) => logger.recordAll(tx, []));
    expect(events).toEqual([]);
    expect(await db.select().from(auditChains)).toHaveLength(0);
  });

  it("refuses a batch that spans two chains", async () => {
    // Ruling 3: one transaction appends to at most one chain, so two transactions can never
    // take two anchor locks in opposite orders. This is where that becomes unfailable.
    await expect(
      db.transaction((tx) => logger.recordAll(tx, [input(), input({ leagueId: "league_2" })])),
    ).rejects.toThrow(/one chain/);
  });
});

describe("the same-transaction contract", () => {
  it("loses the audit event when the caller's transaction rolls back", async () => {
    await db.insert(users).values({ id: "user_alice", email: "a@example.com", displayName: "Alice" });
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(leagues).values({
          id: "league_1", name: "Sunday Money", format: "snake", teamCount: 12, commissionerUserId: "user_alice",
        });
        await logger.record(tx, input());
        throw new Error("the business write failed after the audit append");
      }),
    ).rejects.toThrow(/business write failed/);

    expect(await db.select().from(leagues)).toHaveLength(0);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect(await db.select().from(auditChains)).toHaveLength(0);
  });

  it("fails the business write when the audit append fails, which is the opposite of publishing", async () => {
    // conventions.md: publishing is best-effort and must never fail the write. An audit event is
    // the reverse: a write nobody recorded is worse than a write that did not happen.
    await db.insert(users).values({ id: "user_alice", email: "a@example.com", displayName: "Alice" });
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(leagues).values({
          id: "league_1", name: "Sunday Money", format: "snake", teamCount: 12, commissionerUserId: "user_alice",
        });
        await logger.record(tx, input({ payload: { bad: Number.NaN } as never }));
      }),
    ).rejects.toThrow(/cannot be hashed/);
    expect(await db.select().from(leagues)).toHaveLength(0);
  });
});

describe("concurrency", () => {
  it("serializes two appends to the SAME chain into a gapless, linked run", async () => {
    // Both transactions are in flight before either commits: `held` opens, appends, and waits;
    // `racer` blocks on the anchor row until `held` commits, then reads the new head.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));

    const held = db.transaction(async (tx) => {
      const first = await logger.record(tx, input());
      await gate;
      return first;
    });
    const racer = other.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      return logger.record(tx, input({ eventType: "member_joined" }));
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    const [first, second] = await Promise.all([held, racer]);

    expect([first.sequence, second.sequence].sort()).toEqual([1, 2]);
    const rows = await db.select().from(auditEvents).orderBy(auditEvents.sequence);
    expect(rows[1]!.previousEventHash).toBe(rows[0]!.eventHash);
  });

  it("does NOT let one league's append block another league's, which is why the chain is per league", async () => {
    // The matched pair for the ruling. Same setup as above, different scope, and a statement
    // timeout short enough that blocking would fail the test rather than slow it.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held = db.transaction(async (tx) => {
      await logger.record(tx, input({ leagueId: "league_1" }));
      await gate;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const elsewhere = await other.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
      return logger.record(tx, input({ leagueId: "league_2" }));
    });
    expect(elsewhere).toMatchObject({ chainScope: "league_2", sequence: 1 });

    release();
    await held;
  });
});
```

(`SET LOCAL` inside a transaction is the one form of `SET` PgBouncer transaction pooling allows, because it is transaction-scoped and reset at commit — see `data-layer-hardening.md`. `SET` outside a transaction is what is forbidden.)

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/integrity-service`
Expected: FAIL — `Cannot find module './audit-logger'`.

- [ ] **Step 3: Write `src/integrity-service/audit-logger.ts`**

```ts
import { eq, sql } from "drizzle-orm";
import type { DbTx } from "@/db/client";
import { auditChains, auditEvents } from "@/db/schema";
import type { AuditEvent, AuditEventInput } from "@/domain/audit";
import { GENESIS_HASH, linkEvent, scopeFor, type ChainAnchor } from "@/integrity/chain";

/**
 * The one way anything in this product writes an audit event.
 *
 * There is no update, no delete and no upsert, and there never will be: this interface IS the
 * application-layer half of "append-only" (the database trigger is the second half and the hash
 * chain is the third). `recordAll` is a batch APPEND, not a mutation — it exists so a draft pick
 * that produces two events, or a Plan C trade that produces several, takes the anchor lock once
 * instead of once per event.
 *
 * BOTH methods take the caller's `DbTx` rather than a `Db`. That is the whole contract: an audit
 * event commits with the write it records, or neither commits. It is the exact opposite of the
 * publishing rule in `docs/conventions.md` ("publishing is best-effort and must never fail the
 * write"), and the difference is deliberate — a Redis frame nobody received is a client that
 * refetches, while a mutation nobody recorded is a hole in the record this whole phase exists to
 * be able to trust.
 */
export interface AuditLogger {
  record(tx: DbTx, input: AuditEventInput): Promise<AuditEvent>;
  recordAll(tx: DbTx, inputs: readonly AuditEventInput[]): Promise<readonly AuditEvent[]>;
}

/**
 * Locks one chain's anchor row for the rest of the caller's transaction, creating it at genesis
 * the first time that scope is written to.
 *
 * `SELECT … FOR UPDATE` and not `pg_advisory_lock`, for the same reason `src/draft-service/
 * store.ts` gives: this connection reaches Postgres through PgBouncer in transaction pooling
 * mode, where session-scoped state does not survive a statement boundary. A row lock is
 * transaction-scoped by construction.
 *
 * LOCK ORDER (ruling 3): this is always the LAST lock a transaction takes, and a transaction
 * appends to at most one chain. `applyAction` holds `drafts`, `setLineup` holds `stat_weeks`,
 * `joinLeagueInTx` holds `league_invites` then `leagues` — every one of them reaches this row
 * afterwards and nothing reaches any of them from here, so no cycle exists.
 */
async function lockAnchor(tx: DbTx, scope: string): Promise<ChainAnchor> {
  await tx.insert(auditChains).values({ scope, headHash: GENESIS_HASH }).onConflictDoNothing();
  const [row] = await tx.select().from(auditChains).where(eq(auditChains.scope, scope)).for("update");
  // Unreachable through Postgres: the insert above either created the row or found it committed.
  if (row === undefined) throw new Error(`Audit chain "${scope}" vanished between insert and lock.`);
  return { headSequence: row.headSequence, headHash: row.headHash };
}

export function createAuditLogger({ newId }: { readonly newId: () => string }): AuditLogger {
  async function recordAll(tx: DbTx, inputs: readonly AuditEventInput[]): Promise<readonly AuditEvent[]> {
    if (inputs.length === 0) return [];

    const scopes = new Set(inputs.map((input) => scopeFor(input.leagueId)));
    if (scopes.size > 1) {
      throw new Error(`One transaction may append to one chain; this batch spans ${[...scopes].join(", ")}.`);
    }
    const scope = [...scopes][0]!;

    let anchor = await lockAnchor(tx, scope);
    const events: AuditEvent[] = [];
    for (const input of inputs) {
      // linkEvent hashes here, INSIDE the lock and before any insert, so a payload the canonical
      // encoder refuses fails the caller's transaction rather than writing a row it cannot hash.
      const event = linkEvent(input, anchor, newId());
      events.push(event);
      anchor = { headSequence: event.sequence, headHash: event.eventHash };
    }

    await tx.insert(auditEvents).values(
      events.map((event) => ({ ...event, occurredAt: new Date(event.occurredAt) })),
    );
    // The rollup, advanced in the same transaction as the append it summarizes — the
    // balance-as-rollup convention, applied to the table it was written for. `updatedAt` comes
    // from the event's own injected clock, never from an ambient one.
    await tx
      .update(auditChains)
      .set({ headSequence: anchor.headSequence, headHash: anchor.headHash, updatedAt: new Date(events.at(-1)!.occurredAt) })
      .where(eq(auditChains.scope, scope));

    return events;
  }

  return {
    recordAll,
    async record(tx, input) {
      const [event] = await recordAll(tx, [input]);
      return event!;
    },
  };
}

/**
 * The process-wide logger, mirroring `getPublisher()`. Ids are `crypto.randomUUID()` at this one
 * edge, the same way every other id in this codebase is minted at a route or a service entry.
 */
let shared: AuditLogger | undefined;
export function getAuditLogger(): AuditLogger {
  shared ??= createAuditLogger({ newId: () => crypto.randomUUID() });
  return shared;
}
```

- [ ] **Step 4: Write the test-support tamper helper**

Create `src/integrity-service/test-support.ts`:

```ts
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

/**
 * Edits a stored audit row, by first turning off the triggers that exist to prevent exactly
 * this. That is the point: the trigger stops a careless or casual edit, and the hash chain is
 * what catches the person who could turn the trigger off. A tamper test that could not get past
 * the trigger would be testing the trigger a second time instead of testing the chain.
 *
 * `DISABLE TRIGGER USER` needs table ownership, which is the same privilege that can `DROP
 * TABLE` — so this models a real adversary rather than inventing an impossible one. Test-only:
 * nothing under `src/**` outside a `*.test.ts` may import this.
 */
export async function tamperWithAuditEvent(db: Db, eventId: string, patch: Readonly<Record<string, unknown>>): Promise<void> {
  const assignments = Object.entries(patch).map(([column, value]) => sql`${sql.identifier(column)} = ${value}`);
  await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER USER`);
  try {
    await db.execute(sql`UPDATE audit_events SET ${sql.join(assignments, sql`, `)} WHERE event_id = ${eventId}`);
  } finally {
    await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER USER`);
  }
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npm test -- src/integrity-service`
Expected: PASS, including both concurrency cases.

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/integrity-service
git commit -m "feat(integrity): AuditLogger, the anchor row lock, and one chain per league

The chain-scope ruling, with the arithmetic. A single global chain would put every write in the
product behind one row lock, and because the append lives inside the caller's business
transaction the lock is held for the whole transaction rather than for the append — a
platform-wide ceiling of one over the mean transaction duration, roughly 50 to 200 writes a
second, reached by about a thousand leagues drafting at once. Per-league chains reduce contention
to contention that already exists. The matched concurrency test pair is the proof: same scope
serializes into a gapless linked run, different scopes do not block each other at all.

SELECT FOR UPDATE and not pg_advisory_lock, for the reason store.ts already gives: transaction
pooling does not preserve session state. The anchor is always the last lock a transaction takes,
and a batch that spans two chains throws, so two transactions can never take two anchors in
opposite orders.

The same-transaction contract is the opposite of the publish rule, deliberately: a Redis frame
nobody received is a refetch, a mutation nobody recorded is a hole in the record."
```

---

## Task 4: Verification — checkpointed, batched, and honest about what it cannot see

Two functions and a script. The incremental walk is what makes tamper detection something anyone can afford to run; the full walk is the safety net for a tamper that predates the last checkpoint; and the script is the real, runnable mechanism that a production scheduler will one day call on `INTEGRITY_CONFIG.verification.fullVerifyIntervalHours`.

**What happens on failure** (ruling 8, and it is the question the overview asked to be answered explicitly):

- **The checkpoint does not move.** Every later run re-detects the same break rather than stepping over it.
- **The operator is told.** `scripts/verify-audit-chain.ts` prints the scope, the sequence, the event id and the reason to stderr and exits non-zero. That is a signal a scheduler and a human can both read.
- **A `system_action` event is appended to the platform chain**, recording that a verification failed and on which scope. Detecting a tamper is itself an auditable act.
- **Nothing is stopped, and no member is told.** Halting appends would halt the product, because every audited write commits with its audit event: one corrupted row would become a full outage, triggered by whoever corrupted it. And telling a league "your record may have been tampered with" before a human has looked at it is the accusatory failure mode Task 7's denylist exists to prevent. A member-facing consequence, if there is ever to be one, is a decision for a human holding the script's output.
- **Nothing is ever repaired.** There is no function in this codebase that rewrites a hash, and there must never be one. A chain that can be repaired is a chain that can be forged.

**Files:**
- Create: `src/integrity-service/verify.ts`, `src/integrity-service/verify.test.ts`
- Create: `scripts/verify-audit-chain.ts`
- Modify: `package.json` (the `audit:verify` script)

**Interfaces:**
- Consumes: `verifyLinkedRun`, `computeEventHash`, `HashFn`, `GENESIS_HASH`, `ChainBreakReason` (Task 1); `auditEvents`, `auditChains`, `auditChainCheckpoints` (Task 2); `getAuditLogger` (Task 3).
- Produces:
  - `type ChainVerificationResult = { valid: true; scope; verifiedThrough: number; hashed: number } | { valid: false; scope; firstBrokenEventId: string; firstBrokenSequence: number; reason: ChainBreakReason }`
  - `verifyChainIntegrity(db, scope, deps?): Promise<ChainVerificationResult>`
  - `verifyFullChainIntegrity(db, scope, deps?): Promise<ChainVerificationResult>`
  - `verifyAllChains(db, options?): Promise<readonly ChainVerificationResult[]>`

- [ ] **Step 1: Write the failing verification test**

Create `src/integrity-service/verify.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditChainCheckpoints, auditEvents } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { AuditEventInput } from "@/domain/audit";
import { computeEventHash } from "@/integrity/chain";
import { createAuditLogger } from "./audit-logger";
import { tamperWithAuditEvent } from "./test-support";
import { verifyAllChains, verifyChainIntegrity, verifyFullChainIntegrity } from "./verify";

const db = createTestDb();
let counter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(counter += 1)}` });

const input = (n: number): AuditEventInput => ({
  eventType: "lineup_change",
  actorId: "user_alice",
  actorType: "user",
  leagueId: "league_1",
  payload: { weekNumber: n },
  occurredAt: new Date(Date.UTC(2026, 7, 20, 17, n)).toISOString(),
});

async function seed(count: number): Promise<void> {
  for (let n = 1; n <= count; n += 1) await db.transaction((tx) => logger.record(tx, input(n)));
}

beforeEach(async () => {
  await truncateAll(db);
  counter = 0;
});

describe("verifyChainIntegrity", () => {
  it("verifies an untouched chain and advances the checkpoint to its head", async () => {
    await seed(3);
    expect(await verifyChainIntegrity(db, "league_1")).toEqual({ valid: true, scope: "league_1", verifiedThrough: 3, hashed: 3 });
    const [checkpoint] = await db.select().from(auditChainCheckpoints).where(eq(auditChainCheckpoints.scope, "league_1"));
    expect(checkpoint?.verifiedThroughSequence).toBe(3);
  });

  it("verifies an empty chain as valid, because nothing has been claimed yet", async () => {
    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({ valid: true, verifiedThrough: 0, hashed: 0 });
  });

  it("re-hashes only what is new since the checkpoint", async () => {
    // The spec's incremental-behaviour requirement, asserted by counting the work rather than
    // by trusting the shape of the query. Seed 3, checkpoint, append 2, and assert 2.
    await seed(3);
    await verifyChainIntegrity(db, "league_1");
    await seed(2);

    const hash = vi.fn(computeEventHash);
    const result = await verifyChainIntegrity(db, "league_1", { hash });
    expect(result).toMatchObject({ valid: true, verifiedThrough: 5, hashed: 2 });
    expect(hash).toHaveBeenCalledTimes(2);
  });

  it("catches a tamper after the checkpoint and refuses to advance it", async () => {
    await seed(2);
    await verifyChainIntegrity(db, "league_1");
    await seed(2);
    await tamperWithAuditEvent(db, "evt_3", { payload: { weekNumber: 99 } });

    expect(await verifyChainIntegrity(db, "league_1")).toEqual({
      valid: false, scope: "league_1", firstBrokenEventId: "evt_3", firstBrokenSequence: 3, reason: "hash_mismatch",
    });
    const [checkpoint] = await db.select().from(auditChainCheckpoints).where(eq(auditChainCheckpoints.scope, "league_1"));
    expect(checkpoint?.verifiedThroughSequence).toBe(2);
  });

  it("catches a tamper on the checkpointed row itself", async () => {
    await seed(3);
    await verifyChainIntegrity(db, "league_1");
    await tamperWithAuditEvent(db, "evt_3", { payload: { weekNumber: 99 } });
    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({ reason: "checkpoint_mismatch", firstBrokenSequence: 3 });
  });

  it("does NOT catch a tamper before the checkpoint — that is the full walk's job", async () => {
    // Stated as a test rather than left implicit, because it is the honest cost of being able to
    // afford to run verification at all, and it is a spec exit criterion in both directions.
    await seed(4);
    await verifyChainIntegrity(db, "league_1");
    await tamperWithAuditEvent(db, "evt_2", { payload: { weekNumber: 99 } });

    expect(await verifyChainIntegrity(db, "league_1")).toMatchObject({ valid: true });
    expect(await verifyFullChainIntegrity(db, "league_1")).toMatchObject({
      valid: false, firstBrokenEventId: "evt_2", firstBrokenSequence: 2, reason: "hash_mismatch",
    });
  });
});

describe("verifyFullChainIntegrity", () => {
  it("always walks from genesis, whatever the checkpoint says", async () => {
    await seed(5);
    await verifyChainIntegrity(db, "league_1");
    const hash = vi.fn(computeEventHash);
    expect(await verifyFullChainIntegrity(db, "league_1", { hash })).toMatchObject({ valid: true, hashed: 5 });
    expect(hash).toHaveBeenCalledTimes(5);
  });

  it("pages rather than loading the whole chain, so a long chain stays runnable", async () => {
    // batchSize is small enough in the test config override to make this observable; the query
    // count is what proves it pages, the same countingDb idiom `affectedTeams` established.
    await seed(7);
    const { db: counted, selectCount } = countingDb(db);
    const before = selectCount();
    await verifyFullChainIntegrity(counted, "league_1", { batchSize: 3 });
    // 3 pages of events + the empty page that ends the walk + the checkpoint read + its write.
    expect(selectCount() - before).toBeLessThanOrEqual(7);
  });

  it("catches a deleted row as a sequence gap", async () => {
    await seed(3);
    await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER USER`);
    await db.delete(auditEvents).where(eq(auditEvents.eventId, "evt_2"));
    await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER USER`);
    expect(await verifyFullChainIntegrity(db, "league_1")).toMatchObject({ reason: "sequence_gap", firstBrokenSequence: 3 });
  });
});

describe("verifyAllChains", () => {
  it("verifies every chain that exists and reports one result each", async () => {
    await db.transaction((tx) => logger.record(tx, input(1)));
    await db.transaction((tx) => logger.record(tx, { ...input(1), leagueId: null, eventType: "session_started", payload: {} }));
    const results = await verifyAllChains(db);
    expect(results.map((r) => r.scope).sort()).toEqual(["league_1", "platform"]);
    expect(results.every((r) => r.valid)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/integrity-service/verify`
Expected: FAIL — `Cannot find module './verify'`.

- [ ] **Step 3: Write `src/integrity-service/verify.ts`**

```ts
import { and, asc, eq, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditChainCheckpoints, auditChains, auditEvents } from "@/db/schema";
import type { AuditEvent } from "@/domain/audit";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { GENESIS_HASH, computeEventHash, verifyLinkedRun, type ChainAnchor, type ChainBreakReason, type HashFn } from "@/integrity/chain";

export type ChainVerificationResult =
  | { readonly valid: true; readonly scope: string; readonly verifiedThrough: number; readonly hashed: number }
  | {
      readonly valid: false;
      readonly scope: string;
      readonly firstBrokenEventId: string;
      readonly firstBrokenSequence: number;
      readonly reason: ChainBreakReason;
    };

export interface VerifyOptions {
  /** Injected only so a test can count the work. Production never passes it. */
  readonly hash?: HashFn;
  readonly batchSize?: number;
}

/** A stored row, as the pure verifier wants it: `occurredAt` back in its hashed spelling. */
function toEvent(row: typeof auditEvents.$inferSelect): AuditEvent {
  return { ...row, occurredAt: row.occurredAt.toISOString() };
}

async function page(db: Db, scope: string, after: number, batchSize: number): Promise<readonly AuditEvent[]> {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.chainScope, scope), gt(auditEvents.sequence, after)))
    .orderBy(asc(auditEvents.sequence))
    .limit(batchSize);
  return rows.map(toEvent);
}

/**
 * Walks forward from `from` to the end of the chain, one page at a time, and advances the
 * checkpoint on success. Never advances it on failure: every later run re-detects the same break
 * rather than stepping over it, which is what makes a break something a human eventually sees.
 */
async function walk(db: Db, scope: string, from: ChainAnchor, options: VerifyOptions): Promise<ChainVerificationResult> {
  const batchSize = options.batchSize ?? INTEGRITY_CONFIG.verification.batchSize;
  let anchor = from;
  let hashed = 0;
  for (;;) {
    const events = await page(db, scope, anchor.headSequence, batchSize);
    if (events.length === 0) break;
    const run = verifyLinkedRun(events, anchor, options.hash);
    hashed += run.hashed;
    if (!run.valid) {
      return { valid: false, scope, firstBrokenEventId: run.break.eventId, firstBrokenSequence: run.break.sequence, reason: run.break.reason };
    }
    anchor = run.through;
    if (events.length < batchSize) break;
  }

  await db
    .insert(auditChainCheckpoints)
    .values({ scope, verifiedThroughSequence: anchor.headSequence, verifiedThroughHash: anchor.headHash })
    .onConflictDoUpdate({
      target: auditChainCheckpoints.scope,
      set: { verifiedThroughSequence: anchor.headSequence, verifiedThroughHash: anchor.headHash, verifiedAt: new Date() },
    });
  return { valid: true, scope, verifiedThrough: anchor.headSequence, hashed };
}

/**
 * The routine check: re-hashes only what has been appended since this scope was last verified.
 *
 * It also re-checks the checkpointed row ITSELF, which is what turns "we verified through 3" from
 * a claim into something falsifiable — a tamper exactly on the boundary row would otherwise be
 * invisible to both walks until the next full one.
 *
 * A tamper strictly BEFORE the checkpoint is deliberately invisible here. That is the cost of an
 * incremental check, it is the reason `verifyFullChainIntegrity` exists, and it is asserted in
 * both directions by the tests.
 */
export async function verifyChainIntegrity(db: Db, scope: string, options: VerifyOptions = {}): Promise<ChainVerificationResult> {
  const [checkpoint] = await db.select().from(auditChainCheckpoints).where(eq(auditChainCheckpoints.scope, scope));
  if (checkpoint === undefined || checkpoint.verifiedThroughSequence === 0) {
    return walk(db, scope, { headSequence: 0, headHash: GENESIS_HASH }, options);
  }

  const [boundary] = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.chainScope, scope), eq(auditEvents.sequence, checkpoint.verifiedThroughSequence)));
  if (boundary === undefined || boundary.eventHash !== checkpoint.verifiedThroughHash) {
    return {
      valid: false,
      scope,
      firstBrokenEventId: boundary?.eventId ?? `sequence ${checkpoint.verifiedThroughSequence} (missing)`,
      firstBrokenSequence: checkpoint.verifiedThroughSequence,
      reason: "checkpoint_mismatch",
    };
  }

  return walk(db, scope, { headSequence: checkpoint.verifiedThroughSequence, headHash: checkpoint.verifiedThroughHash }, options);
}

/**
 * The safety net: from genesis, every time, whatever the checkpoint says. Never on a request
 * path — `scripts/verify-audit-chain.ts` is its only caller today, and
 * `INTEGRITY_CONFIG.verification.fullVerifyIntervalHours` is the cadence a scheduler gets.
 */
export async function verifyFullChainIntegrity(db: Db, scope: string, options: VerifyOptions = {}): Promise<ChainVerificationResult> {
  return walk(db, scope, { headSequence: 0, headHash: GENESIS_HASH }, options);
}

/** Every chain that exists, incremental by default. Ordered so the script's output is stable. */
export async function verifyAllChains(db: Db, options: VerifyOptions & { readonly full?: boolean } = {}): Promise<readonly ChainVerificationResult[]> {
  const rows = await db.select({ scope: auditChains.scope }).from(auditChains).orderBy(asc(auditChains.scope));
  const verify = options.full === true ? verifyFullChainIntegrity : verifyChainIntegrity;
  const results: ChainVerificationResult[] = [];
  for (const row of rows) results.push(await verify(db, row.scope, options));
  return results;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/integrity-service/verify`
Expected: PASS, including the "does NOT catch a tamper before the checkpoint" pair.

- [ ] **Step 5: Write the operator script**

Create `scripts/verify-audit-chain.ts`, mirroring `scripts/ingest-once.ts`'s shape (real mechanism, run by hand, scheduled later):

```ts
// Verifies the audit chains and exits non-zero if any of them is broken.
// Run: npm run audit:verify            (incremental, every chain)
//      npm run audit:verify -- --full  (from genesis, every chain)
//      npm run audit:verify -- --scope <leagueId|platform>
//
// This is the real mechanism, not a placeholder: the full walk is the spec's scheduled offline
// job, and a production scheduler (Phase 2 Plan D) runs exactly this on
// INTEGRITY_CONFIG.verification.fullVerifyIntervalHours. Until there is one, an operator runs it.
import { getDb } from "@/db/client";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { verifyAllChains, verifyChainIntegrity, verifyFullChainIntegrity, type ChainVerificationResult } from "@/integrity-service/verify";
import { INTEGRITY_CONFIG } from "@/integrity/config";

function describe(result: ChainVerificationResult): string {
  if (result.valid) return `${result.scope}: ok through sequence ${result.verifiedThrough} (${result.hashed} re-hashed)`;
  return `${result.scope}: BROKEN at sequence ${result.firstBrokenSequence} (event ${result.firstBrokenEventId}), reason ${result.reason}`;
}

/**
 * Detecting a tamper is itself an auditable act, so it is appended to the platform chain. It is
 * NOT a member notice: telling a league its record may have been tampered with, before a human
 * has looked at the output above, is the accusatory failure mode this phase spends a denylist
 * preventing. What happens next is a decision for whoever is reading this output.
 */
async function recordDetection(broken: readonly ChainVerificationResult[]): Promise<void> {
  const db = getDb();
  await db.transaction((tx) =>
    getAuditLogger().record(tx, {
      eventType: "system_action",
      actorId: null,
      actorType: "system",
      leagueId: null,
      payload: {
        action: "chain_verification_failed",
        scopes: broken.map((result) => result.scope),
        checkedAt: new Date().toISOString(),
      },
      occurredAt: new Date().toISOString(),
    }),
  );
}

async function main(): Promise<void> {
  const full = process.argv.includes("--full");
  const scopeFlag = process.argv.indexOf("--scope");
  const scope = scopeFlag === -1 ? undefined : process.argv[scopeFlag + 1];
  if (scopeFlag !== -1 && scope === undefined) throw new Error("--scope needs a chain scope id.");

  const db = getDb();
  const results =
    scope === undefined
      ? await verifyAllChains(db, { full })
      : [full ? await verifyFullChainIntegrity(db, scope) : await verifyChainIntegrity(db, scope)];

  for (const result of results) console.log(describe(result));
  const broken = results.filter((result) => !result.valid);
  if (broken.length === 0) {
    console.log(
      `${results.length} chain(s) verified ${full ? "from genesis" : "incrementally"}. Full-walk cadence: every ${INTEGRITY_CONFIG.verification.fullVerifyIntervalHours}h.`,
    );
    return;
  }

  await recordDetection(broken);
  console.error(`${broken.length} chain(s) failed verification. Nothing has been repaired and nothing will be: a chain that can be repaired is a chain that can be forged.`);
  process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
```

`package.json`: `"audit:verify": "dotenv -e .env.local -- tsx scripts/verify-audit-chain.ts"`, beside `stats:ingest` and `reviews:remove`.

- [ ] **Step 6: Run it against the seeded local database**

```bash
npm run seed
npm run audit:verify
npm run audit:verify -- --full
```
Expected: every chain reported ok, exit 0. (Chains only exist once Tasks 5 and 6 wire the writes; before that this prints "0 chain(s) verified", which is correct and not an error.)

- [ ] **Step 7: Run everything and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add src/integrity-service scripts/verify-audit-chain.ts package.json
git commit -m "feat(integrity): checkpointed verification, the full walk, and the operator script

The scaling review's C5 finding was that re-hashing the whole chain on every run makes tamper
detection decorative, because nobody can afford to run it. The incremental walk resumes from a
per-scope checkpoint and the test counts the hash calls rather than trusting the query shape.

It also re-checks the checkpointed row itself, so 'verified through 3' is falsifiable rather than
a claim. A tamper strictly before the checkpoint is invisible to the incremental run, which is
the honest cost of being able to afford it, and it is asserted in both directions.

Failure semantics, written down because every later plan copies them: the checkpoint does not
move, the operator gets a non-zero exit and a named scope/sequence/event, a system_action goes on
the platform chain, no member is told, nothing is stopped and nothing is ever repaired. Halting
appends would halt the product, since every audited write commits with its audit event.

The tamper tests turn the triggers off to do their tampering. That is the point: the trigger
stops a casual edit, the chain catches the adversary who could turn the trigger off."
```

---

## Task 5: Wiring wave one — a league, its members, and its draft

The first four audited writes, each one appended inside the transaction that performs it. The set is deliberately small and deliberately real: these are the writes an ordinary member's activity feed is made of, and Task 10 is what renders them.

Note what is **not** here: `trade_*` and `roster_move` have no publisher because no trade exists (Plan C), `flag_*` and `admin_action` have no publisher because no admin exists (Plan B), and `system_action` has exactly one (Task 4's detection) until Plan D's enforcement policy. Task 6 adds the test that keeps every reserved name honest.

**Files:**
- Modify: `src/league-service/creation.ts` (+ `creation.test.ts`)
- Modify: `src/league-service/join.ts` (+ `join.test.ts`), `src/league-service/invites.ts` (+ `invites.test.ts`)
- Modify: `src/app/api/leagues/route.ts`, `src/app/api/invites/[code]/accept/route.ts`, `src/app/api/public/leagues/[leagueId]/join/route.ts`
- Modify: `src/draft-service/store.ts` (+ `store.test.ts`), `src/draft-service/instance.ts`, `src/app/api/drafts/[draftId]/actions/route.ts`
- Create: `src/draft-service/audit.ts`, `src/draft-service/audit.test.ts`

**Interfaces:**
- Consumes: `AuditLogger`, `getAuditLogger` (Task 3).
- Produces:
  - `LeagueWriteDeps` gains `readonly audit?: AuditLogger`
  - `JoinLeagueInput` gains `readonly occurredAt: string` and `readonly audit?: AuditLogger`
  - `DraftStoreDeps` gains `readonly audit?: AuditLogger`
  - `ApplyOptions` gains `readonly actor?: { readonly id: string }` — absent means the clock acted
  - `auditEventsForPicks(previous, next): readonly AuditEventInput[]` in `src/draft-service/audit.ts`

- [ ] **Step 1: Write the failing league-creation and join tests**

Add to `src/league-service/creation.test.ts`:

```ts
it("records the league's own creation as the first event on its chain", async () => {
  const result = await createLeague({ db, clock, newId, audit: logger }, validInput());
  expect(result.ok).toBe(true);

  const rows = await db.select().from(auditEvents).where(eq(auditEvents.chainScope, result.leagueId));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    eventType: "league_created",
    sequence: 1,
    actorId: validInput().commissionerUserId,
    actorType: "user",
    leagueId: result.leagueId,
  });
  expect(rows[0]!.payload).toEqual({
    name: "Sunday Money", format: "snake", teamCount: 12, stakeTier: 0,
    isPublicMatchmade: false, experienceTier: "beginner", scoringPreset: "ppr",
  });
  expect(rows[0]!.occurredAt.toISOString()).toBe(clock.now());
});

it("leaves no audit event behind when the league write fails", async () => {
  // The same-transaction contract, proved at a real call site and not only in the logger's own
  // test: `createLeague` already wraps everything in one transaction, and the audit append is
  // inside it, so a duplicate-id failure loses both halves together.
  await createLeague({ db, clock, newId: () => "fixed_id", audit: logger }, validInput());
  const second = await createLeague({ db, clock, newId: () => "fixed_id", audit: logger }, validInput());
  expect(second.ok).toBe(false);
  expect(await db.select().from(auditEvents)).toHaveLength(1);
});
```

Add to `src/league-service/join.test.ts` and `invites.test.ts` the matched pair that proves **both doors write the same event**:

```ts
it("records member_joined when a public join seats someone", async () => {
  const outcome = await joinPublicLeague({ db, newId, clock, audit: logger }, { leagueId: "league_1", userId: "user_bob" });
  expect(outcome.ok).toBe(true);
  const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "member_joined"));
  expect(event).toMatchObject({ actorId: "user_bob", actorType: "user", leagueId: "league_1" });
  expect(event!.payload).toEqual({ teamId: outcome.teamId, via: "public_browse" });
});

it("records member_joined when an invite is accepted, on the same chain and with the same shape", async () => {
  const outcome = await acceptInvite({ db, clock, newId, audit: logger }, { code: "ABC123", userId: "user_bob" });
  const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "member_joined"));
  expect(event!.payload).toEqual({ teamId: outcome.teamId, via: "invite" });
});

it("records nothing when an already-seated member arrives again", async () => {
  // `joinLeagueInTx` treats re-arrival as a free success. An audit event per page reload would
  // be noise in every member's activity feed and a lie about what happened.
  await joinPublicLeague({ db, newId, clock, audit: logger }, { leagueId: "league_1", userId: "user_bob" });
  await joinPublicLeague({ db, newId, clock, audit: logger }, { leagueId: "league_1", userId: "user_bob" });
  expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "member_joined"))).toHaveLength(1);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- src/league-service`
Expected: FAIL — `audit` is not a property of `LeagueWriteDeps`.

- [ ] **Step 3: Wire the league writes**

In `src/league-service/creation.ts`, `LeagueWriteDeps` gains `readonly audit?: AuditLogger`, defaulted at destructure to `getAuditLogger()`, and the transaction gains one call after its four inserts:

```ts
      await audit.record(tx, {
        eventType: "league_created",
        actorId: input.commissionerUserId,
        actorType: "user",
        leagueId,
        payload: {
          name: input.name,
          format: input.format,
          teamCount: input.teamCount,
          stakeTier: input.stakeTier,
          isPublicMatchmade: input.isPublicMatchmade,
          experienceTier: input.experienceTier,
          scoringPreset: input.scoringPreset,
        },
        occurredAt: clock.now(),
      });
```

In `src/league-service/join.ts`, `joinLeagueInTx` records **once**, at the one place a seat is actually taken, so both doors are covered by one call and cannot drift:

```ts
  const teamId = input.newId();
  await tx.insert(teams).values({ /* unchanged */ });
  // Inside the same transaction, after the seat exists and before the caller sees it. Placed
  // here rather than in `acceptInvite` and `joinPublicLeague` separately for exactly the reason
  // the capacity check lives here: two copies of one rule are two places it can disagree.
  await (input.audit ?? getAuditLogger()).record(tx, {
    eventType: "member_joined",
    actorId: input.userId,
    actorType: "user",
    leagueId: league.id,
    payload: { teamId, via: input.via },
    occurredAt: input.occurredAt,
  });
  return { ok: true, leagueId: league.id, teamId, alreadyMember: false };
```

`JoinLeagueInput` gains `readonly via: "invite" | "public_browse"`, `readonly occurredAt: string` and `readonly audit?: AuditLogger`; `joinPublicLeague`'s deps gain `clock` and pass `via: "public_browse"`; `acceptInvite` passes `via: "invite"` and the clock it already has. The three routes pass `systemClock`, exactly as `/api/leagues` already does.

- [ ] **Step 4: Write the failing draft-audit tests**

Create `src/draft-service/audit.test.ts` for the pure half:

```ts
import { describe, expect, it } from "vitest";
import { auditEventsForPicks } from "./audit";

describe("auditEventsForPicks", () => {
  it("produces one event for the pick this action added", () => {
    const events = auditEventsForPicks(stateWithPicks(2), stateWithPicks(3), "user_alice");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "draft_pick",
      actorId: "user_alice",
      actorType: "user",
      leagueId: "league_1",
      occurredAt: "2026-08-20T17:03:00.000Z",
    });
    expect(events[0]!.payload).toEqual({
      draftId: "draft_1", teamId: "team_3", playerId: "player_3", position: "RB",
      round: 1, pickNumber: 3, slot: "RB", slotIndex: 0, price: null, auto: false,
    });
  });

  it("attributes a clock-made pick to the platform, with no actor", () => {
    // The manager who missed the clock did not do this; the platform did. `actorType: system`
    // makes the audit row structurally identical to a human's, attributed honestly, and it is
    // what Task 7's notice keys on to tell that manager what happened.
    const events = auditEventsForPicks(stateWithPicks(2), stateWithAutoPick(3), null);
    expect(events[0]).toMatchObject({ actorType: "system", actorId: null });
    expect(events[0]!.payload).toMatchObject({ auto: true });
  });

  it("produces nothing for an action that added no pick", () => {
    expect(auditEventsForPicks(stateWithPicks(2), stateWithPicks(2), "user_alice")).toEqual([]);
  });

  it("produces one event per pick when several land at once", () => {
    // An auction lot that closes and immediately auto-nominates the next can advance picks by
    // more than one; the audit trail is per pick, never per action.
    expect(auditEventsForPicks(stateWithPicks(2), stateWithPicks(4), "user_alice")).toHaveLength(2);
  });
});
```

And the integration half, in `src/draft-service/store.test.ts`:

```ts
it("records every pick on the league's chain, in the transaction that accepted it", async () => {
  await store.applyAction(draftId, makePick("player_1"), { actor: { id: "user_alice" } });
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "draft_pick"));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ chainScope: leagueId, actorId: "user_alice", sequence: expect.any(Number) });
});

it("records draft_completed in the same transaction that turns the draft into a season", async () => {
  await runFullDraft(store, draftId);
  const [completed] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "draft_completed"));
  expect(completed).toMatchObject({ actorType: "system", actorId: null });
  expect(completed!.payload).toMatchObject({ draftId, picks: expect.any(Number), teams: expect.any(Number) });
});

it("records nothing for a rejected action", async () => {
  const result = await store.applyAction(draftId, makePick("player_already_taken"), { actor: { id: "user_alice" } });
  expect(result.ok).toBe(false);
  expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "draft_pick"))).toHaveLength(0);
});
```

- [ ] **Step 5: Run them and watch them fail, then wire the draft**

Run: `npm test -- src/draft-service`
Expected: FAIL — `Cannot find module './audit'`.

Create `src/draft-service/audit.ts`:

```ts
import type { DraftState } from "@/draft-engine";
import type { AuditEventInput } from "@/domain/audit";

/**
 * The audit events one accepted action produced, derived by diffing the pick list — the same
 * previous/next diff `draftEventsFor` already uses to derive realtime frames, so a pick reaches
 * the audit log and the wire from one comparison rather than two rules that can disagree.
 *
 * `occurredAt` is the pick's OWN timestamp (the action's injected clock), not now: the spec's
 * exit criterion is one correct event per pick with the correct `occurredAt`, and re-reading a
 * clock here would stamp the commit rather than the pick.
 *
 * A queue edit is deliberately not audited. `SET_QUEUE` is a team's private draft plan, and the
 * member-visible activity feed is exactly where it must not appear.
 */
export function auditEventsForPicks(previous: DraftState, next: DraftState, actorId: string | null): readonly AuditEventInput[] {
  const positionOf = new Map(next.pool.map((entry) => [entry.playerId, entry.position]));
  return next.picks.slice(previous.picks.length).map((pick) => ({
    eventType: "draft_pick" as const,
    actorId: pick.auto ? null : actorId,
    actorType: pick.auto ? ("system" as const) : ("user" as const),
    leagueId: next.config.leagueId,
    payload: {
      draftId: next.config.draftId,
      teamId: pick.teamId,
      playerId: pick.playerId,
      position: positionOf.get(pick.playerId) ?? null,
      round: pick.round,
      pickNumber: pick.pickNumber,
      slot: pick.slot,
      slotIndex: pick.slotIndex,
      price: pick.price,
      auto: pick.auto,
    },
    occurredAt: pick.timestamp,
  }));
}
```

In `src/draft-service/store.ts`, inside `applyAction`'s transaction and after the `draft_actions` insert:

```ts
            await tx.insert(draftActions).values({ /* unchanged */ });
            // The audit append rides the draft's existing FOR UPDATE on `drafts`, and the chain
            // anchor is taken after it — the fixed lock order (ruling 3). Both this and the
            // action row commit together or neither does.
            const picked = auditEventsForPicks(state, result.state, options?.actor?.id ?? null);
            await audit.recordAll(tx, picked);
            if (options?.alsoInTransaction !== undefined) await options.alsoInTransaction(tx);
            if (result.state.phase === "complete" && state.phase !== "complete") {
              const counts = await commitDraftState(tx, result.state);
              await audit.record(tx, {
                eventType: "draft_completed",
                actorId: null,
                actorType: "system",
                leagueId: result.state.config.leagueId,
                payload: { draftId, picks: counts.picks, teams: counts.teams },
                occurredAt: action.timestamp,
              });
            }
```

`applyAction`'s two producers pass the actor accordingly: `POST /api/drafts/[draftId]/actions` passes `{ actor: { id: actor.userId } }` (it already resolves the actor for its `teamId` rule), and `src/draft-service/ticker.ts` passes nothing, because the clock is not a person.

- [ ] **Step 6: Run everything**

Run: `npm test -- src/draft-service && npm test -- src/league-service && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/league-service src/draft-service src/app/api
git commit -m "feat(integrity): audit league creation, both join doors, and every draft pick

Four writes, each appended inside the transaction that performs it. member_joined is recorded in
joinLeagueInTx rather than in acceptInvite and joinPublicLeague separately, for the same reason
the capacity check lives there: two copies of one rule are two places it can disagree. Arriving
twice stays free and records nothing, because an audit event per page reload would be noise in
every member's feed and a lie about what happened.

A pick's occurredAt is the pick's own injected timestamp, not the commit's clock, and a
clock-made pick is actorType system with no actor — the manager who missed the clock did not make
that pick, and Task 7's notice keys on exactly that field to tell them so.

SET_QUEUE is deliberately not audited: a team's queue is its private draft plan, and the
member-visible feed is exactly where it must not appear."
```

---

## Task 6: Wiring wave two — lineups, the platform chain, and keeping the reserved names honest

Four more writes and one test that stops this vocabulary from rotting. `lineup_change` completes the league chain; `session_started`, `profile_updated` and `review_removed` are the platform chain's first real traffic, and they are what proves a second scope works at all before Plan B leans on it.

**Files:**
- Modify: `src/league-service/lineups.ts` (+ `lineups.test.ts`)
- Modify: `src/lib/auth/user-sync.ts` (+ its test), `src/app/callback/route.ts`
- Modify: `src/identity-service/profile.ts` (+ `profile.test.ts`)
- Modify: `src/review-service/reviews.ts` (+ `reviews.test.ts`)
- Create: `src/integrity-service/reserved.test.ts`

**Interfaces:**
- Consumes: `AuditLogger` (Task 3), `AUDIT_EVENT_TYPES` (Task 1).
- Produces: no new exported symbols. `setLineup`, `syncUserFromWorkOS`, `updateProfile` and `removeReview` each gain an optional `audit` in their existing deps.

- [ ] **Step 1: Write the failing lineup test**

Add to `src/league-service/lineups.test.ts`:

```ts
it("records the lineup change inside the same transaction that holds the week's share lock", async () => {
  const result = await setLineup(db, validLineupInput(), NOOP_CACHE, { audit: logger, clock });
  expect(result.ok).toBe(true);

  const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "lineup_change"));
  expect(event).toMatchObject({ chainScope: "league_1", actorId: "user_alice", actorType: "user" });
  expect(event!.payload).toEqual({
    teamId: "team_1",
    weekNumber: 3,
    // The starters as they were saved, ids only. Names are resolved when the feed is read, from
    // the tables that own them — see ruling 16.
    starters: [{ slot: "QB", slotIndex: 0, playerId: "player_1" }, /* … */],
  });
});

it("records nothing when the week is locked and the write is refused", async () => {
  await db.insert(statWeeks).values({ week: 3, status: "in_progress" });
  const result = await setLineup(db, validLineupInput(), NOOP_CACHE, { audit: logger, clock });
  expect(result.ok).toBe(false);
  expect(await db.select().from(auditEvents)).toHaveLength(0);
});

it("records nothing when the in-transaction lock re-check refuses the write", async () => {
  // `setLineup` checks the lock twice; the second check is inside the transaction. An audit
  // event written before that check would record a lineup change that never happened.
  await expect(setLineupRacingIngestion()).resolves.toMatchObject({ ok: false });
  expect(await db.select().from(auditEvents)).toHaveLength(0);
});
```

- [ ] **Step 2: Run it, watch it fail, then wire `setLineup`**

Run: `npm test -- src/league-service/lineups`
Expected: FAIL — `setLineup` takes three arguments.

`setLineup` gains a fourth parameter, `deps: { readonly audit?: AuditLogger; readonly clock?: Clock } = {}`, and the append goes **after** the in-transaction lock re-check and beside the upsert, inside the same transaction:

```ts
    const [week] = await tx.select({ status: statWeeks.status }).from(statWeeks).where(eq(statWeeks.week, input.weekNumber)).for("share");
    if (isLineupLocked(week?.status ?? "scheduled")) return true;

    await tx.insert(lineupSlots).values(/* unchanged */).onConflictDoUpdate(/* unchanged */);
    await audit.record(tx, {
      eventType: "lineup_change",
      actorId: input.userId,
      actorType: "user",
      leagueId: input.leagueId,
      payload: {
        teamId: input.teamId,
        weekNumber: input.weekNumber,
        starters: startersOf(lineup).map((slot) => ({ slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId })),
      },
      occurredAt: clock.now(),
    });
    return false;
```

`SetLineupInput` gains `readonly userId: string`. The route already has it (`requireCurrentUser`), and the team is already resolved from the session rather than the body, so this adds no new trust in a request.

- [ ] **Step 3: Write the failing platform-chain tests**

Add to the three existing suites:

```ts
// src/lib/auth/user-sync.test.ts
it("records a session_started on the platform chain for every sign-in", async () => {
  await syncUserFromWorkOS({ db, clock, audit: logger }, workOsUser);
  await syncUserFromWorkOS({ db, clock, audit: logger }, workOsUser);
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "session_started"));
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ chainScope: "platform", leagueId: null, actorId: workOsUser.id, actorType: "user" });
  expect(rows[0]!.payload).toEqual({ via: "callback", firstSignIn: true });
  expect(rows[1]!.payload).toEqual({ via: "callback", firstSignIn: false });
});

it("carries no IP and no device signal, deliberately", async () => {
  // Ruling 20. All four existing IP reads key on X-Forwarded-For, which their own docblock calls
  // caller-controlled and rotatable, and identity-and-trust.md records fixing that as
  // LAUNCH-BLOCKING for Phase 2 Plan D. A multi-account flag keyed on a forgeable header lets an
  // attacker manufacture suspicion against someone else's account, which is strictly worse than
  // a bypassed rate limiter. Plan B adds the signals, with the IP weight at zero.
  await syncUserFromWorkOS({ db, clock, audit: logger }, workOsUser);
  const [row] = await db.select().from(auditEvents);
  expect(Object.keys(row!.payload)).toEqual(["firstSignIn", "via"]);
});

// src/identity-service/profile.test.ts
it("records what changed, and never the old or new display name's contents beyond the field list", async () => {
  await updateProfile(db, { userId: "user_alice", displayName: "Alice B." }, clock, { audit: logger });
  const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "profile_updated"));
  expect(event).toMatchObject({ chainScope: "platform", actorId: "user_alice" });
  expect(event!.payload).toEqual({ fields: ["displayName"] });
});

it("records nothing for a PATCH that changes nothing", async () => {
  await updateProfile(db, { userId: "user_alice" }, clock, { audit: logger });
  expect(await db.select().from(auditEvents)).toHaveLength(0);
});

// src/review-service/reviews.test.ts
it("records the removal on the platform chain, and only when the stamp actually landed", async () => {
  await removeReview(db, { reviewId: "rev_1", removedByUserId: "user_operator", reason: "abuse", audit: logger, clock });
  const [event] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "review_removed"));
  expect(event).toMatchObject({ chainScope: "platform", actorId: "user_operator", actorType: "user" });
  expect(event!.payload).toEqual({ reviewId: "rev_1", authorUserId: "user_bob", reason: "abuse" });

  // The no-re-stamp invariant means a second removal changes nothing, so it must record nothing.
  await removeReview(db, { reviewId: "rev_1", removedByUserId: "user_other", reason: "spam", audit: logger, clock });
  expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "review_removed"))).toHaveLength(1);
});
```

- [ ] **Step 4: Wire the three platform writes**

Each follows the same shape: an optional `audit` in the existing deps, and the append inside a transaction with the write. `removeReview` and `updateProfile`'s no-op path both need care — the rule in every case is **record only when the write actually changed something**, judged by the write's own returned rows and never by a prior read, which is the discipline `removeReview` and `toggleReaction` already use.

`syncUserFromWorkOS` wraps its existing upsert in a transaction (it is one statement today) so the sign-in and its audit event commit together; `firstSignIn` is derived from whether the upsert inserted, using `xmax = 0` on the returned row — the standard Postgres way to tell an insert from an update in an `ON CONFLICT` return, and cheaper than a second query.

- [ ] **Step 5: Write the reserved-vocabulary test**

Create `src/integrity-service/reserved.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES, type AuditEventType } from "@/domain/audit";

/**
 * Every event type is either published by this plan or reserved with a named consumer. A type in
 * neither column is the inert-deliverable class this loop keeps catching: a name in an enum with
 * no writer and no plan that will ever write one.
 *
 * `Record<AuditEventType, …>` and not a partial map: adding a type to the vocabulary without
 * deciding this is a TYPE ERROR, which is a better reminder than a review comment.
 */
const OWNER: Readonly<Record<AuditEventType, "plan-a" | "plan-b" | "plan-c" | "plan-d">> = {
  league_created: "plan-a",
  member_joined: "plan-a",
  draft_pick: "plan-a",
  draft_completed: "plan-a",
  lineup_change: "plan-a",
  session_started: "plan-a",
  profile_updated: "plan-a",
  review_removed: "plan-a",
  system_action: "plan-a",
  roster_move: "plan-c",
  trade_proposed: "plan-c",
  trade_accepted: "plan-c",
  trade_rejected: "plan-c",
  flag_raised: "plan-b",
  flag_resolved: "plan-b",
  admin_action: "plan-b",
};

describe("the audit vocabulary", () => {
  it("assigns every declared type to a plan", () => {
    expect(Object.keys(OWNER).sort()).toEqual([...AUDIT_EVENT_TYPES].sort());
  });

  it("has a real publisher in this repo for every type Plan A owns", async () => {
    // Greps the source rather than the tests: a type "published" only by a test is not published.
    const source = await readAllSource("src");
    for (const [type, owner] of Object.entries(OWNER)) {
      if (owner !== "plan-a") continue;
      expect(source.filter((file) => file.text.includes(`eventType: "${type}"`)).length).toBeGreaterThan(0);
    }
  });

  it("has NO publisher yet for a reserved type, which is the point of reserving it", () => {
    // If this fails, a later plan landed its publisher here and this table needs updating —
    // the same shape `score.update` had while it sat reserved through Phase 1.
    expect(Object.values(OWNER).filter((owner) => owner !== "plan-a").length).toBe(7);
  });
});
```

- [ ] **Step 6: Run everything and verify the chains by hand**

```bash
npm test
npm run infra:up && npm run db:migrate && npm run seed
npm run audit:verify -- --full
```
Expected: the seeded league's chain and the platform chain both verify, with non-zero lengths. This is the first moment the whole spine is observable end to end.

- [ ] **Step 7: Commit**

```bash
git add src/league-service src/lib/auth src/identity-service src/review-service src/integrity-service src/app
git commit -m "feat(integrity): audit lineups, sign-ins, profile edits and review removals

Wave two completes the league chain and gives the platform chain its first real traffic, which is
what proves a second scope works before Plan B leans on it.

Every one of these records only when the write actually changed something, judged by the write's
own returned rows rather than a prior read — the discipline removeReview and toggleReaction
already use. A no-op PATCH, a re-stamped removal and a refused lineup all record nothing.

session_started carries no IP and no device signal, deliberately. All four existing IP reads key
on X-Forwarded-For, which their own docblock calls caller-controlled and rotatable, and a
multi-account flag keyed on a forgeable header lets an attacker manufacture suspicion against
someone else's account. Plan B adds the signals with the IP weight at zero, per the overview.

reserved.test.ts is what keeps the other seven names honest: an exhaustive Record means adding a
type without assigning it a plan is a type error, and the grep proves Plan A's nine have a real
publisher in src rather than only in a test."
```

---
## Task 7: The notice primitive — a durable row, the copy that goes in it, and the words it may never use

The overview flagged a collision to resolve before code: `src/integrity/notifications.ts` beside `src/identity/notifications.ts`, two files with one name doing two jobs. **This plan resolves it by naming, not by docblock** (ruling 11): the integrity module is `src/integrity/notices.ts`, the table is `member_notices`, the event is `notice.created`, and the word "notice" is what the product calls the thing itself. `src/identity/notifications.ts` keeps its name and its job unchanged: it is the catalog of topics a user reads on their profile. One import line can no longer be mistaken for the other, and neither module has to explain itself in a comment nobody reads at the call site.

`notifyAffectedMember` keeps the spec's name, because Plans B, C and D call it by that name.

**The first two notice types are real, and that is the point.** A primitive with no caller is the inert-deliverable class this loop keeps catching, so this plan finds the system-triggered actions that **already exist and already explain nothing**:

1. **`draft_auto_picked`.** When a draft clock expires, `TIMER_EXPIRE` autopicks from the team's queue. It happens today, it is the platform choosing a player for a manager who was not there, and the manager is told nothing at all. It is the same shape as Plan D's lineup auto-set, three plans early, and it is free because Task 5 already records the pick with `actorType: "system"`.
2. **`review_removed`.** Phase 2 shipped `--reason` on the removal script as "author-facing copy", and there has never been anywhere for the author to read it. This is that place.

**Files:**
- Create: `src/integrity/notices.ts`, `src/integrity/notices.test.ts`
- Create: `drizzle/0020_member_notices.sql`
- Modify: `src/db/schema.ts`, `src/db/test-db.ts`
- Create: `src/integrity-service/notify.ts`, `src/integrity-service/notify.test.ts`
- Modify: `src/draft-service/store.ts` (+ its test), `src/review-service/reviews.ts` (+ its test)

**Interfaces:**
- Consumes: `INTEGRITY_CONFIG` (Task 1), `DbTx`, `AuditEvent` (Task 3's return value).
- Produces:
  - `type NoticeType = "draft_auto_picked" | "review_removed"`, `interface NoticeContexts`, `NOTICE_TEMPLATES`, `renderNotice(type, context)`, `NOTICE_SAMPLES`
  - `interface MemberNotice { id; userId; leagueId; noticeType; title; body; context; auditEventId; createdAt; readAt }`
  - `notifyAffectedMember(tx, input, deps?): Promise<MemberNotice>`
  - `memberNotices` Drizzle table

Task 8 delivers these over the wire; Task 10 renders them.

- [ ] **Step 1: Write the failing copy test**

Create `src/integrity/notices.test.ts`. The denylist and the em-dash rule lead, because a copy file whose rules are enforced by review forever is a copy file whose rules erode:

```ts
import { describe, expect, it } from "vitest";
import { INTEGRITY_CONFIG } from "./config";
import { NOTICE_SAMPLES, NOTICE_TEMPLATES, renderNotice, type NoticeType } from "./notices";

const TYPES = Object.keys(NOTICE_TEMPLATES) as readonly NoticeType[];

describe("NOTICE_TEMPLATES", () => {
  it("renders a title and a body for every type this product can send", () => {
    for (const type of TYPES) {
      const notice = renderNotice(type, NOTICE_SAMPLES[type]);
      expect(notice.title).toMatch(/\S/);
      expect(notice.body).toMatch(/\S/);
    }
  });

  it("never accuses the member of anything", () => {
    // The spec's denylist check. It runs over OUR words, rendered with a neutral sample context:
    // the one place member-visible text comes from outside this file is the operator's own
    // removal reason, which is quoted verbatim on purpose (the same call `removalPhraseFor`
    // already made in Phase 2) and must not be silently filtered.
    for (const type of TYPES) {
      const { title, body } = renderNotice(type, NOTICE_SAMPLES[type]);
      const text = `${title} ${body}`.toLowerCase();
      for (const term of INTEGRITY_CONFIG.notices.accusatoryTerms) {
        expect(text).not.toContain(term);
      }
    }
  });

  it("uses no em-dash, because this file is nothing but user-facing copy", () => {
    for (const type of TYPES) {
      const { title, body } = renderNotice(type, NOTICE_SAMPLES[type]);
      expect(`${title} ${body}`).not.toMatch(/[—–]/);
    }
  });

  it("says what happened and what it means, in the second person, without jargon", () => {
    const autoPick = renderNotice("draft_auto_picked", NOTICE_SAMPLES.draft_auto_picked);
    expect(autoPick.title).toBe("Your pick was made automatically");
    expect(autoPick.body).toBe(
      "The clock ran out on pick 24 in Sunday Money, so we used your queue and drafted Bijan Robinson (RB).",
    );

    const removed = renderNotice("review_removed", NOTICE_SAMPLES.review_removed);
    expect(removed.title).toBe("Your review was removed");
    expect(removed.body).toBe(
      'An operator removed your review. The reason they gave was: "off topic". Your review is kept on file exactly as you wrote it.',
    );
  });

  it("fails the type checker rather than the reader when a type has no template", () => {
    // NOTICE_TEMPLATES is a Record over the full union, so adding a NoticeType without adding
    // its copy does not compile. Asserted here too so the property is visible in the suite.
    expect(TYPES.sort()).toEqual(["draft_auto_picked", "review_removed"]);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then write `src/integrity/notices.ts`**

```ts
import { INTEGRITY_CONFIG } from "./config";

/**
 * The copy a system-triggered action says to the member it affected. THE one place this text
 * lives: call sites pass structured context, never a string.
 *
 * Not to be confused with `src/identity/notifications.ts`, and named so it cannot be: that module
 * is the CATALOG of topics a user reads on their profile ("what does this product tell me
 * about?"). This one is the WORDS a specific automated action says to a specific person. The
 * phase overview flagged the two as a naming collision before either existed; renaming is the
 * resolution, because two files called `notifications.ts` differ by one word in an import line.
 *
 * Every template obeys two rules, both enforced by `notices.test.ts` rather than by review:
 * nothing accusatory (`INTEGRITY_CONFIG.notices.accusatoryTerms`), and no em-dash.
 */
export interface NoticeContexts {
  readonly draft_auto_picked: {
    readonly leagueName: string;
    readonly pickNumber: number;
    readonly playerName: string;
    readonly position: string;
  };
  readonly review_removed: {
    /** The operator's OWN words, quoted verbatim. Never paraphrased and never filtered. */
    readonly reason: string;
  };
}

export type NoticeType = keyof NoticeContexts;

export interface RenderedNotice {
  readonly title: string;
  readonly body: string;
}

type NoticeTemplate<T extends NoticeType> = (context: NoticeContexts[T]) => RenderedNotice;

export const NOTICE_TEMPLATES: { readonly [T in NoticeType]: NoticeTemplate<T> } = {
  draft_auto_picked: ({ leagueName, pickNumber, playerName, position }) => ({
    title: "Your pick was made automatically",
    body: `The clock ran out on pick ${pickNumber} in ${leagueName}, so we used your queue and drafted ${playerName} (${position}).`,
  }),
  review_removed: ({ reason }) => ({
    title: "Your review was removed",
    body: `An operator removed your review. The reason they gave was: "${reason}". Your review is kept on file exactly as you wrote it.`,
  }),
};

/** One neutral context per type, so the denylist and em-dash checks have something to render. */
export const NOTICE_SAMPLES: { readonly [T in NoticeType]: NoticeContexts[T] } = {
  draft_auto_picked: { leagueName: "Sunday Money", pickNumber: 24, playerName: "Bijan Robinson", position: "RB" },
  review_removed: { reason: "off topic" },
};

export function renderNotice<T extends NoticeType>(type: T, context: NoticeContexts[T]): RenderedNotice {
  return NOTICE_TEMPLATES[type](context);
}
```

Run: `npm test -- src/integrity`
Expected: PASS.

- [ ] **Step 3: Add `member_notices` and migrate**

```ts
/**
 * What the platform told one member it did, and when they read it.
 *
 * The row stores the RENDERED copy, not only the type and the context (ruling 12). What a person
 * was told is a historical fact: if a template is reworded next month, the notice they already
 * read must not silently become different words. `context` is kept beside it so a later reader
 * can see what it was rendered from, which is also what makes a template change auditable.
 *
 * `league_id` is nullable, because not every automated action happens inside a league: a review
 * removal does not. Unlike `audit_events` this table DOES carry foreign keys with cascade: it is
 * a delivery record, not the record, and a deleted user's undelivered notices are noise.
 *
 * `notice_type` is TEXT and not a pg enum, unlike `audit_event_type`. The audit vocabulary is
 * fixed and fully declared today; notice types are added by Plans B, C and D, and `ALTER TYPE …
 * ADD VALUE` inside drizzle-kit's transaction-wrapped migration is a trap (the new value cannot
 * be used in the same transaction). `NoticeType` plus `NOTICE_TEMPLATES` is the vocabulary, and
 * `notify.test.ts` asserts every stored value is one of its keys.
 */
export const memberNotices = pgTable(
  "member_notices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    leagueId: text("league_id").references(() => leagues.id, { onDelete: "cascade" }),
    noticeType: text("notice_type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    context: jsonb("context").$type<JsonObject>().notNull(),
    /** The audit event this notice explains. No FK, for the same reason `audit_events` has none. */
    auditEventId: text("audit_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    /**
     * The inbox's only ordering. `(user_id, created_at)` and not a partial index on unread: the
     * inbox reads a member's most recent notices whether or not they are read, and the unread
     * count is a `count(*)` over that same bounded page rather than a rollup — the balance-as-
     * rollup convention's own threshold (derive over a bounded set, roll up over an unbounded
     * one), and a member's recent notices are bounded by `INTEGRITY_CONFIG.notices.inboxSize`.
     */
    index("member_notices_user_created_idx").on(t.userId, t.createdAt),
  ],
);
```

```bash
npm run db:generate     # drizzle/0020_member_notices.sql
npm run db:migrate && npm run db:migrate:test
```

Add `member_notices` to `truncateAll`, ahead of `users`.

- [ ] **Step 4: Write the failing `notifyAffectedMember` test**

Create `src/integrity-service/notify.test.ts`:

```ts
describe("notifyAffectedMember", () => {
  it("writes the rendered copy, the context and the audit event it explains", async () => {
    const notice = await db.transaction(async (tx) => {
      const event = await logger.record(tx, autoPickEvent());
      return notifyAffectedMember(
        tx,
        {
          leagueId: "league_1",
          userId: "user_bob",
          noticeType: "draft_auto_picked",
          context: { leagueName: "Sunday Money", pickNumber: 24, playerName: "Bijan Robinson", position: "RB" },
          occurredAt: "2026-08-20T17:00:00.000Z",
          auditEventId: event.eventId,
        },
        { newId: () => "notice_1" },
      );
    });

    const [row] = await db.select().from(memberNotices);
    expect(row).toMatchObject({
      id: "notice_1", userId: "user_bob", leagueId: "league_1", noticeType: "draft_auto_picked",
      title: "Your pick was made automatically", auditEventId: expect.any(String), readAt: null,
    });
    expect(row!.body).toContain("Bijan Robinson");
    expect(row!.context).toEqual(notice.context);
  });

  it("commits with the write it explains, and is lost with it", async () => {
    await expect(
      db.transaction(async (tx) => {
        await notifyAffectedMember(tx, autoPickNotice(), { newId: () => "notice_1" });
        throw new Error("the action this notice explains failed");
      }),
    ).rejects.toThrow();
    expect(await db.select().from(memberNotices)).toHaveLength(0);
  });

  it("only ever stores a type the template registry knows", async () => {
    expect(Object.keys(NOTICE_TEMPLATES)).toContain((await seedOneNotice()).noticeType);
  });
});

describe("listNotices and markNoticesRead", () => {
  it("returns only the caller's own notices, newest first, capped by config", async () => {
    await seedNotices("user_bob", INTEGRITY_CONFIG.notices.inboxSize + 5);
    await seedNotices("user_alice", 2);
    const page = await listNotices(db, "user_bob");
    expect(page.notices).toHaveLength(INTEGRITY_CONFIG.notices.inboxSize);
    expect(page.notices.every((notice) => notice.userId === "user_bob")).toBe(true);
    expect(page.notices[0]!.createdAt > page.notices[1]!.createdAt).toBe(true);
  });

  it("counts unread over the same bounded page rather than the whole table", async () => {
    await seedNotices("user_bob", 3);
    expect((await listNotices(db, "user_bob")).unreadCount).toBe(3);
    await markNoticesRead(db, { userId: "user_bob", noticeIds: ["notice_1"], readAt: NOW });
    expect((await listNotices(db, "user_bob")).unreadCount).toBe(2);
  });

  it("cannot stamp somebody else's notice read", async () => {
    await seedNotices("user_alice", 1);
    const stamped = await markNoticesRead(db, { userId: "user_bob", noticeIds: ["notice_1"], readAt: NOW });
    expect(stamped).toBe(0);
    const [row] = await db.select().from(memberNotices).where(eq(memberNotices.id, "notice_1"));
    expect(row!.readAt).toBeNull();
  });

  it("does not re-stamp a notice that is already read", async () => {
    await seedNotices("user_bob", 1);
    await markNoticesRead(db, { userId: "user_bob", noticeIds: ["notice_1"], readAt: NOW });
    expect(await markNoticesRead(db, { userId: "user_bob", noticeIds: ["notice_1"], readAt: LATER })).toBe(0);
  });
});
```

- [ ] **Step 5: Write `src/integrity-service/notify.ts`**

```ts
/**
 * The seam every automated action in this phase calls to explain itself to the person it
 * affected. Plans B, C and D call it by this name, which is why the name is the spec's.
 *
 * The signature is an object rather than the spec's four positional parameters
 * (`notifyAffectedMember(leagueId, userId, notificationType, context)`), for two reasons: the
 * `tx` is the load-bearing part and has to come first, and two adjacent id strings in a
 * positional call is a swap waiting to happen at a call site nobody re-reads.
 *
 * It writes INSIDE the caller's transaction, exactly like the audit append: a notice about a
 * write that then rolled back is a lie told to a member. The Redis frame is the only best-effort
 * half, and it is `deliverNotice`, called after the commit.
 */
export async function notifyAffectedMember<T extends NoticeType>(
  tx: DbTx,
  input: NotifyInput<T>,
  deps: { readonly newId: () => string } = { newId: () => crypto.randomUUID() },
): Promise<MemberNotice> { /* render, insert, return the row */ }

/**
 * Best-effort live delivery, after the commit. Publishing failure is never surfaced: the durable
 * row is already written and the inbox reads it on the next page load, which is precisely the
 * "Postgres is authoritative, publishing is best-effort" rule this codebase already runs on.
 *
 * A notice with no league is not published at all (ruling 13): the frame exists to nudge a page
 * that is open RIGHT NOW about something happening in a league the reader is looking at, and a
 * review removal is not that. It reaches them on their next load, which is honest and is what
 * the inbox is for.
 */
export async function deliverNotice(notice: MemberNotice, publish = getPublisher().publishToUser): Promise<void> { /* … */ }
```

Wire the two real callers:

- `src/draft-service/store.ts`: when `auditEventsForPicks` produced an event with `actorType: "system"`, resolve that team's manager (`tx.select({ userId: teams.userId }).from(teams).where(eq(teams.id, pick.teamId))` — one query, only on the autopick path) and call `notifyAffectedMember` in the same transaction; call `deliverNotice` beside the existing `broadcast`, after the commit.
- `src/review-service/reviews.ts`: `removeReview` already returns a `RemovalRecord` only when the stamp actually landed. Wrap the update, the audit event and the notice in one transaction; the notice goes to `record.userId` with the operator's `reason` verbatim.

- [ ] **Step 6: Run it, run everything, commit**

```bash
npm test -- src/integrity src/integrity-service src/draft-service src/review-service
npm run typecheck && npm run lint && npm run build
git add src/integrity src/integrity-service src/db drizzle src/draft-service src/review-service
git commit -m "feat(integrity): member_notices, the notice templates, and two real senders

The overview flagged src/integrity/notifications.ts beside src/identity/notifications.ts as a
collision to resolve before code. Resolved by naming rather than by docblock: this is
src/integrity/notices.ts, the table is member_notices, the event is notice.created. identity's
module is the catalog of topics a user reads on their profile and keeps its name. Two files
called notifications.ts differ by one word in an import line.

The primitive ships with two real senders, because a primitive with no caller is the inert
deliverable this loop keeps catching. Both already existed as silent platform actions: a draft
clock expiring and autopicking for a manager who was not there, and a review removal whose
--reason has been called 'author-facing copy' since Phase 2 with nowhere for the author to read
it.

The row stores the rendered copy, not just the type and context: what a person was told is a
historical fact, and rewording a template must not change the words they already read.

The denylist runs over our words rendered with a neutral sample, not over the operator's quoted
reason. Quoting the operator verbatim is the same call Phase 2 made with removalPhraseFor, and
silently filtering their words would be worse than the risk."
```

---

## Task 8: `notice.created` — a per-user stream key, because a private notice may not ride a league broadcast

The overview's third structural finding: all ten realtime event types are league-**broadcast**, and a member-affecting integrity notice cannot ride that. A trade held for fairness review must not tell the league. Even a content-free frame on the league stream would leak the fact that a specific member got a specific kind of notice, which for a held trade is most of the information.

So the frame goes on a **per-user stream key**. This is not a second mechanism: it is Redis Streams over SSE with plain `XREAD BLOCK`, the same publisher, the same `RealtimeEvent` shape, the same `Last-Event-ID` resume. The only generalization is that `subscribe` takes a stream key instead of a league id, which it was already computing internally.

And the frame carries **no copy**: `{ noticeId, noticeType }`. The words come from `GET /api/notices`, where the caller is authenticated as themselves. A Redis stream is retained for `streamMaxLen` entries and read by anything holding the key; the durable row behind an authenticated read is the right place for what a notice actually says.

**Files:**
- Modify: `src/lib/realtime/events.ts`, `src/lib/realtime/config.ts`, `src/lib/realtime/publish.ts`, `src/lib/realtime/subscribe.ts`, `src/lib/realtime/sse.ts` (+ `realtime.test.ts`, `sse.test.ts`)
- Modify: `src/identity/notifications.ts` (+ `notifications.test.ts`)
- Create: `src/app/api/notices/route.ts`, `src/app/api/notices/read/route.ts`, `src/app/api/notices/stream/route.ts`, `src/app/api/notices/_shared.ts`
- Create: `src/integrity-service/schemas.ts`
- Modify: `src/account-room/contract.ts`

**Interfaces:**
- Consumes: `listNotices`, `markNoticesRead`, `deliverNotice` (Task 7); `requireCurrentUser`.
- Produces:
  - `REALTIME_EVENT_TYPES` gains `"notice.created"`
  - `REALTIME_CONFIG.userStreamKey(userId): string`
  - `Publisher` gains `publishToUser({ userId, leagueId, type, payload })`
  - `subscribe({ redis, streamKey, afterId, signal })` (was `leagueId`)
  - `createUserEventStream(request, userId): Response`
  - `interface NoticeView`, `interface NoticesBody { readonly notices: readonly NoticeView[]; readonly unreadCount: number }`

- [ ] **Step 1: Write the failing realtime tests**

Add to `src/lib/realtime/realtime.test.ts`:

```ts
it("delivers a user-targeted frame to that user's stream and nowhere else", async () => {
  const publisher = createPublisher({ redis, clock });
  await publisher.publishToUser({ userId: "user_bob", leagueId: "league_1", type: "notice.created", payload: { noticeId: "notice_1", noticeType: "draft_auto_picked" } });

  const mine = await readOnce(REALTIME_CONFIG.userStreamKey("user_bob"));
  expect(mine).toMatchObject({ type: "notice.created", payload: { noticeId: "notice_1" } });
  expect(await readOnce(REALTIME_CONFIG.leagueStreamKey("league_1"))).toBeNull();
  expect(await readOnce(REALTIME_CONFIG.userStreamKey("user_alice"))).toBeNull();
});

it("carries no notice copy on the wire", async () => {
  // The stream is retained and readable by anything holding the key; the words a member is told
  // live behind an authenticated read of their own row. This asserts the payload's whole shape,
  // so adding `title` later fails here rather than shipping.
  await publisher.publishToUser({ userId: "user_bob", leagueId: "league_1", type: "notice.created", payload: noticePayload });
  const frame = await readOnce(REALTIME_CONFIG.userStreamKey("user_bob"));
  expect(Object.keys(frame!.payload as object).sort()).toEqual(["noticeId", "noticeType"]);
});
```

And to `src/identity/notifications.test.ts`, the catalog's honest extension — the existing test already fails without it:

```ts
it("names the user-targeted event, now that one exists", () => {
  const topic = NOTIFICATION_CATALOG.find((entry) => entry.key === "platform-actions");
  expect(topic?.events).toEqual(["notice.created"]);
});
```

with the catalog entry itself:

```ts
  {
    key: "platform-actions",
    title: "When the platform acts on your league",
    detail: "In the app, in your notices and on your league's activity page.",
    events: ["notice.created"],
  },
```

- [ ] **Step 2: Run them, watch them fail, then generalize the transport**

`src/lib/realtime/config.ts`:

```ts
  /**
   * Redis Stream key for ONE USER's own events. The second key format in this product, and the
   * reason it exists: every other event type is a league broadcast, and a notice about one
   * member ("your trade is on hold for review") must not be readable by their leaguemates. Same
   * mechanism, same XREAD, same Last-Event-ID resume, different key.
   */
  userStreamKey: (userId: string): string => `user:${userId}:events`,
```

`src/lib/realtime/subscribe.ts`: `SubscribeInput.leagueId` becomes `streamKey`, and the internal `REALTIME_CONFIG.leagueStreamKey(leagueId)` call moves out to the two callers. One line moves; nothing else about the iterator changes.

`src/lib/realtime/publish.ts`: `createPublisher` returns `publishToUser` beside `publish`, both delegating to one private `append(key, input)` so the MAXLEN policy, the field layout and the error contract cannot drift between them.

`src/lib/realtime/sse.ts`: `createLeagueEventStream` passes `REALTIME_CONFIG.leagueStreamKey(leagueId)`; a new `createUserEventStream(request, userId)` passes `REALTIME_CONFIG.userStreamKey(userId)`. Both go through the same builder and therefore share `maxStreamsPerUser`, which is correct: a notices tab is a Redis socket and an fd like any other.

- [ ] **Step 3: Write the failing route tests**

```ts
// src/app/api/notices/notices-routes.test.ts
it("returns only the caller's notices", async () => {
  const response = await GET(authed("user_bob"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data.notices.map((n: NoticeView) => n.id)).toEqual(["notice_2", "notice_1"]);
});

it("answers 401 with JSON rather than redirecting", async () => {
  expect(await (await GET(anonymous())).json()).toEqual({ ok: false, error: expect.any(String) });
});

it("marks only the caller's own notices read, and answers what it stamped", async () => {
  const response = await POST(authedWithBody("user_bob", { noticeIds: ["notice_1", "someone_elses"] }));
  expect(await response.json()).toEqual({ ok: true, data: { stamped: 1 } });
});

it("rejects a body that is not a list of ids, naming the field", async () => {
  const response = await POST(authedWithBody("user_bob", { noticeIds: "notice_1" }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/noticeIds/);
});

it("rate-limits the notices read the same way every other read in this codebase is limited", async () => {
  for (let i = 0; i < NOTICES_RATE_LIMIT + 1; i += 1) await GET(authed("user_bob"));
  expect((await GET(authed("user_bob"))).status).toBe(429);
});
```

- [ ] **Step 4: Write the three routes**

Each is thin: `requireCurrentUser`, the rate limiter from `_shared.ts` (the same singleton-plus-test-reset shape `src/app/api/profile/_shared.ts` established), `parseJson` with the Zod schema for the POST, the service call, and the `ok()`/`fail()` envelope. The stream route declares `runtime = "nodejs"` and `dynamic = "force-dynamic"` like the league SSE route, and calls `createUserEventStream(request, user.id)`.

There is no route anywhere that takes a user id from a request: every one of these reads the caller from `requireCurrentUser()`, which is what makes "only your own notices" a property of the code rather than a check somebody could forget.

- [ ] **Step 5: Prove the end-to-end path with two clients**

Add to the SSE suite, reusing the existing two-client chat pattern:

```ts
it("reaches an open notices stream when an autopick happens, and does not reach the league's", async () => {
  const mine = openStream("/api/notices/stream", "user_bob");
  const leaguemate = openStream("/api/leagues/league_1/events", "user_alice");

  await expireTheDraftClock();          // the ticker's TIMER_EXPIRE, which autopicks for user_bob

  await expect(nextEvent(mine)).resolves.toMatchObject({ type: "notice.created" });
  await expect(nextEvent(leaguemate)).resolves.toMatchObject({ type: "draft.pick" });
  // The leaguemate sees the PICK, which is public, and never the notice, which is not.
  expect(framesSoFar(leaguemate).map((f) => f.type)).not.toContain("notice.created");
});
```

- [ ] **Step 6: Run everything and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add src/lib/realtime src/identity src/app/api/notices src/integrity-service src/account-room
git commit -m "feat(realtime): notice.created on a per-user stream key

The overview's third structural finding: all ten event types are league broadcasts, and a notice
about one member cannot ride one. Even a content-free frame on the league stream leaks that a
specific member got a specific kind of notice, which for a held trade is most of the information.

Not a second mechanism. Same Redis Streams over SSE, same XREAD BLOCK, same Last-Event-ID
resume, same publisher, same per-user connection cap. subscribe() now takes the stream key it was
already computing internally, which is the whole generalization.

The frame carries noticeId and noticeType and nothing else. A stream is retained and readable by
anything holding the key; the words a member is told come from an authenticated read of their own
row. The payload's whole key list is asserted, so adding a title later fails the test.

notifications.test.ts forced the catalog to gain an honest topic for the new event type, which is
exactly what that coupling is for."
```

---
## Task 9: The field allowlist — what a member may see, decided type by type, denying by default

The spec asks for "an explicit per-`eventType` field allowlist for this view" that excludes admin-investigatory fields, and for Plan B to be able to prove the admin view shows more than the member view over the same events. This task is that allowlist, built as a **`Record<AuditEventType, …>` over the full union**, so a plan that adds an event type without deciding whether members may see it does not compile.

Two rules make the whole thing safe:

1. **Deny by default.** Every type Plan A does not publish is `hidden`. Plan B flips its own, Plan C flips its own. A visible renderer for a payload shape nobody has written yet would be a guess, and a guess in an allowlist is a leak.
2. **Read the payload field by field.** No renderer ever spreads a payload into a row. A field that is missing or the wrong type makes the row `null`, not the string "undefined".

And one visibility case that is neither everyone nor nobody: **`lineup_change` is visible only to the manager who made it** (ruling 15). Broadcasting "Alice benched her starting running back" to the league before kickoff hands every opponent free information about a lineup the product deliberately locks. It is a competitive leak, not a privacy nicety.

**Files:**
- Create: `src/integrity/activity-view.ts`, `src/integrity/activity-view.test.ts`
- Create: `src/integrity-service/activity.ts`, `src/integrity-service/activity.test.ts`

**Interfaces:**
- Consumes: `AuditEvent`, `AUDIT_EVENT_TYPES` (Task 1); `auditEvents` (Task 2); `IconName` (**type only**, exactly the way `src/identity/avatars.ts` imports it, so the rule layer never pulls React).
- Produces:
  - `type ActivityVisibility = "everyone" | "actor_only" | "hidden"`
  - `const ACTIVITY_VISIBILITY: Readonly<Record<AuditEventType, ActivityVisibility>>`
  - `interface ActivityNames { member(userId): string; player(playerId): string; team(teamId): string }`
  - `interface ActivityRow { eventId; occurredAt; icon: IconName; headline; detail: string | null }`
  - `activityRowFor(event, viewer, names): ActivityRow | null`
  - `listLeagueActivity(db, { leagueId, viewerUserId, before? }): Promise<ActivityPage>`

Task 10 renders `ActivityRow`s; Plan B's admin detail view reads the same events without this function, which is what makes its allowlist proof possible.

- [ ] **Step 1: Write the failing allowlist test**

Create `src/integrity/activity-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "@/domain/audit";
import { ACTIVITY_VISIBILITY, activityRowFor } from "./activity-view";

const names = {
  member: (id: string | null) => (id === "user_alice" ? "Alice" : id === "user_bob" ? "Bob" : "A former member"),
  player: (id: string) => (id === "player_1" ? "Bijan Robinson" : "A player who is no longer listed"),
  team: (id: string) => (id === "team_1" ? "Alice's team" : "Another team"),
};
const viewer = { userId: "user_bob" };

describe("ACTIVITY_VISIBILITY", () => {
  it("decides every event type in the vocabulary", () => {
    expect(Object.keys(ACTIVITY_VISIBILITY).sort()).toEqual([...AUDIT_EVENT_TYPES].sort());
  });

  it("hides every type this plan does not publish, so a later plan has to decide on purpose", () => {
    for (const type of ["trade_proposed", "trade_accepted", "trade_rejected", "roster_move", "flag_raised", "flag_resolved", "admin_action"] as const) {
      expect(ACTIVITY_VISIBILITY[type]).toBe("hidden");
    }
  });

  it("hides the platform chain's types, which can never appear in a league feed anyway", () => {
    for (const type of ["session_started", "profile_updated", "review_removed"] as const) {
      expect(ACTIVITY_VISIBILITY[type]).toBe("hidden");
    }
  });
});

describe("activityRowFor", () => {
  it("renders a human pick with the round and the pick number", () => {
    expect(activityRowFor(event("draft_pick", { draftId: "d", teamId: "team_1", playerId: "player_1", position: "RB", round: 2, pickNumber: 24, slot: "RB", slotIndex: 0, price: null, auto: false }, "user_alice"), viewer, names)).toEqual({
      eventId: "evt_1",
      occurredAt: "2026-08-20T17:00:00.000Z",
      icon: "check",
      headline: "Alice drafted Bijan Robinson.",
      detail: "Round 2, pick 24.",
    });
  });

  it("says the clock did it when the clock did it, and never blames the manager", () => {
    const row = activityRowFor(event("draft_pick", { ...pickPayload, auto: true }, null), viewer, names);
    expect(row).toMatchObject({
      icon: "clock",
      headline: "The clock ran out, so Alice's team drafted Bijan Robinson from their queue.",
    });
  });

  it("shows an auction price only when there is one", () => {
    expect(activityRowFor(event("draft_pick", { ...pickPayload, price: 42 }, "user_alice"), viewer, names)?.detail).toBe("Round 2, pick 24. Won for $42.");
  });

  it("shows a member their own lineup change and nobody else's", () => {
    const mine = event("lineup_change", { teamId: "team_2", weekNumber: 3, starters: [] }, "user_bob");
    const theirs = event("lineup_change", { teamId: "team_1", weekNumber: 3, starters: [] }, "user_alice");
    expect(activityRowFor(mine, viewer, names)?.headline).toBe("You set your week 3 lineup.");
    expect(activityRowFor(theirs, viewer, names)).toBeNull();
  });

  it("returns null for a hidden type rather than a row with a blank headline", () => {
    expect(activityRowFor(event("flag_raised", { flagId: "f1" }, null), viewer, names)).toBeNull();
  });

  it("returns null for a payload missing a field it needs", () => {
    // A malformed payload renders NOTHING. The alternative is a feed row that says "undefined
    // drafted undefined", which is worse than a missing row in every way.
    expect(activityRowFor(event("draft_pick", { teamId: "team_1" }, "user_alice"), viewer, names)).toBeNull();
  });

  it("never lets a payload field it did not ask for reach the row", () => {
    // The allowlist proof, in this module rather than only across Plan B's two views: an extra
    // field on the payload (a similarity score, a private note) cannot appear in the output.
    const row = activityRowFor(event("member_joined", { teamId: "team_1", via: "invite", internalRiskScore: 0.97 }, "user_bob"), viewer, names);
    expect(JSON.stringify(row)).not.toContain("0.97");
    expect(JSON.stringify(row)).not.toContain("internalRiskScore");
  });

  it("renders a system action from its own summary, which is the contract Plan D writes against", () => {
    expect(activityRowFor(event("system_action", { action: "lineup_auto_set", summary: "Bob's week 4 lineup was set automatically." }, null), viewer, names)).toMatchObject({
      icon: "alert-triangle",
      headline: "Bob's week 4 lineup was set automatically.",
    });
    // No summary, no row. A system action that cannot explain itself does not get a feed entry.
    expect(activityRowFor(event("system_action", { action: "lineup_auto_set" }, null), viewer, names)).toBeNull();
  });

  it("uses no em-dash in any headline or detail it can produce", () => {
    for (const sample of EVERY_RENDERABLE_SAMPLE) {
      const row = activityRowFor(sample, viewer, names);
      expect(`${row?.headline ?? ""} ${row?.detail ?? ""}`).not.toMatch(/[—–]/);
    }
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then write `src/integrity/activity-view.ts`**

The module's shape, with the reasoning that belongs in the code rather than in this plan:

```ts
/**
 * What a league member is allowed to see of their league's audit trail, decided type by type.
 *
 * A `Record` over the whole union and not a partial map: adding an event type without deciding
 * this is a type error, which is the only version of an allowlist that stays honest across four
 * plans. Everything this plan does not publish is `hidden`, so the plan that adds the publisher
 * is the plan that decides what its payload may show.
 *
 * `actor_only` exists for exactly one type. A lineup change is not secret from the league in
 * principle, but it IS competitively sensitive before kickoff: this product locks lineups at
 * kickoff precisely so nobody can react to somebody else's, and a feed that broadcast every
 * bench move would hand back the information the lock exists to protect.
 */
export const ACTIVITY_VISIBILITY: Readonly<Record<AuditEventType, ActivityVisibility>> = {
  league_created: "everyone",
  member_joined: "everyone",
  draft_pick: "everyone",
  draft_completed: "everyone",
  system_action: "everyone",
  lineup_change: "actor_only",
  roster_move: "hidden",      // Plan C decides, with its payload
  trade_proposed: "hidden",   // Plan C
  trade_accepted: "hidden",   // Plan C
  trade_rejected: "hidden",   // Plan C
  flag_raised: "hidden",      // Plan B: investigatory, admin-only by the spec's own allowlist
  flag_resolved: "hidden",    // Plan B
  admin_action: "hidden",     // Plan B
  session_started: "hidden",  // platform chain: never in a league feed at all
  profile_updated: "hidden",  // platform chain
  review_removed: "hidden",   // platform chain
};
```

plus typed payload readers (`str`, `num`, `bool`, each returning `undefined` for a missing or wrong-typed field) and one renderer per visible type, each naming its fields explicitly. `activityRowFor` returns `null` whenever visibility denies, the viewer is not the actor for an `actor_only` type, or a renderer's required field is absent.

- [ ] **Step 3: Write the failing service test**

`src/integrity-service/activity.test.ts` covers the read: scoped to one league's chain, newest first, paged by sequence, names resolved in a bounded number of queries, and hidden rows genuinely absent rather than filtered in the browser.

```ts
it("reads one league's chain and never another's", async () => {
  const page = await listLeagueActivity(db, { leagueId: "league_1", viewerUserId: "user_bob" });
  expect(page.rows.every((row) => row.eventId.startsWith("evt_l1_"))).toBe(true);
});

it("returns newest first and pages by sequence", async () => {
  const first = await listLeagueActivity(db, { leagueId: "league_1", viewerUserId: "user_bob" });
  expect(first.rows).toHaveLength(INTEGRITY_CONFIG.activity.pageSize);
  const second = await listLeagueActivity(db, { leagueId: "league_1", viewerUserId: "user_bob", before: first.nextBefore! });
  expect(second.rows[0]!.eventId).not.toBe(first.rows.at(-1)!.eventId);
});

it("resolves names in a bounded number of queries however many rows it renders", async () => {
  // The N+1 this would otherwise be: one lookup per row for the actor and one for the player.
  const { db: counted, selectCount } = countingDb(db);
  const before = selectCount();
  await listLeagueActivity(counted, { leagueId: "league_1", viewerUserId: "user_bob" });
  expect(selectCount() - before).toBeLessThanOrEqual(4);
});

it("omits a hidden row entirely rather than sending it and hiding it in the browser", async () => {
  await seedLineupChangeBy("user_alice");
  const page = await listLeagueActivity(db, { leagueId: "league_1", viewerUserId: "user_bob" });
  expect(JSON.stringify(page)).not.toContain("player_secret");
});
```

- [ ] **Step 4: Write `src/integrity-service/activity.ts`**

One query for the page of events (served by `audit_events_scope_sequence_idx`), one for the distinct actors, one for the distinct players named in the page's payloads, one for the teams — four queries whatever the page size, which is what the query-count test pins. `ActivityNames` falls back to plain language for anything missing ("A former member", "A player who is no longer listed") rather than an id or an empty string, because a member reading their league's history should never see a uuid.

- [ ] **Step 5: Run everything and commit**

```bash
npm test -- src/integrity src/integrity-service
npm run typecheck && npm run lint && npm run build
git add src/integrity src/integrity-service
git commit -m "feat(integrity): the member-visible field allowlist, denying by default

A Record over the whole event-type union rather than a partial map, so a plan that adds a type
without deciding whether members may see it does not compile. Everything this plan does not
publish is hidden: a visible renderer for a payload shape nobody has written yet is a guess, and
a guess in an allowlist is a leak.

Renderers read payloads field by field and never spread one, so an extra field (a similarity
score, an admin's note) cannot reach a member's screen even if a later plan puts one in a payload
this feed already renders. A missing field makes the row null, because 'undefined drafted
undefined' is worse than a missing row.

lineup_change is visible only to the manager who made it. This product locks lineups at kickoff
so nobody can react to somebody else's, and a feed that broadcast every bench move would hand
back exactly the information the lock protects."
```

---

## Task 10: The surfaces — a league's history, and an inbox for what the platform did to you

The plan's only user-facing task, and the reason Plan A is not pure infrastructure. Strategy §4 promises members "a transparent per-league audit log"; this is it, plus the inbox that is where a notice actually reaches a person.

**Files:**
- Create: `src/app/app/leagues/[leagueId]/activity/page.tsx`
- Create: `src/league-room/components/activity-feed.tsx` (+ its test)
- Create: `src/account-room/hooks/use-notices.ts` (+ its test), `src/account-room/components/notice-inbox.tsx` (+ its test)
- Modify: `src/components/app-shell/app-header.tsx` (+ its test), `src/league-room/components/league-home.tsx` (+ its test)
- Modify: `e2e/league-lifecycle.spec.ts`

**Interfaces:**
- Consumes: `listLeagueActivity` (Task 9), `listNotices` and the three notices routes (Task 8), `resolveLeagueMembership`/`requireCurrentUser`, `Avatar`, `Card`, `Badge`, `EmptyState`, `ErrorState`, `Icon`, `PageTitle`.
- Produces: no new exported service symbols. `AppHeaderProps` gains nothing: the inbox is a client component the header renders, and it fetches its own data.

- [ ] **Step 1: Write the failing component tests**

`src/league-room/components/activity-feed.test.tsx`, in both themes via `inBothThemes`:

```tsx
it("renders a row per activity entry, newest first, with a readable time", () => { /* … */ });

it("offers a way forward from an empty feed instead of a dead end", () => {
  render(<ActivityFeed rows={[]} leagueId="league_1" nextBefore={null} />);
  expect(screen.getByText("Nothing has happened here yet.")).toBeVisible();
  // StatePanelProps.action is required, not optional: an empty state without a way on is a
  // dead end, which docs/design-system.md rules out.
  expect(screen.getByRole("link", { name: "Go to the league" })).toHaveAttribute("href", "/app/leagues/league_1");
});

it("shows older entries through a plain link, so the history works with no JavaScript", () => {
  render(<ActivityFeed rows={rows} leagueId="league_1" nextBefore={41} />);
  expect(screen.getByRole("link", { name: "Show older" })).toHaveAttribute("href", "/app/leagues/league_1/activity?before=41");
});

it("passes an automated a11y check and reads as a list", async () => {
  const { container } = render(<ActivityFeed rows={rows} leagueId="league_1" nextBefore={null} />);
  expect(await axe(container)).toHaveNoViolations();
  expect(screen.getAllByRole("listitem")).toHaveLength(rows.length);
});
```

`src/account-room/components/notice-inbox.test.tsx`:

```tsx
it("shows nothing but the control when there is nothing to say", () => { /* no badge, no dot */ });
it("counts unread notices and announces the count to a screen reader", () => { /* aria-label carries the number */ });
it("opens on click, closes on Escape, and returns focus to the trigger", async () => { /* … */ });
it("marks what it showed as read, once, and not again on reopen", async () => { /* … */ });
it("adds a notice that arrives on the stream without a reload", async () => { /* fake EventSource, notice.created, refetch */ });
it("keeps working when the stream never connects", async () => {
  // The durable row is the product; the frame is a nudge. A failed EventSource must not take the
  // inbox with it, and there is no retry loop here: the browser's own reconnect is the mechanism.
});
it("says so plainly when the fetch fails, and offers a retry", async () => { /* ErrorState */ });
```

- [ ] **Step 2: Build the surfaces**

`/app/leagues/[leagueId]/activity/page.tsx` is a Server Component: `requireCurrentUser`, then `resolveLeagueMembership` and `notFound()` for a stranger (404 and not 403, the same non-oracle discipline `publicJoinPrecondition` and the league home already use), then `listLeagueActivity` and `listNotices` scoped to this league. It renders, in order:

1. `PageTitle` "League activity", with the league's name beneath it.
2. **"What the platform did"** — this viewer's own notices for this league, if any. This is where the spec's "SYSTEM_ACTION entries alongside the plain-language notification copy" lands, and it is a separate band rather than interleaved because the two sources have different cursors and, more importantly, because a member's own question ("what happened to MY team?") is a different question from "what happened here?".
3. `ActivityFeed` — the chronological history, with `Show older` as a plain link.

`NoticeInbox` goes in `AppHeader`, left of the profile link, as a `"use client"` component rendered by a server component (the same relationship `LeagueHome` already has with the league page). `LeagueHome` gains one link to the activity page, beside its existing matchup link, so the feed is reachable from where a member already is rather than by typing a URL.

- [ ] **Step 3: Extend the e2e walkthrough**

In `e2e/league-lifecycle.spec.ts`, after the existing draft completes, the same authenticated session visits the activity page and asserts a real row from a real draft:

```ts
await page.goto(`/app/leagues/${leagueId}/activity`);
await expect(page.getByRole("heading", { name: "League activity" })).toBeVisible();
await expect(page.getByRole("listitem").filter({ hasText: "drafted" }).first()).toBeVisible();
// The whole spine, end to end, in a browser: a real pick, through AuditLogger, into the chain,
// out through the allowlist, onto a page a member can read.
```

- [ ] **Step 4: 360px and both themes**

Run the mobile spec (`e2e/mobile-360.spec.ts`) with the activity page added to its route list. Long headlines wrap rather than overflow; the inbox panel is full-width at 360px rather than a floating card clipped by the viewport.

- [ ] **Step 5: PERSONA PANEL (controller step)**

The controller runs the four-persona panel over both surfaces together, because they answer one reader's one question. Specific things to put in front of it:

- **The first-timer**, on the activity feed's headline copy: does "The clock ran out, so Alice's team drafted Bijan Robinson from their queue" explain autopick to somebody who has never seen one, or does it need the glossary's `InfoTip` on "queue"?
- **The high-stakes veteran**, on `lineup_change` being actor-only: is a feed that shows draft picks and joins but not other people's lineup moves confusing, or obviously correct? Would they expect to see them after the week locks?
- **The commissioner**, on the empty state: the feed is empty for a league that has not drafted, which is exactly when a commissioner is most likely to look at it.
- **The social casual**, on the notice inbox: is an unread count on the header a thing they want, or a thing they will resent, for a product whose only two notice types today are rare?
- **Everyone**, on the two notice bodies quoted in Task 7. The removal notice quotes an operator's words verbatim; is that legible as a quotation, or does it read as the product's own voice?

Anything the panel raises that is out of scope goes into the ledger for Plan B, named, rather than being built here.

- [ ] **Step 6: Commit**

```bash
git add src/app/app/leagues src/league-room src/account-room src/components e2e
git commit -m "feat(activity): the member-visible league feed and the notice inbox

Strategy section 4 promises members a transparent per-league audit log and, until now, nothing in
the product let a member see one. This is that page, plus the inbox where a notice actually
reaches a person.

A stranger gets 404 and not 403, the same non-oracle discipline publicJoinPrecondition and the
league home already use: a 403 would confirm that a guessed league id names a real league.

The feed's history works with no JavaScript at all — Show older is a link with a cursor in the
query string, not a fetch — because a record of what happened should not depend on a bundle.

The notices band is separate from the chronological feed rather than interleaved: what happened
here and what happened to me are two questions, and they have two cursors."
```

---

## Task 11: Docs, two more gates, and the closing battery

**Files:**
- Modify: `vitest.config.mts`
- Create: `docs/decisions/audit-and-integrity.md`
- Modify: `docs/conventions.md`, `docs/design-system.md`, `README.md`

- [ ] **Step 1: Add the two gates, with both halves each**

`src/integrity` and `src/integrity-service` join `COVERAGE_GATED_DIRS` **and** each gets its own `thresholds` block. Fourteen becomes **sixteen**. `src/integrity` is the pure rule layer and gates for the same reason every pure directory does; `src/integrity-service` gates for the reason Plan C gave when it added `src/identity-service` and `src/review-service` as gates 13 and 14 — its whole-branch review found every HIGH finding in the service layer, which no gate measured. The audit logger, the verifier and the notice writer are a strictly stronger case: they are the write path for the record this phase exists to make trustworthy.

A few guards in the service layer are unreachable through real Postgres (`lockAnchor`'s "the row vanished between insert and lock"). Those are covered by narrow stub-`Db` tests that put the code in the state it defends against, exactly as `identity-service` already does, never by lowering a threshold or adding an ignore comment.

Verify with an **unfiltered** `npm run test:coverage` reporting sixteen directories at 100% on all four metrics.

- [ ] **Step 2: Write `docs/decisions/audit-and-integrity.md`**

Sections, each recording what was chosen, why, and what would have to change for the choice to be wrong:

1. **The chain scope ruling** — per league plus one platform chain, with the contention arithmetic from Task 3, the lock-ordering rule, and the condition that would force the platform chain to be sharded (any platform-chain append from inside a long transaction).
2. **The write-ordering ruling** — the audit append and the notice row are inside the business transaction and fail it; the Redis frame is best-effort after commit. Stated as the rule every later plan copies, and stated beside `conventions.md`'s opposite rule for publishing so the difference is deliberate rather than confusing.
3. **Canonicalization** — sorted keys, the rejecting encoder, `normalizeInstant`, the version in the hashed bytes, and the golden vector. What a `hashVersion` bump would cost.
4. **Verification** — checkpointed versus full, what each can and cannot see, and the failure semantics in full (checkpoint frozen, operator told, `system_action` appended, nothing stopped, no member told, never repaired).
5. **The audited set** — the eight writes wired here, why each, and the seven reserved names with their owning plans.
6. **The notice primitive** — the naming resolution against `identity/notifications`, why the rendered copy is stored, why delivery is a per-user stream key, and what Plan D's email sender changes (one entry in `CHANNEL_STATUS`, one column, one section of a page that already exists).
7. **The member field allowlist** — deny by default, the exhaustive record, `actor_only` for lineups, and the proof Plan B is expected to write against it.
8. **Growth, unowned on purpose** — `audit_events` is now the fastest-growing table in the system and there is no retention or partitioning policy. The indexes are specified; the growth policy is not, and inventing one here would be inventing a number. Named as a Phase 8 item with the arithmetic a future reader needs: a twelve-team league generates on the order of 10^3 events per season, so a hundred thousand leagues is a hundred million rows before any retention question becomes urgent.

- [ ] **Step 3: Correct the drift, by grep and not by guess**

```bash
grep -rn "fourteen\|FOURTEEN\|14 gated\|Phase 3 owns the real audit log\|no admin\|append-only" docs src README.md
```

Known targets: `docs/conventions.md`'s directory map (`src/integrity/`, `src/integrity-service/` and their one-line descriptions), its coverage-gate enumeration (fourteen becomes sixteen), its client-boundary section (both new directories join the blocked list, and the sentence explaining why neither is exempt), its real-time section (the second stream key format, `notice.created`, and the one-mechanism claim restated so it stays true), and its scripts list (`audit:verify`). `src/db/schema.ts:506`'s "Phase 3 owns the real audit log" is now describing something real and should say where it is. `README.md` gains the `audit:verify` script. `docs/design-system.md` needs no change, which is itself worth confirming out loud: this plan added no primitive and no icon.

- [ ] **Step 4: The closing battery**

```bash
npm run infra:down && npm run infra:up
npm run db:migrate && npm run db:migrate:test
npm run seed && npm run stats:ingest
npm run audit:verify -- --full        # every chain the seed produced, from genesis
npm test
npm run test:coverage                 # UNFILTERED: sixteen gated dirs, all 100%
TEST_DATABASE_URL=$TEST_PGBOUNCER_URL npm test    # the whole suite through the pooler
npm run typecheck && npm run lint && npm run build
NEXT_DIST_DIR=.next-e2e npm run build && npm run e2e
npm run e2e                           # twice, back to back, per Plan A's precedent
```

The through-the-pooler run is not optional for this plan and is the single most important line in the battery. Every design decision in Tasks 3 and 4 turns on transaction pooling: the anchor row lock exists **because** `pg_advisory_lock` is session-scoped and unavailable, and `SET LOCAL` in the concurrency tests is the one form of `SET` the pooler allows. A suite that only ever ran against the direct port would not have tested the thing this plan is built around.

- [ ] **Step 5: Commit**

```bash
git add docs vitest.config.mts README.md
git commit -m "docs: the audit and integrity decision record, two more gates, and the drift sweep

Fourteen gated directories become sixteen. src/integrity gates because it is pure;
src/integrity-service gates for the reason Plan C gave when it added identity-service and
review-service, and more so: it is the write path for the record this whole phase exists to make
trustworthy, and a gate that measures everywhere except the write path measures the wrong place.

The decision doc's job is to make Plans B, C and D short. The write-ordering rule is the one they
all copy and the one most likely to be got backwards, so it is stated beside conventions.md's
opposite rule for publishing rather than in isolation.

Growth is recorded as unowned on purpose. audit_events is now the fastest-growing table in the
system and there is no retention or partitioning policy; the indexes are specified and the policy
is not, because inventing one here would be inventing a number. Phase 8, with the arithmetic."
```

---
## Open questions, self-ruled

Every judgment call this plan makes, numbered, with the reasoning that would have to be wrong for the ruling to be wrong.

1. **One chain per league, plus one platform chain for the league-less events.** A single global chain is the obvious reading of "a hash chain", and it is unshippable here. The append lives inside the caller's business transaction (ruling 4), so the chain-head lock is held for the whole business transaction, which makes the product's total write throughput `1 / (mean business transaction duration)` — roughly 50 to 200 writes per second platform-wide, reached by about a thousand leagues drafting at once. It would also put one row underneath `drafts FOR UPDATE`, `stat_weeks FOR SHARE` and the invite-then-league order simultaneously, which is a lock-ordering class the pooler cannot help with. Per-league chains reduce contention to contention that already exists. The cost is a genesis per league and an N+1-chain verification loop, both of which are loops rather than problems. This is wrong only if the platform chain's own volume ever stops being short transactions, and that condition is written into its docblock.

2. **The anchor row in `audit_chains` is the lock, the head and the rollup, all three.** It could have been three things: a lock table, a head pointer, and a count. It is one row because they are one fact, and because `docs/decisions/data-layer-hardening.md` requires the rollup to advance in the same transaction as the append anyway — which is exactly when the lock is held. There is deliberately no `event_count` column: `head_sequence` already is the count, and a second copy of one number is a second thing that can disagree.

3. **The anchor is always the last lock a transaction takes, and a transaction appends to at most one chain.** Two rules that together make a deadlock cycle unconstructible rather than merely unobserved. `recordAll` throws on a batch spanning two scopes, which is where the second rule stops being a convention.

4. **The audit append and the notice row are inside the business transaction and fail it; only the Redis frame is best-effort.** This is the exact opposite of `conventions.md`'s publishing rule, in the same flow, and the difference is the point: a frame nobody received is a client that refetches, while a mutation nobody recorded is a hole in the record this phase exists to make trustworthy. Written down here and in the decision doc because it is the rule every later plan copies and the one most likely to be got backwards.

5. **Canonical serialization is sorted-key JSON from a rejecting encoder, not `JSON.stringify`.** The verifier re-derives a hash from a row read back out of Postgres, and `jsonb` does not preserve key order. Everything the encoder refuses (`undefined`, `NaN`, `Infinity`, unsafe integers, `bigint`, `Date`, `Map`/`Set`, class instances, cycles, NUL) it refuses because that value changes across the same round trip. Failing loudly at the write, with the path named, beats a chain that stops verifying weeks later on a row nobody can explain.

6. **`hashVersion` is part of the hashed bytes and a stored column, and the genesis constant is derived rather than zeros.** An audit chain is the one structure where you can never change the algorithm without a way to tell old rows from new ones; one integer bought now is cheaper than a migration that cannot be written. The verifier refuses an unknown version rather than guessing. Genesis is `sha256("commish:audit:chain:v1")` because a column that defaulted to zeros, or an uninitialised buffer, must not accidentally validate as "this is the first event".

7. **`audit_events` carries no foreign keys, and it is the only table in this schema where that is true.** `leagues` cascades to nine tables today. A cascade is a `DELETE`, so an FK to `leagues` would either be rejected by the append-only trigger (making a league undeletable) or, without the trigger, would let deleting a league delete the record of what happened in it. The audit trail of a deleted league is exactly the trail you want to still have. Referential integrity here is the hash chain's job.

8. **A failed verification stops the checkpoint, not the product, and tells an operator, not a member.** Halting appends on a detected break would halt every audited write, so one corrupted row becomes a full outage triggered by whoever corrupted it. Telling a league "your record may have been tampered with" before a human has looked is the accusatory failure mode this phase spends a denylist preventing. So: the checkpoint freezes, the script exits non-zero naming scope, sequence, event and reason, a `system_action` records the detection on the platform chain, and a human decides what follows. **Nothing is ever repaired.** A chain that can be repaired is a chain that can be forged, and there is no function in this codebase that rewrites a hash.

9. **Event-type values are lowercase snake_case, contradicting the spec's SCREAMING_SNAKE.** Every pg enum in `src/db/schema.ts` is lowercase snake_case, and the phase overview already ruled this way once, on `beginner`/`experienced` versus the spec's `NEW`/`EXPERIENCED`: the shipped spelling wins. The mapping is one-to-one and mechanical, and it is stated in the type's own docblock so a reader holding the spec is not confused for a second.

10. **`roster_move` means a trade's player transfer and nothing else.** The spec lists it alongside `draft_pick` and `lineup_change`, which reads as an umbrella that would overlap both. It is ruled as the residue: a roster change that is neither of those. Today that can only be a trade, because this product has no free agency, no waivers and no add/drop. The docblock says so, so a future reader does not assume waivers are covered by a name that sounds like it covers them.

11. **The `integrity/notifications` vs `identity/notifications` collision is resolved by renaming, not by a docblock on each.** The overview proposed two files with one name plus an explanatory comment. Two files called `notifications.ts` differ by one word in an import line, and the comment is in the file rather than at the call site where the mistake happens. `src/integrity/notices.ts`, `member_notices`, `notice.created`: a different word for a different thing. `notifyAffectedMember` keeps the spec's name because Plans B, C and D call it by that name.

12. **A notice stores the copy it delivered, not just its type and context.** What a person was told is a historical fact. If a template is reworded next month, the notice they already read must not silently become different words, which is the same principle that makes `reviews` keep a removed review's text. The context is stored beside it so a template change is auditable rather than invisible.

13. **User-targeted delivery rides a per-user Redis stream key, and the frame carries no copy.** The league stream is a broadcast; even a content-free frame on it leaks that a specific member got a specific kind of notice, which for a held trade is most of the information. A per-user key is the same mechanism (Streams over SSE, `XREAD BLOCK`, `Last-Event-ID`), the same publisher and the same connection cap, differing only in the key `subscribe` was already computing internally. The frame is `{ noticeId, noticeType }` and the words come from an authenticated read, because a stream is retained and readable by anything holding the key. A notice with no league is not published at all: the frame exists to nudge a page that is open right now.

14. **`src/integrity/**` and `src/integrity-service/**` are BOTH server-only and BOTH join the coverage gate.** Unlike `@/identity`, `@/chat`, `@/matchmaking`, `@/help` and `@/reviews`, neither half is browser-safe — the rule layer reads `node:crypto` and the service layer is Postgres-backed — so both go on the client-boundary blocked list rather than one being exempt. Client code needs neither as a value, because a notice carries the copy it delivered and an activity row arrives already rendered. Gating both is the Plan C precedent applied where it matters more: gate 16 is the write path for the record this phase exists to make trustworthy, and a gate that measures everywhere except the write path measures the wrong place.

15. **`lineup_change` is visible in the activity feed only to the manager who made it.** Not a privacy nicety: this product locks lineups at kickoff precisely so nobody can react to somebody else's, and a feed that broadcast every bench move before lock would hand back the information the lock protects. Whether it should become visible to everyone AFTER a week locks is a real question and is on the panel's list rather than guessed at here.

16. **Ids are stored in payloads; display names are resolved when the feed is read.** The tempting alternative is denormalizing names into the payload so a row is self-contained. It is wrong for people (you refer to somebody by their current name, and `profile_updated` exists precisely because names change) and unnecessary for players (`players` is effectively immutable reference data). The payload stores only what a later read cannot recover: the price, the round, the slot, whether the clock made the pick. Anything missing renders as plain language ("A former member"), never a uuid.

17. **The draft is audited at the action seam in `store.ts`, not at the commit seam in `commit.ts`.** The overview named `commit.ts`, which is where a finished draft becomes a season. But `commitDraftState` sees only the final pick list, with no timestamps and no way to tell a human pick from an autopick, and the spec's exit criterion is one event per pick with the correct `actorId` and `occurredAt`. `CompletedPick` carries both `timestamp` and `auto`, and the action transaction already holds the draft's row lock, so the honest place is where the action lands. `draft_completed` is still recorded at the commit, where it belongs.

18. **The verification checkpoint is a separate table from the chain anchor.** As columns on `audit_chains` it would be simpler by one table and wrong: advancing the checkpoint would take a lock on the row every append is waiting for, so a chain walk would block every write to that league for its duration. Two tables cost one row and buy the property that the verifier and the writer never contend.

19. **Eight writes are audited now, seven names are reserved with a named owner, and a test keeps that honest.** The eight are the writes an ordinary member's activity feed is actually made of, plus the platform chain's first traffic. The seven cannot be published because their subjects do not exist (no trade, no admin). `reserved.test.ts` uses an exhaustive `Record` so adding a type without assigning it a plan is a type error, and greps `src/` so a type "published" only by a test does not count. The `score.update` precedent is the shape: reserved through one phase, turned on by name in the next.

20. **`session_started` carries no IP and no device signal.** The spec's Step 2 asks for both, and Step 2 is Plan B. All four existing IP reads key on `X-Forwarded-For`, which their own docblock calls caller-controlled and rotatable, and `identity-and-trust.md` records fixing that as LAUNCH-BLOCKING for Phase 2 Plan D. A rate limiter keyed on a forgeable header loses a speed bump; a multi-account flag keyed on one lets an attacker manufacture suspicion against somebody else's account. Recording the sign-in now and the signals later is not a deferral of half a feature, it is refusing to persist a field whose only consumer would be a heuristic that cannot trust it yet.

21. **There is no retention or partitioning policy, on purpose, and it is named rather than invented.** `audit_events` is now the fastest-growing table in the system. The indexes are specified because the read patterns are known; the growth policy is not, because inventing a retention window for a record whose whole value is that it is complete would be inventing a number. A twelve-team league produces on the order of 10^3 events per season, so this is a Phase 8 question with real arithmetic behind it rather than an omission.

22. **The notice inbox is bounded, has no cursor, and derives its unread count.** `INTEGRITY_CONFIG.notices.inboxSize` most-recent notices, `count` over that same bounded page. This is the balance-as-rollup convention's own threshold read correctly: derive over a bounded set, roll up over an unbounded one. A member's recent notices are bounded; a league's audit history is not, which is why the activity feed pages and the inbox does not.

23. **The full walk pages, and neither walk ever runs on a request path.** The scaling review's finding was that verification which cannot be afforded is verification nobody runs, and loading a million-row chain into memory to check it is the same mistake as re-hashing it. `scripts/verify-audit-chain.ts` is the only caller today; `fullVerifyIntervalHours` is the number a production scheduler gets, and Plan D is the plan that has one.

24. **`INTEGRITY_CONFIG` in `src/integrity/config.ts`, not `src/config/integrity.ts`.** The spec names a file in a directory this repo does not have and will not create. Twenty-two `config.ts` files sit beside their modules today. The spec's actual requirement is one documented home with no inline magic numbers, which this satisfies without forking the convention, and every threshold the spec names is a field on this object.

25. **The hash is taken over the instant's round-tripped spelling, via `normalizeInstant`.** A caller passing `2026-08-20T19:00:00+02:00` or microsecond precision would otherwise write a row that never verifies, because `timestamptz` hands back UTC milliseconds. This is the single most likely production-only failure in the design, and it costs one function and one test naming both spellings.

26. **`TRUNCATE` is not blocked, only `UPDATE` and `DELETE`.** A statement-level `BEFORE TRUNCATE` trigger would break `truncateAll` and therefore every integration test in this repo. `TRUNCATE` already requires table ownership, which is the same privilege that can `DROP TABLE` or `ALTER TABLE … DISABLE TRIGGER`, so blocking it buys nothing against anyone who has it. The spec asks for `BEFORE UPDATE` and `BEFORE DELETE`, and that is exactly what ships.

27. **`audit_event_type` is a pg enum; `member_notices.notice_type` is `text`.** Not an inconsistency. The audit vocabulary is fixed by the spec and declared in full today, so no later migration has to touch the type. Notice types are added by Plans B, C and D, and `ALTER TYPE … ADD VALUE` inside drizzle-kit's transaction-wrapped migration is a trap: the new value cannot be used in the same transaction. `NoticeType` plus `NOTICE_TEMPLATES` is the vocabulary, and a test asserts every stored value is one of its keys.

28. **`recordAll` exists beside `record`, contradicting the spec's "exposing only `record(event)`".** Both are appends; neither can update, delete or upsert, so the constraint the spec is actually stating is intact. The reason is the anchor lock: an auction lot that closes and auto-nominates can advance the pick list by more than one, and Plan C's trade will produce several events at once. Taking one lock instead of N is the difference between a batch and a queue.

29. **The tamper tests turn the append-only triggers off in order to tamper.** A tamper test that could not get past the trigger would be testing the trigger a second time instead of testing the chain. `DISABLE TRIGGER USER` needs table ownership, which is the same privilege that can `DROP TABLE`, so this models the real adversary the hash chain exists for: the one who already got past the first two defenses. The helper lives in `test-support.ts` and re-enables in a `finally`.

30. **`notifyAffectedMember` takes `(tx, input)` rather than the spec's four positional parameters.** The `tx` is the load-bearing part and has to come first (ruling 4), and `(leagueId, userId, …)` is two adjacent id strings in a positional call, which is a swap waiting to happen at a call site nobody re-reads. The name is the spec's, because that is what Plans B, C and D call.

---

## Self-review

**Spec coverage — Step 1 (immutable audit log), task by task:**

| Spec task (lines 76–87) | Where |
|---|---|
| Tests first for hash-chain construction, verification and tamper detection, before any implementation | Task 1 steps 1, 2, 5 and 6 — all three in memory, with no database in the picture |
| Immutable `AuditEvent` domain type in `src/domain/audit.ts` with the named fields | Task 1 step 3. Every spec field is present; `chainScope`, `sequence` and `hashVersion` are added, and rulings 1, 2 and 6 say why |
| `eventHash = sha256(previousEventHash + canonicalSerialize(eventFields))`, genesis from config | Task 1 step 7. The previous hash is a hashed FIELD rather than a prepended string, which is the same claim without a concatenation ambiguity, and genesis is `INTEGRITY_CONFIG.chain.genesisHash` |
| Drizzle schema (**SQLite**) with `BEFORE UPDATE`/`BEFORE DELETE` triggers | Task 2. Postgres, not SQLite: the reality table says why, and the triggers are a plpgsql function plus two row triggers, hand-appended after generation |
| Both composite indexes, verified by a schema-introspection test | Task 2 steps 3 and 7, in `index-plans.test.ts`, which reads `pg_indexes` back out of the catalog |
| `AuditLogger` exposing only `record` | Task 3. Plus `recordAll`, which is also an append; ruling 28 |
| Checkpointed incremental `verifyChainIntegrity` with a `verified_through_event_id` checkpoint | Task 4. The checkpoint stores a sequence and a hash rather than an event id, so the boundary row itself is falsifiable (and the id is one lookup away); ruling 18 covers the separate table |
| `verifyFullChainIntegrity` as an explicitly-invoked from-genesis walk, cadence in config | Task 4 steps 3 and 5, `scripts/verify-audit-chain.ts`, `INTEGRITY_CONFIG.verification.fullVerifyIntervalHours` |
| `notifyAffectedMember` in `src/integrity/notifications.ts`, one place the copy lives, denylist test | Tasks 7 and 8. The module is `src/integrity/notices.ts` (ruling 11) and the copy is `NOTICE_TEMPLATES`; the denylist test is Task 7 step 1 |
| Wire audit logging into existing mutation points via a subscriber layer, not by editing reducers | Tasks 5 and 6. Nothing in `src/draft-engine/**` or `src/league/**` is touched: the appends live in the service layer's existing transactions, which is where the transaction is. A literal event-subscriber running after the fact could not be in the transaction, which ruling 4 rules out |
| A tamper test using raw SQL or a corrupted in-memory chain, asserting the correct broken pointer | Task 1 steps 5 (in memory, four break kinds) and Task 4 step 1 (real rows, via ruling 29's trigger-disabling helper) |
| An incremental-behavior test proving only the new events were re-hashed, via a call count | Task 4 step 1, "re-hashes only what is new since the checkpoint", plus the full walk's matching count |
| A test that DB triggers reject direct UPDATE/DELETE independent of `AuditLogger` | Task 2 step 1, which writes and attacks its rows in raw SQL and runs before `AuditLogger` exists |

**Spec coverage — Step 1's exit criteria:**

| Exit criterion | Where |
|---|---|
| Hash-chain creation, verification and tamper detection covered, with the correct broken-event pointer | Task 1 step 5, Task 4 step 1 |
| Both composite indexes present, verified by schema introspection | Task 2 step 7 |
| Incremental run re-hashes only past the checkpoint; a corruption before it is caught only by the full walk; both covered | Task 4 step 1, the "does NOT catch a tamper before the checkpoint" pair |
| A seeded league produces exactly one correct audit event per roster move, trade action, draft pick and lineup change, with correct `actorId` and `occurredAt` | Tasks 5 and 6 for picks, joins, creation and lineups, each asserting `actorId` and `occurredAt`. **Trade actions are absent because no trade exists** (reality table, ruling 19); Plan C's exit criteria carry that half, and `reserved.test.ts` is what makes the gap visible rather than forgotten |
| Direct UPDATE/DELETE rejected by the database, verified by a test that bypasses the ORM | Task 2 step 1 |
| A template with denylisted accusatory language fails a test-level check | Task 7 step 1 |

**Spec coverage — Step 4, the member-visible half only:**

| Spec task (lines 198–199) | Where |
|---|---|
| A member-visible league activity feed at `/league/<id>/activity`, not gated on `isAdmin` | Task 10. The path is `/app/leagues/[leagueId]/activity`, matching this app's actual route tree |
| Chronological, readable, covering draft picks, trades, roster/lineup moves and `SYSTEM_ACTION` entries | Task 9's renderers and Task 10's page. Trades render nothing until Plan C publishes them and flips their visibility, which the exhaustive record forces |
| Alongside the plain-language notification copy Steps 5 and 6 send | Task 10 step 2, the "What the platform did" band, reading this viewer's own notices for this league |
| An explicit per-`eventType` field allowlist excluding admin-investigatory fields | Task 9, deny by default, with the "never lets a payload field it did not ask for reach the row" test |
| A test proving raw multi-account scores are in the admin view and absent from the member feed | **Plan B**, by the overview's split, because the admin view does not exist to compare against yet. Task 9's allowlist test is the half that can be written now and is the half Plan B's proof will lean on |
| Design-system standing rule: loading/empty/error states, a11y, keyboard, copy, 360px | Task 10 steps 1, 4 and 5 |

**Overview obligations:**

| Obligation | Where |
|---|---|
| Hash-input canonicalization, including JSON key order | Task 1, rulings 5 and 25 |
| The chain under concurrent writers through PgBouncer, with no advisory locks | Task 3: the anchor row `FOR UPDATE`, plus the matched concurrency pair (same scope serializes, different scopes do not block) |
| Per-league versus global chains, ruled explicitly with the write-contention math | Ruling 1 and Task 3's opening, with the arithmetic |
| What happens on verification failure: who is told, what stops | Ruling 8 and Task 4's opening |
| Which existing writes get audited first, minimal but real, same-transaction | Tasks 5 and 6, ruling 19: league create, both join doors, draft pick, draft completed, lineup change, session started, profile updated, review removed |
| Durable per-user notification row, one new registered event type, `deliverableChannels()` stays `["in_app"]` | Tasks 7 and 8. `CHANNEL_STATUS` is untouched, so email stays "not-connected" |
| The activity feed with the persona panel marked as a controller step | Task 10 step 5 |
| The naming collision resolved, with a name ruled | Ruling 11 |
| New gated dirs join with `include` **and** `thresholds` | Task 11 step 1, fourteen to sixteen |
| 8 to 12 tasks; final task is docs plus the closing battery including the pooler-routed suite and a double e2e | Eleven tasks; Task 11 step 4 |

**Placeholder scan:** no `TODO`, no `TBD`, no "handle errors appropriately", no "similar to Task N", no step whose expected output is unstated. Every file in the File Structure tables appears in a task's Files block. Four places name a helper the executing engineer writes to taste rather than showing it in full — the payload readers in Task 9 step 2, the four name-resolution queries in Task 9 step 4, the three route bodies in Task 8 step 4, and the `_shared.ts` limiter — and each names the existing file in this repo whose shape it copies (`src/app/api/profile/_shared.ts`, `src/league-service/home.ts`'s bounded-query idiom), which is a pointer to real code rather than a placeholder.

**Type consistency:** `AuditEvent` is declared once in `src/domain/audit.ts` and is the shape `linkEvent` returns, `auditEvents` stores, `verifyLinkedRun` walks and `activityRowFor` reads, with `occurredAt` a string everywhere in TypeScript and a `Date` only at the two Drizzle boundaries (`recordAll`'s insert, `verify.ts`'s `toEvent`). `AuditEventInput` is what every call site in Tasks 5 and 6 builds, and it deliberately cannot carry `chainScope`, `sequence` or any hash. `ChainAnchor` is one type used by `linkEvent`, `verifyLinkedRun`, `lockAnchor` and `walk`, with the same two field names (`headSequence`, `headHash`) as the `audit_chains` columns. `ChainBreakReason` is declared once and includes `checkpoint_mismatch`, which only the service emits. `HashFn` is the injected signature in both `verifyLinkedRun` and `VerifyOptions`. `NoticeType` is `keyof NoticeContexts`, so the templates map, the samples map and `renderNotice`'s generic all derive from one declaration. `ActivityRow` is declared in `src/integrity/activity-view.ts` and reaches `src/league-room/**` as an `import type`; `NoticeView` is declared in `src/account-room/contract.ts` as the wire shape and is what the route serializes. `AuditLogger` is one interface with two methods, used identically by five services.

**Boundary check:** `src/integrity/**` and `src/integrity-service/**` are server-only and are added to `SERVER_ONLY_MODULE_GROUPS` in Task 1, so `src/draft-room/**`, `src/league-room/**`, `src/chat-room/**` and `src/account-room/**` reach them only as types. `src/integrity/**` imports `@/domain/audit` and `node:crypto` and nothing else from the repo; it imports `IconName` **type-only**, the same way `src/identity/avatars.ts` does, so the rule layer never pulls React. `src/integrity-service/**` imports `@/db`, `@/integrity` and `@/lib/realtime`, and is imported by `src/league-service/**`, `src/draft-service/**`, `src/review-service/**`, `src/identity-service/**`, `src/lib/auth/**`, `src/app/**` and `scripts/**` — all legal directions. `scripts/verify-audit-chain.ts` imports `src/**`, which is the allowed direction; nothing under `src/**` imports `scripts/**`. `src/integrity-service/test-support.ts` is imported only by `*.test.ts` files.

**Founder rules:** one persona panel, a marked controller step (Task 10 step 5), covering both new surfaces together because they answer one reader's one question. Every user-facing string quoted in this plan is em-dash free, and Tasks 7 and 9 turn that from a rule into two tests over the two files that are nothing but copy. No new UI primitive and no new icon: every glyph these surfaces need is already in `ICONS`, which is what "centralize the first time" looks like two phases later. No mock data on a real surface: an empty feed renders a real empty state with a real way forward, and the seeded example row that would have made the screenshot nicer is not there. Nothing here is built in a shape a later phase plans to throw away: the chain admits Plan C's trades as payloads, the allowlist admits them as a one-line visibility flip, the notice registry admits Plan D's three types as three template entries, and the notification catalog admits email as one entry in a map that already names it.

**One thing this plan deliberately does not do, stated so it is not mistaken for an oversight:** it does not make the activity feed live. A member watching the page during a draft sees new picks on reload, not as they land. The feed is a history and its cursor is a sequence; the live view of a draft is the draft room, which already has one. Turning the feed into a second realtime consumer would mean a second subscription per open page for a surface people visit to look backwards.

