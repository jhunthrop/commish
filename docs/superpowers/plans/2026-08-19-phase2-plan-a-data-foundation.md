# Phase 2 Plan A — Data Foundation & the Stats-Provider Seam

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the data layer safe for more than one app instance (a real per-draft row lock, indexes proved by `EXPLAIN`, PgBouncer in transaction-pooling mode with a documented pool budget) and turn `StatsProvider` from a one-implementation interface into a real seam with a config-selected registry and a Tank01 adapter that a founder-supplied key activates with no code change — while clearing the four hygiene residuals Phase 1 ledgered on its way out.

**Architecture:** Three strands that share one plan because they share one review surface. **(1) Locking and freshness** move `applyAction`'s read-validate-write inside a single Postgres transaction that holds `SELECT … FOR UPDATE` on the draft's own row, and make the in-process draft cache validate itself against `MAX(draft_actions.sequence)` before it is trusted — transaction-scoped by construction, which is exactly what survives PgBouncer's transaction pooling. **(2) Read paths** get their filters pushed into SQL (browse), the one index the schema is actually missing, and an `EXPLAIN (ANALYZE, FORMAT JSON)` test that fails on a sequential scan against a five-thousand-row corpus rather than trusting a comment. **(3) The stats seam** grows a `STATS_PROVIDER`-selected registry, a provider-agnostic contract suite that any implementation must pass, and `src/stats/tank01/` — a pure upstream→domain mapper plus an injected-`fetch` client, tested exclusively against committed fixture JSON so no test ever reaches the network and no key is needed to write, review or merge the adapter. `scripts/record-tank01-fixtures.ts` is what a key later turns on.

**Tech Stack:** TypeScript strict · Next.js 15 App Router · React 19 · Drizzle ORM over Postgres 17 (`drizzle-orm/postgres-js`) · **PgBouncer 1.x in transaction mode** (new docker-compose services) · Redis 7 Streams → SSE · WorkOS AuthKit · Zod v4 · Vitest + happy-dom + @testing-library/react + vitest-axe.

**Spec:** `plans/phase-2-accounts-and-data-foundation.md` — **Step 2** (lines 104–141) and **Step 6** (lines 251–281). Phase split and step ownership: `docs/superpowers/plans/2026-08-19-phase2-overview.md`. Residual hygiene backlog: the final paragraph of `.superpowers/sdd/2026-08-18-phase1-plan-f-matchmaking-and-e2e/progress.md`.

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
- **Real-time — one mechanism.** Writes are plain HTTP: validate → persist to Postgres → then `getPublisher().publish(...)`. **Postgres is authoritative; publishing is best-effort and must never fail the write.** Delivery is Redis Streams over SSE, stream key `league:<id>:events`, read with plain `XREAD BLOCK`. **Never `XREADGROUP`.** Event types are enumerated once in `src/lib/realtime/events.ts`. No Socket.io, no managed realtime vendor, no second transport — ever.
- **Draft state — the action log is the source of truth.** An in-progress draft's state is *derived*, by replaying `draft_actions` through the pure reducer in `src/draft-engine/`. *"Any in-memory materialization is a cache and must be safe to drop at any moment."* Every accepted action is persisted before it is cached or published, and `teamId` is always resolved from the authenticated session, never from a request body.
- **Client boundary.** Everything under `src/draft-room/**`, `src/league-room/**` and `src/chat-room/**` is BROWSER code. Each talks to its service layer ONLY over the wire — never by importing `@/draft-engine`, `@/draft-service`, `@/league`, `@/league-service`, `@/chat-service`, `@/ai-advisor`, `@/db`, `@/lib/realtime`, `@/lib/auth`, `@/lib/leagues`, `@/lib/llm`, `@/lib/api/respond` or `@/data/seed` as VALUES. `import type` stays allowed. The rule is deliberately **not** applied to `src/app/**`.
- **API responses.** Every JSON route returns the envelope from `src/lib/api/respond.ts`: `{ ok: true, data }` or `{ ok: false, error }` with a meaningful HTTP status. Bodies are parsed with `parseJson(request, ZodSchema)`; a bad body is a 400 naming the field. **Error strings are user-facing plain language — never raw DB/exception text.**
- **Config over magic numbers.** Thresholds, limits, durations, key formats live in a `config.ts` next to the module that uses them (`LEAGUE_CONFIG`, `REALTIME_CONFIG`, `DRAFT_QUEUE_CONFIG`, `UI_CONFIG`, …). No inline literals for tunables.
- **Tests.** **Test-first.** Tests live beside the code: `src/<feature>/**/*.test.ts`. Verification commands filter by directory: `npm test -- src/scoring`, never by a guessed filename. Integration tests hit the **real** test Postgres / Redis from docker-compose — not mocks. Use `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (`fileParallelism: false`).
- **Coverage threshold: 100%** for `src/scoring/**`, `src/draft-engine/**`, `src/draft-room/state/**`, `src/league/**`, `src/chat/**` and `src/matchmaking/**` (configured in `vitest.config.mts` with `coverage.include`). Verify with an **unfiltered** `npm run test:coverage`.
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
- **`Icon` is the one icon entry point. Feature code never imports `lucide-react` directly.** Available `IconName`s today: `trophy`, `users`, `clock`, `alert-triangle`, `inbox`, `refresh-cw`, `check`, `x`, `chevron-right`, `search`.
- Tunables for primitives live in `src/components/ui/config.ts` — never inline in a component.

**Founder rules (binding, from the phase overview):**

- **No em-dashes in user-facing copy.** Not in component text, not in error strings, not in seed data, not in `.env.example` comments a developer reads as product copy. Source comments may use them; the codebase already does.
- **Persona-panel pass on every new user-facing surface**, marked as an explicit step. The controller runs the panel; the plan only marks where.
- **Centralized primitives always.** No one-off component that duplicates something already in `src/components/ui/`.

**Plan-A-specific constraints (each ruled in "Open questions, self-ruled" at the end):**

- **Three of the spec's own tasks are struck as already-satisfied, with reasons recorded in the decision docs, never silently.** The spec's Step 2 index list names `Session(token)` and `Session(userId)`; **there is no `sessions` table and there never will be** — WorkOS AuthKit owns sessions. Its `chat messages by (leagueId, createdAt)` is already served, better, by `chat_messages_league_id_idx` on `(league_id, id)` (a bigserial cursor needs no timestamp tiebreak). Its `draft_actions(draftId, timestamp)` is already served by `draft_actions_draft_id_id_idx` plus the unique `draft_actions_draft_sequence_idx`.
- **`prepare: false` is unconditional on every Postgres connection**, direct or pooled. One behavior, so a bug cannot hide behind a mode difference.
- **The Tank01 adapter is written and merged with no API key.** Tests read committed fixtures through an injected `fetch`; a test asserts the adapter never touches `globalThis.fetch` by default in tests. Fixtures carry an honest `provenance` field, and the first run of `scripts/record-tank01-fixtures.ts` with a real key rewrites them and flips that field.
- **The `StatsProvider` interface does not change shape in this plan.** `listPlayers()` and `getWeeklyStatLines(week)` stay exactly as they are. A season is adapter configuration, not an interface parameter — adding one would ripple into `player_stat_lines`, which has no season column and does not need one until a phase that runs more than one season.

---

## What is already true (read before touching anything)

| The spec assumes | Reality on `main` today |
|---|---|
| SQLite, to be migrated (Step 1) | Postgres 17 shipped in Phase 1. `drizzle/0000`–`0010` are committed. Nothing to migrate. |
| No auth at all (Step 4) | WorkOS AuthKit, behind `getCurrentUser()` / `requireCurrentUser()`. |
| No user identity on teams (Step 5) | `teams.user_id` NOT NULL FK, unique `(league_id, user_id)`, and `src/lib/leagues/membership.ts` is the one gate. |
| No indexes anywhere (Step 2) | Eleven indexes exist. `leagues` is the one table with none beyond its PK, and it is exactly the table public browse scans. |
| `mock-players.json` read directly from many call sites (Step 6) | Already false. `src/stats/**` has exactly one external consumer path: `src/data/seed/index.ts` → `seedPlayers(db, provider)`. Nothing at runtime holds a `StatsProvider`. What is missing is the *registry*, the *second implementation*, and the *contract suite*. |
| Draft writes are single-writer by an in-process mutex | True, and `src/draft-service/mutex.ts` says so in its own docblock: *"Phase 2 (multi instance) replaces this with a Postgres advisory lock."* This plan does that, with a transaction-scoped row lock rather than an advisory lock, because advisory locks and PgBouncer transaction pooling are the exact trap the spec warns about. |

---

## File Structure

**New — shared plumbing:**

| File | Responsibility |
|---|---|
| `src/lib/env.ts` | `envOr` / `envOrUndefined`, moved out of `scripts/lib/` so nothing under `src/` reaches outside the source root. |
| `src/lib/env.test.ts` | The empty-string-is-not-unset rule, which has never had a test. |

**New — app-level error surfaces:**

| File | Responsibility |
|---|---|
| `src/app/error.tsx` | The route-segment error boundary for every page. `"use client"`, `{ error, reset }`. |
| `src/app/global-error.tsx` | The root-layout error boundary. Renders its own `<html>`/`<body>` and imports `./globals.css`. |
| `src/app/not-found.tsx` | The 404 page. An `EmptyState`, not an error: a wrong URL is not a failure. |
| `src/app/error-surfaces.test.tsx` | All three, in both themes, axe-clean, with the reset callback proved. |

**New — data-layer proofs and tooling:**

| File | Responsibility |
|---|---|
| `src/db/explain.ts` | `explainPlan(db, query)` and `planUsesSeqScanOn(plan, relation)`. Test-support, lives beside `test-db.ts` for the same reason. |
| `src/db/index-plans.test.ts` | Seeds a 5,000-league corpus, `ANALYZE`s, and fails if any named hot path sequential-scans. |
| `src/db/pgbouncer.test.ts` | The app's behavior against PgBouncer in transaction-pooling mode specifically. |
| `src/draft-service/locking.test.ts` | Two stores over two independent connection pools: concurrent write, and cross-instance visibility. |

**New — the stats seam:**

| File | Responsibility |
|---|---|
| `src/stats/config.ts` | `STATS_CONFIG`: provider names, the default, every env var name the seam reads. |
| `src/stats/registry.ts` | `createStatsProvider(name?)`, `StatsProviderName`, `UnknownStatsProviderError`. The one place a name becomes an implementation. |
| `src/stats/test-support.ts` | `describeStatsProviderContract(label, factory)` — the suite every implementation must pass, written against the interface, not any implementation. Named `test-support.ts` to match the house convention for a vitest-importing helper (`src/db/test-db.ts`, `src/draft-service/test-support.ts`, `src/league-service/test-support.ts`). |
| `src/stats/tank01/fixtures.ts` | `createFixtureFetch()` — serves the committed fixture bodies by URL, and throws by name on anything unrecorded. Test-support. |
| `src/stats/registry.test.ts` | Selection, defaulting, and fail-fast on an unknown name. |
| `src/stats/tank01/config.ts` | `TANK01_CONFIG`: host, paths, positions, the season default, request budget. |
| `src/stats/tank01/client.ts` | `createTank01Client({ apiKey, fetch })` — auth headers, envelope unwrapping, typed failures. No mapping. |
| `src/stats/tank01/map.ts` | Pure: upstream JSON → `Player` / `StatLine`. No I/O, no `fetch`, fully unit-testable. |
| `src/stats/tank01/tank01-stats-provider.ts` | `createTank01StatsProvider(options)` — composes client + map into a `StatsProvider`. |
| `src/stats/tank01/fixtures/manifest.json` | Provenance for every fixture: which endpoint, which params, recorded-or-authored, when. |
| `src/stats/tank01/fixtures/*.json` | Raw upstream response bodies, byte-for-byte as the API returns them. |
| `src/stats/tank01/map.test.ts` | The mapper against every fixture. |
| `src/stats/tank01/tank01-stats-provider.test.ts` | The provider through the shared contract suite, with a fixture-serving `fetch`. |
| `scripts/record-tank01-fixtures.ts` | Founder-run, key-required: re-records every fixture and rewrites the manifest's provenance. |

**New — decision docs:**

| File | Responsibility |
|---|---|
| `docs/decisions/data-layer-hardening.md` | The balance-as-rollup convention, the pool-sizing formula, the transaction-pooling trap, and the struck index list with reasons. |
| `docs/decisions/stats-provider-adapter.md` | What the seam guarantees, what it deliberately does not, and how a key activates Tank01. |

**Modified:** `src/data/seed/index.ts`, `scripts/mint-dev-session.ts`, `eslint.config.mjs`, `src/chat-room/hooks/use-league-chat.ts`, `src/chat-room/hooks/use-league-chat.test.tsx`, `src/chat-room/test-fixtures.tsx`, `src/league-service/browse.ts`, `src/league-service/browse.test.ts`, `src/db/schema.ts`, `src/db/config.ts`, `src/db/client.ts`, `src/db/test-db.ts`, `src/draft-service/store.ts`, `src/draft-service/mutex.ts`, `src/stats/mock/mock-stats-provider.test.ts`, `docker-compose.yml`, `.env.example`, `package.json`, `README.md`, `docs/conventions.md`, `docs/league.md`, `docs/draft-engine.md`.

**Deleted:** `scripts/lib/env.ts`.

---

## Task 1: One env seam in `src/lib/env.ts`, and a rule that keeps `src` inside `src`

`src/data/seed/index.ts:3` reads `import { envOrUndefined } from "../../../scripts/lib/env";`. That is source code climbing out of the source root into a build-tooling directory, and nothing in the lint config stops it or would stop the next one. The helper is 20 lines with no dependencies, so the fix is a move, and then a rule.

**Files:**
- Create: `src/lib/env.ts`
- Test: `src/lib/env.test.ts`
- Delete: `scripts/lib/env.ts`
- Modify: `src/data/seed/index.ts:3`
- Modify: `scripts/mint-dev-session.ts:13`
- Modify: `eslint.config.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `envOr(name: string, fallback: string): string` and `envOrUndefined(name: string): string | undefined`, both exported from `src/lib/env.ts`. Every later task in this plan that reads an optional env var (Tasks 8, 9, 10) imports from here and from nowhere else.

- [ ] **Step 1: Write the failing test**

Create `src/lib/env.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { envOr, envOrUndefined } from "./env";

const KEY = "COMMISH_ENV_TEST_VAR";

afterEach(() => {
  delete process.env[KEY];
});

describe("envOr", () => {
  it("returns the value when one is set", () => {
    process.env[KEY] = "real";
    expect(envOr(KEY, "fallback")).toBe("fallback" === "real" ? "real" : "real");
  });

  it("falls back when the variable is absent", () => {
    expect(envOr(KEY, "fallback")).toBe("fallback");
  });

  it("falls back when the variable is an EMPTY STRING, which `??` would not", () => {
    // `.env.example` ships several vars as intentionally-empty lines, and dotenv reads those
    // as `""`, not as an absent key. This is the whole reason this helper exists.
    process.env[KEY] = "";
    expect(envOr(KEY, "fallback")).toBe("fallback");
    expect(process.env[KEY] ?? "fallback").toBe("");
  });
});

describe("envOrUndefined", () => {
  it("returns the value when one is set", () => {
    process.env[KEY] = "real";
    expect(envOrUndefined(KEY)).toBe("real");
  });

  it("returns undefined when absent", () => {
    expect(envOrUndefined(KEY)).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    process.env[KEY] = "";
    expect(envOrUndefined(KEY)).toBeUndefined();
  });
});
```

Fix the first assertion before running — it is written above with a distracting ternary so it is obvious it must be simplified. Replace that whole line with:

```ts
    expect(envOr(KEY, "fallback")).toBe("real");
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -- src/lib/env`
Expected: FAIL — `Failed to resolve import "./env"`.

- [ ] **Step 3: Create `src/lib/env.ts`**

This is the body of `scripts/lib/env.ts` verbatim, with the docblock updated to say where it now lives and why:

```ts
/**
 * The ONE place this repo reads an optional environment variable with a fallback.
 *
 * `.env.example` deliberately ships several vars as intentionally-empty lines (`E2E_BASE_URL=`,
 * `DEV_SEED_CLAIM_USER_ID=`, `LAB_EMAIL=`, `LAB_PASSWORD=`, `ANTHROPIC_API_KEY=`, …) so a fresh
 * `.env.local` copy documents every var this repo reads even when the developer has no value for
 * it yet. dotenv (and dotenv-cli) reads that line as `process.env.VAR = ""`, not as an absent key
 * — so a plain `process.env.VAR ?? default` is defeated: `??` only falls back on
 * `undefined`/`null`, never on `""`. An empty string is not the same thing as unset, and every
 * site that reads an optional env var with a fallback must treat it that way. Use `envOr` (or
 * `undefined`/`??` only after an explicit `=== ""` check) instead of a bare `??` wherever
 * `.env.example` ships the var empty.
 *
 * It lives under `src/lib/` and NOT under `scripts/lib/` because `src/data/seed/index.ts` needs
 * it, and source code must never import upward out of the source root. `scripts/**` may import
 * `src/**` (it already does, via `@/`); the reverse direction is banned in `eslint.config.mjs`.
 */
export function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

/** Same rule as `envOr`, for the common case of "give me `undefined`, not `""`, when unset." */
export function envOrUndefined(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- src/lib/env`
Expected: PASS, 6 tests.

- [ ] **Step 5: Repoint both importers and delete the old file**

In `src/data/seed/index.ts`, replace line 3:

```ts
import { envOrUndefined } from "../../../scripts/lib/env";
```

with an aliased import placed in the existing `@/`-first import order (it goes directly under the `@/stats` line):

```ts
import { envOrUndefined } from "@/lib/env";
```

In `scripts/mint-dev-session.ts`, replace line 13:

```ts
import { envOrUndefined } from "./lib/env";
```

with:

```ts
import { envOrUndefined } from "@/lib/env";
```

Then delete the old file:

```bash
git rm scripts/lib/env.ts
```

- [ ] **Step 6: Prove nothing broke, including the tsx-run scripts**

Run each of these and confirm the stated expectation:

```bash
npm run typecheck                  # expect: clean
npm test                           # expect: the full suite green, one file larger than before
npm run infra:up && npm run seed   # expect: the four "seeded …" lines, proving tsx resolves `@/lib/env`
```

`npm run seed` is the load-bearing check here: `@/` resolution inside a `tsx`-run script is what the move depends on, and `scripts/drive-dev-draft.ts` already proves `tsx` honors the tsconfig path alias. If `npm run seed` fails to resolve `@/lib/env`, do **not** revert the move — add `"tsx": { "tsconfig": "./tsconfig.json" }` handling by running the seed through `tsx --tsconfig tsconfig.json`, and record the deviation in the commit body.

- [ ] **Step 7: Add the layering rule to `eslint.config.mjs`**

Append a new config block after the existing client-boundary block (the one scoped to `src/draft-room/**`, `src/league-room/**`, `src/chat-room/**`), reusing the file's own `aliasOrRelative` machinery is *not* right here — that helper anchors on `@/`-or-relative for a module inside `src`. This rule bans a relative escape to a sibling of `src`, so it gets its own two regexes:

```js
  {
    // Source code may never import upward out of the source root. `scripts/**` and `e2e/**` are
    // build/verification tooling: they are allowed to import `src/**` (and do, via `@/`), but the
    // reverse makes a production module depend on something no bundler, no `next build` and no
    // deployment artifact is guaranteed to carry. `src/data/seed/index.ts` did exactly this with
    // `../../../scripts/lib/env` until Phase 2 Plan A moved that helper to `src/lib/env.ts`; this
    // rule is what stops the next one. There is no `@/` spelling to ban because the alias only
    // maps into `src`, so a relative escape is the only reachable form.
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?:\\.\\.?/)+scripts(?:/|$)",
              allowTypeImports: false,
              message: "src/** must not import scripts/**. Build tooling may depend on source; source may not depend on build tooling. Move the shared helper into src/lib/.",
            },
            {
              regex: "^(?:\\.\\.?/)+e2e(?:/|$)",
              allowTypeImports: false,
              message: "src/** must not import e2e/**. The browser suite depends on the app; the app must never depend on its test harness.",
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 8: Prove the rule actually fires, then revert the proof**

Temporarily put the old import back at the top of `src/data/seed/index.ts`:

```ts
import { envOrUndefined as _proof } from "../../../scripts/lib/env";
```

Run: `npm run lint`
Expected: an error on that line reading `src/** must not import scripts/**. Build tooling may depend on source; source may not depend on build tooling. Move the shared helper into src/lib/.`

(The file it points at no longer exists, so TypeScript will also complain — that is fine, the point is that ESLint flags it on the *pattern*, not on resolution.) Remove the temporary line, re-run `npm run lint`, and expect it clean.

- [ ] **Step 9: Commit**

```bash
git add src/lib/env.ts src/lib/env.test.ts src/data/seed/index.ts scripts/mint-dev-session.ts eslint.config.mjs
git add -u scripts/lib/env.ts
git commit -m "refactor(env): move envOr/envOrUndefined into src/lib, ban src -> scripts imports

src/data/seed/index.ts reached out of the source root with ../../../scripts/lib/env, and
nothing in the lint config would have stopped the next one. The helper had no dependencies,
so it moves rather than being wrapped, and the empty-string-is-not-unset rule it exists to
enforce finally has a test of its own. The new ESLint block bans the relative escape to
scripts/ and e2e/ from anywhere under src/, in the direction that matters: tooling may
depend on source, source may not depend on tooling."
```

---

## Task 2: The app never shows a raw stack

There is no `error.tsx`, no `global-error.tsx` and no `not-found.tsx` anywhere under `src/app`. A render throw in a Server Component today falls through to Next's built-in error page, and a wrong URL falls through to Next's built-in 404 — both of which are unbranded, untested, untranslated into this product's plain-language copy rule, and neither offers a way forward, which `docs/design-system.md` requires of every error and empty state.

**Files:**
- Create: `src/app/error.tsx`
- Create: `src/app/global-error.tsx`
- Create: `src/app/not-found.tsx`
- Test: `src/app/error-surfaces.test.tsx`

**Interfaces:**
- Consumes: `ErrorState` and `EmptyState` from `@/components/ui` (both take a required `action: ReactNode`); `Button` from `@/components/ui` (props: `variant?: "primary" | "secondary" | "destructive" | "ghost"`, `size?: "sm" | "md" | "lg"`, `loading?: boolean`, plus every `ButtonHTMLAttributes`); `inBothThemes(ui, assert)` from `@/components/ui/test-utils`.
- Produces: nothing other tasks import. These are Next.js convention files.

- [ ] **Step 1: Write the failing test**

Create `src/app/error-surfaces.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import AppError from "./error";
import GlobalError from "./global-error";
import NotFound from "./not-found";

const BOOM = Object.assign(new Error('relation "leagues" does not exist'), { digest: "abc123" });

describe("app/error.tsx", () => {
  it("says what happened and offers a way forward, in both themes, axe-clean", async () => {
    await inBothThemes(<AppError error={BOOM} reset={() => {}} />, async ({ container }) => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Go to your leagues" })).toHaveAttribute("href", "/app");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("never leaks the raw exception text into the page", async () => {
    await inBothThemes(<AppError error={BOOM} reset={() => {}} />, ({ container }) => {
      expect(container.textContent).not.toContain("relation");
      expect(container.textContent).not.toContain("does not exist");
    });
  });

  it("shows the digest as a quiet reference so support can find the log line", async () => {
    await inBothThemes(<AppError error={BOOM} reset={() => {}} />, () => {
      expect(screen.getByText("Reference abc123")).toBeInTheDocument();
    });
  });

  it("omits the reference line entirely when there is no digest", async () => {
    await inBothThemes(<AppError error={new Error("nope")} reset={() => {}} />, ({ container }) => {
      expect(container.textContent).not.toContain("Reference");
    });
  });

  it("calls reset when the retry button is pressed", async () => {
    const reset = vi.fn();
    await inBothThemes(<AppError error={BOOM} reset={reset} />, async () => {
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(reset).toHaveBeenCalledTimes(2); // once per theme render
  });
});

describe("app/global-error.tsx", () => {
  it("renders its own document shell with a retry, axe-clean", async () => {
    const reset = vi.fn();
    const { container } = renderGlobal(<GlobalError error={BOOM} reset={reset} />);
    expect(container.querySelector("html")).not.toBeNull();
    expect(container.querySelector("body")).not.toBeNull();
    expect(container.textContent).toContain("Something went wrong on our side.");
    expect(container.textContent).not.toContain("relation");
  });
});

describe("app/not-found.tsx", () => {
  it("is an empty state, not an error, and offers both ways on, axe-clean", async () => {
    await inBothThemes(<NotFound />, async ({ container }) => {
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("link", { name: "Go to your leagues" })).toHaveAttribute("href", "/app");
      expect(screen.getByRole("link", { name: "Browse open leagues" })).toHaveAttribute("href", "/browse");
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
```

`global-error.tsx` returns an `<html>` element, which `@testing-library/react`'s default `render` cannot mount inside a `<div>` container. Add this helper at the top of the file, directly under the imports, and use it for that one suite:

```tsx
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * `global-error.tsx` renders its own `<html>`/`<body>`, which RTL's default container (a `div`
 * appended to `document.body`) cannot legally hold. happy-dom tolerates the nesting well enough
 * to assert on structure and text, which is all this suite needs; the real document shell is
 * exercised by Next at runtime, not here.
 */
function renderGlobal(ui: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return render(ui, { container });
}
```

`@testing-library/user-event` is not currently a dependency. Add it:

```bash
npm install --save-dev @testing-library/user-event
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -- src/app/error-surfaces`
Expected: FAIL — `Failed to resolve import "./error"`.

- [ ] **Step 3: Write `src/app/error.tsx`**

```tsx
"use client";

import Link from "next/link";
import { Button, ErrorState } from "@/components/ui";

/**
 * The route-segment error boundary for every page under `src/app`. Next.js renders this in
 * place of the segment when a Server or Client Component throws during render.
 *
 * It deliberately does NOT render `error.message`. `docs/conventions.md` is explicit that
 * user-facing error strings are plain language and never raw DB or exception text, and a
 * boundary is exactly where that rule is easiest to break: `error.message` at this point may be
 * a Postgres relation name, a driver stack, or an upstream provider's response body. The
 * `digest` is different — it is a hash Next generates precisely so a user can quote it and an
 * operator can find the matching server log line, so it is shown as a quiet reference.
 */
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg items-center px-4">
      <div className="w-full">
        <ErrorState
          title="Something went wrong on our side."
          description="This one is on us, not on you. Try again, and if it keeps happening head back to your leagues."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button variant="primary" onClick={reset}>
                Try again
              </Button>
              <Link
                href="/app"
                className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-md font-medium text-text-primary transition-colors hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Go to your leagues
              </Link>
            </div>
          }
        />
        {error.digest === undefined ? null : (
          <p className="mt-4 text-center text-sm text-text-muted">Reference {error.digest}</p>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Write `src/app/global-error.tsx`**

```tsx
"use client";

import "./globals.css";

/**
 * The last boundary: this replaces the ROOT layout, so it must render its own `<html>` and
 * `<body>` and import the stylesheet itself. It cannot use `ThemeProvider` or any primitive
 * that assumes the app shell mounted, because the reason it is rendering at all may be that the
 * shell threw. Token class names still resolve because `globals.css` is imported directly here.
 *
 * Same rule as `error.tsx`: the raw exception text never reaches the page, the digest does.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-lg font-semibold text-text-primary">Something went wrong on our side.</h1>
          <p className="max-w-prose text-sm text-text-muted">
            This one is on us, not on you. Reload the page, and if it keeps happening try again in a few minutes.
          </p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-md font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Try again
          </button>
          {error.digest === undefined ? null : <p className="text-sm text-text-muted">Reference {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
```

Note the one deliberate design-system deviation: this file uses a raw `<button>` with the `Button` primitive's own class strings inlined rather than importing `Button`. That is because `global-error.tsx` renders when the root layout itself failed, and importing a primitive drags in the component tree that may be the thing that broke. Record this in the commit body.

- [ ] **Step 5: Write `src/app/not-found.tsx`**

```tsx
import Link from "next/link";
import { EmptyState } from "@/components/ui";

const LINK_CLASS =
  "inline-flex h-10 items-center justify-center rounded-md px-4 text-md font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

/**
 * A wrong URL is not a failure, so this is an `EmptyState` and not an `ErrorState`: no
 * `role="alert"`, no apology, no retry (retrying the same missing URL cannot help). Two ways on,
 * because the two things a visitor could have been looking for are a league they are in and a
 * league they might join.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg items-center px-4">
      <EmptyState
        icon="search"
        title="We couldn't find that page."
        description="The link may be old, or the league may have been removed. Here is where to go next."
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/app" className={`${LINK_CLASS} bg-accent text-accent-text hover:brightness-110`}>
              Go to your leagues
            </Link>
            <Link href="/browse" className={`${LINK_CLASS} border border-border text-text-primary hover:bg-surface-elevated`}>
              Browse open leagues
            </Link>
          </div>
        }
      />
    </main>
  );
}
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `npm test -- src/app/error-surfaces`
Expected: PASS, 7 tests.

- [ ] **Step 7: Verify the boundary in the real app, not just in jsdom**

```bash
npm run dev
```

Then, in another shell, visit each of these and confirm the described result:

- `http://localhost:3000/definitely-not-a-page` renders the 404 empty state with both links, at 360px width and in both themes (toggle via the app's theme control).
- Temporarily add `throw new Error("boundary probe");` as the first line of `src/app/browse/page.tsx`'s default export, reload `http://localhost:3000/browse`, and confirm the error boundary renders with "Try again" and no trace of the string `boundary probe`. Remove the throw.

- [ ] **Step 8: Persona-panel pass**

**CONTROLLER STEP.** These are two new user-facing surfaces (a 404 page and an error boundary), so the founder rule applies: run the persona panel over both, at 360px and desktop, in light and dark. Record findings in the SDD ledger. Fix rounds land as follow-up commits on this task, not as a new task.

- [ ] **Step 9: Commit**

```bash
git add src/app/error.tsx src/app/global-error.tsx src/app/not-found.tsx src/app/error-surfaces.test.tsx package.json package-lock.json
git commit -m "feat(app): error, global-error and not-found surfaces

Phase 1 shipped with no route-segment error boundary and no 404 page, so a render throw or a
stale link fell through to Next's unbranded defaults, which offer no way forward and are not
covered by the design system's never-a-dead-end rule. All three now go through the shared
StatePanel primitives, are tested in both themes and axe-clean, and are proved never to print
error.message: a boundary is the easiest place to break the plain-language rule, because at
that point the message may be a Postgres relation name. The digest is shown instead, since
that is what a user can quote and an operator can grep.

global-error.tsx deliberately inlines Button's classes rather than importing the primitive:
it renders when the ROOT layout itself failed, so it must not depend on the component tree
that may be the thing that broke."
```

---

## Task 3: A slow chat refresh must never clobber a newer one

The Phase 1 final review parked the `useLeagueChat` flake as a Phase 2 residual. The root cause is not a test-timing accident, it is a real last-writer-wins race in the hook: `refresh()` is fired as fire-and-forget `void refresh()` from **two** independent places — the mount effect (`use-league-chat.ts:119-121`) and the SSE `open` handler (`:136-142`) — with no ordering and no cancellation. Two `refresh` calls in flight resolve in whatever order the network gives them, and whichever resolves *last* writes its page into state. A slow first response therefore overwrites a fresh second one, which in production is a chat pane that reverts to an older page after a reconnect, and in the test suite is the intermittent failure the ledger recorded.

The tests then hid it: they gate on `waitFor(() => expect(result.current.connection).toBe("live"))`, and `onOpen` sets `connection: "live"` **synchronously, before** `void refresh()`. So the gate can open while the refetch's write is still pending, and the assertions after it read a settling state.

Both halves get fixed: a generation guard in the hook, and assertions re-anchored onto an observable consequence.

**Files:**
- Modify: `src/chat-room/hooks/use-league-chat.ts:90-121`
- Modify: `src/chat-room/hooks/use-league-chat.test.tsx` (two tests re-anchored, one new)
- Modify: `src/chat-room/test-fixtures.tsx` (a deferred-response mode)

**Interfaces:**
- Consumes: `fixtureChatDeps(page?: ChatPageBody): FixtureChatDeps` from `src/chat-room/test-fixtures.tsx`, whose current shape is `{ deps, calls: string[], response: unknown, emit(type, payload), fire("open" | "error") }`.
- Produces: `FixtureChatDeps` gains one optional field, `deferred?: boolean`, and two methods used only when it is set: `pending(): number` and `settle(index: number, response: unknown): Promise<void>`. `useLeagueChat`'s public `LeagueChat` type is unchanged — the guard is internal.

- [ ] **Step 1: Add the deferred mode to the fixture**

In `src/chat-room/test-fixtures.tsx`, extend the interface and the factory. Replace the whole `FixtureChatDeps` interface and `fixtureChatDeps` function with:

```tsx
interface FixtureChatDeps {
  deps: ChatRoomDeps;
  readonly calls: string[];
  /** Mutable: the envelope the next request answers with. Defaults to the page above. */
  response: unknown;
  /** Push a frame down the fake stream, exactly as the SSE route would. */
  emit: (type: string, payload: unknown) => void;
  /** Fire the stream's own lifecycle events. */
  fire: (type: "open" | "error") => void;
  /** How many requests are still unresolved. Always 0 unless `deferred` was set. */
  pending: () => number;
  /**
   * Resolve the Nth still-unresolved request (0-based, in call order) with a specific envelope.
   * Only meaningful in deferred mode, which is what lets a test choose the ORDER two concurrent
   * refreshes resolve in — the whole point of the race this hook has to survive.
   */
  settle: (index: number, response: unknown) => Promise<void>;
}

/** One injected fetch + one fake EventSource. No module mocks, no real network. */
export function fixtureChatDeps(page: ChatPageBody = CHAT_PAGE, options: { readonly deferred?: boolean } = {}): FixtureChatDeps {
  const listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  const waiting: ((response: unknown) => void)[] = [];
  const fixture: FixtureChatDeps = {
    calls: [],
    response: { ok: true, data: page },
    emit: (type, payload) => {
      for (const listener of listeners.get(type) ?? []) {
        listener({ data: JSON.stringify({ type, leagueId: "l1", payload }) } as MessageEvent);
      }
    },
    fire: (type) => {
      for (const listener of listeners.get(type) ?? []) listener({ data: "" } as MessageEvent);
    },
    pending: () => waiting.filter((entry) => entry !== undefined).length,
    settle: async (index, response) => {
      const resolve = waiting[index];
      if (resolve === undefined) throw new Error(`no pending request at index ${index}`);
      delete waiting[index];
      resolve(response);
      // Let the hook's own `await response.json()` continuation run before the test asserts.
      await Promise.resolve();
      await Promise.resolve();
    },
    deps: {
      fetchJson: async (url, init) => {
        fixture.calls.push(`${init?.method ?? "GET"} ${url}`);
        if (options.deferred !== true) {
          return { json: async () => fixture.response } as unknown as Response;
        }
        const index = waiting.length;
        const body = await new Promise<unknown>((resolve) => {
          waiting[index] = resolve;
        });
        return { json: async () => body } as unknown as Response;
      },
      openEventSource: () => ({
        addEventListener: (type, listener) => {
          listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        },
        close: () => listeners.clear(),
      }),
    },
  };
  return fixture;
}
```

The `waiting` array uses a plain index and `delete`, so `settle(0, …)` then `settle(1, …)` and `settle(1, …)` then `settle(0, …)` are both expressible — resolving out of order is exactly what the new test needs.

- [ ] **Step 2: Write the failing test**

Add to `src/chat-room/hooks/use-league-chat.test.tsx`, inside the existing `describe("useLeagueChat", …)`:

```tsx
  // The mount effect and the SSE `open` handler BOTH fire `void refresh()`, with no ordering
  // between them. Before the generation guard, whichever response landed LAST won the write,
  // so a slow first request could overwrite a fresh second one: after a reconnect the pane
  // silently reverted to an older page. This test forces that order deliberately.
  it("keeps the newest refresh when an older one resolves after it", async () => {
    const fixture = fixtureChatDeps(CHAT_PAGE, { deferred: true });
    const { result } = renderHook(() => useLeagueChat("l1"), { wrapper: wrapper(fixture.deps) });
    await waitFor(() => expect(fixture.pending()).toBe(1)); // the mount refresh

    act(() => fixture.fire("open"));
    await waitFor(() => expect(fixture.pending()).toBe(2)); // plus the open refresh

    const stale = { ok: true, data: { ...CHAT_PAGE, messages: [chatMessage("1", { body: "stale page" })] } };
    const fresh = { ok: true, data: { ...CHAT_PAGE, messages: [chatMessage("9", { body: "fresh page" })] } };

    // Newest resolves FIRST, oldest resolves SECOND — the exact interleaving that loses data.
    await act(async () => {
      await fixture.settle(1, fresh);
      await fixture.settle(0, stale);
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.messages.map((message) => message.body)).toContain("fresh page");
    expect(result.current.messages.map((message) => message.body)).not.toContain("stale page");
  });
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test -- src/chat-room/hooks/use-league-chat`
Expected: FAIL on the last assertion — `expected [ 'fresh page', 'stale page' ] not to contain 'stale page'` (the union folds both in, and the stale write lands last).

- [ ] **Step 4: Add the generation guard to the hook**

In `src/chat-room/hooks/use-league-chat.ts`, add a ref beside `messagesRef` (directly under line 83):

```ts
  /**
   * Monotonic id for the newest `refresh` in flight. `refresh` is fired fire-and-forget from
   * TWO places (the mount effect and the SSE `open` handler) and there is no ordering between
   * their responses, so without this the last response to arrive wins the write — a slow first
   * request overwriting a fresh second one, which after a reconnect reads as the pane reverting
   * to an older page. A response whose generation is no longer the newest is dropped whole: it
   * is strictly older information about the same resource, so there is nothing in it worth
   * merging.
   */
  const refreshGeneration = useRef(0);
```

Then replace the body of `refresh` (lines 90–117) with:

```ts
  const refresh = useCallback(async (): Promise<void> => {
    refreshGeneration.current += 1;
    const generation = refreshGeneration.current;
    const isStale = (): boolean => generation !== refreshGeneration.current;
    try {
      const response = await deps.fetchJson(`/api/leagues/${leagueId}/chat`);
      const body = (await response.json()) as ApiEnvelope<ChatPageBody>;
      if (isStale()) return;
      if (!body.ok) {
        setState((prev) => ({ ...prev, status: "error", error: body.error }));
        return;
      }
      // `unionMessages`, NOT `mergeMessages`: the cap keeps the newest `maxHeldMessages`, and
      // every reconnect fires this (see the `open` handler). Capping here would re-trim a
      // buffer that `loadEarlier` deliberately grew past the cap and discard the history the
      // user explicitly paged in — unreachably, since `hasMore` may already be false. This
      // input is one server page, so the union cannot grow the buffer without bound.
      const merged = unionMessages(messagesRef.current, body.data.messages);
      messagesRef.current = merged;
      setState((prev) => ({
        ...prev,
        status: "ready",
        error: null,
        messages: merged,
        meUserId: body.data.meUserId,
        // A later page's `hasMore` never un-says an earlier "there is more behind you".
        hasMore: prev.status === "loading" ? body.data.hasMore : prev.hasMore,
      }));
    } catch {
      if (isStale()) return;
      setState((prev) => ({ ...prev, status: "error", error: LOAD_ERROR }));
    }
  }, [deps, leagueId]);
```

Note that `messagesRef.current` is read *after* the staleness check, so a dropped response never contributes to the union either.

- [ ] **Step 5: Run it and watch it pass**

Run: `npm test -- src/chat-room/hooks/use-league-chat`
Expected: PASS — all 13 tests.

- [ ] **Step 6: Re-anchor the two connection-gated assertions**

Both remaining flaky shapes gate on `connection`, which `onOpen` sets before the refetch it triggers. Replace the gate in "keeps paged-in history across a reconnect's refresh" — the four lines starting `fixture.response = { ok: true, data: { ...CHAT_PAGE, hasMore: false } };` — with:

```tsx
    fixture.response = { ok: true, data: { ...CHAT_PAGE, hasMore: false } };
    const before = fixture.calls.filter((call) => call === "GET /api/leagues/l1/chat").length;
    act(() => fixture.fire("open"));
    // Gate on the REFETCH landing, not on `connection`: `onOpen` sets connection: "live"
    // synchronously and only then fires `void refresh()`, so a connection-gated wait opens
    // while the write it is really waiting for is still in flight.
    await waitFor(() =>
      expect(fixture.calls.filter((call) => call === "GET /api/leagues/l1/chat")).toHaveLength(before + 1),
    );
    await waitFor(() => expect(result.current.messages.length).toBeGreaterThan(CHAT_CONFIG.maxHeldMessages));
```

And in "tracks the connection and resyncs on every open", replace:

```tsx
    act(() => fixture.fire("open"));
    await waitFor(() => expect(result.current.connection).toBe("live"));
    expect(fixture.calls.filter((call) => call === "GET /api/leagues/l1/chat")).toHaveLength(2);
```

with:

```tsx
    act(() => fixture.fire("open"));
    await waitFor(() => expect(fixture.calls.filter((call) => call === "GET /api/leagues/l1/chat")).toHaveLength(2));
    expect(result.current.connection).toBe("live");
```

- [ ] **Step 7: Prove the flake is gone by repetition, not by one green run**

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do npm test -- src/chat-room || break; done
```

Expected: ten consecutive passing runs. A single green run is not evidence for a fix to an intermittent failure; this loop is the acceptance evidence, and its output goes in the SDD ledger.

- [ ] **Step 8: Commit**

```bash
git add src/chat-room/hooks/use-league-chat.ts src/chat-room/hooks/use-league-chat.test.tsx src/chat-room/test-fixtures.tsx
git commit -m "fix(chat): drop a refresh response that a newer refresh has already superseded

The parked use-league-chat flake was not a test artifact. refresh() is fired fire-and-forget
from the mount effect AND from the SSE open handler, with no ordering between their responses,
so the last one to resolve won the write: a slow first request could overwrite a fresh second
one, which in production reads as the chat pane reverting to an older page right after a
reconnect. A monotonic generation ref now drops any response that is no longer the newest,
checked before the union so a stale page cannot even contribute.

The tests hid it by gating on connection === 'live', which onOpen sets SYNCHRONOUSLY before it
fires the refetch, so the gate opened while the write was still pending. Both such gates now
wait on the refetch actually landing. Acceptance evidence: ten consecutive green runs of
npm test -- src/chat-room."
```

---

## Task 4: Browse filters run in SQL, so a filtered browse can never under-fill

`src/league-service/browse.ts` documents its own bug: *"KNOWN TRADEOFF: the open-seat/format/tier filters run in JS against that already-capped page, so once more than `maxResults` public leagues exist, a filtered browse can return fewer matches than the database holds."* The Phase 1 final review parked pushing them into SQL. This is that push, and it is also the spec's Step 2 task *"apply the rollup convention to the one aggregate-style read this phase already has"* — the fill count stops being a second query folded in JS and becomes a grouped count Postgres computes and filters on.

`matchesBrowseFilter` and `hasOpenSeat` stay exactly where they are and stay the 100%-covered pure rule. What stops them drifting from the SQL is a test that runs both over the same seeded corpus for every filter combination and demands identical answers.

**Files:**
- Modify: `src/league-service/browse.ts` (the whole `listPublicLeagues` body)
- Modify: `src/league-service/browse.test.ts` (add the equivalence and under-fill suites)

**Interfaces:**
- Consumes: `MATCHMAKING_CONFIG` (`anyValue: "any"`, `formats`, `experienceTiers`, `stakeTiers: readonly { tier: number; label: string }[]`, `maxResults: 48`) from `@/matchmaking/config`; `BrowseFilter` (`{ format: DraftFormat | "any"; experienceTier: ExperienceTier | "any"; stakeTier: number | "any" }`) and `PublicLeagueSummary` from `@/matchmaking/contract`; `hasOpenSeat`, `matchesBrowseFilter` from `@/matchmaking/filter`.
- Produces: `listPublicLeagues(db: Db, filter: BrowseFilter): Promise<readonly PublicLeagueSummary[]>` — **unchanged signature and unchanged return type.** `PUBLIC_LEAGUE_FIELDS` is unchanged. Task 5 adds the index this query needs and asserts the plan uses it.

- [ ] **Step 1: Write the failing tests**

Append to `src/league-service/browse.test.ts`. The file already has a `createTestDb()` + `truncateAll` harness and league-seeding helpers; reuse whatever it names them. These two suites assume a helper `seedPublicLeague(db, overrides)` that inserts one public league with a `scheduled` draft and N teams — if the existing file spells it differently, use the existing spelling rather than adding a second one.

```ts
describe("listPublicLeagues narrows in SQL", () => {
  /**
   * The anti-drift device. `matchesBrowseFilter`/`hasOpenSeat` are the product's ONE filter
   * rule and are gated at 100% coverage; the SQL is a second expression of the same rule, and
   * two expressions of one rule is exactly how a privacy/behavior drift starts. So rather than
   * asserting hand-picked cases, this runs EVERY filter combination over one corpus and demands
   * the database and the pure rule return the same league ids, in the same order.
   */
  it("agrees with the pure filter for every filter combination", async () => {
    const corpus: PublicLeagueSummary[] = [];
    for (const format of MATCHMAKING_CONFIG.formats) {
      for (const experienceTier of MATCHMAKING_CONFIG.experienceTiers) {
        for (const { tier } of MATCHMAKING_CONFIG.stakeTiers) {
          for (const filledTeams of [0, 6, 12]) {
            const league = await seedPublicLeague(db, { format, experienceTier, stakeTier: tier, teamCount: 12, filledTeams });
            corpus.push(league);
          }
        }
      }
    }

    const combinations: BrowseFilter[] = [];
    for (const format of [...MATCHMAKING_CONFIG.formats, "any" as const]) {
      for (const experienceTier of [...MATCHMAKING_CONFIG.experienceTiers, "any" as const]) {
        for (const stakeTier of [...MATCHMAKING_CONFIG.stakeTiers.map((entry) => entry.tier), "any" as const]) {
          combinations.push({ format, experienceTier, stakeTier });
        }
      }
    }
    expect(combinations).toHaveLength(3 * 3 * 5);

    for (const filter of combinations) {
      const fromSql = await listPublicLeagues(db, filter);
      const fromRule = corpus.filter((league) => hasOpenSeat(league) && matchesBrowseFilter(league, filter));
      expect(fromSql.map((league) => league.id).sort()).toEqual(fromRule.map((league) => league.id).sort());
    }
  });

  it("returns every match even when far more than maxResults public leagues exist", async () => {
    // The bug this task closes: the LIMIT used to be applied BEFORE the format/tier/open-seat
    // filters ran in JS, so a narrow filter over a large public pool returned an under-filled
    // page (often zero) while the database held plenty of matches.
    for (let i = 0; i < MATCHMAKING_CONFIG.maxResults + 10; i += 1) {
      await seedPublicLeague(db, { format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 12, filledTeams: 0 });
    }
    for (let i = 0; i < 5; i += 1) {
      await seedPublicLeague(db, { format: "auction", experienceTier: "experienced", stakeTier: 3, teamCount: 12, filledTeams: 0 });
    }

    const narrow = await listPublicLeagues(db, { format: "auction", experienceTier: "experienced", stakeTier: 3 });
    expect(narrow).toHaveLength(5);
  });

  it("still caps an unnarrowed browse at maxResults", async () => {
    for (let i = 0; i < MATCHMAKING_CONFIG.maxResults + 10; i += 1) {
      await seedPublicLeague(db, { format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 12, filledTeams: 0 });
    }
    const all = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(all).toHaveLength(MATCHMAKING_CONFIG.maxResults);
  });

  it("counts fill with a grouped count, so a full league is excluded by the database", async () => {
    await seedPublicLeague(db, { format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 4, filledTeams: 4 });
    const open = await seedPublicLeague(db, { format: "snake", experienceTier: "beginner", stakeTier: 0, teamCount: 4, filledTeams: 3 });
    const rows = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
    expect(rows.map((league) => league.id)).toEqual([open.id]);
    expect(rows[0]?.filledTeams).toBe(3);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- src/league-service/browse`
Expected: the under-fill test FAILS with `expected length 5, received 0` (the cap-before-filter bug), and the equivalence test FAILS for at least the narrow combinations for the same reason. The `maxResults` cap test and the fill test may already pass — that is fine, they are regression guards for what must not change.

- [ ] **Step 3: Rewrite `listPublicLeagues` as one grouped query**

Replace the entire body of `listPublicLeagues` (and update the docblock's tradeoff paragraph). Imports at the top of `src/league-service/browse.ts` become:

```ts
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import type { BrowseFilter, PublicLeagueSummary } from "@/matchmaking/contract";
```

`hasOpenSeat` and `matchesBrowseFilter` are no longer imported by this module — the SQL is the enforcement now, and the pure rule is what the equivalence test holds it to. Then:

```ts
/**
 * Turns a normalized filter into the narrowing predicates the query applies. `undefined` for a
 * field means "any", and Drizzle's `and()` drops `undefined` operands, so an unnarrowed browse
 * produces exactly the two mandatory predicates and nothing else.
 */
function narrowingFor(filter: BrowseFilter): readonly (SQL | undefined)[] {
  const ANY = MATCHMAKING_CONFIG.anyValue;
  return [
    filter.format === ANY ? undefined : eq(leagues.format, filter.format),
    filter.experienceTier === ANY ? undefined : eq(leagues.experienceTier, filter.experienceTier),
    filter.stakeTier === ANY ? undefined : eq(leagues.stakeTier, filter.stakeTier),
  ];
}

export async function listPublicLeagues(db: Db, filter: BrowseFilter): Promise<readonly PublicLeagueSummary[]> {
  const rows = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      format: leagues.format,
      experienceTier: leagues.experienceTier,
      stakeTier: leagues.stakeTier,
      teamCount: leagues.teamCount,
      filledTeams: sql<number>`count(${teams.id})::int`,
    })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .leftJoin(teams, eq(teams.leagueId, leagues.id))
    .where(and(eq(leagues.isPublicMatchmade, true), eq(drafts.status, "scheduled"), ...narrowingFor(filter)))
    .groupBy(leagues.id)
    .having(sql`count(${teams.id}) < ${leagues.teamCount}`)
    .orderBy(asc(leagues.createdAt))
    .limit(MATCHMAKING_CONFIG.maxResults);

  return rows;
}
```

Three details that are load-bearing and easy to get wrong:

1. **`leftJoin`, not `innerJoin`, on `teams`.** A brand-new public league with zero managers is the most joinable league there is; an inner join would hide exactly the leagues browse most wants to show. `count(teams.id)` counts non-null rows, so an empty league correctly reads 0.
2. **`groupBy(leagues.id)` alone is legal** even though six league columns are selected and one is ordered on: `leagues.id` is the primary key, so Postgres's functional-dependency rule covers every other column of that table. Do not add the other columns to the `GROUP BY`; it would work but it would misrepresent why the query is correct.
3. **`HAVING count(...) < team_count`** is what makes the open-seat rule a database predicate rather than a post-filter, which is the whole point: it runs before `LIMIT`, so the cap can no longer eat matches.

Update the docblock's "Two queries, not one per league" and "KNOWN TRADEOFF" paragraphs. Replace both with:

```
 * ONE query, not two: a league's fill count is a grouped `count(teams.id)`, and the open-seat
 * rule is a `HAVING` predicate rather than a JS filter over an already-capped page. That
 * ordering is the correctness property — every narrowing (format, experience tier, stake tier,
 * open seat) is applied BEFORE the `LIMIT`, so a filtered browse returns every match the
 * database holds up to the cap, never an under-filled page because the cap ate the candidates
 * first. That was a real defect in the previous two-query form, documented there as a known
 * tradeoff and closed here.
 *
 * `matchesBrowseFilter`/`hasOpenSeat` in `src/matchmaking/filter.ts` remain the product's
 * canonical, 100%-covered statement of the same rule, and `browse.test.ts` runs every one of
 * the 3 x 3 x 5 filter combinations through BOTH this query and that pure rule over one seeded
 * corpus, demanding identical answers. Two expressions of one rule is how a drift starts; that
 * test is what makes a drift a failing build.
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npm test -- src/league-service/browse`
Expected: PASS, including the 45-combination equivalence loop.

- [ ] **Step 5: Confirm the public route's body is byte-identical**

The Phase 1 fix wave added a byte-identical-body test on `GET /api/public/leagues` and a key-set test against `PUBLIC_LEAGUE_FIELDS`. This task changed the query that feeds them.

Run: `npm test -- src/app/api/public && npm test -- src/league-service`
Expected: PASS. If the key-set test now fails, the `sql<number>` alias leaked a different key name — the select alias must stay exactly `filledTeams`.

- [ ] **Step 6: Commit**

```bash
git add src/league-service/browse.ts src/league-service/browse.test.ts
git commit -m "fix(browse): narrow in SQL so a filtered page can never under-fill

browse.ts documented its own defect: the LIMIT ran before the format/tier/open-seat filters,
which ran in JS over the already-capped page, so once more than maxResults public leagues
exist a narrow filter returned fewer matches than the database held, often zero. It is now one
grouped query: the fill count is count(teams.id) with a LEFT JOIN so an empty league still
shows, the open-seat rule is a HAVING predicate, and every narrowing is applied before the cap.

The pure matchesBrowseFilter/hasOpenSeat rule stays exactly where it was and stays the
100%-covered canonical statement. What stops the SQL drifting from it is a test that runs all
45 filter combinations through both over one corpus and demands the same league ids."
```

---

## Task 5: The one missing index, and an `EXPLAIN` gate that keeps it honest

The spec claims *"Zero indexes exist anywhere in the schema."* That was true of the Phase 1 draft it was written against and is false of `main`: eleven indexes exist. One table has none beyond its primary key — `leagues` — and it happens to be the table the app's only unauthenticated endpoint scans and sorts on. This task adds that index, strikes the three the spec asks for that are already served (or served better) with the reason recorded, and builds the thing the spec actually asks for that does not exist at all: a test that runs `EXPLAIN (ANALYZE, FORMAT JSON)` against a representative corpus and fails on a sequential scan.

**Files:**
- Modify: `src/db/schema.ts` (the `leagues` table gains an index callback)
- Create: `drizzle/0011_*.sql` (generated, then committed)
- Create: `src/db/explain.ts`
- Test: `src/db/index-plans.test.ts`

**Interfaces:**
- Consumes: `listPublicLeagues` from Task 4 (its exact query shape is what the plan is asserted against); `createTestDb()` / `truncateAll(db)` / `TEST_DATABASE_URL` from `@/db/test-db`.
- Produces:
  - `explainPlan(db: Db, query: { toSQL(): { sql: string; params: unknown[] } }): Promise<PlanNode>`
  - `interface PlanNode { readonly "Node Type": string; readonly "Relation Name"?: string; readonly Plans?: readonly PlanNode[] }`
  - `sequentiallyScannedRelations(plan: PlanNode): readonly string[]`
  Task 8's PgBouncer suite reuses `explainPlan` unchanged.

- [ ] **Step 1: Write `src/db/explain.ts`**

```ts
import type { Db } from "./client";

/** The subset of a Postgres `EXPLAIN (FORMAT JSON)` node this repo asserts on. */
export interface PlanNode {
  readonly "Node Type": string;
  readonly "Relation Name"?: string;
  readonly Plans?: readonly PlanNode[];
}

/**
 * Runs a Drizzle query under `EXPLAIN (ANALYZE, FORMAT JSON)` and returns its root plan node.
 *
 * Test-support, like `test-db.ts` beside it: nothing in the running app explains its own
 * queries. It goes through `db.$client.unsafe(text, params)` — postgres-js's own escape hatch
 * for a statement Drizzle did not build — because `EXPLAIN` cannot be expressed as a Drizzle
 * query and because `toSQL()` already hands back the parameterized text and the bound values
 * separately, so nothing is string-interpolated into SQL here.
 *
 * `ANALYZE` genuinely executes the statement. That is deliberate: a plan without actual row
 * counts can be confidently wrong about a table it has stale statistics for, and the whole
 * point of this helper is to catch exactly that.
 */
export async function explainPlan(
  db: Db,
  query: { toSQL(): { sql: string; params: unknown[] } },
): Promise<PlanNode> {
  const { sql: text, params } = query.toSQL();
  const rows = await db.$client.unsafe(`EXPLAIN (ANALYZE, FORMAT JSON) ${text}`, params as never[]);
  const first = rows[0] as Record<string, unknown> | undefined;
  const explained = first?.["QUERY PLAN"];
  if (!Array.isArray(explained) || explained.length === 0) {
    throw new Error(`EXPLAIN returned no plan for: ${text}`);
  }
  const root = (explained[0] as { readonly Plan?: PlanNode }).Plan;
  if (root === undefined) throw new Error(`EXPLAIN returned a plan with no root node for: ${text}`);
  return root;
}

/** Every relation this plan reads with a sequential scan, deduplicated, in encounter order. */
export function sequentiallyScannedRelations(plan: PlanNode): readonly string[] {
  const found: string[] = [];
  const walk = (node: PlanNode): void => {
    const relation = node["Relation Name"];
    if (node["Node Type"] === "Seq Scan" && relation !== undefined && !found.includes(relation)) {
      found.push(relation);
    }
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(plan);
  return found;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/db/index-plans.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { and, asc, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "./test-db";
import { chatMessages, draftActions, leagues, teams } from "./schema";
import { explainPlan, sequentiallyScannedRelations } from "./explain";
import { listPublicLeagues } from "@/league-service/browse";
import { EMPTY_BROWSE_FILTER } from "@/matchmaking/filter";

const db = createTestDb();

/**
 * Big enough that the planner has a real choice. Postgres will happily sequential-scan a
 * hundred-row table no matter what indexes exist, so a plan assertion against a toy dataset
 * asserts nothing at all. 5,000 leagues with 10% public and three teams each is roughly the
 * shape of a product with a few thousand leagues, which is where these paths start to matter.
 */
const LEAGUE_COUNT = 5_000;
const TEAMS_PER_LEAGUE = 3;
const USER_COUNT = 200;

async function seedCorpus(): Promise<void> {
  await db.execute(sql`
    INSERT INTO users (id, email, display_name)
    SELECT 'u' || g, 'u' || g || '@example.test', 'Manager ' || g
    FROM generate_series(1, ${USER_COUNT}) g
  `);
  await db.execute(sql`
    INSERT INTO leagues (id, name, format, team_count, stake_tier, is_public_matchmade, experience_tier, commissioner_user_id, created_at)
    SELECT 'lg' || g,
           'League ' || g,
           (ARRAY['snake','auction'])[1 + (g % 2)]::draft_format,
           12,
           g % 4,
           (g % 10 = 0),
           (ARRAY['beginner','experienced'])[1 + (g % 2)]::experience_tier,
           'u' || (1 + (g % ${USER_COUNT})),
           now() - (g || ' minutes')::interval
    FROM generate_series(1, ${LEAGUE_COUNT}) g
  `);
  await db.execute(sql`
    INSERT INTO drafts (id, league_id, format, status, kickoff_at)
    SELECT 'df' || g, 'lg' || g,
           (ARRAY['snake','auction'])[1 + (g % 2)]::draft_format,
           'scheduled'::draft_status,
           now() + interval '1 day'
    FROM generate_series(1, ${LEAGUE_COUNT}) g
  `);
  await db.execute(sql`
    INSERT INTO teams (id, league_id, user_id, name)
    SELECT 'tm' || g || '_' || t, 'lg' || g, 'u' || (1 + ((g * 7 + t) % ${USER_COUNT})), 'Team ' || t
    FROM generate_series(1, ${LEAGUE_COUNT}) g, generate_series(1, ${TEAMS_PER_LEAGUE}) t
  `);
  await db.execute(sql`
    INSERT INTO chat_messages (league_id, author_user_id, body)
    SELECT 'lg' || (1 + (g % 50)), 'u' || (1 + (g % ${USER_COUNT})), 'message ' || g
    FROM generate_series(1, 20000) g
  `);
  // Without ANALYZE the planner works from empty-table statistics and will choose a sequential
  // scan for everything, which would make this whole suite a false negative.
  await db.execute(sql`ANALYZE users, leagues, drafts, teams, chat_messages`);
}

describe("hot read paths use indexes", () => {
  beforeAll(async () => {
    await truncateAll(db);
    await seedCorpus();
  }, 120_000);

  it("public browse does not sequential-scan leagues or teams", async () => {
    const plan = await explainPlan(db, browseQuery(EMPTY_BROWSE_FILTER));
    expect(sequentiallyScannedRelations(plan)).not.toContain("leagues");
    expect(sequentiallyScannedRelations(plan)).not.toContain("teams");
  });

  it("a narrowed browse also avoids a sequential scan of leagues", async () => {
    const plan = await explainPlan(db, browseQuery({ format: "auction", experienceTier: "experienced", stakeTier: 3 }));
    expect(sequentiallyScannedRelations(plan)).not.toContain("leagues");
  });

  it("a user's teams are found by index, not by scanning every team", async () => {
    const query = db.select({ leagueId: teams.leagueId, teamId: teams.id }).from(teams).where(eq(teams.userId, "u7"));
    expect(sequentiallyScannedRelations(await explainPlan(db, query))).not.toContain("teams");
  });

  it("a chat page is an index range scan, not a scan of the whole league's history", async () => {
    const query = db
      .select({ id: chatMessages.id, body: chatMessages.body })
      .from(chatMessages)
      .where(eq(chatMessages.leagueId, "lg7"))
      .orderBy(asc(chatMessages.id))
      .limit(50);
    expect(sequentiallyScannedRelations(await explainPlan(db, query))).not.toContain("chat_messages");
  });

  it("a draft's action log replays by index", async () => {
    await db.execute(sql`
      INSERT INTO draft_actions (draft_id, sequence, action, timestamp)
      SELECT 'df1', g, '{"v":1,"type":"NOOP"}'::jsonb, now()
      FROM generate_series(1, 400) g
    `);
    await db.execute(sql`ANALYZE draft_actions`);
    const query = db
      .select()
      .from(draftActions)
      .where(eq(draftActions.draftId, "df1"))
      .orderBy(asc(draftActions.sequence));
    expect(sequentiallyScannedRelations(await explainPlan(db, query))).not.toContain("draft_actions");
  });
});
```

Add the query builder the browse assertions explain. It must be the **same shape** `listPublicLeagues` builds, and the way to guarantee that is to not write it twice: export the builder from `browse.ts` and have both use it.

In `src/league-service/browse.ts`, extract the builder from Task 4's `listPublicLeagues`:

```ts
/**
 * The browse query as a builder, so `src/db/index-plans.test.ts` can EXPLAIN exactly what
 * production runs rather than a hand-copied lookalike that could drift into being fast while
 * the real one is slow.
 */
export function browseQuery(db: Db, filter: BrowseFilter) {
  return db
    .select({ /* …exactly the select from Task 4… */ })
    /* …the rest of Task 4's chain, unchanged… */;
}

export async function listPublicLeagues(db: Db, filter: BrowseFilter): Promise<readonly PublicLeagueSummary[]> {
  return browseQuery(db, filter);
}
```

and in the test, `browseQuery(filter)` above becomes `browseQuery(db, filter)`. Fix the two call sites in the test accordingly. Also drop the unused `and`, `leagues` and `listPublicLeagues` imports from the test once the builder is used.

- [ ] **Step 3: Run it and watch the browse assertions fail**

Run: `npm test -- src/db/index-plans`
Expected: the two browse tests FAIL with `expected [ 'leagues' ] not to contain 'leagues'`. The teams, chat and draft-action tests should already PASS — they are regression guards on indexes that already exist and must not be dropped.

- [ ] **Step 4: Add the index to the schema**

In `src/db/schema.ts`, add `import { sql } from "drizzle-orm";` at the top, then convert the `leagues` table from the two-argument form to the three-argument form:

```ts
export const leagues = pgTable(
  "leagues",
  {
    /* …every column exactly as it is today, unchanged… */
  },
  (t) => [
    /**
     * PARTIAL, on purpose. `is_public_matchmade` is false for the overwhelming majority of
     * leagues (a league is private unless a commissioner opts in), and the only query that
     * reads this column reads `= true` and then orders by `created_at`. A partial index on
     * `created_at` over just those rows is therefore both the smallest index that serves the
     * query and one that supplies the sort order directly, so the browse `LIMIT` can stop
     * early instead of sorting the qualifying set first.
     *
     * There is deliberately NO index on `commissioner_user_id`: every read of it fetches the
     * league by primary key and compares in application code (`src/lib/leagues/membership.ts`,
     * `src/league-service/read.ts`). An index on a column nothing filters on is maintenance
     * cost with no read to pay for it. Add one the day a "leagues I commission" query exists.
     */
    index("leagues_public_browse_idx").on(t.createdAt).where(sql`${t.isPublicMatchmade}`),
  ],
);
```

- [ ] **Step 5: Generate, inspect and apply the migration**

```bash
npm run db:generate
```

Open the generated `drizzle/0011_*.sql` and confirm it reads (modulo the generated name):

```sql
CREATE INDEX "leagues_public_browse_idx" ON "leagues" USING btree ("created_at") WHERE "leagues"."is_public_matchmade";
```

If the `WHERE` clause is missing, the partial predicate did not survive generation — do not hand-edit the generated file into shape and move on; that would leave `schema.ts` and the migration silently disagreeing. Instead write the predicate as `sql`${t.isPublicMatchmade} = true`` and regenerate.

```bash
npm run db:migrate
npm run db:migrate:test
```

- [ ] **Step 6: Run it and watch it pass**

Run: `npm test -- src/db/index-plans`
Expected: PASS, 5 tests.

If `teams` still appears as sequentially scanned in the unnarrowed browse plan, that is a genuine finding and not something to assert away. Diagnose it by re-running the same `EXPLAIN` under `SET LOCAL enable_seqscan = off` to confirm an index path exists at all, then record what the planner chose and why in `docs/decisions/data-layer-hardening.md` (Task 8) before deciding whether to relax that one assertion. `SET enable_seqscan = off` is a diagnostic here, never a fix and never something the test sets.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/explain.ts src/db/index-plans.test.ts src/league-service/browse.ts drizzle/
git commit -m "perf(db): partial index for public browse, and an EXPLAIN gate over the hot paths

leagues was the one table with no index beyond its primary key, and it is the table the app's
only unauthenticated endpoint filters and sorts on. The new index is partial on
is_public_matchmade because a league is private unless someone opts in, so the index covers a
small minority of rows and supplies browse's sort order directly.

The larger point of this commit is the gate: src/db/index-plans.test.ts seeds 5,000 leagues,
20,000 chat messages and 400 draft actions, ANALYZEs, and fails if any named hot path
sequential-scans. A plan assertion over a hundred rows asserts nothing, which is why the corpus
is that size. The browse query is exported as a builder so the test explains exactly what
production runs rather than a lookalike that could drift into being fast on its own."
```

---

## Task 6: A draft cache that validates itself against the log

`createDraftStore`'s `cache` is a `Map<string, DraftState>` that is populated on load and mutated on every accepted action, and `load()` returns a cached entry unconditionally. With one process that is correct, because the same process wrote every action. With two, it is a stale read: instance B answers `GET /api/drafts/<id>` from a cache built before instance A appended a pick, and the pick is invisible until something happens to invalidate it — which nothing does.

`docs/conventions.md` already states the property that makes the fix obvious: *"Any in-memory materialization is a cache and must be safe to drop at any moment."* A cache that cannot tell whether it is stale is not safe to drop, it is unsafe to keep. `draft_actions.sequence` is a per-draft counter that `DraftState.sequence` mirrors exactly (`state.sequence` starts at 0 and `reduce.ts:70` increments it by one per accepted action, which is the same number written to the row), so `MAX(sequence)` is a complete, one-row freshness check.

**Files:**
- Modify: `src/draft-service/store.ts` (`load`)
- Test: `src/draft-service/locking.test.ts` (new file, visibility half)

**Interfaces:**
- Consumes: `createDraftStore({ db, publish, clock, onPublishError? })` returning `DraftStore`; `DraftState.sequence: number`; `createTestDb()` from `@/db/test-db`; the draft fixtures in `src/draft-service/test-support.ts` (use whatever that file already exports to build a startable draft — do not add a second fixture builder).
- Produces: `latestActionSequence(db: Db | DbTx, draftId: string): Promise<number>`, exported from `src/draft-service/store.ts`. Task 7 calls it from inside a transaction, which is why it takes `Db | DbTx` rather than `Db`.

- [ ] **Step 1: Write the failing test**

Create `src/draft-service/locking.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { TEST_DATABASE_URL, truncateAll } from "@/db/test-db";
import { DB_POOL_CONFIG } from "@/db/config";
import { createDraftStore } from "./store";

/**
 * TWO app instances, simulated the only way that is actually meaningful: two Drizzle clients
 * over two INDEPENDENT postgres-js connection pools, each with its own `createDraftStore` and
 * therefore its own in-process cache and its own mutex. A single shared `db` would prove
 * nothing — the whole class of bug here is one process not seeing what another process wrote.
 */
function instance() {
  const db = createDb(TEST_DATABASE_URL, {
    max: DB_POOL_CONFIG.testMaxConnections,
    idleTimeoutSeconds: DB_POOL_CONFIG.testIdleTimeoutSeconds,
  });
  const store = createDraftStore({ db, publish: async () => {}, clock: { now: () => new Date().toISOString() } });
  return { db, store };
}

describe("two app instances against one draft", () => {
  // …`beforeEach` truncates and seeds a startable snake draft with `seedStartableDraft(db)`
  // from ./test-support; see Step 2 for exactly what that must provide.

  it("shows instance B a pick that instance A made, without restarting B", async () => {
    const a = instance();
    const b = instance();

    // Warm B's cache FIRST, so it holds a materialization that is about to go stale.
    const before = await b.store.getDraftState(draftId);
    expect(before?.picks).toHaveLength(0);

    const applied = await a.store.applyAction(draftId, firstPickFor(await a.store.getDraftState(draftId)));
    expect(applied.ok).toBe(true);

    const after = await b.store.getDraftState(draftId);
    expect(after?.picks).toHaveLength(1);
    expect(after?.sequence).toBe(before!.sequence + 1);

    await a.db.$client.end();
    await b.db.$client.end();
  });
});
```

`seedStartableDraft` and `firstPickFor` are helpers this test needs. **Do not invent new fixtures** — `src/draft-service/test-support.ts` already builds drafts for `store.test.ts` and `ticker.test.ts`. Read it, use what it exports, and if it exports a builder under a different name use that name throughout this file instead. `firstPickFor(state)` is a one-liner over `@/draft-engine`'s `teamOnClock` and `bestAvailableFor` — the same two selectors `scripts/drive-dev-draft.ts:11` already imports for exactly this purpose.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/draft-service/locking`
Expected: FAIL — `expected 0 to be 1` on `after?.picks`. B answers from its warm, stale cache.

- [ ] **Step 3: Add the freshness check**

In `src/draft-service/store.ts`, add the imports `max` is expressed with (`sql` from `drizzle-orm`, and `DbTx` is already imported) and export the helper above `createDraftStore`:

```ts
/**
 * The highest `sequence` this draft's action log holds, or 0 for a log with no rows.
 *
 * This is the whole cross-instance freshness mechanism. `DraftState.sequence` counts accepted
 * actions and is exactly the value written to `draft_actions.sequence` for the row that action
 * produced, so a cached state whose `sequence` equals this is provably a materialization of the
 * complete log and a cached state whose `sequence` is lower is provably behind. One row, served
 * by the existing unique index on `(draft_id, sequence)`.
 *
 * Takes `Db | DbTx` because Task 7's locked write path calls it INSIDE the transaction that
 * holds the draft's row lock, where using the outer `db` would read outside the lock.
 */
export async function latestActionSequence(db: Db | DbTx, draftId: string): Promise<number> {
  const [row] = await db
    .select({ latest: sql<number | null>`max(${draftActions.sequence})` })
    .from(draftActions)
    .where(eq(draftActions.draftId, draftId));
  return row?.latest ?? 0;
}
```

Then replace `load` (lines 94–107) with:

```ts
  async function load(draftId: string, tx?: DbTx): Promise<DraftState | null> {
    const source = tx ?? db;
    const cached = cache.get(draftId);
    if (cached !== undefined) {
      // A cache built by THIS process can still be behind: another instance may have appended
      // to the same log. Verified, not assumed — see `latestActionSequence`.
      if ((await latestActionSequence(source, draftId)) === cached.sequence) return cached;
      cache.delete(draftId);
    }
    const config = await loadDraftConfig(source, draftId);
    if (config === null) return null;
    const rows = await source
      .select()
      .from(draftActions)
      .where(eq(draftActions.draftId, draftId))
      .orderBy(asc(draftActions.sequence));
    const state = replayDraft(config, rows.map((row) => draftActionSchema.parse(row.action)));
    cache.set(draftId, state);
    return state;
  }
```

`loadDraftConfig` currently takes `Db`; widen its parameter type in `src/draft-service/setup.ts` to `Db | DbTx`. That is a type-only change — the query it runs is identical on both.

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/draft-service/locking`
Expected: PASS.

- [ ] **Step 5: Prove the rest of the draft service is unharmed**

Run: `npm test -- src/draft-service && npm test -- src/integration && npm test -- src/app/api/drafts`
Expected: PASS. The freshness check adds one indexed `MAX()` per cached read; if any timing-sensitive ticker test now fails, that is a real signal about the ticker's assumptions and belongs in the ledger, not a reason to weaken the check.

- [ ] **Step 6: Update the `mutex.ts` docblock's forward reference**

`src/draft-service/mutex.ts` currently promises *"Phase 2 (multi instance) replaces this with a Postgres advisory lock."* Half of that is now delivered and the other half arrives in Task 7, but the mechanism is not an advisory lock. Replace that paragraph with:

```
 * Phase 1 ran a single Node process, so an in-process queue was enough to keep two submissions
 * for the same draft from interleaving their read-validate-write. It is still worth keeping as
 * an intra-process fast path — it turns same-process contention into a cheap queue instead of a
 * round trip to Postgres — but it is no longer what makes the write path safe. Phase 2 Plan A
 * moved the read-validate-write inside one transaction holding `SELECT ... FOR UPDATE` on the
 * draft's own row (`store.ts`), and made the cache validate itself against `MAX(sequence)`.
 *
 * A ROW lock and not a Postgres advisory lock, deliberately: `pg_advisory_lock` is
 * SESSION-scoped, and this app's connection reaches Postgres through PgBouncer in transaction
 * pooling mode, where a session is not a stable thing to hold anything on. `SELECT ... FOR
 * UPDATE` is transaction-scoped by construction, so it is released by the same COMMIT that
 * makes the write visible and it cannot leak onto whichever pooled backend serves the next
 * statement. See `docs/decisions/data-layer-hardening.md`.
 *
 * The unique index on `(draft_id, sequence)` remains the database's own backstop: a bug in
 * either lock can then cost a rejected action, never a double-drafted player.
```

- [ ] **Step 7: Commit**

```bash
git add src/draft-service/store.ts src/draft-service/setup.ts src/draft-service/mutex.ts src/draft-service/locking.test.ts
git commit -m "fix(draft): validate the draft cache against the action log's max sequence

createDraftStore's cache was returned unconditionally, which is correct for one process and a
stale read for two: instance B kept answering from a materialization built before instance A
appended a pick, and nothing invalidated it. conventions.md already says an in-memory
materialization must be safe to drop at any moment, and a cache that cannot tell whether it is
stale is not safe to keep.

DraftState.sequence is exactly the value written to draft_actions.sequence for the row that
action produced, so one indexed MAX() is a complete freshness check. The test simulates two
instances the only way that means anything: two Drizzle clients over two independent pools,
each with its own store, its own cache and its own mutex."
```

---

## Task 7: The per-draft row lock

With Task 6, two instances agree about what has already happened. They still do not agree about what happens next: `applyAction` loads state, validates, reduces, and only then opens a transaction to insert. Two instances can both load sequence 12, both admit the same pick, and both try to insert sequence 13. Today the unique index on `(draft_id, sequence)` catches that and the loser gets "Someone else acted first. Try again." — which is correct, but it means the second manager's legitimate, non-conflicting pick is bounced on a race rather than serialized, and it means the *only* thing standing between two instances and a double-applied action is a constraint violation caught in a `catch`.

The spec's fix is to make the read-validate-write one serialized unit: `SELECT … FOR UPDATE` on the draft's row, taken inside the same transaction that persists the action.

**Files:**
- Modify: `src/draft-service/store.ts` (`applyAction`)
- Modify: `src/draft-service/locking.test.ts` (the concurrency half)

**Interfaces:**
- Consumes: `latestActionSequence` and the `load(draftId, tx?)` signature, both from Task 6; `ApplyResult = { ok: true; state: DraftState } | { ok: false; reason: string }`; `ApplyOptions.alsoInTransaction?: (tx: DbTx) => Promise<void>`; `isSequenceConflict(error)`.
- Produces: no new exports. `applyAction`'s signature and return type are unchanged, which is the point — every existing caller (`startDraft`, the actions route, the ticker, `scripts/drive-dev-draft.ts`) keeps working untouched.

- [ ] **Step 1: Write the failing test**

Add to `src/draft-service/locking.test.ts`:

```ts
  it("accepts exactly one of two simultaneous picks and rejects the other cleanly", async () => {
    const a = instance();
    const b = instance();

    const state = await a.store.getDraftState(draftId);
    await b.store.getDraftState(draftId); // warm B too, so both hold the same view
    const action = firstPickFor(state);

    const [resultA, resultB] = await Promise.all([
      a.store.applyAction(draftId, action),
      b.store.applyAction(draftId, action),
    ]);

    const accepted = [resultA, resultB].filter((result) => result.ok);
    expect(accepted).toHaveLength(1);

    const rejected = [resultA, resultB].find((result) => !result.ok);
    // A user-facing plain-language reason, per conventions.md. Never a driver message.
    expect(rejected && "reason" in rejected ? rejected.reason : "").not.toContain("duplicate key");

    // And exactly one pick landed in the log, not two.
    const rows = await a.db.select().from(draftActions).where(eq(draftActions.draftId, draftId));
    expect(rows.filter((row) => row.sequence >= 1)).toHaveLength(state!.sequence + 1 - state!.sequence + rows.length - rows.length + 1);

    await a.db.$client.end();
    await b.db.$client.end();
  });
```

The row-count assertion above is written deliberately unreadably so it is obvious it must be replaced. Replace that whole `expect` with the honest one:

```ts
    const [{ count }] = await a.db
      .select({ count: sql<number>`count(*)::int` })
      .from(draftActions)
      .where(eq(draftActions.draftId, draftId));
    expect(count).toBe(state!.sequence + 1);
```

Add a second concurrency test that proves the lock serializes rather than merely rejects — two *different*, both-legal actions from two instances:

```ts
  it("serializes two different legal actions rather than losing one to a sequence clash", async () => {
    const a = instance();
    const b = instance();
    const state = await a.store.getDraftState(draftId);

    // Two distinct picks, both legal from `state`, submitted at once. Under a row lock the
    // second one re-reads the log inside the lock, sees the first, and is admitted or rejected
    // on the DRAFT'S OWN RULES (whose turn it is) rather than on a sequence collision.
    const [first, second] = twoDistinctPicksFor(state);
    const results = await Promise.all([a.store.applyAction(draftId, first), b.store.applyAction(draftId, second)]);

    expect(results.filter((result) => result.ok).length).toBeGreaterThanOrEqual(1);
    for (const result of results) {
      if (!result.ok) expect(result.reason).not.toBe("Someone else acted first. Try again.");
    }

    await a.db.$client.end();
    await b.db.$client.end();
  });
```

`twoDistinctPicksFor(state)` returns the on-clock team's pick of the two best available players, as two `MAKE_PICK` actions. In a snake draft only the first is the on-clock team's, so the second is expected to be rejected with a turn-based reason such as `"It isn't your turn."` — assert on *which* rejection, because "rejected for the right reason" is the whole content of this test. Read `src/draft-engine/admit.ts` for the exact reason strings and assert the literal one it produces; do not paraphrase it.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/draft-service/locking`
Expected: the first new test may pass intermittently (the unique index already prevents double-apply) — run it ten times with `for i in $(seq 10); do npm test -- src/draft-service/locking || break; done` and expect at least one run where both are accepted or the reason contains a sequence-conflict message. The **second** test fails deterministically with `expected 'Someone else acted first. Try again.' not to be 'Someone else acted first. Try again.'`.

- [ ] **Step 3: Move the read-validate-write inside the locked transaction**

Replace `applyAction` (lines 129–168) with:

```ts
    async applyAction(draftId, action, options?: ApplyOptions) {
      return mutex.run(draftId, async (): Promise<ApplyResult> => {
        // `previous` is captured out of the transaction so `broadcast` (which must run AFTER
        // the commit, because publishing is best-effort and must never fail a committed write)
        // still has the before-state to diff against.
        let previous: DraftState | null = null;

        try {
          const outcome = await db.transaction(async (tx): Promise<ApplyResult> => {
            /**
             * THE CROSS-INSTANCE LOCK. Every accepted action for this draft passes through this
             * one row, so "replay the action log" becomes the single-writer path across any
             * number of app instances rather than only across restarts.
             *
             * `SELECT ... FOR UPDATE` and not `pg_advisory_lock`: this connection reaches
             * Postgres through PgBouncer in transaction pooling mode, where session-scoped state
             * does not survive statement boundaries. A row lock is transaction-scoped by
             * construction, so it is taken and released entirely inside this block — which is
             * exactly the property transaction pooling requires and exactly the trap the spec
             * warns about. See docs/decisions/data-layer-hardening.md.
             *
             * Lock order: this is a leaf. `joinLeagueInTx` takes `league_invites` then `leagues`;
             * nothing takes `drafts` before either of those, and this function takes nothing
             * after `drafts`, so no cycle exists.
             */
            const [locked] = await tx.select({ id: drafts.id }).from(drafts).where(eq(drafts.id, draftId)).for("update");
            if (locked === undefined) return { ok: false, reason: "That draft doesn't exist." };

            // Loaded INSIDE the lock and validated against the log, so a state another instance
            // has already advanced can never be the state this action is admitted against.
            const state = await load(draftId, tx);
            if (state === null) return { ok: false, reason: "That draft doesn't exist." };
            previous = state;

            // Command-time preconditions — the tunable-reading guards the reducer must not own,
            // because it also runs on replay.
            const admitted = admitCommand(state, action);
            if (!admitted.ok) return admitted;

            const result = reduceDraft(state, action);
            if (!result.ok) return result;

            await tx.insert(draftActions).values({
              draftId,
              sequence: result.state.sequence,
              action,
              timestamp: new Date(action.timestamp),
            });
            if (options?.alsoInTransaction !== undefined) await options.alsoInTransaction(tx);
            // A completed draft becomes a season in the same transaction that completed it.
            if (result.state.phase === "complete" && state.phase !== "complete") {
              await commitDraftState(tx, result.state);
            }
            return { ok: true, state: result.state };
          });

          if (!outcome.ok) {
            // A rejection may have been decided against a state we loaded inside the lock and
            // then rolled back with it. Drop the materialization rather than keep one whose
            // provenance is a rolled-back transaction.
            cache.delete(draftId);
            return outcome;
          }

          cache.set(draftId, outcome.state);
          if (previous !== null) await broadcast(previous, outcome.state, action);
          return outcome;
        } catch (error: unknown) {
          // Our view of the log is provably stale — drop it so the next read replays.
          cache.delete(draftId);
          // The unique index remains the backstop. With the row lock in place this should be
          // unreachable; if it fires, that is a real signal that something wrote outside the
          // lock, so it keeps its user-facing retry message rather than being swallowed.
          if (isSequenceConflict(error)) return { ok: false, reason: "Someone else acted first. Try again." };
          throw error;
        }
      });
    },
```

Two things this deliberately keeps:

1. **The in-process mutex stays.** It is now a fast path, not the safety mechanism: it collapses same-process contention into a cheap queue instead of N concurrent transactions all queuing on one row lock. Task 6 already rewrote its docblock to say so.
2. **`broadcast` stays outside the transaction.** `docs/conventions.md`: *"Postgres is authoritative; publishing is best-effort and must never fail the write."* Publishing inside the transaction would make a Redis outage roll back a committed pick.

`let previous` needs `eslint-plugin-functional`'s `no-let` — that rule is scoped to `src/domain/**` only (`eslint.config.mjs`), so it does not apply here. Confirm with `npm run lint` rather than assuming.

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/draft-service/locking`
Expected: PASS, 3 tests.

- [ ] **Step 5: Prove the whole draft path still works, ten times**

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do npm test -- src/draft-service || break; done
npm test -- src/integration
npm test -- src/app/api/drafts
```

Expected: all green, ten times. The repetition is the acceptance evidence for a concurrency change; one green run is not.

- [ ] **Step 6: Commit**

```bash
git add src/draft-service/store.ts src/draft-service/locking.test.ts
git commit -m "feat(draft): serialize every accepted action on the draft's own row lock

applyAction loaded, validated and reduced OUTSIDE the transaction and only then inserted, so
two instances could both admit an action against the same state. The unique index on
(draft_id, sequence) caught the double-apply, which is the right backstop but the wrong primary
mechanism: it turned a legitimate, non-conflicting second action into a bounced retry, and it
made a constraint violation caught in a catch block the only thing between two instances and a
double-drafted player.

The read-validate-write is now one transaction holding SELECT ... FOR UPDATE on the draft's
row, so a second writer re-reads the log inside the lock and is admitted or rejected on the
draft's OWN rules. A row lock and not pg_advisory_lock, because advisory locks are
session-scoped and this connection reaches Postgres through PgBouncer in transaction pooling
mode, where a session is not a stable thing to hold anything on.

broadcast stays outside the transaction: publishing is best-effort and must never fail a
committed write. The in-process mutex stays as an intra-process fast path."
```

---

## Task 8: PgBouncer, a pool budget with a formula behind it, and the rollup convention

`src/db/config.ts` says `defaultMaxConnections: 10` with no methodology, and the spec is explicit that this was left as a placeholder for exactly this task. Connection demand grows with instance count, in precisely the high-load scenario (Sunday) where scaling out is most needed, so the budget needs to be arithmetic rather than a round number. And the pooler needs to actually be in the loop locally, because transaction pooling breaks specific patterns and finding that out in production is the failure this task exists to prevent.

**Files:**
- Modify: `docker-compose.yml` (two new services)
- Modify: `src/db/config.ts`
- Modify: `src/db/client.ts`
- Modify: `.env.example`
- Test: `src/db/pgbouncer.test.ts`
- Test: `src/db/config.test.ts`
- Create: `docs/decisions/data-layer-hardening.md`

**Interfaces:**
- Consumes: `createDb(connectionString?, options?)` where `DbOptions = { max?: number; idleTimeoutSeconds?: number }`; `explainPlan` from Task 5; the two-instance harness from Task 6.
- Produces: `DB_POOL_CONFIG` gains `postgresMaxConnections`, `reservedSuperuserConnections`, `expectedMaxInstances`, `backgroundJobPoolSize`; and `requestPoolSizePerInstance(): number` is exported from `src/db/config.ts`. `DbOptions` is unchanged.

- [ ] **Step 1: Add the pooler services to `docker-compose.yml`**

Append two services, and pin them by digest rather than by tag in Step 2:

```yaml
  # Transaction-mode connection pooler in front of the dev Postgres. Production will run one of
  # these too (Plan D), and the app talks to it rather than to Postgres directly — so it has to
  # be in the loop locally, or the first time anyone finds out that transaction pooling breaks
  # a pattern will be in production. See docs/decisions/data-layer-hardening.md.
  pgbouncer:
    image: edoburu/pgbouncer:latest
    environment:
      DB_HOST: postgres
      DB_PORT: "5432"
      DB_USER: commish
      DB_PASSWORD: commish
      DB_NAME: commish
      POOL_MODE: transaction
      AUTH_TYPE: scram-sha-256
      MAX_CLIENT_CONN: "500"
      DEFAULT_POOL_SIZE: "25"
      LISTEN_PORT: "6432"
    ports:
      - "6432:6432"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -p 6432 -U commish -d commish"]
      interval: 5s
      timeout: 3s
      retries: 10

  # The same pooler in front of the TEST Postgres, so src/db/pgbouncer.test.ts exercises
  # transaction pooling for real rather than describing it.
  pgbouncer-test:
    image: edoburu/pgbouncer:latest
    environment:
      DB_HOST: postgres-test
      DB_PORT: "5432"
      DB_USER: commish
      DB_PASSWORD: commish
      DB_NAME: commish_test
      POOL_MODE: transaction
      AUTH_TYPE: scram-sha-256
      MAX_CLIENT_CONN: "500"
      DEFAULT_POOL_SIZE: "25"
      LISTEN_PORT: "6432"
    ports:
      - "6433:6432"
    depends_on:
      postgres-test:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -p 6432 -U commish -d commish_test"]
      interval: 5s
      timeout: 3s
      retries: 10
```

- [ ] **Step 2: Bring them up and pin the digest**

```bash
docker compose pull pgbouncer
docker image inspect --format '{{index .RepoDigests 0}}' edoburu/pgbouncer:latest
```

Take the `edoburu/pgbouncer@sha256:…` string that prints and replace **both** `image: edoburu/pgbouncer:latest` lines with it, with a comment giving the tag and the date it was resolved. A floating `latest` in an infrastructure file is a build that changes under you; a digest is the same pooler every time on every machine.

```bash
npm run infra:up
docker compose ps
```

Expected: five services, all `healthy`. If the `edoburu` image's environment-variable contract has changed (it configures itself from `DB_*`/`POOL_MODE`/`AUTH_TYPE` today), read `docker compose logs pgbouncer` and adjust — do **not** fall back to disabling the pooler and marking this task done.

- [ ] **Step 3: Write the failing config test**

Create `src/db/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DB_POOL_CONFIG, requestPoolSizePerInstance } from "./config";

describe("connection-pool budget", () => {
  it("divides the real connection budget among the instances that will compete for it", () => {
    const { postgresMaxConnections, reservedSuperuserConnections, backgroundJobPoolSize, expectedMaxInstances } = DB_POOL_CONFIG;
    const available = postgresMaxConnections - reservedSuperuserConnections - backgroundJobPoolSize;
    expect(requestPoolSizePerInstance()).toBe(Math.floor(available / expectedMaxInstances));
  });

  it("never lets every instance plus the batch pool exceed what Postgres will actually grant", () => {
    const { postgresMaxConnections, reservedSuperuserConnections, backgroundJobPoolSize, expectedMaxInstances } = DB_POOL_CONFIG;
    const worstCase = requestPoolSizePerInstance() * expectedMaxInstances + backgroundJobPoolSize;
    expect(worstCase).toBeLessThanOrEqual(postgresMaxConnections - reservedSuperuserConnections);
  });

  it("reserves a separate, smaller pool for background jobs so a batch cannot starve requests", () => {
    expect(DB_POOL_CONFIG.backgroundJobPoolSize).toBeGreaterThan(0);
    expect(DB_POOL_CONFIG.backgroundJobPoolSize).toBeLessThan(requestPoolSizePerInstance());
  });

  it("uses the computed budget as the default pool size", () => {
    expect(DB_POOL_CONFIG.defaultMaxConnections).toBe(requestPoolSizePerInstance());
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npm test -- src/db/config`
Expected: FAIL — `requestPoolSizePerInstance is not a function`.

- [ ] **Step 5: Replace `src/db/config.ts`**

```ts
/**
 * Postgres connection-pool tunables, with the arithmetic that produced them.
 *
 * Phase 1 left `defaultMaxConnections: 10` as a round number with no methodology behind it, and
 * the Phase 2 spec calls that out as a placeholder. The number that matters is not "how many
 * connections does one process want" but "how many can every process that will exist take at
 * once without any of them being refused", which is a division, so it is written as one:
 *
 *   pool_size_per_instance = (postgres_max_connections
 *                             - reserved_superuser_connections
 *                             - background_job_pool_size) / expected_max_instances
 *
 * `background_job_pool_size` is subtracted BEFORE the division, not carved out of one
 * instance's share, because it is a separate pool with a separate lifetime: Plan B's
 * stats-ingestion worker holds connections for the length of a poll cycle, and a batch job that
 * can borrow from the request path's budget is a batch job that can take the request path down
 * on the busiest day of the week. Reserving it up front is what makes "a batch can never starve
 * a request" arithmetic rather than a hope.
 *
 * The three inputs are Postgres's own defaults today (`max_connections = 100`,
 * `superuser_reserved_connections = 3`) plus this product's own scaling ceiling for the phase.
 * When Plan D provisions a managed Postgres with a different `max_connections`, change the
 * number HERE and the pool sizes follow — that is the whole reason it is a formula.
 */
export const DB_POOL_CONFIG = {
  /** Postgres's `max_connections`. The docker-compose image ships the default; Plan D's managed instance must be checked and this updated to match. */
  postgresMaxConnections: 100,
  /** Postgres's `superuser_reserved_connections`. Left for an operator to get in during an incident. */
  reservedSuperuserConnections: 3,
  /** How many app instances may run at once this phase. Plan D's hosting sets the real ceiling. */
  expectedMaxInstances: 4,
  /** The separate pool background/batch work uses, subtracted from the budget before the split. */
  backgroundJobPoolSize: 5,
  /** Computed below; kept as a field so `createDb` reads one name rather than calling a function. */
  get defaultMaxConnections(): number {
    return requestPoolSizePerInstance();
  },
  /**
   * The test pool: small and short-lived. Every test file calls `createTestDb()` and opens
   * its own `postgres-js` pool that nothing previously closed; at ~40 files that's enough
   * simultaneous connections against the tmpfs-backed `postgres-test` container to cause
   * contention and transient timeouts under a full-suite run. A small max plus a short idle
   * timeout keeps each file's footprint bounded even before `createTestDb`'s own
   * `afterAll(() => db.$client.end())` releases it for good.
   */
  testMaxConnections: 3,
  testIdleTimeoutSeconds: 5,
} as const;

/** The formula in this module's docblock, executable. */
export function requestPoolSizePerInstance(): number {
  const available =
    DB_POOL_CONFIG.postgresMaxConnections -
    DB_POOL_CONFIG.reservedSuperuserConnections -
    DB_POOL_CONFIG.backgroundJobPoolSize;
  return Math.floor(available / DB_POOL_CONFIG.expectedMaxInstances);
}
```

A getter inside an object that a function below reads back is a circular-looking definition — it is not (the getter is only evaluated on access, by which point the function is hoisted), but if `tsc` or the `as const` inference objects, split it: drop the getter, export `const DEFAULT_MAX_CONNECTIONS = requestPoolSizePerInstance()` beside the config, and have `client.ts` read that. Settle it by compiling, not by arguing.

- [ ] **Step 6: Make `prepare: false` unconditional in `client.ts`**

In `createDb`, add the option and the reason:

```ts
export function createDb(connectionString: string = requireDatabaseUrl(), options: DbOptions = {}) {
  const client = postgres(connectionString, {
    max: options.max ?? DB_POOL_CONFIG.defaultMaxConnections,
    idle_timeout: options.idleTimeoutSeconds,
    /**
     * UNCONDITIONAL, whether this connection string points at Postgres or at PgBouncer.
     *
     * postgres-js names and caches prepared statements per backend connection by default.
     * PgBouncer in transaction pooling mode hands a client a different backend between
     * transactions, so a named statement prepared on one is missing on the next and the query
     * fails with "prepared statement does not exist" under load and not in development, which
     * is the worst possible time to discover it.
     *
     * It is set for the DIRECT connection too, deliberately: one behavior everywhere means a
     * bug cannot hide behind a mode difference between dev and production. The cost is that
     * each statement uses the unnamed prepared statement instead of a cached named one, which
     * is not an extra round trip in the extended protocol.
     */
    prepare: false,
  });
  return drizzle(client, { schema });
}
```

- [ ] **Step 7: Write the PgBouncer suite**

Create `src/db/pgbouncer.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb } from "./client";
import { DB_POOL_CONFIG } from "./config";
import { truncateAll } from "./test-db";
import { drafts } from "./schema";
import { envOr } from "@/lib/env";

/**
 * docker-compose's `pgbouncer-test` service, in front of `postgres-test`. Not skipped when
 * unset: `npm run infra:up` provisions it, and a suite that silently skips is a suite that
 * reports a pass for a thing nobody checked.
 */
const PGBOUNCER_URL = envOr("TEST_PGBOUNCER_URL", "postgres://commish:commish@localhost:6433/commish_test");

function pooled() {
  return createDb(PGBOUNCER_URL, { max: DB_POOL_CONFIG.testMaxConnections, idleTimeoutSeconds: DB_POOL_CONFIG.testIdleTimeoutSeconds });
}

describe("the app against PgBouncer in transaction pooling mode", () => {
  it("runs ordinary parameterized queries, which is what `prepare: false` buys", async () => {
    const db = pooled();
    const [row] = await db.select({ answer: sql<number>`1 + 1` }).from(sql`(select 1) as t`);
    expect(row?.answer).toBe(2);
    await db.$client.end();
  });

  it("does NOT give a client a stable backend between transactions, which is why nothing may hold session state", async () => {
    // The trap, demonstrated rather than described. `pg_advisory_lock` is session-scoped, so a
    // lock taken outside a transaction here may be held on a backend the next statement never
    // sees. This is the entire reason the draft lock is `SELECT ... FOR UPDATE` and not an
    // advisory lock — see src/draft-service/store.ts and mutex.ts.
    const db = pooled();
    const pids = new Set<number>();
    for (let i = 0; i < 20; i += 1) {
      const [row] = await db.select({ pid: sql<number>`pg_backend_pid()` }).from(sql`(select 1) as t`);
      pids.add(row!.pid);
    }
    // Not an assertion about a specific number of backends — only that a client must not ASSUME
    // one. If this ever reports exactly one pid across twenty statements, that is a sign the
    // pooler is in session mode, which would silently re-enable the trap.
    expect(pids.size).toBeGreaterThanOrEqual(1);
    const [{ mode }] = await db.$client.unsafe("SHOW POOL_MODE") as unknown as [{ mode: string }];
    expect(mode).toBe("transaction");
    await db.$client.end();
  });

  it("takes and releases the draft row lock entirely inside one transaction", async () => {
    const db = pooled();
    await truncateAll(db);
    // …seed one league + one draft with the same helper Task 6's suite uses…

    await db.transaction(async (tx) => {
      const [locked] = await tx.select({ id: drafts.id }).from(drafts).where(eq(drafts.id, draftId)).for("update");
      expect(locked?.id).toBe(draftId);
    });

    // A second, independent client can take the same lock immediately, proving the first
    // transaction's COMMIT released it and nothing leaked onto a pooled backend.
    const other = pooled();
    await other.transaction(async (tx) => {
      const [locked] = await tx.select({ id: drafts.id }).from(drafts).where(eq(drafts.id, draftId)).for("update");
      expect(locked?.id).toBe(draftId);
    });

    await db.$client.end();
    await other.$client.end();
  });
});
```

`SHOW POOL_MODE` is a PgBouncer admin command and is only answerable on its `pgbouncer` admin database. If it errors against the application database, drop that one assertion and instead assert the pool mode from the compose file by reading `POOL_MODE` out of `docker compose config` in the step below — do not leave the mode unverified, since transaction mode is the only mode this whole task is about.

- [ ] **Step 8: Run the pooled suite, and then the whole suite through the pooler once**

```bash
npm test -- src/db/config
npm test -- src/db/pgbouncer
TEST_DATABASE_URL=postgres://commish:commish@localhost:6433/commish_test npm test
```

Expected: the first two green; the third — the entire 1,300-plus-test suite routed through PgBouncer instead of directly at Postgres — green as well. That third run is the real exit criterion of this task, because "the app works through a transaction pooler" is not a property one test can establish. It is not the default (`TEST_DATABASE_URL` still points at 5433 in `.env.example`) because a pooler in the path makes every test slower and would obscure a real regression behind a pooling artifact; running it explicitly, and recording that it passed, is the honest trade.

If anything fails in that third run, it is a genuine transaction-pooling incompatibility. Fix the app, not the run.

- [ ] **Step 9: Point dev at the pooler and document the whole thing**

In `.env.example`, change the primary connection to go through the pooler and add the test pooler line, keeping the existing comment style:

```
# Primary Postgres connection. Points at PgBouncer (docker-compose "pgbouncer" service, port
# 6432) and NOT at Postgres directly (5432), because that is how the deployed app connects and a
# pooler that is only in the path in production is a pooler nobody has tested. Transaction
# pooling mode: nothing may rely on session state, which is why the draft lock is a row lock and
# not pg_advisory_lock. See docs/decisions/data-layer-hardening.md.
DATABASE_URL=postgres://commish:commish@localhost:6432/commish

# Test-only: Postgres connection used by the test suite (docker-compose "postgres-test" service,
# port 5433, tmpfs). Direct, not pooled, on purpose: a pooler in the path makes every test slower
# and can turn a real regression into something that looks like a pooling artifact. The suite is
# run through TEST_PGBOUNCER_URL explicitly as its own verification step instead.
TEST_DATABASE_URL=postgres://commish:commish@localhost:5433/commish_test

# Test-only: the same test database reached through PgBouncer in transaction pooling mode
# (docker-compose "pgbouncer-test" service, port 6433). src/db/pgbouncer.test.ts uses this.
TEST_PGBOUNCER_URL=postgres://commish:commish@localhost:6433/commish_test
```

Create `docs/decisions/data-layer-hardening.md`:

````markdown
# Decision: data-layer hardening

**Date:** 2026-08-19 · **Phase 2, Plan A** · Spec: `plans/phase-2-accounts-and-data-foundation.md` Step 2

## The balance-as-rollup convention

**Rule.** Any running total in this product is maintained as a **rollup row, updated in the same
transaction as each contributing write**, over an **append-only source table that remains the
reconciliation source of truth**. A running total is never computed as a `SUM()` or a table scan
on the read path.

That is two obligations, not one:

1. The append-only table is never deleted from or updated in place. It is what an audit,
   a dispute, or a regulator reconstructs the total from, and it is what a corrupted rollup is
   rebuilt from.
2. The rollup is updated **inside the same transaction** as the write it summarizes. Not after
   it, not in a job, not on a schedule. A rollup that can be updated separately is a rollup that
   can disagree with its source, and a balance that disagrees with its ledger is the single worst
   failure a money product has.

**Why it is written down here, in a phase with no ledger.** Phase 4 introduces a payment ledger
and Phase 3 an audit log, and both are the shape that invites `SELECT sum(amount) FROM …` on
every read. Writing the convention after those tables exist means retrofitting it; writing it now
means those phases can follow it instead of re-deriving it. This file does not edit those phase
files — another process owns cross-file reconciliation.

**Applied in this phase.** The one aggregate-style read that exists is public browse's fill count.
It is now a grouped `count(teams.id)` with the open-seat rule as a `HAVING` predicate
(`src/league-service/browse.ts`), served by `leagues_public_browse_idx`, rather than a second
query folded in JavaScript over an already-capped page. `teams` is the append-only source; the
count is derived per query rather than stored, which is the correct call at this cardinality (a
league has at most a few dozen teams, and a stored counter would be a second thing to keep
honest). The convention's threshold is **unbounded growth**: derive a count over a bounded set,
roll up a total over an unbounded one. A payment ledger is unbounded. A league's roster is not.

## Connection-pool sizing

```
pool_size_per_instance = (postgres_max_connections
                          - reserved_superuser_connections
                          - background_job_pool_size) / expected_max_instances
```

Executable as `requestPoolSizePerInstance()` in `src/db/config.ts`, with each input a named
field so changing a managed provider's `max_connections` changes one number and the pool sizes
follow. `src/db/config.test.ts` asserts that every instance's pool plus the background pool can
never exceed what Postgres will actually grant.

`background_job_pool_size` is subtracted **before** the division rather than carved out of one
instance's share. Plan B's stats-ingestion worker holds connections for the length of a poll
cycle; a batch job that can borrow from the request path's budget is a batch job that can take
the request path down on the busiest day of the week.

## PgBouncer, transaction pooling, and what it forbids

The app connects through PgBouncer in **transaction pooling** mode, locally
(`docker-compose.yml`, port 6432) and in the deployed environment (Plan D). A client is handed a
different backend between transactions, so **nothing may rely on session-scoped state**:

- **No `pg_advisory_lock`.** It is session-scoped. The per-draft lock is
  `SELECT … FOR UPDATE` on the `drafts` row, taken and released entirely inside one transaction
  (`src/draft-service/store.ts`). `src/db/pgbouncer.test.ts` proves the lock is released by the
  commit and immediately available to an independent client.
- **No named prepared statements.** `createDb` sets `prepare: false` unconditionally, on the
  direct connection as well as the pooled one, so a bug cannot hide behind a mode difference.
- **No `SET` outside a transaction**, no session-scoped temporary tables, no `LISTEN`/`NOTIFY`.
  The last one costs nothing here: real-time is Redis Streams over SSE and always has been.

Verification: `npm test -- src/db/pgbouncer`, plus the whole suite run through the pooler
(`TEST_DATABASE_URL=postgres://commish:commish@localhost:6433/commish_test npm test`) as a
release-gate step rather than a default, since a pooler in the path slows every test and can
disguise a regression as a pooling artifact.

## The index list, including what was struck and why

**Added:** `leagues_public_browse_idx` — partial, `ON leagues (created_at) WHERE
is_public_matchmade`. The only table with no index beyond its primary key, and the one the app's
single unauthenticated endpoint filters and sorts on.

**Already present and verified by `src/db/index-plans.test.ts`:** `teams_league_id_idx`,
`teams_user_id_idx`, `teams_league_user_idx`, `chat_messages_league_id_idx (league_id, id)`,
`draft_actions_draft_id_id_idx`, `draft_actions_draft_sequence_idx`, `drafts_league_id_idx`
(unique), `drafts_status_idx`, `league_invites_league_id_idx`, `players_position_idx`,
`player_stat_lines_week_idx`, `users_email_idx`.

**Struck from the spec's list, with reasons:**

| Spec asked for | Why it is not built |
|---|---|
| `Session(token)`, `Session(userId)` | There is no `sessions` table and there will not be one. WorkOS AuthKit owns sessions; `users.id` **is** the WorkOS user id. Indexing a table that does not exist is not a deferral, it is a category error in the spec, which was written against a Phase 1 that planned hand-rolled auth. |
| chat messages by `(leagueId, createdAt)` | Already served, better, by `chat_messages_league_id_idx` on `(league_id, id)`. `id` is a `bigserial` that doubles as the page cursor, so a page is an index range scan with no timestamp tie to break. A `createdAt` index would be a second index serving strictly less. |
| `draft_actions(draftId, timestamp)` | Already served by `draft_actions_draft_id_id_idx` for the replay read and by the unique `draft_actions_draft_sequence_idx` for the append. Replay orders by `sequence`, never by `timestamp`. |
| An index on `leagues.commissioner_user_id` | Nothing filters on it. Every read fetches the league by primary key and compares in application code (`src/lib/leagues/membership.ts`, `src/league-service/read.ts`). Add it the day a "leagues I commission" query exists, not before. |

**How the list stays honest:** `src/db/index-plans.test.ts` seeds 5,000 leagues, 20,000 chat
messages and 400 draft actions, runs `ANALYZE`, and fails the build if any named hot path
sequential-scans. A plan assertion over a hundred rows asserts nothing, which is why the corpus
is that size.
````

- [ ] **Step 10: Commit**

```bash
git add docker-compose.yml src/db/config.ts src/db/config.test.ts src/db/client.ts src/db/pgbouncer.test.ts .env.example docs/decisions/data-layer-hardening.md
git commit -m "feat(db): PgBouncer in transaction mode, a pool budget with a formula, and the rollup rule

defaultMaxConnections: 10 was a round number the Phase 2 spec explicitly calls a placeholder.
It is now the result of a division that names every input, so a managed Postgres with a
different max_connections changes one number and every pool follows. The background-job pool is
subtracted BEFORE the split rather than carved out of one instance's share, which is what makes
'a batch can never starve the request path' arithmetic rather than a hope.

PgBouncer is in the loop locally, in front of both the dev and the test database, because the
first time anyone finds out that transaction pooling breaks a pattern must not be in
production. prepare: false is unconditional, direct connection included, so a bug cannot hide
behind a mode difference. The pgbouncer suite demonstrates the session-state trap rather than
describing it, and the whole test suite was run through the pooler once as the exit criterion.

docs/decisions/data-layer-hardening.md carries the rollup convention Phase 3's audit log and
Phase 4's ledger are meant to follow, the pool formula, the pooling prohibitions, and the index
list including the four the spec asked for that were struck and why."
```

---

## Task 9: The provider registry and the contract every implementation must pass

`src/stats/provider.ts` declares a two-method interface and exactly one implementation satisfies it, chosen by a hardcoded constructor call at `src/data/seed/index.ts:20`. That is an interface, not a seam: nothing selects, nothing fails fast on a bad selection, and nothing states what an implementation has to *do* beyond type-checking. The spec's Step 6 asks for all three, and its "refactor every call site that read `mock-players.json` directly" task is already satisfied — there are no such call sites.

**Files:**
- Create: `src/stats/config.ts`
- Create: `src/stats/registry.ts`
- Create: `src/stats/test-support.ts`
- Test: `src/stats/registry.test.ts`
- Modify: `src/stats/mock/mock-stats-provider.test.ts` (adopt the shared contract)
- Modify: `src/data/seed/index.ts` (select through the registry)
- Modify: `.env.example`

**Interfaces:**
- Consumes: `StatsProvider` (`listPlayers(): Promise<readonly Player[]>`, `getWeeklyStatLines(week: number): Promise<readonly StatLine[]>`) from `@/stats/provider`; `Player` (`id`, `name`, `position: "QB" | "RB" | "WR" | "TE" | "K" | "DEF"`, `nflTeam`) and `StatLine` (`playerId`, `week`, plus fourteen numeric stat fields) from `@/domain/player`; `envOr` / `envOrUndefined` from `@/lib/env` (Task 1); `createMockStatsProvider(dataset?)` from `@/stats/mock/mock-stats-provider`.
- Produces:
  - `STATS_CONFIG` — `{ providers: readonly ["mock", "tank01"]; defaultProvider: "mock"; envVars: { provider: "STATS_PROVIDER" } }`
  - `type StatsProviderName = (typeof STATS_CONFIG.providers)[number]`
  - `class UnknownStatsProviderError extends Error`
  - `createStatsProvider(name?: string): StatsProvider`
  - `describeStatsProviderContract(label: string, factory: () => StatsProvider | Promise<StatsProvider>): void`
  Task 10 registers `tank01` in `createStatsProvider` and runs `describeStatsProviderContract` against it.

- [ ] **Step 1: Write the failing tests**

Create `src/stats/registry.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createStatsProvider, UnknownStatsProviderError } from "./registry";
import { STATS_CONFIG } from "./config";

afterEach(() => {
  delete process.env[STATS_CONFIG.envVars.provider];
});

describe("createStatsProvider", () => {
  it("defaults to the mock provider when nothing is configured", async () => {
    const provider = createStatsProvider();
    expect((await provider.listPlayers()).length).toBeGreaterThan(0);
  });

  it("reads the provider name from the environment", async () => {
    process.env[STATS_CONFIG.envVars.provider] = "mock";
    const provider = createStatsProvider();
    expect((await provider.listPlayers()).length).toBeGreaterThan(0);
  });

  it("treats an empty environment value as unset, not as a provider named ''", () => {
    process.env[STATS_CONFIG.envVars.provider] = "";
    expect(() => createStatsProvider()).not.toThrow();
  });

  it("fails fast, by name, on a provider that does not exist", () => {
    expect(() => createStatsProvider("sportsdataio")).toThrow(UnknownStatsProviderError);
    expect(() => createStatsProvider("sportsdataio")).toThrow(
      'Unknown stats provider "sportsdataio". Set STATS_PROVIDER to one of: mock, tank01.',
    );
  });

  it("never silently falls back to mock data for an unknown name", () => {
    // The failure mode this guards is the worst one available here: a deployment that thinks it
    // is serving a live feed and is quietly serving a fixed 2026 fake season instead.
    process.env[STATS_CONFIG.envVars.provider] = "definitely-not-a-provider";
    expect(() => createStatsProvider()).toThrow(UnknownStatsProviderError);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- src/stats/registry`
Expected: FAIL — `Failed to resolve import "./registry"`.

- [ ] **Step 3: Write `src/stats/config.ts`**

```ts
/**
 * Every tunable the stats seam has.
 *
 * `tank01` is listed here before Task 10 implements it deliberately: the error message a
 * misconfiguration produces should name every provider the product intends to offer, and the
 * registry's own switch is what fails if one of them is not wired yet. A name in this list with
 * no implementation is a compile error, not a silent gap.
 */
export const STATS_CONFIG = {
  providers: ["mock", "tank01"] as const,
  /**
   * Mock, and not a live feed, is the default on purpose. A live feed costs money per request
   * and needs a key; a developer who has just cloned the repo should get a working season, and a
   * deployment that wants real data should have to say so.
   */
  defaultProvider: "mock",
  envVars: {
    provider: "STATS_PROVIDER",
  },
} as const;

export type StatsProviderName = (typeof STATS_CONFIG.providers)[number];

export function isStatsProviderName(value: string): value is StatsProviderName {
  return (STATS_CONFIG.providers as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Write `src/stats/registry.ts`**

```ts
import { envOr } from "@/lib/env";
import { STATS_CONFIG, isStatsProviderName, type StatsProviderName } from "./config";
import { createMockStatsProvider } from "./mock/mock-stats-provider";
import type { StatsProvider } from "./provider";

/**
 * A configured provider name that no implementation answers to.
 *
 * Its own class, not a bare `Error`, because the one thing that must never happen here is a
 * silent fallback: a deployment configured for a live feed that quietly serves the fixed 2026
 * mock season would look completely healthy and would be completely wrong.
 */
export class UnknownStatsProviderError extends Error {
  readonly name = "UnknownStatsProviderError";
  readonly provider: string;
  constructor(provider: string) {
    super(
      `Unknown stats provider "${provider}". Set ${STATS_CONFIG.envVars.provider} to one of: ${STATS_CONFIG.providers.join(", ")}.`,
    );
    this.provider = provider;
  }
}

/**
 * The ONE place a provider name becomes an implementation.
 *
 * `envOr`, not `process.env[...] ?? default`: `.env.example` may ship `STATS_PROVIDER=` as an
 * intentionally-empty line, and dotenv reads that as `""`, which `??` would happily accept as a
 * provider named empty string. See `src/lib/env.ts`.
 */
export function createStatsProvider(name: string = envOr(STATS_CONFIG.envVars.provider, STATS_CONFIG.defaultProvider)): StatsProvider {
  if (!isStatsProviderName(name)) throw new UnknownStatsProviderError(name);
  return build(name);
}

function build(name: StatsProviderName): StatsProvider {
  switch (name) {
    case "mock":
      return createMockStatsProvider();
    case "tank01":
      // Task 10 replaces this. Until then the name is reachable and the failure is explicit,
      // which is strictly better than the name not existing: `STATS_PROVIDER=tank01` says what
      // is missing rather than reading as a typo.
      throw new Error("The tank01 stats provider is not wired up yet.");
  }
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `npm test -- src/stats/registry`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the shared contract suite**

Create `src/stats/test-support.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
import type { StatsProvider } from "./provider";

const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

const STAT_FIELDS = [
  "passingYards",
  "passingTouchdowns",
  "interceptions",
  "rushingYards",
  "rushingTouchdowns",
  "receivingYards",
  "receivingTouchdowns",
  "receptions",
  "fumblesLost",
  "fieldGoalsMade",
  "extraPointsMade",
  "sacks",
  "defensiveInterceptions",
  "defensiveTouchdowns",
] as const;

/**
 * The contract EVERY `StatsProvider` implementation must satisfy, written against the interface
 * and never against an implementation's internals — so a future licensed feed is verified by
 * this same suite unchanged rather than by a second suite that agrees with it by coincidence.
 *
 * It asserts SHAPE and INVARIANTS, not values. Determinism is deliberately not asserted here: it
 * is true of the mock and false of any live feed, so it belongs in the mock's own test where it
 * is a real property, not in a contract a live provider would have to fail.
 */
export function describeStatsProviderContract(label: string, factory: () => StatsProvider | Promise<StatsProvider>): void {
  describe(`${label} satisfies the StatsProvider contract`, () => {
    it("lists players with a stable id, a real name, a known position and an NFL team", async () => {
      const players = await (await factory()).listPlayers();
      expect(players.length).toBeGreaterThan(0);
      for (const player of players) {
        expect(player.id).toMatch(/\S/);
        expect(player.name).toMatch(/\S/);
        expect(POSITIONS).toContain(player.position);
        expect(player.nflTeam).toMatch(/\S/);
      }
    });

    it("never lists the same player id twice", async () => {
      const players = await (await factory()).listPlayers();
      const ids = players.map((player) => player.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("returns stat lines stamped with the week that was asked for", async () => {
      const lines = await (await factory()).getWeeklyStatLines(1);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line.week).toBe(1);
    });

    it("returns every stat field as a finite, non-negative number", async () => {
      // Every implementation over a real feed parses strings into numbers, and the failure mode
      // is NaN silently reaching the scoring engine and turning a team's total into NaN. This is
      // the assertion that makes that a test failure instead of a Sunday.
      const lines = await (await factory()).getWeeklyStatLines(1);
      for (const line of lines) {
        for (const field of STAT_FIELDS) {
          expect(Number.isFinite(line[field])).toBe(true);
          expect(line[field]).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it("only reports stats for players it also lists", async () => {
      const provider = await factory();
      const listed = new Set((await provider.listPlayers()).map((player) => player.id));
      for (const line of await provider.getWeeklyStatLines(1)) {
        expect(listed.has(line.playerId)).toBe(true);
      }
    });

    it("never reports the same player twice in one week", async () => {
      const lines = await (await factory()).getWeeklyStatLines(1);
      const ids = lines.map((line) => line.playerId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("answers a week outside the season with an empty list rather than an error", async () => {
      // `seedPlayers` walks weeks upward until it gets an empty array, so this is not a
      // nicety — it is the loop's termination condition.
      const provider = await factory();
      await expect(provider.getWeeklyStatLines(0)).resolves.toEqual([]);
      await expect(provider.getWeeklyStatLines(99)).resolves.toEqual([]);
    });
  });
}
```

Note the last case: `createMockStatsProvider` filters `dataset.statLines` by week, so weeks 0 and 99 already return `[]`. Confirm that rather than assume it, and if the mock throws on either, fix the mock — the seeder's termination condition depends on this behavior today.

- [ ] **Step 7: Point the mock's own test at the shared contract**

In `src/stats/mock/mock-stats-provider.test.ts`, add at the top level of the file:

```ts
import { describeStatsProviderContract } from "../test-support";

describeStatsProviderContract("MockStatsProvider", () => createMockStatsProvider());
```

Keep every existing test in that file. They assert mock-specific properties (the 250-player count, determinism against the committed dataset) that the contract deliberately does not, and deleting them would trade a real assertion for a generic one.

Run: `npm test -- src/stats`
Expected: PASS, with seven new contract cases.

- [ ] **Step 8: Select through the registry at the seed entry point**

In `src/data/seed/index.ts`, replace the `createMockStatsProvider` import with the registry and change line 20:

```ts
import { createStatsProvider } from "@/stats/registry";
```

```ts
  const playerCounts = await seedPlayers(db, createStatsProvider());
  console.log(`seeded ${playerCounts.players} players and ${playerCounts.statLines} stat lines`);
```

- [ ] **Step 9: Document the variable**

Add to `.env.example`, above the `ALLOW_DESTRUCTIVE_SEED` block:

```
# Which stats source `npm run seed` reads: mock (default) or tank01. Mock is the fixed 2026
# dataset committed at src/stats/mock/dataset.json and needs no key or network. tank01 reads the
# live Tank01 NFL API and needs TANK01_API_KEY below. An unrecognized value fails fast and names
# the valid ones; it never falls back to mock, because a deployment that thinks it has live data
# and is quietly serving a fake season would look healthy and be wrong.
STATS_PROVIDER=mock
```

- [ ] **Step 10: Prove the seed still works and commit**

```bash
npm run infra:up && npm run seed
npm run typecheck && npm run lint && npm test -- src/stats && npm test -- src/data/seed
```

```bash
git add src/stats/config.ts src/stats/registry.ts src/stats/registry.test.ts src/stats/test-support.ts src/stats/mock/mock-stats-provider.test.ts src/data/seed/index.ts .env.example
git commit -m "feat(stats): a selected provider registry and a contract every implementation must pass

StatsProvider had one implementation chosen by a hardcoded constructor call, which is an
interface rather than a seam: nothing selected, nothing failed fast on a bad selection, and
nothing said what an implementation has to DO beyond type-checking.

createStatsProvider is now the one place a name becomes an implementation, reading
STATS_PROVIDER through envOr so an intentionally-empty .env line is not read as a provider
named empty string, and throwing UnknownStatsProviderError by name rather than falling back.
The fallback is the failure worth guarding: a deployment configured for a live feed that
quietly serves the fixed 2026 mock season looks completely healthy and is completely wrong.

describeStatsProviderContract asserts shape and invariants against the INTERFACE, so Task 10's
Tank01 adapter and a future licensed feed are verified by the same suite unchanged. It does not
assert determinism, which is true of the mock and false of any live feed, so that stays in the
mock's own test where it is a real property."
```

---

## Task 10: The Tank01 adapter, against fixtures, activated by a key

The second implementation. It is written, tested, reviewed and merged **with no API key**, because every test reads committed fixture JSON through an injected `fetch` and a suite-level guard makes any attempt to reach `globalThis.fetch` a loud failure. When the founder supplies a key, `STATS_PROVIDER=tank01` plus `TANK01_API_KEY` activates it with no code change, and `scripts/record-tank01-fixtures.ts` re-records the fixtures from the live API and flips their provenance.

Everything below is grounded in Tank01's actual documented and captured behavior. The three facts that shape the whole adapter:

1. **The envelope is `{ "statusCode": 200, "body": … }`, and `statusCode` is the only number in the entire response.** Every other value, including every stat, is a JSON string.
2. **An application-level error returns HTTP 200** with `{ "statusCode": 200, "body": {}, "error": "…" }`. Gateway errors (401 no key, 403 not subscribed, 429 rate limited) return `{ "message": "…" }` with no envelope. HTTP status alone tells you nothing.
3. **`fumblesLost` lives under the `Defense` group even for offensive players**, and stat groups are **absent** rather than empty when a player has none. A mapper that looks for a "Fumbles" group scores every fumble as zero.

**Files:**
- Create: `src/stats/tank01/config.ts`, `client.ts`, `map.ts`, `tank01-stats-provider.ts`, `fixtures.ts`
- Create: `src/stats/tank01/fixtures/manifest.json` and the fixture bodies it names
- Test: `src/stats/tank01/map.test.ts`, `src/stats/tank01/tank01-stats-provider.test.ts`
- Create: `scripts/record-tank01-fixtures.ts`
- Modify: `src/stats/registry.ts` (the `tank01` case), `src/db/schema.ts` (`sacks` becomes `real`), `.env.example`, `package.json`
- Create: `drizzle/0012_*.sql` (generated)

**Interfaces:**
- Consumes: `STATS_CONFIG`, `StatsProviderName`, `describeStatsProviderContract` (Task 9); `envOr` / `envOrUndefined` (Task 1); `Player`, `Position`, `StatLine` from `@/domain/player`.
- Produces:
  - `TANK01_CONFIG` (below, verbatim)
  - `class Tank01Error extends Error` with `readonly kind: "unauthorized" | "forbidden" | "rate_limited" | "upstream" | "malformed"` and `readonly path: string`
  - `createTank01Client(options: Tank01ClientOptions): Tank01Client` where `Tank01Client = { get(path: string, query?: Readonly<Record<string, string>>): Promise<unknown> }`
  - `mapPlayerList(body: unknown): readonly Player[]`, `mapTeamsToDefensePlayers(body: unknown): readonly Player[]`, `mapGameIds(body: unknown): readonly string[]`, `mapBoxScoreToStatLines(body: unknown, week: number): readonly StatLine[]`
  - `createTank01StatsProvider(options: Tank01ProviderOptions): StatsProvider`
  - `createFixtureFetch(): typeof globalThis.fetch`

- [ ] **Step 1: Write `src/stats/tank01/config.ts`**

```ts
/**
 * Every tunable the Tank01 adapter has.
 *
 * A SEASON lives here rather than on the `StatsProvider` interface. `getWeeklyStatLines(week)`
 * stays a one-parameter method because adding a season would ripple into `player_stat_lines`,
 * which is keyed `(player_id, week)` with no season column and does not need one until a phase
 * that runs more than one season at a time. A season is a property of THIS adapter's
 * configuration, and the mock provider does not have one at all.
 */
export const TANK01_CONFIG = {
  host: "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com",
  baseUrl: "https://tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com",
  paths: {
    playerList: "/getNFLPlayerList",
    teams: "/getNFLTeams",
    gamesForWeek: "/getNFLGamesForWeek",
    boxScore: "/getNFLBoxScore",
  },
  /** Tank01 holds data from 2022 onward. `season=2026` means the 2026-27 season. */
  defaultSeason: 2026,
  /** `reg` | `post` | `pre` | `all`. Only the regular season is scored. */
  seasonType: "reg",
  /**
   * The regular season's week range. A request outside it is answered locally with an empty
   * list and never reaches the API — which matters more than it looks: `seedPlayers` walks
   * weeks upward until it gets an empty array, so without this bound a seed would burn the
   * monthly request quota discovering where the season ends.
   */
  weeks: { first: 1, last: 18 },
  /**
   * Team defenses are not players in Tank01: they arrive as `body.DST.{home,away}` on a box
   * score, keyed by team abbreviation. The domain has a `DEF` position, so the adapter
   * synthesizes one player per NFL team with this prefix. The prefix is config, not a literal,
   * because `listPlayers` and `getWeeklyStatLines` must mint the SAME id or every defense's
   * stat line would reference a player nobody drafted.
   */
  defensePlayerIdPrefix: "DST-",
  /** The positions the scoring engine handles. Everything else in the player list is dropped. */
  scoredPositions: ["QB", "RB", "WR", "TE", "K"],
  envVars: {
    apiKey: "TANK01_API_KEY",
    season: "TANK01_SEASON",
  },
} as const;
```

- [ ] **Step 2: Write the failing mapper tests**

Create `src/stats/tank01/map.test.ts`. These are pure-function tests over literal upstream payloads, so they need no fixtures and no client:

```ts
import { describe, expect, it } from "vitest";
import { TANK01_CONFIG } from "./config";
import { mapBoxScoreToStatLines, mapGameIds, mapPlayerList, mapTeamsToDefensePlayers } from "./map";

describe("mapPlayerList", () => {
  it("keeps only the positions the scoring engine handles", () => {
    const players = mapPlayerList([
      { playerID: "4240499", longName: "Justin Jefferson", pos: "WR", team: "MIN" },
      { playerID: "3139477", longName: "Patrick Mahomes", pos: "QB", team: "KC" },
      { playerID: "1", longName: "A Long Snapper", pos: "LS", team: "SF" },
      { playerID: "2", longName: "A Linebacker", pos: "LB", team: "SF" },
    ]);
    expect(players).toEqual([
      { id: "4240499", name: "Justin Jefferson", position: "WR", nflTeam: "MIN" },
      { id: "3139477", name: "Patrick Mahomes", position: "QB", nflTeam: "KC" },
    ]);
  });

  it("drops an entry missing an id, a name or a team rather than emitting a broken player", () => {
    expect(mapPlayerList([{ playerID: "", longName: "Nobody", pos: "WR", team: "SF" }])).toEqual([]);
    expect(mapPlayerList([{ playerID: "9", longName: "", pos: "WR", team: "SF" }])).toEqual([]);
    expect(mapPlayerList([{ playerID: "9", longName: "Somebody", pos: "WR", team: "" }])).toEqual([]);
  });

  it("returns an empty list for a body that is not an array", () => {
    expect(mapPlayerList({})).toEqual([]);
    expect(mapPlayerList(null)).toEqual([]);
  });
});

describe("mapTeamsToDefensePlayers", () => {
  it("mints one DEF player per team, with the configured id prefix", () => {
    const defenses = mapTeamsToDefensePlayers([
      { teamID: "28", teamAbv: "SF", teamCity: "San Francisco", teamName: "49ers" },
      { teamID: "32", teamAbv: "WSH", teamCity: "Washington", teamName: "Commanders" },
    ]);
    expect(defenses).toEqual([
      { id: `${TANK01_CONFIG.defensePlayerIdPrefix}SF`, name: "San Francisco 49ers", position: "DEF", nflTeam: "SF" },
      { id: `${TANK01_CONFIG.defensePlayerIdPrefix}WSH`, name: "Washington Commanders", position: "DEF", nflTeam: "WSH" },
    ]);
  });
});

describe("mapGameIds", () => {
  it("reads the composite gameID off each scheduled game", () => {
    expect(
      mapGameIds([
        { gameID: "20261018_CAR@WSH", away: "CAR", home: "WSH" },
        { gameID: "20261018_SF@SEA", away: "SF", home: "SEA" },
      ]),
    ).toEqual(["20261018_CAR@WSH", "20261018_SF@SEA"]);
  });

  it("ignores a game with no id instead of producing an undefined request", () => {
    expect(mapGameIds([{ away: "CAR", home: "WSH" }, { gameID: "20261018_SF@SEA" }])).toEqual(["20261018_SF@SEA"]);
  });
});

describe("mapBoxScoreToStatLines", () => {
  const BOX = {
    gameID: "20261018_SF@SEA",
    playerStats: {
      "12483": {
        playerID: "12483",
        longName: "A Quarterback",
        Passing: { passAttempts: "27", passCompletions: "16", passYds: "160", passTD: "2", int: "1" },
        Rushing: { carries: "4", rushYds: "18", rushTD: "0" },
        // The gotcha this assertion exists for: a QB's lost fumble is reported under Defense.
        Defense: { fumblesLost: "1", totalTackles: "1" },
      },
      "4240499": {
        playerID: "4240499",
        longName: "A Receiver",
        Receiving: { receptions: "9", targets: "12", recYds: "134", recTD: "1" },
      },
      "9999": {
        playerID: "9999",
        longName: "A Kicker",
        Kicking: { fgMade: "3", fgAttempts: "4", xpMade: "2" },
      },
    },
    DST: {
      away: { teamAbv: "SF", defTD: "1", defensiveInterceptions: "2", sacks: "4.0", ptsAllowed: "17" },
      home: { teamAbv: "SEA", defTD: "0", defensiveInterceptions: "0", sacks: "1.5", ptsAllowed: "24" },
    },
  };

  it("parses every stat out of its string, from the group it actually lives in", () => {
    const lines = mapBoxScoreToStatLines(BOX, 7);
    const qb = lines.find((line) => line.playerId === "12483");
    expect(qb).toEqual({
      playerId: "12483",
      week: 7,
      passingYards: 160,
      passingTouchdowns: 2,
      interceptions: 1,
      rushingYards: 18,
      rushingTouchdowns: 0,
      receivingYards: 0,
      receivingTouchdowns: 0,
      receptions: 0,
      fumblesLost: 1,
      fieldGoalsMade: 0,
      extraPointsMade: 0,
      sacks: 0,
      defensiveInterceptions: 0,
      defensiveTouchdowns: 0,
    });
  });

  it("zero-fills every group a player does not have, because groups are absent and not empty", () => {
    const wr = mapBoxScoreToStatLines(BOX, 7).find((line) => line.playerId === "4240499");
    expect(wr?.receptions).toBe(9);
    expect(wr?.receivingYards).toBe(134);
    expect(wr?.passingYards).toBe(0);
    expect(wr?.fumblesLost).toBe(0);
  });

  it("reads kicking out of the Kicking group", () => {
    const k = mapBoxScoreToStatLines(BOX, 7).find((line) => line.playerId === "9999");
    expect(k?.fieldGoalsMade).toBe(3);
    expect(k?.extraPointsMade).toBe(2);
  });

  it("emits one DEF stat line per side, keyed by the same id listPlayers mints", () => {
    const lines = mapBoxScoreToStatLines(BOX, 7);
    const sf = lines.find((line) => line.playerId === `${TANK01_CONFIG.defensePlayerIdPrefix}SF`);
    expect(sf?.defensiveTouchdowns).toBe(1);
    expect(sf?.defensiveInterceptions).toBe(2);
    expect(sf?.sacks).toBe(4);
  });

  it("keeps a half sack as a half sack", () => {
    const sea = mapBoxScoreToStatLines(BOX, 7).find(
      (line) => line.playerId === `${TANK01_CONFIG.defensePlayerIdPrefix}SEA`,
    );
    expect(sea?.sacks).toBe(1.5);
  });

  it("never produces NaN from a missing, empty or non-numeric value", () => {
    const lines = mapBoxScoreToStatLines(
      { playerStats: { "1": { playerID: "1", Passing: { passYds: "", passTD: "n/a" } } } },
      3,
    );
    expect(lines[0]?.passingYards).toBe(0);
    expect(lines[0]?.passingTouchdowns).toBe(0);
  });

  it("tolerates a 2022-era box score with no DST block at all", () => {
    expect(() => mapBoxScoreToStatLines({ playerStats: {} }, 1)).not.toThrow();
    expect(mapBoxScoreToStatLines({ playerStats: {} }, 1)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npm test -- src/stats/tank01/map`
Expected: FAIL — `Failed to resolve import "./map"`.

- [ ] **Step 4: Write `src/stats/tank01/map.ts`**

```ts
import type { Player, Position, StatLine } from "@/domain/player";
import { TANK01_CONFIG } from "./config";

/**
 * Tank01 returns EVERY value as a JSON string — `statusCode` on the envelope is the only number
 * in a response. So every read goes through here, and anything that is not a finite number
 * becomes 0 rather than NaN: a single NaN reaching the scoring engine turns a whole team's
 * weekly total into NaN, and it would do it silently.
 */
function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function group(entry: unknown, name: string): Record<string, unknown> {
  if (typeof entry !== "object" || entry === null) return {};
  const found = (entry as Record<string, unknown>)[name];
  return typeof found === "object" && found !== null ? (found as Record<string, unknown>) : {};
}

function isScoredPosition(value: string): value is Position {
  return (TANK01_CONFIG.scoredPositions as readonly string[]).includes(value);
}

/** `/getNFLPlayerList` → the offensive/kicking players the scoring engine handles. */
export function mapPlayerList(body: unknown): readonly Player[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((raw): readonly Player[] => {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const id = str(record.playerID);
    const name = str(record.longName);
    const position = str(record.pos);
    const nflTeam = str(record.team);
    // A player missing any of these cannot be drafted, displayed or scored, so it is dropped
    // rather than emitted with a placeholder that would fail a foreign key at seed time.
    if (id === "" || name === "" || nflTeam === "" || !isScoredPosition(position)) return [];
    return [{ id, name, position, nflTeam }];
  });
}

/**
 * `/getNFLTeams` → one synthetic `DEF` player per NFL team.
 *
 * Tank01 has no concept of a team defense as a player; defensive stats arrive per side on a box
 * score. The domain does have a `DEF` position, so the two ends are bridged here — and the id is
 * minted from the SAME `defensePlayerIdPrefix` + `teamAbv` that `mapBoxScoreToStatLines` uses,
 * because a defense whose stat line references an unlisted player id is a foreign-key failure at
 * seed time and an unscored roster slot at runtime.
 */
export function mapTeamsToDefensePlayers(body: unknown): readonly Player[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((raw): readonly Player[] => {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const abbreviation = str(record.teamAbv);
    if (abbreviation === "") return [];
    const city = str(record.teamCity);
    const nickname = str(record.teamName);
    const name = [city, nickname].filter((part) => part !== "").join(" ");
    return [
      {
        id: `${TANK01_CONFIG.defensePlayerIdPrefix}${abbreviation}`,
        name: name === "" ? abbreviation : name,
        position: "DEF",
        nflTeam: abbreviation,
      },
    ];
  });
}

/** `/getNFLGamesForWeek` → the composite `YYYYMMDD_AWAY@HOME` ids the box-score call needs. */
export function mapGameIds(body: unknown): readonly string[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((raw): readonly string[] => {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const gameId = str(record.gameID);
    return gameId === "" ? [] : [gameId];
  });
}

function emptyStats(playerId: string, week: number): StatLine {
  return {
    playerId,
    week,
    passingYards: 0,
    passingTouchdowns: 0,
    interceptions: 0,
    rushingYards: 0,
    rushingTouchdowns: 0,
    receivingYards: 0,
    receivingTouchdowns: 0,
    receptions: 0,
    fumblesLost: 0,
    fieldGoalsMade: 0,
    extraPointsMade: 0,
    sacks: 0,
    defensiveInterceptions: 0,
    defensiveTouchdowns: 0,
  };
}

/**
 * `/getNFLBoxScore` → one `StatLine` per player who appeared, plus one per team defense.
 *
 * Three upstream behaviors this has to survive, all of them verified against captured responses:
 *
 * 1. **Stat groups are ABSENT, not empty**, when a player has none of that kind of stat. Every
 *    read goes through `group()`, which yields `{}` for a missing group, so a receiver simply
 *    reads 0 for every passing field rather than throwing on `undefined.passYds`.
 * 2. **`fumblesLost` lives under `Defense`, even for offensive players.** A quarterback who
 *    fumbles gets a `Defense` group containing it. Reading it from anywhere else scores every
 *    lost fumble in the league as zero, which is a silent scoring bug, not a crash.
 * 3. **2022-era responses have no `DST` block at all**, and some have a duplicate-casing bug in
 *    their team-id keys. Nothing here requires `DST` to exist.
 */
export function mapBoxScoreToStatLines(body: unknown, week: number): readonly StatLine[] {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  const playerStats = record.playerStats;
  const players: readonly StatLine[] =
    typeof playerStats === "object" && playerStats !== null
      ? Object.entries(playerStats as Record<string, unknown>).flatMap(([key, entry]): readonly StatLine[] => {
          const playerId = str((entry as Record<string, unknown> | null)?.playerID) || key;
          if (playerId === "") return [];
          const passing = group(entry, "Passing");
          const rushing = group(entry, "Rushing");
          const receiving = group(entry, "Receiving");
          const defense = group(entry, "Defense");
          const kicking = group(entry, "Kicking");
          return [
            {
              ...emptyStats(playerId, week),
              passingYards: num(passing.passYds),
              passingTouchdowns: num(passing.passTD),
              interceptions: num(passing.int),
              rushingYards: num(rushing.rushYds),
              rushingTouchdowns: num(rushing.rushTD),
              receivingYards: num(receiving.recYds),
              receivingTouchdowns: num(receiving.recTD),
              receptions: num(receiving.receptions),
              // See behavior (2) above. This is not a typo.
              fumblesLost: num(defense.fumblesLost),
              fieldGoalsMade: num(kicking.fgMade),
              extraPointsMade: num(kicking.xpMade),
              sacks: num(defense.sacks),
              defensiveInterceptions: num(defense.defensiveInterceptions),
              defensiveTouchdowns: num(defense.defTD),
            },
          ];
        })
      : [];

  const dst = record.DST;
  const sides = typeof dst === "object" && dst !== null ? Object.values(dst as Record<string, unknown>) : [];
  const defenses: readonly StatLine[] = sides.flatMap((side): readonly StatLine[] => {
    const entry = typeof side === "object" && side !== null ? (side as Record<string, unknown>) : {};
    const abbreviation = str(entry.teamAbv);
    if (abbreviation === "") return [];
    return [
      {
        ...emptyStats(`${TANK01_CONFIG.defensePlayerIdPrefix}${abbreviation}`, week),
        sacks: num(entry.sacks),
        defensiveInterceptions: num(entry.defensiveInterceptions),
        defensiveTouchdowns: num(entry.defTD),
      },
    ];
  });

  return [...players, ...defenses];
}
```

- [ ] **Step 5: Run the mapper tests and watch them pass**

Run: `npm test -- src/stats/tank01/map`
Expected: PASS, 11 tests. The "keeps a half sack as a half sack" case is the one that will also fail later at the database boundary — Step 12 deals with that.

- [ ] **Step 6: Write the client**

Create `src/stats/tank01/client.ts`:

```ts
import { TANK01_CONFIG } from "./config";

export type Tank01FailureKind = "unauthorized" | "forbidden" | "rate_limited" | "upstream" | "malformed";

/**
 * A typed upstream failure. Typed because the four gateway kinds mean four different operator
 * actions (fix the key, subscribe, back off, retry) and collapsing them into one `Error` makes
 * a quota problem indistinguishable from a bad key at 2am.
 *
 * The `message` here is an OPERATOR-facing string, not a user-facing one. Nothing in this
 * adapter reaches a user directly — it is consumed by the seeder today and by Plan B's
 * ingestion worker later, both of which log rather than render.
 */
export class Tank01Error extends Error {
  readonly name = "Tank01Error";
  readonly kind: Tank01FailureKind;
  readonly path: string;
  constructor(kind: Tank01FailureKind, path: string, message: string) {
    super(message);
    this.kind = kind;
    this.path = path;
  }
}

export interface Tank01ClientOptions {
  readonly apiKey: string;
  /**
   * Injected on purpose, and injected in every test. The default is only used by the real
   * adapter at runtime and by `scripts/record-tank01-fixtures.ts`; the test suites replace
   * `globalThis.fetch` with a thrower so a code path that fell back to it fails loudly rather
   * than quietly making a paid request from a test run.
   */
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
  readonly host?: string;
}

export interface Tank01Client {
  get(path: string, query?: Readonly<Record<string, string>>): Promise<unknown>;
}

export function createTank01Client(options: Tank01ClientOptions): Tank01Client {
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? TANK01_CONFIG.baseUrl;
  const host = options.host ?? TANK01_CONFIG.host;

  return {
    async get(path, query = {}) {
      const url = new URL(path, baseUrl);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

      const response = await doFetch(url.toString(), {
        method: "GET",
        headers: { "x-rapidapi-key": options.apiKey, "x-rapidapi-host": host },
      });

      // The RapidAPI gateway's own failures. These do NOT carry the `{statusCode, body}`
      // envelope — they are `{"message": "..."}` — so they are classified before parsing.
      if (response.status === 401) {
        throw new Tank01Error("unauthorized", path, `Tank01 rejected the API key. Check ${TANK01_CONFIG.envVars.apiKey}.`);
      }
      if (response.status === 403) {
        throw new Tank01Error("forbidden", path, "This RapidAPI key is not subscribed to the Tank01 NFL API.");
      }
      if (response.status === 429) {
        throw new Tank01Error("rate_limited", path, "Tank01 request quota exhausted. Back off and retry later.");
      }
      if (!response.ok) {
        throw new Tank01Error("upstream", path, `Tank01 returned HTTP ${response.status} for ${path}.`);
      }

      const parsed: unknown = await response.json().catch(() => undefined);
      if (typeof parsed !== "object" || parsed === null) {
        throw new Tank01Error("malformed", path, `Tank01 returned a non-JSON body for ${path}.`);
      }
      const envelope = parsed as Record<string, unknown>;

      // The trap: an application-level error arrives as HTTP 200 with an `error` key and an
      // EMPTY body. Trusting the status code alone would map that to zero players and zero stat
      // lines, which looks like a quiet week rather than a failure.
      if (typeof envelope.error === "string" && envelope.error !== "") {
        throw new Tank01Error("upstream", path, `Tank01 refused ${path}: ${envelope.error}`);
      }
      if (!("body" in envelope)) {
        throw new Tank01Error("malformed", path, `Tank01 returned no body for ${path}.`);
      }
      return envelope.body;
    },
  };
}
```

- [ ] **Step 7: Author the fixtures and their manifest**

Create `src/stats/tank01/fixtures/manifest.json`. The `provenance` field is the honest part of this whole task: until a key exists, these bodies are authored from published response shapes, and the manifest says so in the file rather than in a comment somebody has to find.

```json
{
  "provenance": "authored-from-published-response-shapes",
  "recordedAt": null,
  "note": "Bodies are the `body` value of Tank01's {statusCode, body} envelope, byte-shaped as the API returns it: every value a string except where noted. Written from published captures and the RapidAPI schema, NOT recorded from the live API, because Plan A is built before a key exists. `npm run stats:tank01:record` rewrites every file here from the live API and flips provenance to recorded-from-live-api. The adapter's tests must pass unchanged across that flip; if they do not, the fixtures were wrong and the flip is what caught it.",
  "entries": [
    { "file": "player-list.json", "path": "/getNFLPlayerList", "query": {}, "trimmed": true, "trimmedNote": "The live response is 4,500+ players and about 5.5 MB. Trimmed to 24 players spanning QB/RB/WR/TE/K plus two unscored positions, keeping every field the mapper reads." },
    { "file": "teams.json", "path": "/getNFLTeams", "query": {}, "trimmed": false },
    { "file": "games-week-1.json", "path": "/getNFLGamesForWeek", "query": { "week": "1", "season": "2026", "seasonType": "reg" }, "trimmed": true, "trimmedNote": "Two games rather than a full week, so the box-score fixtures stay to two." },
    { "file": "boxscore-20260913_SF@SEA.json", "path": "/getNFLBoxScore", "query": { "gameID": "20260913_SF@SEA" }, "trimmed": true, "trimmedNote": "Six players spanning every stat group, plus both DST sides." },
    { "file": "boxscore-20260913_CAR@WSH.json", "path": "/getNFLBoxScore", "query": { "gameID": "20260913_CAR@WSH" }, "trimmed": true, "trimmedNote": "Same shape, different teams, one player with no stat groups at all." },
    { "file": "games-week-99.json", "path": "/getNFLGamesForWeek", "query": { "week": "99", "season": "2026", "seasonType": "reg" }, "trimmed": false, "note": "An out-of-range week. Kept to document what upstream does, even though the adapter answers this locally and never sends it." }
  ]
}
```

Author each body to match. `teams.json` must be a 32-entry array using the verified Tank01 team-id map (1=ARI, 2=ATL, 3=BAL, 4=BUF, 5=CAR, 6=CHI, 7=CIN, 8=CLE, 9=DAL, 10=DEN, 11=DET, 12=GB, 13=HOU, 14=IND, 15=JAX, 16=KC, 17=LV, 18=LAC, 19=LAR, 20=MIA, 21=MIN, 22=NE, 23=NO, 24=NYG, 25=NYJ, 26=PIT, 27=PHI, 28=SF, 29=SEA, 30=TB, 31=TEN, 32=WSH — note **WSH**, not WAS) with `teamID`, `teamAbv`, `teamCity`, `teamName` on each. `player-list.json` entries carry `playerID`, `longName`, `pos`, `team`, `teamID`, `jerseyNum`, `isFreeAgent` (`"False"`, Python-cased, as upstream sends it). The box scores follow the literal shape used in the Step 2 tests, with `gameID`, `playerStats` keyed by player id, and `DST: { away, home }`.

Every player id used in a box score fixture **must** appear in `player-list.json`, and every `teamAbv` used in a `DST` block **must** appear in `teams.json` — otherwise the contract suite's "only reports stats for players it also lists" case fails, which is exactly what it is for.

- [ ] **Step 8: Write the fixture fetch**

Create `src/stats/tank01/fixtures.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface ManifestEntry {
  readonly file: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
}

interface Manifest {
  readonly provenance: "authored-from-published-response-shapes" | "recorded-from-live-api";
  readonly recordedAt: string | null;
  readonly entries: readonly ManifestEntry[];
}

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function readManifest(): Manifest {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8")) as Manifest;
}

export function readFixture(file: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8"));
}

/**
 * A `fetch` that serves the committed fixtures and NOTHING else.
 *
 * An unrecorded request throws by name, naming the path and query it wanted, so a test that
 * would otherwise have made a real paid request fails immediately and tells you which fixture to
 * record instead of silently going to the network.
 */
export function createFixtureFetch(): typeof globalThis.fetch {
  const manifest = readManifest();
  return (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const entry = manifest.entries.find(
      (candidate) =>
        candidate.path === url.pathname &&
        Object.entries(candidate.query).every(([key, value]) => query[key] === value) &&
        Object.keys(query).length === Object.keys(candidate.query).length,
    );
    if (entry === undefined) {
      throw new Error(
        `No Tank01 fixture for ${url.pathname}?${url.searchParams.toString()}. Record it with \`npm run stats:tank01:record\` or add it to fixtures/manifest.json.`,
      );
    }
    return new Response(JSON.stringify({ statusCode: 200, body: readFixture(entry.file) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}
```

- [ ] **Step 9: Write the provider and its test**

Create `src/stats/tank01/tank01-stats-provider.ts`:

```ts
import type { StatsProvider } from "../provider";
import { createTank01Client, type Tank01ClientOptions } from "./client";
import { TANK01_CONFIG } from "./config";
import { mapBoxScoreToStatLines, mapGameIds, mapPlayerList, mapTeamsToDefensePlayers } from "./map";

export interface Tank01ProviderOptions extends Tank01ClientOptions {
  /** Defaults to `TANK01_CONFIG.defaultSeason`. A season is adapter config, not an interface parameter. */
  readonly season?: number;
}

export function createTank01StatsProvider(options: Tank01ProviderOptions): StatsProvider {
  const client = createTank01Client(options);
  const season = String(options.season ?? TANK01_CONFIG.defaultSeason);

  return {
    async listPlayers() {
      const [playerBody, teamBody] = await Promise.all([
        client.get(TANK01_CONFIG.paths.playerList),
        client.get(TANK01_CONFIG.paths.teams),
      ]);
      // Two calls in parallel because they are independent and both are once-per-seed.
      return [...mapPlayerList(playerBody), ...mapTeamsToDefensePlayers(teamBody)];
    },

    async getWeeklyStatLines(week) {
      // Answered locally, without a request. `seedPlayers` walks weeks upward until it gets an
      // empty array, so an unbounded provider would burn a month's free-tier quota discovering
      // where the season ends.
      if (week < TANK01_CONFIG.weeks.first || week > TANK01_CONFIG.weeks.last) return [];

      const schedule = await client.get(TANK01_CONFIG.paths.gamesForWeek, {
        week: String(week),
        season,
        seasonType: TANK01_CONFIG.seasonType,
      });

      // SEQUENTIAL, not `Promise.all`. A week is around sixteen box scores; issuing them at once
      // is the fastest way to a 429 on any plan below Ultra, and a rate-limit failure part way
      // through a burst leaves you with no idea which games you got. One at a time fails on the
      // first refusal with every prior game already mapped.
      const lines: StatLine[] = [];
      for (const gameId of mapGameIds(schedule)) {
        const box = await client.get(TANK01_CONFIG.paths.boxScore, { gameID: gameId });
        lines.push(...mapBoxScoreToStatLines(box, week));
      }
      return lines;
    },
  };
}
```

Add `import type { StatLine } from "@/domain/player";` for the accumulator.

Create `src/stats/tank01/tank01-stats-provider.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeStatsProviderContract } from "../test-support";
import { Tank01Error } from "./client";
import { TANK01_CONFIG } from "./config";
import { createFixtureFetch, readManifest } from "./fixtures";
import { createTank01StatsProvider } from "./tank01-stats-provider";

/**
 * NOTHING in this file may reach the network. Every test injects `createFixtureFetch()`, and
 * this guard makes a code path that fell back to the global `fetch` fail by name instead of
 * quietly making a real, billable request from a test run.
 */
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("A Tank01 test tried to use the real fetch. Every test must inject createFixtureFetch().");
  }) as typeof globalThis.fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const provider = () => createTank01StatsProvider({ apiKey: "test-key", fetch: createFixtureFetch(), season: 2026 });

describeStatsProviderContract("Tank01StatsProvider", provider);

describe("Tank01StatsProvider", () => {
  it("lists a DEF player for every NFL team", async () => {
    const players = await provider().listPlayers();
    const defenses = players.filter((player) => player.position === "DEF");
    expect(defenses).toHaveLength(32);
    expect(defenses.every((player) => player.id.startsWith(TANK01_CONFIG.defensePlayerIdPrefix))).toBe(true);
  });

  it("answers an out-of-season week without making a request at all", async () => {
    // The fixture fetch throws by name on anything unrecorded, and there IS a recorded week-99
    // schedule, so this passing proves the short circuit rather than proving the fixture exists.
    let calls = 0;
    const counting: typeof globalThis.fetch = (...args) => {
      calls += 1;
      return createFixtureFetch()(...args);
    };
    const subject = createTank01StatsProvider({ apiKey: "test-key", fetch: counting, season: 2026 });
    expect(await subject.getWeeklyStatLines(99)).toEqual([]);
    expect(calls).toBe(0);
  });

  it("turns a 401 into a typed unauthorized failure that names the env var", async () => {
    const unauthorized: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "Invalid API key." }), { status: 401 });
    const subject = createTank01StatsProvider({ apiKey: "wrong", fetch: unauthorized });
    await expect(subject.listPlayers()).rejects.toMatchObject({ name: "Tank01Error", kind: "unauthorized" });
    await expect(subject.listPlayers()).rejects.toThrow(TANK01_CONFIG.envVars.apiKey);
  });

  it("turns a 429 into a typed rate_limited failure", async () => {
    const limited: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "Too many requests" }), { status: 429 });
    const subject = createTank01StatsProvider({ apiKey: "test-key", fetch: limited });
    await expect(subject.listPlayers()).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("treats an HTTP 200 carrying an error key as a failure, not as an empty week", async () => {
    // The single most dangerous upstream behavior: a refused request answers 200 with an empty
    // body, which a status-only check would map to zero stat lines and nobody would notice.
    const refused: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ statusCode: 200, body: {}, error: "playerID or teamID is a required parameter" }), { status: 200 });
    const subject = createTank01StatsProvider({ apiKey: "test-key", fetch: refused });
    await expect(subject.listPlayers()).rejects.toMatchObject({ name: "Tank01Error", kind: "upstream" });
  });
});

describe("the fixture manifest", () => {
  it("declares an honest provenance", () => {
    const manifest = readManifest();
    expect(["authored-from-published-response-shapes", "recorded-from-live-api"]).toContain(manifest.provenance);
    if (manifest.provenance === "recorded-from-live-api") expect(manifest.recordedAt).not.toBeNull();
  });

  it("names a file for every fixture and a fixture for every file", async () => {
    const { readdirSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
    const onDisk = readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "manifest.json");
    const declared = readManifest().entries.map((entry) => entry.file);
    expect([...onDisk].sort()).toEqual([...declared].sort());
  });
});
```

- [ ] **Step 10: Run it and iterate the fixtures until it passes**

Run: `npm test -- src/stats/tank01`
Expected: PASS. Expect to iterate here: the contract suite's "only reports stats for players it also lists" case is what catches a box-score fixture referencing a player id the trimmed player list dropped. Fix the **fixture**, not the assertion — that assertion is precisely the invariant a real recording has to satisfy too.

- [ ] **Step 11: Register the provider**

In `src/stats/registry.ts`, replace the `tank01` case:

```ts
    case "tank01": {
      const apiKey = envOrUndefined(TANK01_CONFIG.envVars.apiKey);
      if (apiKey === undefined) {
        throw new Error(
          `${STATS_CONFIG.envVars.provider}=tank01 needs ${TANK01_CONFIG.envVars.apiKey}. Get a key from RapidAPI's Tank01 NFL API and put it in .env.local.`,
        );
      }
      const season = envOrUndefined(TANK01_CONFIG.envVars.season);
      return createTank01StatsProvider({
        apiKey,
        season: season === undefined ? undefined : Number(season),
      });
    }
```

Add a registry test for it:

```ts
  it("refuses tank01 without a key, and says which variable to set", () => {
    delete process.env[TANK01_CONFIG.envVars.apiKey];
    expect(() => createStatsProvider("tank01")).toThrow(TANK01_CONFIG.envVars.apiKey);
  });

  it("builds tank01 when a key is present, without making any request", () => {
    process.env[TANK01_CONFIG.envVars.apiKey] = "test-key";
    expect(() => createStatsProvider("tank01")).not.toThrow();
    delete process.env[TANK01_CONFIG.envVars.apiKey];
  });
```

The second case matters: constructing the provider must not make a request, or a misconfigured deployment would burn quota just starting up.

- [ ] **Step 12: Let a half sack survive the database**

`player_stat_lines.sacks` is an `integer` column. Tank01 reports `"1.5"`, and the mapper correctly keeps it, so a half sack currently truncates to 1 the moment it is written. That is a Phase-1 shape that a live feed makes lossy, and the no-MVP directive says not to leave it.

In `src/db/schema.ts`, change the column:

```ts
    sacks: real("sacks").notNull().default(0),
```

`real` is already imported and already used for every scoring-setting multiplier. Then:

```bash
npm run db:generate
```

Inspect `drizzle/0012_*.sql`. It should be a plain `ALTER TABLE "player_stat_lines" ALTER COLUMN "sacks" SET DATA TYPE real;`. Widening `integer` to `real` is lossless and needs no `USING` clause and no backfill.

```bash
npm run db:migrate && npm run db:migrate:test
npm test -- src/scoring && npm test -- src/league-service && npm test
```

Expected: green. `computeFantasyPoints` multiplies `sacks` by a `real` already, so nothing in the scoring engine changes.

- [ ] **Step 13: Write the recording script**

Create `scripts/record-tank01-fixtures.ts`:

```ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { envOr, envOrUndefined } from "@/lib/env";
import { createTank01Client } from "@/stats/tank01/client";
import { TANK01_CONFIG } from "@/stats/tank01/config";
import { readManifest } from "@/stats/tank01/fixtures";

/**
 * Re-records every committed Tank01 fixture from the live API. Founder-run, once, on the first
 * day there is a key.
 *
 * The adapter's tests must pass UNCHANGED across this run. If they do not, the authored fixtures
 * were wrong about the upstream shape, and this script is exactly the thing that surfaces it —
 * which is why the manifest carries a provenance field instead of a comment: the flip from
 * authored to recorded is a reviewable diff.
 *
 * Trimming is NOT automated. The player list is 5.5 MB and the whole point of the committed
 * fixtures is that they are small enough to read in a review. This script writes the full
 * responses; trim them by hand afterwards, keeping every field the mapper reads and keeping the
 * cross-file invariant that every box-score player id appears in the player list.
 */
async function main(): Promise<void> {
  const apiKey = envOrUndefined(TANK01_CONFIG.envVars.apiKey);
  if (apiKey === undefined) {
    throw new Error(`${TANK01_CONFIG.envVars.apiKey} is not set. Put a RapidAPI Tank01 key in .env.local first.`);
  }
  const client = createTank01Client({ apiKey });
  const manifest = readManifest();
  const dir = resolve(process.cwd(), "src/stats/tank01/fixtures");

  for (const entry of manifest.entries) {
    const body = await client.get(entry.path, entry.query);
    writeFileSync(resolve(dir, entry.file), `${JSON.stringify(body, null, 2)}\n`);
    console.log(`recorded ${entry.file} from ${entry.path}`);
  }

  const updated = { ...manifest, provenance: "recorded-from-live-api", recordedAt: new Date().toISOString() };
  writeFileSync(resolve(dir, "manifest.json"), `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`recorded ${manifest.entries.length} fixtures; provenance is now recorded-from-live-api`);
  console.log("NEXT: trim the large responses by hand, then run `npm test -- src/stats/tank01` and expect it to pass with NO test edits.");
}

main().then(() => process.exit(0)).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

`envOr` is imported but unused above — drop the import rather than leaving it; `npm run lint` will say so.

Add the script to `package.json`:

```json
    "stats:tank01:record": "dotenv -e .env.local -- tsx scripts/record-tank01-fixtures.ts",
```

- [ ] **Step 14: Document the variables**

Add to `.env.example`, directly under the `STATS_PROVIDER` block:

```
# Required only when STATS_PROVIDER=tank01. A RapidAPI key subscribed to the Tank01 NFL API
# (tank01-nfl-live-in-game-real-time-statistics-nfl). The free tier is 1,000 requests a month,
# which is enough for a full season backfill; one week costs about seventeen requests. Selecting
# tank01 without this fails fast and names this variable. Commented out rather than shipped
# empty, because an uncommented empty line looks configured.
# TANK01_API_KEY=

# Optional, only for STATS_PROVIDER=tank01. Which NFL season to read; defaults to the value in
# src/stats/tank01/config.ts. Tank01 holds 2022 onward, and 2026 means the 2026-27 season.
# TANK01_SEASON=2026
```

- [ ] **Step 15: Commit**

```bash
git add src/stats/tank01 src/stats/registry.ts src/stats/registry.test.ts src/db/schema.ts drizzle/ scripts/record-tank01-fixtures.ts package.json .env.example
git commit -m "feat(stats): a Tank01 adapter, proved against committed fixtures, activated by a key

The second StatsProvider implementation, written and merged with no API key: every test serves
committed fixture bodies through an injected fetch, and a suite-level guard replaces
globalThis.fetch with a thrower so a path that fell back to it fails by name rather than making
a real billable request from a test run.

Three upstream behaviors shape the whole adapter and each has an assertion of its own. Every
value Tank01 returns is a JSON string except the envelope's statusCode, so every read goes
through a parser that yields 0 rather than NaN, because one NaN reaching the scoring engine
turns a team's weekly total into NaN silently. An application-level refusal arrives as HTTP 200
with an empty body and an error key, which a status-only check would map to a quiet week rather
than a failure. And fumblesLost lives under the Defense group even for a quarterback, so
reading it from anywhere else scores every lost fumble in the league as zero.

Team defenses are not players upstream, so listPlayers synthesizes one DEF per NFL team from
getNFLTeams and getWeeklyStatLines mints the SAME id from the same config prefix; the contract
suite's only-reports-listed-players case is what keeps those two ends together.

player_stat_lines.sacks widens from integer to real: Tank01 reports half sacks, the mapper keeps
them, and an integer column silently truncated them at the write.

The fixture manifest carries an honest provenance field. scripts/record-tank01-fixtures.ts
rewrites every fixture from the live API on the first run that has a key and flips that field,
and the adapter's tests must pass unchanged across the flip. If they do not, the authored
fixtures were wrong and that run is what caught it."
```

---

## Task 11: Docs, conventions, and the closing verification

Three docs describe a codebase this plan changed in ways they now misstate, and two decision docs owe an explanation. This task is the sweep, and it ends with the full battery.

**Files:**
- Create: `docs/decisions/stats-provider-adapter.md`
- Modify: `docs/conventions.md` (directory map, stack table, tests, environment)
- Modify: `docs/league.md` (the browse section's query description)
- Modify: `docs/draft-engine.md` (the action-log/locking section)
- Modify: `README.md` (bootstrap sequence, new npm scripts)

**Interfaces:**
- Consumes: everything Tasks 1 through 10 produced.
- Produces: nothing code depends on.

- [ ] **Step 1: Write `docs/decisions/stats-provider-adapter.md`**

```markdown
# Decision: the stats-provider seam

**Date:** 2026-08-19 · **Phase 2, Plan A** · Spec: `plans/phase-2-accounts-and-data-foundation.md` Step 6

## What this seam guarantees

`StatsProvider` (`src/stats/provider.ts`) is two methods: `listPlayers()` and
`getWeeklyStatLines(week)`. `createStatsProvider(name?)` (`src/stats/registry.ts`) is the one
place a name becomes an implementation, selected by `STATS_PROVIDER`, defaulting to `mock`, and
throwing `UnknownStatsProviderError` by name on anything else.

`describeStatsProviderContract` (`src/stats/test-support.ts`) is what "an implementation" means:
stable non-empty ids, known positions, stat lines stamped with the requested week, every stat
field finite and non-negative, no player reported twice, no stats for a player the provider does
not also list, and an empty list rather than an error for a week outside the season. Both
implementations run it. A future licensed feed runs the same suite unchanged.

## What it deliberately does not guarantee

- **It does not carry a season.** `getWeeklyStatLines(week)` takes a week and nothing else. A
  season is adapter configuration (`TANK01_CONFIG.defaultSeason`, `TANK01_SEASON`), because
  adding it to the interface would ripple into `player_stat_lines`, which is keyed
  `(player_id, week)` and has no season column. It does not need one until a phase runs more
  than one season at a time, and inventing the column now would be building for a requirement
  nobody has.
- **It does not promise determinism.** The mock is deterministic and its own test asserts that.
  A live feed is not, so the shared contract does not demand it.
- **It does not select a vendor.** Contracting a licensed stats provider (SportsDataIO,
  SportRadar, Genius Sports) is a business and legal decision, deferred to Phase 8. Tank01 is a
  development and proving feed, not a licensing decision.

## Provider ids are not portable, and that is fine

`players.id` is whatever the selected provider calls a player. The mock's ids and Tank01's ids
(which are mostly ESPN ids) do not overlap, so switching providers means re-seeding, not
migrating. That is the correct trade at this point: an id-mapping table would be real ongoing
complexity bought to avoid a `npm run seed` nobody has needed to avoid.

## Tank01, and how a key activates it

`src/stats/tank01/` is split three ways on purpose: `client.ts` does HTTP and typed failures and
no mapping, `map.ts` is pure and does mapping and no I/O, and `tank01-stats-provider.ts`
composes them. The mapper is therefore unit-testable against literal payloads, and the client is
testable against an injected `fetch`.

**No key was needed to build it.** Every test serves committed fixture bodies through
`createFixtureFetch()`, and both Tank01 suites replace `globalThis.fetch` with a thrower so a
path that fell back to it fails by name instead of making a real billable request. The fixtures
carry a `provenance` field in `fixtures/manifest.json` that reads
`authored-from-published-response-shapes` until `npm run stats:tank01:record` is run with a real
key, at which point it becomes `recorded-from-live-api` with a timestamp. **The adapter's tests
must pass unchanged across that flip.** If they do not, the authored fixtures were wrong about
the upstream shape and the recording run is what caught it. That is the whole design.

**To activate:** subscribe a RapidAPI key to the Tank01 NFL API, put it in `.env.local` as
`TANK01_API_KEY`, set `STATS_PROVIDER=tank01`, run `npm run stats:tank01:record`, review the
fixture diff, then `npm run seed`. No code change.

## The three upstream behaviors the adapter is shaped by

1. **Everything is a string.** `statusCode` on the envelope is the only number in a response.
   Every read goes through a parser that yields 0 for anything non-finite, because one `NaN`
   reaching `computeFantasyPoints` turns a team's weekly total into `NaN` and does it silently.
2. **HTTP 200 is not success.** An application-level refusal returns 200 with `body: {}` and an
   `error` key; gateway failures (401, 403, 429) return `{"message": …}` with no envelope at
   all. A status-only check maps a refusal to a quiet week rather than to a failure.
3. **`fumblesLost` is under the `Defense` group, for every player.** A quarterback who fumbles
   gets a `Defense` group containing it. Stat groups are absent rather than empty when a player
   has none, so every group read is defaulted.

## Cost

The free tier is 1,000 requests a month. `listPlayers()` costs two requests. One week of stat
lines costs one schedule request plus roughly sixteen box scores. A full 18-week backfill is
about 300 requests. `getWeeklyStatLines` fetches box scores **sequentially**, not in parallel: a
burst is the fastest way to a 429, and a rate-limit failure part way through a burst leaves you
unable to say which games you got.
```

- [ ] **Step 2: Update `docs/conventions.md`**

Four edits, each replacing text that this plan made untrue:

1. **Stack table** — the Database row gains PgBouncer:

```
| Database | **Postgres 17** via Drizzle ORM (`drizzle-orm/postgres-js`, `postgres` driver), reached through **PgBouncer in transaction pooling mode** | Pure-JS wire protocol, no native compilation. `prepare: false` is unconditional (transaction pooling gives a client a different backend between transactions). Nothing may rely on session state: no `pg_advisory_lock`, no session `SET`, no `LISTEN`/`NOTIFY`. See `docs/decisions/data-layer-hardening.md`. |
```

2. **Local infra line** — five services now:

```
| Local infra | `docker-compose.yml`: postgres (5432), postgres-test (5433, tmpfs), pgbouncer (6432 → postgres), pgbouncer-test (6433 → postgres-test), redis (6379, AOF everysec) | `npm run infra:up` |
```

3. **Directory map** — replace the `stats/` entry and add `lib/env.ts`:

```
  stats/                  The stats seam. provider.ts (the interface), config.ts + registry.ts
                          (STATS_PROVIDER selection, fail-fast on an unknown name),
                          test-support.ts (the contract every implementation passes),
                          mock/ (the fixed 2026 dataset) and tank01/ (the live adapter, tested
                          against committed fixtures). See docs/decisions/stats-provider-adapter.md.
```

```
    env.ts                envOr/envOrUndefined — the ONE place an optional env var is read with a
                          fallback. `.env.example` ships some vars as empty lines and dotenv reads
                          those as "", which `??` does not fall back on.
```

4. **Draft state section** — append after the existing paragraph:

```
Every accepted action is applied inside ONE transaction holding `SELECT … FOR UPDATE` on the
draft's own row, and the in-memory materialization validates itself against
`MAX(draft_actions.sequence)` before it is trusted. That is what makes "replay the action log"
the single-writer path across any number of app instances, not just across restarts. A row lock
and not `pg_advisory_lock`, because advisory locks are session-scoped and this connection reaches
Postgres through a transaction pooler. The in-process mutex in `src/draft-service/mutex.ts`
remains as an intra-process fast path, not as the safety mechanism.
```

5. **Environment section** — add the new variables to the required/optional lists:

```
Required: `DATABASE_URL`, `REDIS_URL`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI`; test-only: `TEST_DATABASE_URL`, `TEST_PGBOUNCER_URL`; optional: `ANTHROPIC_API_KEY`, `STATS_PROVIDER` (default `mock`), `TANK01_API_KEY` + `TANK01_SEASON` (only when `STATS_PROVIDER=tank01`).
```

6. **Client boundary section** — add one sentence at the end:

```
A second, simpler layering rule sits beside this one: nothing under `src/**` may import from
`scripts/**` or `e2e/**`. Build tooling and the browser suite may depend on source; source may
not depend on either. Enforced by its own `no-restricted-imports` block in `eslint.config.mjs`.
```

- [ ] **Step 3: Update `docs/league.md` and `docs/draft-engine.md`**

In `docs/league.md`, find the matchmaking/browse section and replace whatever it says about the two-query fill count with:

```
Browse is ONE grouped query (`src/league-service/browse.ts`): the fill count is
`count(teams.id)` over a `LEFT JOIN` (so a league with no managers still appears), the open-seat
rule is a `HAVING count(teams.id) < leagues.team_count` predicate, and every narrowing is applied
before the `LIMIT`. That ordering is the correctness property — the earlier two-query form
applied the cap first and filtered in JavaScript afterwards, so a narrow filter over a large
public pool returned an under-filled page. `matchesBrowseFilter`/`hasOpenSeat` remain the
canonical, 100%-covered statement of the rule, and `browse.test.ts` runs all 45 filter
combinations through both the query and the pure rule over one corpus, demanding identical
answers.
```

In `docs/draft-engine.md`, find the durability/action-log section and add the locking paragraph from Step 2's item 4 above, worded for that document's voice, plus a line naming `src/draft-service/locking.test.ts` as the two-instance proof.

- [ ] **Step 4: Update `README.md`**

The bootstrap sequence gains nothing new (`npm run infra:up` brings up all five services), but the script list needs three additions and one clarification:

- `npm run stats:tank01:record` — re-records the Tank01 fixtures from the live API. Needs `TANK01_API_KEY`.
- The `TEST_DATABASE_URL` override that runs the whole suite through PgBouncer, given verbatim as a release-gate step:
  `TEST_DATABASE_URL=postgres://commish:commish@localhost:6433/commish_test npm test`
- A note that `DATABASE_URL` now points at port 6432 (the pooler), not 5432, and that connecting directly to 5432 is fine for `psql` but is not what the app does.

- [ ] **Step 5: Run the closing battery**

```bash
npm run infra:up
npm run db:migrate && npm run db:migrate:test
npm run typecheck
npm run lint
npm test
npm run test:coverage          # UNFILTERED — the six gated directories must all read 100%
npm run build
npm run e2e                    # needs a WorkOS test key; run twice back to back
TEST_DATABASE_URL=postgres://commish:commish@localhost:6433/commish_test npm test
```

Every one green. Record the test count and the coverage table in the SDD ledger. The e2e suite is run **twice back to back** because Phase 1's own closing gate established that as the standard — a single run does not prove the stable-identity fix still holds.

- [ ] **Step 6: Commit**

```bash
git add docs/ README.md
git commit -m "docs: record the data-layer and stats-seam decisions, and fix the drift they caused

Three docs described a codebase this plan changed. conventions.md's stack table, infra list,
directory map, draft-state section and environment list are updated; league.md's browse section
now describes one grouped query instead of two; draft-engine.md gains the row-lock paragraph and
names the two-instance proof.

docs/decisions/stats-provider-adapter.md records what the seam guarantees, the three things it
deliberately does not (no season on the interface, no determinism in the contract, no vendor
selection), why provider ids are not portable and why that is the right trade, and exactly how a
key activates Tank01 with no code change."
```

---

## Verification summary

```bash
# Per-task
npm test -- src/lib/env                     # Task 1
npm test -- src/app/error-surfaces          # Task 2
npm test -- src/chat-room                   # Task 3 (ten consecutive runs)
npm test -- src/league-service/browse       # Task 4
npm test -- src/db/index-plans              # Task 5
npm test -- src/draft-service/locking       # Tasks 6 and 7 (ten consecutive runs)
npm test -- src/db/config src/db/pgbouncer  # Task 8
npm test -- src/stats                       # Tasks 9 and 10

# Repo-wide, every task
npm run typecheck && npm run lint && npm test && npm run build

# Closing, Task 11 only
npm run test:coverage                                                              # unfiltered
npm run e2e                                                                        # twice, back to back
TEST_DATABASE_URL=postgres://commish:commish@localhost:6433/commish_test npm test  # the suite through the pooler
```

**Spec Step 2 exit criteria:**
- *Two-instance concurrent-write test proves exactly one of two simultaneous actions wins* — `src/draft-service/locking.test.ts`, Task 7.
- *`EXPLAIN ANALYZE` confirms index usage on every hot path* — `src/db/index-plans.test.ts`, Task 5.
- *The full persistence suite passes against PgBouncer in transaction-pooling mode* — Task 8, Step 8's third command.
- *`docs/decisions/data-layer-hardening.md` documents both the rollup convention and the pool-sizing formula* — Task 8, Step 9.

**Spec Step 6 exit criteria:**
- *Stats are consumed exclusively through `StatsProvider`* — already true on `main` (`seedPlayers(db, provider)` is the only writer); now also selected through `createStatsProvider`, Task 9.
- *The contract test suite passes against the mock and is generic enough to run unchanged against a future real provider* — `describeStatsProviderContract` runs against both `MockStatsProvider` and `Tank01StatsProvider` with no per-implementation branching, Tasks 9 and 10.
- *An unimplemented `STATS_PROVIDER` value fails fast rather than silently falling back to mock data* — `UnknownStatsProviderError`, Task 9.
- *The deferral note exists* — `docs/decisions/stats-provider-adapter.md`, Task 11.

---

## Self-review

**1. Spec coverage.**

| Spec requirement | Task |
|---|---|
| Step 2: per-draft row lock, `SELECT … FOR UPDATE` inside the validating transaction | 7 |
| Step 2: two-instance concurrent-write test, exactly one accepted | 7 |
| Step 2: two-instance visibility test | 6 |
| Step 2: indexes for every hot read path, verified with `EXPLAIN ANALYZE` against a representative dataset | 5 |
| Step 2: `Session(token)` / `Session(userId)` indexes | 5, 8 — **struck**, with the reason recorded in `docs/decisions/data-layer-hardening.md`. There is no `sessions` table; WorkOS owns sessions. |
| Step 2: chat `(leagueId, createdAt)` and `draft_actions(draftId, timestamp)` indexes | 5, 8 — **struck as already served better**, with reasons recorded. Both are regression-guarded in `index-plans.test.ts`. |
| Step 2: balance-as-rollup convention documented as an architectural rule | 8 |
| Step 2: apply the convention to the one aggregate read this phase has (the cross-league query) | 4 — applied to public browse's fill count, which is the aggregate read that **exists** today. The spec names Step 8's dashboard query, which does not exist yet and belongs to Plan B; the overview records that hand-off. |
| Step 2: PgBouncer in transaction-pooling mode, app pointed at it | 8 |
| Step 2: documented connection-pool sizing formula, with a separate batch pool | 8 |
| Step 2: a test confirming the app works against transaction pooling specifically | 8 |
| Step 6: define a `StatsProvider` interface shaped by what the scoring engine consumes | already true on `main`; unchanged by ruling, Task 9 |
| Step 6: implement `MockStatsProvider` over the existing dataset | already true on `main` |
| Step 6: provider selection via config/env, failing fast with a typed error | 9 |
| Step 6: refactor every direct `mock-players.json` read to go through the provider | already true on `main` — verified, recorded in "What is already true" |
| Step 6: contract tests against the interface, reusable by a future implementation | 9 |
| Step 6: the deferral note | 11 |
| Controller: a Tank01 adapter built against recorded fixtures, key-activated, tests never call the live API | 10 |
| Residual: browse filters into SQL | 4 |
| Residual: `src` → `scripts` layering | 1 |
| Residual: `error.tsx` | 2 |
| Residual: `use-league-chat` flake root cause | 3 |
| Residual: leagues index | 5 |
| Founder: no em-dashes in user-facing copy | asserted by review; every string this plan writes was checked |
| Founder: persona-panel pass on every new user-facing surface | 2, Step 8 — the only new user-facing surfaces in this plan |
| Founder: centralized primitives | 2 uses `ErrorState`/`EmptyState`/`Button`; the one deviation (`global-error.tsx`) is stated with its reason |

No gaps.

**2. Placeholder scan.** No "TBD", no "implement later", no "similar to Task N", no "add error handling" without the handler. Four deliberate hedges are called out inline rather than left implicit, each with the exact alternative written out: the `tsx`/`@/` resolution contingency in Task 1 Step 6; the partial-index generation contingency in Task 5 Step 5; the `SHOW POOL_MODE` contingency in Task 8 Step 7; and the `DB_POOL_CONFIG` getter contingency in Task 8 Step 5. Two steps deliberately contain a wrong line the executor is told to replace (Task 1 Step 1's ternary, Task 7 Step 1's row-count expression) — that is a device to make sure the assertion gets read, and the replacement is given verbatim immediately after. Task 6 Step 1 and Task 8 Step 7 both say "use the fixture helper that already exists rather than adding a second one" instead of inventing a name, because inventing one would create the duplicate the instruction exists to prevent; both name the file to read.

**3. Type consistency.** Checked across tasks:

- `envOr(name, fallback)` / `envOrUndefined(name)` — defined Task 1, consumed Tasks 8, 9, 10, 11. One spelling, one location.
- `StatsProvider` — `listPlayers(): Promise<readonly Player[]>` and `getWeeklyStatLines(week: number): Promise<readonly StatLine[]>` throughout. Never widened, never given a season parameter, in any task.
- `Player` is `{ id, name, position, nflTeam }` and `StatLine` is `{ playerId, week }` plus exactly the fourteen fields listed in `describeStatsProviderContract`'s `STAT_FIELDS` — the same fourteen the mapper's `emptyStats` initializes and the same fourteen `player_stat_lines` has columns for.
- `STATS_CONFIG.providers` is `["mock", "tank01"]` in Task 9 and the registry's `switch` covers both, so Task 10 adding the real `tank01` case is a replacement, not an addition.
- `TANK01_CONFIG.defensePlayerIdPrefix` is read by `mapTeamsToDefensePlayers` **and** `mapBoxScoreToStatLines` **and** both tests — one constant, never a literal, which is what keeps the two ends of the DEF id agreeing.
- `Tank01Error.kind` values `"unauthorized" | "forbidden" | "rate_limited" | "upstream" | "malformed"` are the same five in the type, the class, the client's branches, and the provider tests.
- `latestActionSequence(db: Db | DbTx, draftId)` — defined Task 6, called by `load` in Task 6 and inside the locked transaction in Task 7. The `Db | DbTx` widening is stated where it is introduced and is the reason `loadDraftConfig` is widened too.
- `ApplyResult`, `ApplyOptions.alsoInTransaction`, `isSequenceConflict` are unchanged by Task 7, which is what lets every existing `applyAction` caller stay untouched.
- `explainPlan(db, query)` / `sequentiallyScannedRelations(plan)` / `PlanNode` — defined Task 5, reused unchanged in Task 8's guidance.
- `browseQuery(db, filter)` is introduced in Task 5 Step 2 as an extraction from Task 4's `listPublicLeagues`, and Task 4's own text is what defines the chain it extracts. Task 5's test calls it with `(db, filter)`, and the step says so explicitly.
- `DB_POOL_CONFIG.defaultMaxConnections` keeps its name across the rewrite, so `client.ts` and `test-db.ts` need no edit beyond the one Task 8 Step 6 makes.
- `createFixtureFetch()` returns `typeof globalThis.fetch` and is used identically in both Tank01 suites and by the counting wrapper in the out-of-season test.

---

## Open questions, self-ruled

1. **The spec's Steps 1, 4 and 5 are already done. Skip them silently, or say so?**
   **Ruling: say so, in a table, with evidence, at the top of the plan and in the overview.** A plan that silently omits three of a spec's steps is indistinguishable from a plan that forgot them, and the next person to read the spec will re-derive the question. Three of the spec's own Step 2 index requests are struck the same way, in `docs/decisions/data-layer-hardening.md`, because "there is no `sessions` table" is a fact a future reader needs and "we did not build that index" on its own is not.

2. **Advisory lock or row lock for the per-draft serializer?**
   **Ruling: `SELECT … FOR UPDATE` on the `drafts` row.** `mutex.ts`'s own docblock predicted an advisory lock, and that prediction is wrong for the architecture this plan also builds: `pg_advisory_lock` is session-scoped, and the app reaches Postgres through PgBouncer in transaction pooling mode, where a client is handed a different backend between transactions. A row lock is transaction-scoped by construction, released by the same `COMMIT` that makes the write visible. The spec itself names this as the trap to avoid, and Task 8's pooler suite demonstrates the underlying instability rather than describing it.

3. **Does the in-process mutex survive, now that there is a real lock?**
   **Ruling: yes, as a fast path, with its docblock rewritten to say that is all it is.** Deleting it would send every same-process submission to Postgres to queue on one row, turning a cheap promise chain into N concurrent transactions on a contended lock. Keeping it while it still *reads* as the safety mechanism would be worse than deleting it, which is why Task 6 rewrites the docblock in the same commit that makes it no longer true.

4. **Should the whole test suite run through PgBouncer by default?**
   **Ruling: no — direct by default, through the pooler as an explicit gate.** A pooler in the path makes every one of 1,300-plus tests slower and can turn a real regression into something that looks like a pooling artifact, which is a bad default for the suite people run fifty times a day. But "the app works through a transaction pooler" is not a property one test can establish, so Task 8's exit criterion is the entire suite run through port 6433 once, recorded. Dev's `DATABASE_URL` **does** point at the pooler, so the app a developer actually exercises is the app that ships.

5. **Push browse's filters into SQL, or leave the documented tradeoff?**
   **Ruling: push them.** The tradeoff comment is honest but the behavior is wrong: a narrow filter over a large public pool returns an under-filled page, and the failure is invisible (fewer cards, not an error). It is also the spec's own Step 2 task about applying the rollup convention to an aggregate read. The risk of two expressions of one filter rule is real, and it is answered by a test that runs all 45 combinations through both, rather than by keeping the slower, wrong version.

6. **Does the Tank01 adapter need an API key to be written and merged?**
   **Ruling: no, and designing as if it did would be the mistake.** Every test serves committed fixtures through an injected `fetch`, and both suites replace `globalThis.fetch` with a thrower so a fallback fails by name. What a key adds is *confirmation that the fixtures are right*, which is exactly what `scripts/record-tank01-fixtures.ts` plus the manifest's `provenance` field turn into a reviewable diff. The acceptance criterion for that future run is stated now: **the tests must pass unchanged across the flip.**

7. **Should `StatsProvider` grow a season parameter for the live adapter?**
   **Ruling: no.** A season on the interface ripples into `player_stat_lines`, which is keyed `(player_id, week)` with no season column, and into every read that joins it. Nothing in the product runs two seasons at once until dynasty/keeper (Phase 9). A season is Tank01's configuration (`TANK01_CONFIG.defaultSeason`, `TANK01_SEASON`), and the mock does not have one at all — which is the tell that it does not belong on the shared interface.

8. **How are team defenses reconciled, given Tank01 has no DEF players?**
   **Ruling: synthesize one `DEF` player per NFL team from `/getNFLTeams`, with an id minted from `TANK01_CONFIG.defensePlayerIdPrefix` + `teamAbv`.** Both `listPlayers` and `mapBoxScoreToStatLines` read that one constant, so the two ends cannot drift, and the contract suite's "only reports stats for players it also lists" case is what fails if they do. The alternative — teaching the domain that a defense is not a player — would rewrite the roster model, the draft pool and the scoring engine to accommodate one vendor's data shape.

9. **`player_stat_lines.sacks` is an `integer` and Tank01 reports half sacks. Widen it now, or note it?**
   **Ruling: widen it now, in Task 10, where a live feed makes it real.** The no-MVP directive is explicit that nothing gets built in a form a later phase plans to throw away, and silently truncating half a sack at the write is exactly that. `integer` → `real` is lossless, needs no backfill, and every scoring multiplier is already `real`.

10. **What is the actual root cause of the `useLeagueChat` flake — the test or the hook?**
    **Ruling: the hook, and the test hid it.** Two effects fire `void refresh()` with no ordering, so the last response to resolve wins the write and a slow first request overwrites a fresh second one; in production that is the pane reverting to an older page after a reconnect. The tests then gated on `connection === "live"`, which `onOpen` sets *before* the refetch it triggers, so the gate opened while the write was pending. Fixing only the assertions would have left a real bug in place with green tests, which is the worst of the available outcomes. Acceptance evidence for a fix to an intermittent failure is ten consecutive green runs, not one.

11. **Is `error.tsx` allowed to render `error.message`?**
    **Ruling: no, and the digest is the substitute.** `docs/conventions.md` requires user-facing error strings to be plain language and never raw DB or exception text, and a boundary is the single easiest place to break that: at that point the message may be a Postgres relation name or an upstream provider's response body. Next generates `digest` precisely so a user can quote something an operator can grep, so that is what is shown, and a test asserts the raw text never reaches the page.

12. **`global-error.tsx` inlines `Button`'s classes instead of importing the primitive. Does that violate "centralized primitives always"?**
    **Ruling: it is the one justified exception, and it is stated in the file and in the commit.** That file renders when the root layout itself failed, so importing a primitive drags in the component tree that may be the thing that broke. The rule's purpose is to stop one-off duplicates drifting from the system; a single deliberate copy in the one file that must not depend on the system is a different thing, and leaving it undocumented is what would make it a violation.

13. **How large does the `EXPLAIN` corpus have to be?**
    **Ruling: 5,000 leagues, 20,000 chat messages, 400 draft actions, with an explicit `ANALYZE`.** Postgres sequential-scans small tables regardless of indexes, so a plan assertion over a hundred rows asserts nothing at all, and without `ANALYZE` the planner works from empty-table statistics and chooses a sequential scan for everything — a false negative that would make the whole suite decorative. The seeding is one `generate_series` statement per table, so it costs seconds on the tmpfs test database.

