# Phase 1 Plan B — Draft Engine & Durable Draft Service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the headless half of the draft product — a pure snake+auction draft reducer with an auto-tightening pick clock at 100% coverage, and a durable replay-based draft service (persist-then-publish, crash-recoverable, concurrency-guarded) exposed over JSON API routes and the existing league SSE stream — so Plan C only has to build React on top of it.

**Architecture:** `src/draft-engine/` is pure: `(state, action) => { ok: true, state } | { ok: false, reason }`, no I/O and no ambient clock — every action carries an ISO `timestamp`. `src/draft-service/` is the only thing that touches Postgres or Redis: it replays the `draft_actions` log through the reducer to materialize state (an in-memory map is a *cache*, never the source of truth), persists an action row **before** applying it, and publishes `draft.*` events best-effort **after** the Postgres write on the existing `league:<id>:events` Redis stream. Route handlers are thin: authenticate, resolve the caller's team server-side, validate the body with Zod, delegate, envelope the answer.

**Tech Stack:** TypeScript strict (`readonly` domain types); Drizzle + Postgres 17; Redis 7 Streams over SSE (`XADD` / `XREAD BLOCK` — never `XREADGROUP`); Next.js 15 App Router route handlers; Zod v4; Vitest (+ real test Postgres and real Redis from docker-compose).

**Spec:** `plans/fantasy-mvp-prototype.md` — **Step 3** in full, the **backend** bullets of **Step 4** (durable replay-based session store, crash-recovery test, `commitDraftResults`, `publishEvent` wiring, the automated two-SSE-client integration test), and Step 5's "Extend (not duplicate) Step 4's session store and `commitDraftResults` to handle auction-drafted rosters" (auction is first-class here, not bolted on later). `docs/conventions.md` is the binding engineering convention set; `docs/research/2026-08-16-beating-apex-strategy.md` §1.1/§4 is the product intent (one system that runs snake *and* auction natively — Apex outsources auctions to ESPN — with Underdog's auto-tightening clock instead of a 5-day email draft).

**Out of scope (Plan C builds these on top of what this plan ships):** every React surface — the snake draft board, the auction bidding UI, the pick-landing celebration motion, and the read-only TV draftboard at `/draft/<id>/board`. This plan ships the state, the selectors those components need, the API they call, and the events they subscribe to.

## Global Constraints

Copied from `docs/conventions.md` / the spec — every task's requirements implicitly include these:

- **No MVP.** Nothing built in a form a later phase plans to throw away.
- **Immutability:** every domain and engine type is `readonly`; arrays are `readonly T[]`; never mutate an input — return new objects.
- **No ambient clock** in `src/domain/**` or `src/draft-engine/**`: no `Date.now()`, no `new Date()` for "now". Parsing a *supplied* ISO string (`Date.parse(action.timestamp)`) is fine. `Date.now()`/`new Date()` are allowed only at the outermost edge (route handlers, `publisher.ts`, the seed entry point, the ticker's system clock).
- **Config over magic numbers:** tunables live in a `config.ts` next to the module; no inline literals.
- **Test-first.** Tests live beside code as `src/<feature>/**/*.test.ts`; run with `npm test -- src/<dir>`, never by guessed filename. Integration tests use the **real** test Postgres via `createTestDb()` + `truncateAll(db)` in `beforeEach` and the real Redis from docker-compose. Test files run serially (`fileParallelism: false`, already configured).
- **Coverage:** `src/scoring/**` and `src/draft-engine/**` must be 100% branches/functions/lines/statements (Task 5 adds the second threshold to `vitest.config.mts`). If a branch is uncovered, add a test — never lower the threshold.
- **Real-time — one mechanism.** Redis Streams → SSE, stream key `league:<id>:events`, plain `XREAD BLOCK` from a per-connection cursor. **Never `XREADGROUP`.** No Socket.io, no second transport, no new stream key per draft — `draft.*` events ride the league stream. Publishing is **best-effort and happens after** the Postgres write; a Redis failure must never make an accepted action look rejected.
- **Event types** are enumerated once in `src/lib/realtime/events.ts`. `draft.pick`, `draft.nominate`, `draft.bid`, `draft.timer_expire`, `draft.status` already exist there — add nothing.
- **API envelope:** `{ ok: true, data }` / `{ ok: false, error }` via `src/lib/api/respond.ts`; bodies parsed with `parseJson(request, ZodSchema)`. Error strings are user-facing plain language — never raw DB/exception text.
- **Identity:** server code reads "who is this" only via `getCurrentUser()` / `requireCurrentUser()` from `src/lib/auth/current-user.ts`. **API routes return a JSON 401, never a redirect.** The server resolves `teamId` from the authenticated user — **a client-supplied `teamId` is never trusted and never appears in a request body schema.**
- **Migrations:** `ADD COLUMN … NOT NULL` without a `DEFAULT` is acceptable only while the table is empty (pre-first-deploy).
- **Verification for every task:** `npm run typecheck && npm run lint && npm test -- <dir>`; the final task also `npm run build`.
- **Commits:** conventional commits; the body says *why* and records any deviation from the plan.
- **`docs/conventions.md` and `docs/design-system.md` outrank this plan's inline reference code.** If reference code in a task contradicts them, follow the conventions and note it in the task report.
- **Reference code in tasks is authoritative for interfaces, names, and test cases.** Implementers may restructure bodies for DRY without changing behavior.
- **Disputed type/compile claims are settled with `tsc`, not argument.** Run `npm run typecheck`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/domain/draft.ts` (modify) | The versioned, discriminated `DraftAction` union persisted in `draft_actions.action` forever, plus `DraftPoolEntry`. Pure types. |
| `src/domain/roster.ts` (modify) | Adds `STANDARD_ROSTER_SLOTS` — the one canonical 15-slot config, used by the `leagues.roster_slots` DB default, the seed, and tests. |
| `src/draft-engine/config.ts` | `DRAFT_CLOCK_SCHEDULE` (ordered tiers) and `AUCTION_CONFIG` (min bid, bid increment, bid window, per-slot budget reserve). Every tunable. |
| `src/draft-engine/state.ts` | `DraftConfig`, `DraftState`, `CompletedPick`, `AuctionLot`, `AuctionState`, `initialDraftState()`, `totalRosterSlots()`. |
| `src/draft-engine/action-schema.ts` | Zod schemas: `draftActionSchema` (parses persisted jsonb on replay) and `clientDraftActionSchema` (the HTTP body — **no `teamId`, no `timestamp`**). One source of truth for both boundaries. |
| `src/draft-engine/slotting.ts` | `assignSlot()` — picks the roster slot a drafted player lands in by **delegating to `validateRosterAdd`**, never reimplementing roster rules. |
| `src/draft-engine/order.ts` | `snakeTeamForPick()`, `roundForPick()` — snake serpentine turn order. |
| `src/draft-engine/apply-pick.ts` | `applyPick()` — the shared "record a pick + fill a roster slot" transition used by snake picks, snake autopicks, and auction awards. Does not advance the turn. |
| `src/draft-engine/snake.ts` | `reduceMakePick()`, `reduceSnakeExpiry()`, `advanceSnake()`. |
| `src/draft-engine/auction.ts` | `reduceNominate()`, `reduceBid()`, `reduceAuctionExpiry()`, `nextNominator()`. |
| `src/draft-engine/clock-schedule.ts` | `hoursUntil()`, `clockTierFor()`, `tierIndexFor()`, `nextTighteningAfter()` — the auto-tightening clock, pure. |
| `src/draft-engine/selectors.ts` | Derived reads for the service and Plan C's UI: who's on the clock, deadline, current tier, when it next shortens, available pool, budgets, `draftStateView()`. |
| `src/draft-engine/reduce.ts` | The one public reducer: `reduceDraft(state, action)`. Dispatch + `START_DRAFT` + sequence bump. |
| `src/draft-engine/events.ts` | `draftEventsFor(prev, next, action)` → the `draft.*` envelopes the service publishes. Pure. |
| `src/draft-engine/replay.ts` | `replayDraft(config, actions)`, `DraftReplayError`. |
| `src/draft-engine/index.ts` | Barrel — the engine's public surface. |
| `src/draft-service/config.ts` | `DRAFT_SERVICE_CONFIG` (ticker interval, ticker batch size). |
| `src/draft-service/mutex.ts` | `createKeyedMutex()` — in-process per-draft serialization (Phase 1, single instance). |
| `src/draft-service/setup.ts` | `loadDraftConfig(db, draftId)` — builds `DraftConfig` from the `drafts` + `leagues` rows. |
| `src/draft-service/pool.ts` | `buildDraftPool(db, leagueId)` — the ranked player pool (deterministic: projected season points via `computeFantasyPoints`, tie-broken by playerId). |
| `src/draft-service/order.ts` | `draftOrderFor(draftId, teamIds)` — deterministic seeded shuffle. |
| `src/draft-service/store.ts` | `createDraftStore()` — `getDraftState`, `applyAction`, `invalidate`, `startDraft`, `commitDraftResults`. The durable replay-based session store. |
| `src/draft-service/commit.ts` | `commitDraftResults()` internals — one transaction writing `draft_picks` + `roster_slots` + `drafts.status`. |
| `src/draft-service/ticker.ts` | `createDraftTicker()` — injectable `Clock` + explicit `tick()`; `start()`/`stop()` wrap it in a `setInterval`. |
| `src/draft-service/authz.ts` | `resolveDraftActor(db, draftId, userId)` — the one place routes learn the caller's team and commissioner status. |
| `src/draft-service/index.ts` | `getDraftStore()`, `getDraftTicker()` process singletons. |
| `src/draft-service/test-support.ts` | Shared test fixtures (`SPRINT_ROSTER_SLOTS`, `seedDraftFixture()`), not a `.test.ts` so vitest doesn't collect it. |
| `src/app/api/drafts/[draftId]/route.ts` | `GET` — materialized state + selectors. |
| `src/app/api/drafts/[draftId]/actions/route.ts` | `POST` — submit MAKE_PICK / NOMINATE / BID for the caller's own team. |
| `src/app/api/drafts/[draftId]/start/route.ts` | `POST` — commissioner starts the draft. |
| `src/instrumentation.ts` | Starts the draft ticker once per Node server process. |
| `src/data/seed/config.ts`, `src/data/seed/seed-dev-leagues.ts` | Dev league + 12 teams + scheduled snake and auction drafts, added to the ONE seed entry point. |
| `docs/draft-engine.md` | State shape, action union, invariants, replay model, event payload contracts. |

Existing files this plan modifies: `src/db/schema.ts` (`leagues.roster_slots`, `draft_actions.sequence`), `src/data/seed/index.ts`, `vitest.config.mts` (coverage threshold), `docs/conventions.md`, `package.json` (no new scripts required — verify).

---

### Task 1: Draft action union, state types, engine config, slot assignment

**Model tier:** standard.

**Files:**
- Modify: `src/domain/draft.ts`, `src/domain/roster.ts`
- Create: `src/draft-engine/config.ts`, `src/draft-engine/state.ts`, `src/draft-engine/slotting.ts`, `src/draft-engine/action-schema.ts`
- Test: `src/draft-engine/state.test.ts`, `src/draft-engine/slotting.test.ts`, `src/draft-engine/action-schema.test.ts`

**Interfaces:**
- Consumes: `Position` (`@/domain/player`), `RosterSlot`, `RosterSlotConfig`, `RosterSlotType` (`@/domain/roster`), `validateRosterAdd`, `eligibleSlotsForPosition` (`@/domain/roster-eligibility`), `DraftFormat` (`@/domain/league`), `DraftStatus` (`@/domain/draft`).
- Produces (every later task depends on these exact names):
  - `DRAFT_ACTION_VERSION = 1`; `DraftPoolEntry = { readonly playerId: string; readonly position: Position }`; the `DraftAction` union with members `StartDraftAction | MakePickAction | NominateAction | BidAction | TimerExpireAction`.
  - `STANDARD_ROSTER_SLOTS: readonly RosterSlotConfig[]` (8 slot types summing to 15 roster spots).
  - `DRAFT_CLOCK_SCHEDULE: readonly ClockTier[]`, `ClockTier = { readonly untilHoursBeforeKickoff: number; readonly pickSeconds: number }`, `AUCTION_CONFIG`.
  - `DraftConfig`, `DraftState`, `CompletedPick`, `AuctionLot`, `AuctionState`, `initialDraftState(config: DraftConfig): DraftState`, `totalRosterSlots(slotConfig: readonly RosterSlotConfig[]): number`, `rosterFor(state, teamId): readonly RosterSlot[]`, `auctionOf(state): AuctionState | null`.
  - `assignSlot(input: { position: Position; roster: readonly RosterSlot[]; slotConfig: readonly RosterSlotConfig[] }): SlotAssignment` where `SlotAssignment = { readonly ok: true; readonly slot: RosterSlotType; readonly slotIndex: number } | { readonly ok: false; readonly reason: string }`.
  - `draftActionSchema: ZodType<DraftAction>`, `clientDraftActionSchema` (body type `ClientDraftAction`).

**Design notes the implementer must preserve:**
- `draft_actions.action` holds this JSON **forever**, so every member carries `v: 1` (`DRAFT_ACTION_VERSION`). A future shape change adds `v: 2` members and a migration path in `draftActionSchema`; it never silently reinterprets old rows.
- `START_DRAFT` carries **both** the draft order and the full ranked pool. That makes the action log self-contained: replay never re-derives an ordering or a ranking that could have changed since (projections move; the pool a draft actually ran against must not).
- `DraftState.rosters` holds **only filled slots**. `validateRosterAdd` counts filled slots, so this is exactly the shape it wants, and `slotIndex` is simply the count of existing entries for that slot type.

- [ ] **Step 1: Write the failing state + slotting tests**

```ts
// src/draft-engine/state.test.ts
import { describe, it, expect } from "vitest";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { auctionOf, initialDraftState, rosterFor, totalRosterSlots, type DraftConfig } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";

const config: DraftConfig = {
  draftId: "draft_1",
  leagueId: "league_1",
  format: "snake",
  kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null,
  slotConfig: STANDARD_ROSTER_SLOTS,
  clockSchedule: DRAFT_CLOCK_SCHEDULE,
};

describe("totalRosterSlots", () => {
  it("sums every slot's count — the standard config is 15 rounds", () => {
    expect(totalRosterSlots(STANDARD_ROSTER_SLOTS)).toBe(15);
  });
  it("is 0 for an empty config", () => {
    expect(totalRosterSlots([])).toBe(0);
  });
});

describe("initialDraftState", () => {
  const state = initialDraftState(config);

  it("starts scheduled at sequence 0 with nothing drafted and no clock running", () => {
    expect(state.phase).toBe("scheduled");
    expect(state.sequence).toBe(0);
    expect(state.picks).toEqual([]);
    expect(state.draftOrder).toEqual([]);
    expect(state.pool).toEqual([]);
    expect(state.rosters).toEqual({});
    expect(state.budgets).toEqual({});
    expect(state.auction).toBeNull();
    expect(state.pickNumber).toBe(0);
    expect(state.turnStartedAt).toBeNull();
  });

  it("carries the config through unchanged", () => {
    expect(state.config).toBe(config);
  });

  it("has an empty roster for a team it has never seen", () => {
    expect(rosterFor(state, "nobody")).toEqual([]);
  });

  it("has no auction sub-state for a snake draft", () => {
    expect(auctionOf(state)).toBeNull();
  });
});
```

```ts
// src/draft-engine/slotting.test.ts
import { describe, it, expect } from "vitest";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { assignSlot } from "./slotting";

const filled = (slot: RosterSlot["slot"], slotIndex: number, playerId: string): RosterSlot => ({ slot, slotIndex, playerId });

describe("assignSlot", () => {
  it("puts a player in the first eligible slot in config order", () => {
    expect(assignSlot({ position: "RB", roster: [], slotConfig: STANDARD_ROSTER_SLOTS })).toEqual({ ok: true, slot: "RB", slotIndex: 0 });
  });

  it("fills the second copy of a multi-count slot", () => {
    const roster = [filled("RB", 0, "p1")];
    expect(assignSlot({ position: "RB", roster, slotConfig: STANDARD_ROSTER_SLOTS })).toEqual({ ok: true, slot: "RB", slotIndex: 1 });
  });

  it("overflows to FLEX once the dedicated slots are full", () => {
    const roster = [filled("RB", 0, "p1"), filled("RB", 1, "p2")];
    expect(assignSlot({ position: "RB", roster, slotConfig: STANDARD_ROSTER_SLOTS })).toEqual({ ok: true, slot: "FLEX", slotIndex: 0 });
  });

  it("overflows to BENCH once FLEX is full too", () => {
    const roster = [filled("RB", 0, "p1"), filled("RB", 1, "p2"), filled("FLEX", 0, "p3")];
    expect(assignSlot({ position: "RB", roster, slotConfig: STANDARD_ROSTER_SLOTS })).toEqual({ ok: true, slot: "BENCH", slotIndex: 0 });
  });

  it("rejects with a plain-language reason when every eligible slot is full", () => {
    const roster = [filled("QB", 0, "p1"), ...Array.from({ length: 6 }, (_, i) => filled("BENCH", i, `b${i}`))];
    const result = assignSlot({ position: "QB", roster, slotConfig: STANDARD_ROSTER_SLOTS });
    expect(result).toEqual({ ok: false, reason: "Your roster has no open slot for a QB." });
  });

  it("rejects when the league has no slot that accepts the position at all", () => {
    const noKicker: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.filter((s) => s.slot !== "K" && s.slot !== "BENCH");
    const result = assignSlot({ position: "K", roster: [], slotConfig: noKicker });
    expect(result).toEqual({ ok: false, reason: "No roster slot in this league accepts a K." });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/draft-engine`
Expected: FAIL — cannot find module `./state` / `./slotting` / `@/domain/roster` export `STANDARD_ROSTER_SLOTS`.

- [ ] **Step 3: Add `STANDARD_ROSTER_SLOTS` to the roster domain**

Append to `src/domain/roster.ts`:

```ts
/**
 * The canonical 15-slot roster. One definition, used by the `leagues.roster_slots`
 * column default, the dev seed, and every test — a league may override it per-league,
 * but nothing re-declares this shape.
 */
export const STANDARD_ROSTER_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 2, eligiblePositions: ["RB"] },
  { slot: "WR", count: 2, eligiblePositions: ["WR"] },
  { slot: "TE", count: 1, eligiblePositions: ["TE"] },
  { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
  { slot: "K", count: 1, eligiblePositions: ["K"] },
  { slot: "DEF", count: 1, eligiblePositions: ["DEF"] },
  { slot: "BENCH", count: 6, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];
```

- [ ] **Step 4: Replace the flat `DraftAction` with the versioned union**

Nothing outside `src/domain/draft.ts` imports the old flat `DraftAction` (verified: `grep -rn "DraftAction" src` matches only that file), so this is a clean replacement, not a migration. Replace the `DraftActionType`/`DraftAction` block in `src/domain/draft.ts` with:

```ts
import type { Position } from "./player";

/**
 * Persisted JSON shape version. `draft_actions.action` stores these rows forever, so the
 * discriminant `v` travels with every action: a future shape adds `v: 2` members and an
 * explicit upgrade path, and never silently reinterprets a `v: 1` row.
 */
export const DRAFT_ACTION_VERSION = 1;

export type DraftActionType = "START_DRAFT" | "MAKE_PICK" | "NOMINATE" | "BID" | "TIMER_EXPIRE";

/** One draftable player, as the draft saw them: id plus the position roster rules key off. */
export interface DraftPoolEntry {
  readonly playerId: string;
  readonly position: Position;
}

/**
 * Opens the draft. Carries the team order AND the ranked pool so the action log is
 * self-contained: replaying it can never depend on a ranking or ordering that has since moved.
 */
export interface StartDraftAction {
  readonly v: 1;
  readonly type: "START_DRAFT";
  readonly timestamp: string;
  /** Team ids in round-1 pick order (snake) / nomination order (auction). */
  readonly draftOrder: readonly string[];
  /** The full draftable pool, best player first. */
  readonly pool: readonly DraftPoolEntry[];
}

export interface MakePickAction {
  readonly v: 1;
  readonly type: "MAKE_PICK";
  readonly timestamp: string;
  readonly teamId: string;
  readonly playerId: string;
}

export interface NominateAction {
  readonly v: 1;
  readonly type: "NOMINATE";
  readonly timestamp: string;
  readonly teamId: string;
  readonly playerId: string;
  /** The nominating team's own opening bid — a nomination is a bid. */
  readonly openingBid: number;
}

export interface BidAction {
  readonly v: 1;
  readonly type: "BID";
  readonly timestamp: string;
  readonly teamId: string;
  readonly amount: number;
}

/** Submitted only by the server-side ticker, never by a client. */
export interface TimerExpireAction {
  readonly v: 1;
  readonly type: "TIMER_EXPIRE";
  readonly timestamp: string;
}

export type DraftAction =
  | StartDraftAction
  | MakePickAction
  | NominateAction
  | BidAction
  | TimerExpireAction;
```

- [ ] **Step 5: Implement engine config, state, and slotting**

```ts
// src/draft-engine/config.ts

/**
 * One tier of the auto-tightening pick clock. A tier applies while the draft is more than
 * `untilHoursBeforeKickoff` hours from kickoff; tiers are ordered farthest-out first, and
 * the last tier is the floor that applies at (and after) kickoff.
 *
 * This is the direct answer to Apex's 5-day email draft (strategy doc §1.1, §4): schedule
 * flexibility without ever leaving a live room.
 */
export interface ClockTier {
  readonly untilHoursBeforeKickoff: number;
  readonly pickSeconds: number;
}

/** 8h → 4h → 1h → 10m → 60s, per the strategy doc's named schedule. */
export const DRAFT_CLOCK_SCHEDULE: readonly ClockTier[] = [
  { untilHoursBeforeKickoff: 168, pickSeconds: 8 * 60 * 60 },
  { untilHoursBeforeKickoff: 48, pickSeconds: 4 * 60 * 60 },
  { untilHoursBeforeKickoff: 12, pickSeconds: 60 * 60 },
  { untilHoursBeforeKickoff: 2, pickSeconds: 10 * 60 },
  { untilHoursBeforeKickoff: 0, pickSeconds: 60 },
];

export const AUCTION_CONFIG = {
  /** Lowest legal opening bid, in whole dollars. */
  minBid: 1,
  /** Minimum raise over the standing high bid. League-configurable later; never a literal. */
  bidIncrement: 1,
  /** How long a live bidding window stays open after the latest bid, in seconds. */
  bidWindowSeconds: 15,
  /** Dollars a team must keep in reserve for each roster spot it still has to fill. */
  reservePerOpenSlot: 1,
} as const;
```

```ts
// src/draft-engine/state.ts
import type { DraftFormat } from "@/domain/league";
import type { DraftPoolEntry, DraftStatus } from "@/domain/draft";
import type { RosterSlot, RosterSlotConfig, RosterSlotType } from "@/domain/roster";
import type { ClockTier } from "./config";

/** Static, DB-derived setup. Never changes during a draft. */
export interface DraftConfig {
  readonly draftId: string;
  readonly leagueId: string;
  readonly format: DraftFormat;
  /** The league's first-kickoff instant — what the auto-tightening clock is measured against. */
  readonly kickoffAt: string;
  /** Auction dollars per team; null for snake drafts. */
  readonly auctionBudget: number | null;
  readonly slotConfig: readonly RosterSlotConfig[];
  readonly clockSchedule: readonly ClockTier[];
}

export interface CompletedPick {
  /** Global 1-based pick order (snake pick number / auction lot number). */
  readonly pickNumber: number;
  /** Snake: the serpentine round. Auction: how many players this team had already won, +1. */
  readonly round: number;
  readonly teamId: string;
  readonly playerId: string;
  readonly slot: RosterSlotType;
  /** Winning bid for an auction pick; null for a snake pick. */
  readonly price: number | null;
  readonly timestamp: string;
  /** True when the clock made this pick, not a human. */
  readonly auto: boolean;
}

export interface AuctionLot {
  readonly playerId: string;
  readonly highBid: number;
  readonly highBidTeamId: string;
  readonly nominatedByTeamId: string;
  /** True when the clock nominated this player because the nominating team stalled. */
  readonly autoNominated: boolean;
}

export interface AuctionState {
  /** Team whose turn it is to nominate; null once every roster is full. */
  readonly nominatingTeamId: string | null;
  /** The player currently up for bid, or null between lots. */
  readonly lot: AuctionLot | null;
}

export interface DraftState {
  readonly config: DraftConfig;
  readonly phase: DraftStatus;
  /** Count of actions applied. Doubles as the optimistic-concurrency sequence number. */
  readonly sequence: number;
  readonly draftOrder: readonly string[];
  /** The draftable pool, best player first. Empty until START_DRAFT. */
  readonly pool: readonly DraftPoolEntry[];
  readonly picks: readonly CompletedPick[];
  /** teamId → filled roster slots only. Empty slots are simply absent. */
  readonly rosters: Readonly<Record<string, readonly RosterSlot[]>>;
  /** teamId → remaining auction dollars. Empty for snake drafts. */
  readonly budgets: Readonly<Record<string, number>>;
  readonly auction: AuctionState | null;
  /** Snake: the pick about to be made. Auction: the lot about to be awarded. 1-based. */
  readonly pickNumber: number;
  /** When the current clock window started. The deadline is derived, never stored. */
  readonly turnStartedAt: string | null;
}

/**
 * The one reducer result shape. It lives here rather than in `reduce.ts` so that
 * `snake.ts` and `auction.ts` can reference it without importing the module that
 * imports them — no cycle, type-only or otherwise.
 */
export type DraftReduceResult =
  | { readonly ok: true; readonly state: DraftState }
  | { readonly ok: false; readonly reason: string };

/** Rounds in a snake draft = roster spots per team. */
export function totalRosterSlots(slotConfig: readonly RosterSlotConfig[]): number {
  return slotConfig.reduce((sum, s) => sum + s.count, 0);
}

export function initialDraftState(config: DraftConfig): DraftState {
  return {
    config,
    phase: "scheduled",
    sequence: 0,
    draftOrder: [],
    pool: [],
    picks: [],
    rosters: {},
    budgets: {},
    auction: null,
    pickNumber: 0,
    turnStartedAt: null,
  };
}

/** Convenience for callers building a roster map: the filled slots for one team. */
export function rosterFor(state: DraftState, teamId: string): readonly RosterSlot[] {
  return state.rosters[teamId] ?? [];
}

/**
 * The auction sub-state, or null for a snake draft. One accessor, so no caller re-derives
 * "is this an auction" from two fields that could disagree.
 */
export function auctionOf(state: DraftState): AuctionState | null {
  return state.config.format === "auction" ? state.auction : null;
}
```

```ts
// src/draft-engine/slotting.ts
import type { Position } from "@/domain/player";
import type { RosterSlot, RosterSlotConfig, RosterSlotType } from "@/domain/roster";
import { eligibleSlotsForPosition, validateRosterAdd } from "@/domain/roster-eligibility";

export type SlotAssignment =
  | { readonly ok: true; readonly slot: RosterSlotType; readonly slotIndex: number }
  | { readonly ok: false; readonly reason: string };

interface AssignSlotInput {
  readonly position: Position;
  /** Filled slots only. */
  readonly roster: readonly RosterSlot[];
  readonly slotConfig: readonly RosterSlotConfig[];
}

/**
 * Where a newly drafted player lands. Roster-construction rules are NOT reimplemented here:
 * eligibility and capacity both come from `src/domain/roster-eligibility.ts`. This function
 * only chooses among the slots that module says are legal — first eligible slot in config
 * order, so starters fill before FLEX and FLEX before BENCH, deterministically.
 */
export function assignSlot({ position, roster, slotConfig }: AssignSlotInput): SlotAssignment {
  const eligible = eligibleSlotsForPosition(position, slotConfig);
  if (eligible.length === 0) {
    return { ok: false, reason: `No roster slot in this league accepts a ${position}.` };
  }
  for (const slot of eligible) {
    const check = validateRosterAdd({ slotConfig, currentRoster: roster, position, targetSlot: slot });
    if (check.valid) {
      const slotIndex = roster.filter((s) => s.slot === slot).length;
      return { ok: true, slot, slotIndex };
    }
  }
  return { ok: false, reason: `Your roster has no open slot for a ${position}.` };
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- src/draft-engine && npm run typecheck`
Expected: PASS (12 tests: 6 state + 6 slotting); typecheck clean.

- [ ] **Step 7: Write the failing action-schema tests**

```ts
// src/draft-engine/action-schema.test.ts
import { describe, it, expect } from "vitest";
import { clientDraftActionSchema, draftActionSchema } from "./action-schema";

describe("draftActionSchema (persisted jsonb boundary)", () => {
  it("accepts a v1 MAKE_PICK row", () => {
    const row = { v: 1, type: "MAKE_PICK", timestamp: "2026-09-01T00:00:00.000Z", teamId: "t1", playerId: "p1" };
    expect(draftActionSchema.parse(row)).toEqual(row);
  });

  it("accepts a v1 START_DRAFT row with its order and pool", () => {
    const row = {
      v: 1,
      type: "START_DRAFT",
      timestamp: "2026-09-01T00:00:00.000Z",
      draftOrder: ["t1", "t2"],
      pool: [{ playerId: "p1", position: "QB" }],
    };
    expect(draftActionSchema.parse(row)).toEqual(row);
  });

  it("rejects an unknown version — old rows are never silently reinterpreted", () => {
    const row = { v: 2, type: "MAKE_PICK", timestamp: "2026-09-01T00:00:00.000Z", teamId: "t1", playerId: "p1" };
    expect(draftActionSchema.safeParse(row).success).toBe(false);
  });

  it("rejects an unknown action type", () => {
    expect(draftActionSchema.safeParse({ v: 1, type: "TRADE", timestamp: "2026-09-01T00:00:00.000Z" }).success).toBe(false);
  });

  it("rejects a non-positive bid", () => {
    const row = { v: 1, type: "BID", timestamp: "2026-09-01T00:00:00.000Z", teamId: "t1", amount: 0 };
    expect(draftActionSchema.safeParse(row).success).toBe(false);
  });
});

describe("clientDraftActionSchema (HTTP body boundary)", () => {
  it("accepts a pick submission", () => {
    expect(clientDraftActionSchema.parse({ type: "MAKE_PICK", playerId: "p1" })).toEqual({ type: "MAKE_PICK", playerId: "p1" });
  });

  it("defaults a nomination's opening bid to the configured minimum", () => {
    expect(clientDraftActionSchema.parse({ type: "NOMINATE", playerId: "p1" })).toEqual({ type: "NOMINATE", playerId: "p1", openingBid: 1 });
  });

  it("ignores a client-supplied teamId — the server always resolves the team from the session", () => {
    const parsed = clientDraftActionSchema.parse({ type: "MAKE_PICK", playerId: "p1", teamId: "someone_elses_team" });
    expect(parsed).not.toHaveProperty("teamId");
  });

  it("refuses TIMER_EXPIRE from a client — only the server ticker may expire a clock", () => {
    expect(clientDraftActionSchema.safeParse({ type: "TIMER_EXPIRE" }).success).toBe(false);
  });

  it("refuses START_DRAFT from the actions endpoint", () => {
    expect(clientDraftActionSchema.safeParse({ type: "START_DRAFT" }).success).toBe(false);
  });
});
```

- [ ] **Step 8: Run to verify failure**

Run: `npm test -- src/draft-engine/action-schema`
Expected: FAIL — cannot find module `./action-schema`.

- [ ] **Step 9: Implement the schemas**

```ts
// src/draft-engine/action-schema.ts
import { z } from "zod";
import { DRAFT_ACTION_VERSION, type DraftAction } from "@/domain/draft";
import { AUCTION_CONFIG } from "./config";

const version = z.literal(DRAFT_ACTION_VERSION);
const timestamp = z.string().min(1);
const teamId = z.string().min(1);
const playerId = z.string().min(1);
const dollars = z.number().int().positive();

const poolEntry = z.object({
  playerId,
  position: z.enum(["QB", "RB", "WR", "TE", "K", "DEF"]),
});

/**
 * The persisted-row boundary. `draft_actions.action` is jsonb written by an earlier
 * process (possibly an earlier deploy), so replay validates it rather than trusting it.
 * Unknown `v` values fail loudly instead of being reinterpreted as v1.
 */
export const draftActionSchema: z.ZodType<DraftAction> = z.discriminatedUnion("type", [
  z.object({ v: version, type: z.literal("START_DRAFT"), timestamp, draftOrder: z.array(teamId).min(2), pool: z.array(poolEntry).min(1) }),
  z.object({ v: version, type: z.literal("MAKE_PICK"), timestamp, teamId, playerId }),
  z.object({ v: version, type: z.literal("NOMINATE"), timestamp, teamId, playerId, openingBid: dollars }),
  z.object({ v: version, type: z.literal("BID"), timestamp, teamId, amount: dollars }),
  z.object({ v: version, type: z.literal("TIMER_EXPIRE"), timestamp }),
]);

/**
 * The HTTP boundary for POST /api/drafts/:draftId/actions.
 *
 * Deliberately has NO `teamId` and NO `timestamp`: the server resolves the acting team
 * from the authenticated session and stamps the time itself. A client that sends a
 * `teamId` has it stripped, not honoured. TIMER_EXPIRE and START_DRAFT are absent because
 * only the ticker and the commissioner route may produce them.
 */
export const clientDraftActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MAKE_PICK"), playerId }),
  z.object({ type: z.literal("NOMINATE"), playerId, openingBid: dollars.default(AUCTION_CONFIG.minBid) }),
  z.object({ type: z.literal("BID"), amount: dollars }),
]);

export type ClientDraftAction = z.infer<typeof clientDraftActionSchema>;
```

- [ ] **Step 10: Run to verify pass**

Run: `npm test -- src/draft-engine && npm run typecheck && npm run lint`
Expected: PASS (22 tests); typecheck and lint clean.

If `z.ZodType<DraftAction>` rejects the discriminated union structurally, do **not** widen to `z.ZodType<unknown>` — instead add `satisfies` at the parse site and settle the exact annotation with `npm run typecheck`.

- [ ] **Step 11: Commit**

```bash
git add src/domain/draft.ts src/domain/roster.ts src/draft-engine
git commit -m "feat(draft): versioned draft action union, engine state types, clock/auction config, slot assignment

The persisted action JSON lives in draft_actions forever, so it carries an explicit
version discriminant, and START_DRAFT snapshots the order and ranked pool so replay can
never depend on a ranking that has since moved. Slot assignment delegates every roster
rule to domain/roster-eligibility rather than restating it."
```

---

### Task 2: Snake reducer core — START_DRAFT, turn order, MAKE_PICK, rejections

**Model tier:** capable model (this is the correctness core of the product).

**Files:**
- Create: `src/draft-engine/order.ts`, `src/draft-engine/apply-pick.ts`, `src/draft-engine/snake.ts`, `src/draft-engine/reduce.ts`, `src/draft-engine/selectors.ts`
- Test: `src/draft-engine/order.test.ts`, `src/draft-engine/reduce-snake.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produced (`DraftState`, `DraftConfig`, `initialDraftState`, `totalRosterSlots`, `rosterFor`, `assignSlot`, the `DraftAction` union, `STANDARD_ROSTER_SLOTS`, `DRAFT_CLOCK_SCHEDULE`).
- Produces:
  - `snakeTeamForPick(draftOrder: readonly string[], pickNumber: number): string`, `roundForPick(teamCount: number, pickNumber: number): number` (both 1-based `pickNumber`).
  - `applyPick(state: DraftState, input: ApplyPickInput): ApplyPickResult` where `ApplyPickInput = { readonly teamId: string; readonly playerId: string; readonly price: number | null; readonly auto: boolean; readonly timestamp: string }` and `ApplyPickResult = { readonly ok: true; readonly state: DraftState } | { readonly ok: false; readonly reason: string }`.
  - `DraftReduceResult = { readonly ok: true; readonly state: DraftState } | { readonly ok: false; readonly reason: string }` — declared in `state.ts` (so `snake.ts`/`auction.ts` can use it without an import cycle) and re-exported from `reduce.ts`.
  - `reduceDraft(state: DraftState, action: DraftAction): DraftReduceResult`. **This is the single public reducer shape used by every later task.** On success `state.sequence` is exactly `previous.sequence + 1`.
  - `reduceMakePick(state, action: MakePickAction): DraftReduceResult`, `advanceSnake(state: DraftState, timestamp: string): DraftState`.
  - Selectors: `draftedPlayerIds(state): ReadonlySet<string>`, `availablePool(state): readonly DraftPoolEntry[]`, `openSlotCount(state, teamId): number`, `isComplete(state): boolean`, `teamOnClock(state): string | null`, `bestAvailableFor(state, teamId): DraftPoolEntry | null`. (Task 3 extends `teamOnClock` for auction and adds budget selectors; Task 4 adds the clock selectors and `draftStateView`.)

- [ ] **Step 1: Write the failing turn-order tests**

```ts
// src/draft-engine/order.test.ts
import { describe, it, expect } from "vitest";
import { roundForPick, snakeTeamForPick } from "./order";

const ORDER = ["a", "b", "c", "d"];

describe("roundForPick", () => {
  it.each([
    [1, 1],
    [4, 1],
    [5, 2],
    [8, 2],
    [9, 3],
  ])("pick %i is in round %i for 4 teams", (pickNumber, expected) => {
    expect(roundForPick(ORDER.length, pickNumber)).toBe(expected);
  });
});

describe("snakeTeamForPick", () => {
  it("runs odd rounds forwards", () => {
    expect([1, 2, 3, 4].map((n) => snakeTeamForPick(ORDER, n))).toEqual(["a", "b", "c", "d"]);
  });

  it("reverses on even rounds — the team that picked last picks first", () => {
    expect([5, 6, 7, 8].map((n) => snakeTeamForPick(ORDER, n))).toEqual(["d", "c", "b", "a"]);
  });

  it("reverses back on round three", () => {
    expect([9, 10, 11, 12].map((n) => snakeTeamForPick(ORDER, n))).toEqual(["a", "b", "c", "d"]);
  });

  it("gives every team exactly the same number of picks over a full 12-team, 15-round draft", () => {
    const order = Array.from({ length: 12 }, (_, i) => `t${i + 1}`);
    const counts = new Map<string, number>();
    for (let n = 1; n <= 12 * 15; n++) {
      const team = snakeTeamForPick(order, n);
      counts.set(team, (counts.get(team) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual(Array.from({ length: 12 }, () => 15));
  });

  it("throws for a pick number outside the draft", () => {
    expect(() => snakeTeamForPick(ORDER, 0)).toThrow(/pick number/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/draft-engine/order`
Expected: FAIL — cannot find module `./order`.

- [ ] **Step 3: Implement turn order**

```ts
// src/draft-engine/order.ts

/** 1-based round containing a 1-based pick number. */
export function roundForPick(teamCount: number, pickNumber: number): number {
  return Math.ceil(pickNumber / teamCount);
}

/**
 * Snake order: odd rounds run down the draft order, even rounds run back up it.
 * `draftOrder` is round-1 order; `pickNumber` is 1-based and global across rounds.
 */
export function snakeTeamForPick(draftOrder: readonly string[], pickNumber: number): string {
  if (!Number.isInteger(pickNumber) || pickNumber < 1) {
    throw new Error(`Invalid pick number: ${pickNumber}.`);
  }
  const teamCount = draftOrder.length;
  const round = roundForPick(teamCount, pickNumber);
  const indexInRound = (pickNumber - 1) % teamCount;
  const orderIndex = round % 2 === 1 ? indexInRound : teamCount - 1 - indexInRound;
  const team = draftOrder[orderIndex];
  if (team === undefined) throw new Error(`Invalid pick number: ${pickNumber}.`);
  return team;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/draft-engine/order`
Expected: PASS (10 tests).

- [ ] **Step 5: Write the failing snake reducer tests**

```ts
// src/draft-engine/reduce-snake.test.ts
import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { availablePool, bestAvailableFor, isComplete, openSlotCount, teamOnClock } from "./selectors";

/** Three slots per team keeps reducer tests fast and every assertion hand-checkable. */
const SPRINT_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "BENCH", count: 1, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
  { playerId: "wr1", position: "WR" },
  { playerId: "qb3", position: "QB" },
  { playerId: "rb3", position: "RB" },
  { playerId: "wr2", position: "WR" },
];

const CONFIG: DraftConfig = {
  draftId: "draft_1",
  leagueId: "league_1",
  format: "snake",
  kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null,
  slotConfig: SPRINT_SLOTS,
  clockSchedule: DRAFT_CLOCK_SCHEDULE,
};

const START: StartDraftAction = {
  v: 1,
  type: "START_DRAFT",
  timestamp: "2026-09-01T00:00:00.000Z",
  draftOrder: ["t1", "t2"],
  pool: POOL,
};

function started(): DraftState {
  const result = reduceDraft(initialDraftState(CONFIG), START);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

function pick(state: DraftState, teamId: string, playerId: string, timestamp = "2026-09-01T00:10:00.000Z"): DraftState {
  const result = reduceDraft(state, { v: 1, type: "MAKE_PICK", timestamp, teamId, playerId });
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

describe("START_DRAFT", () => {
  it("opens the draft, seeds empty rosters, starts the clock and puts team one on the clock", () => {
    const state = started();
    expect(state.phase).toBe("in_progress");
    expect(state.sequence).toBe(1);
    expect(state.pickNumber).toBe(1);
    expect(state.draftOrder).toEqual(["t1", "t2"]);
    expect(state.pool).toEqual(POOL);
    expect(state.turnStartedAt).toBe(START.timestamp);
    expect(state.rosters).toEqual({ t1: [], t2: [] });
    expect(teamOnClock(state)).toBe("t1");
  });

  it("rejects a second start", () => {
    expect(reduceDraft(started(), START)).toEqual({ ok: false, reason: "This draft has already started." });
  });

  it("rejects a draft order with a duplicate team", () => {
    const result = reduceDraft(initialDraftState(CONFIG), { ...START, draftOrder: ["t1", "t1"] });
    expect(result).toEqual({ ok: false, reason: "Every team may appear in the draft order only once." });
  });

  it("rejects a pool with a duplicate player", () => {
    const result = reduceDraft(initialDraftState(CONFIG), { ...START, pool: [POOL[0]!, POOL[0]!] });
    expect(result).toEqual({ ok: false, reason: "Every player may appear in the draft pool only once." });
  });

  it("rejects an auction draft with no budget", () => {
    const auctionConfig: DraftConfig = { ...CONFIG, format: "auction", auctionBudget: null };
    const result = reduceDraft(initialDraftState(auctionConfig), START);
    expect(result).toEqual({ ok: false, reason: "An auction draft needs a budget before it can start." });
  });
});

describe("MAKE_PICK (snake)", () => {
  it("records the pick, fills a roster slot, advances the clock and hands over the turn", () => {
    const state = pick(started(), "t1", "qb1");
    expect(state.sequence).toBe(2);
    expect(state.picks).toEqual([
      { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB", price: null, timestamp: "2026-09-01T00:10:00.000Z", auto: false },
    ]);
    expect(state.rosters.t1).toEqual([{ slot: "QB", slotIndex: 0, playerId: "qb1" }]);
    expect(state.pickNumber).toBe(2);
    expect(state.turnStartedAt).toBe("2026-09-01T00:10:00.000Z");
    expect(teamOnClock(state)).toBe("t2");
  });

  it("rejects a pick before the draft has started", () => {
    const result = reduceDraft(initialDraftState(CONFIG), { v: 1, type: "MAKE_PICK", timestamp: START.timestamp, teamId: "t1", playerId: "qb1" });
    expect(result).toEqual({ ok: false, reason: "This draft hasn't started yet." });
  });

  it("rejects a pick from a team that isn't on the clock", () => {
    const result = reduceDraft(started(), { v: 1, type: "MAKE_PICK", timestamp: START.timestamp, teamId: "t2", playerId: "qb1" });
    expect(result).toEqual({ ok: false, reason: "It's not your turn to pick." });
  });

  it("rejects an already-drafted player", () => {
    const state = pick(started(), "t1", "qb1");
    const result = reduceDraft(state, { v: 1, type: "MAKE_PICK", timestamp: START.timestamp, teamId: "t2", playerId: "qb1" });
    expect(result).toEqual({ ok: false, reason: "That player has already been drafted." });
  });

  it("rejects a player who isn't in this draft's pool", () => {
    const result = reduceDraft(started(), { v: 1, type: "MAKE_PICK", timestamp: START.timestamp, teamId: "t1", playerId: "ghost" });
    expect(result).toEqual({ ok: false, reason: "That player isn't in this draft's player pool." });
  });

  it("rejects a pick that would exceed the roster slots, via validateRosterAdd", () => {
    // t1 takes QB, RB and BENCH; a fourth player has nowhere to go.
    let state = pick(started(), "t1", "qb1");
    state = pick(state, "t2", "rb1");
    state = pick(state, "t2", "qb2");
    state = pick(state, "t1", "rb2");
    state = pick(state, "t1", "wr1");
    const result = reduceDraft(state, { v: 1, type: "MAKE_PICK", timestamp: START.timestamp, teamId: "t2", playerId: "qb3" });
    expect(result).toEqual({ ok: false, reason: "Your roster has no open slot for a QB." });
  });

  it("rejects a nomination in a snake draft", () => {
    const result = reduceDraft(started(), { v: 1, type: "NOMINATE", timestamp: START.timestamp, teamId: "t1", playerId: "qb1", openingBid: 1 });
    expect(result).toEqual({ ok: false, reason: "This is a snake draft — make a pick instead of nominating." });
  });

  it("completes the draft after the last pick and stops the clock", () => {
    let state = started();
    const script: readonly (readonly [string, string])[] = [
      ["t1", "qb1"], ["t2", "rb1"], ["t2", "qb2"], ["t1", "rb2"], ["t1", "wr1"], ["t2", "wr2"],
    ];
    for (const [teamId, playerId] of script) state = pick(state, teamId, playerId);
    expect(isComplete(state)).toBe(true);
    expect(state.phase).toBe("complete");
    expect(state.turnStartedAt).toBeNull();
    expect(teamOnClock(state)).toBeNull();
    expect(state.picks).toHaveLength(6);
    const result = reduceDraft(state, { v: 1, type: "MAKE_PICK", timestamp: START.timestamp, teamId: "t1", playerId: "qb3" });
    expect(result).toEqual({ ok: false, reason: "This draft has already finished." });
  });

  it("never mutates the state it was given", () => {
    const before = started();
    const snapshot = structuredClone(before);
    pick(before, "t1", "qb1");
    expect(before).toEqual(snapshot);
  });
});

describe("selectors", () => {
  it("reports the undrafted pool, remaining slots and best available for a team", () => {
    const state = pick(started(), "t1", "qb1");
    expect(availablePool(state).map((p) => p.playerId)).toEqual(["rb1", "qb2", "rb2", "wr1", "qb3", "rb3", "wr2"]);
    expect(openSlotCount(state, "t1")).toBe(2);
    expect(openSlotCount(state, "t2")).toBe(3);
    // t1 already has a QB, so the best player they can still roster is rb1.
    expect(bestAvailableFor(state, "t1")?.playerId).toBe("rb1");
    expect(bestAvailableFor(state, "t2")?.playerId).toBe("rb1");
  });

  it("returns null best-available for a team with no room left", () => {
    let state = pick(started(), "t1", "qb1");
    state = pick(state, "t2", "rb1");
    state = pick(state, "t2", "qb2");
    state = pick(state, "t1", "rb2");
    state = pick(state, "t1", "wr1");
    expect(bestAvailableFor(state, "t1")).toBeNull();
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npm test -- src/draft-engine/reduce-snake`
Expected: FAIL — cannot find module `./reduce`.

- [ ] **Step 7: Implement `applyPick`, the snake reducer, the dispatcher and the first selectors**

```ts
// src/draft-engine/apply-pick.ts
import { rosterFor, type CompletedPick, type DraftState } from "./state";
import { roundForPick } from "./order";
import { assignSlot } from "./slotting";
import { draftedPlayerIds } from "./selectors";

export interface ApplyPickInput {
  readonly teamId: string;
  readonly playerId: string;
  /** Auction winning bid; null for a snake pick. */
  readonly price: number | null;
  readonly auto: boolean;
  readonly timestamp: string;
}

export type ApplyPickResult =
  | { readonly ok: true; readonly state: DraftState }
  | { readonly ok: false; readonly reason: string };

/**
 * The one place a player becomes a pick: validates the player is real and undrafted, asks
 * `assignSlot` (which delegates to domain roster rules) where they land, and records both the
 * pick and the roster slot. It does NOT advance the turn — snake and auction advance differently.
 */
export function applyPick(state: DraftState, input: ApplyPickInput): ApplyPickResult {
  const entry = state.pool.find((p) => p.playerId === input.playerId);
  if (entry === undefined) return { ok: false, reason: "That player isn't in this draft's player pool." };
  if (draftedPlayerIds(state).has(input.playerId)) return { ok: false, reason: "That player has already been drafted." };

  const roster = rosterFor(state, input.teamId);
  const assignment = assignSlot({ position: entry.position, roster, slotConfig: state.config.slotConfig });
  if (!assignment.ok) return { ok: false, reason: assignment.reason };

  const round =
    state.config.format === "snake"
      ? roundForPick(state.draftOrder.length, state.pickNumber)
      : state.picks.filter((p) => p.teamId === input.teamId).length + 1;

  const pick: CompletedPick = {
    pickNumber: state.pickNumber,
    round,
    teamId: input.teamId,
    playerId: input.playerId,
    slot: assignment.slot,
    price: input.price,
    timestamp: input.timestamp,
    auto: input.auto,
  };

  return {
    ok: true,
    state: {
      ...state,
      picks: [...state.picks, pick],
      rosters: {
        ...state.rosters,
        [input.teamId]: [...roster, { slot: assignment.slot, slotIndex: assignment.slotIndex, playerId: input.playerId }],
      },
    },
  };
}
```

```ts
// src/draft-engine/snake.ts
import type { MakePickAction } from "@/domain/draft";
import { totalRosterSlots, type DraftState } from "./state";
import { snakeTeamForPick } from "./order";
import { applyPick } from "./apply-pick";
import type { DraftReduceResult } from "./state";

/** Moves to the next pick, or ends the draft once every roster spot is filled. */
export function advanceSnake(state: DraftState, timestamp: string): DraftState {
  const next = state.pickNumber + 1;
  const totalPicks = state.draftOrder.length * totalRosterSlots(state.config.slotConfig);
  return next > totalPicks
    ? { ...state, pickNumber: next, phase: "complete", turnStartedAt: null }
    : { ...state, pickNumber: next, turnStartedAt: timestamp };
}

export function reduceMakePick(state: DraftState, action: MakePickAction): DraftReduceResult {
  if (state.config.format !== "snake") {
    return { ok: false, reason: "This is an auction draft — nominate a player instead of picking." };
  }
  if (snakeTeamForPick(state.draftOrder, state.pickNumber) !== action.teamId) {
    return { ok: false, reason: "It's not your turn to pick." };
  }
  const applied = applyPick(state, {
    teamId: action.teamId,
    playerId: action.playerId,
    price: null,
    auto: false,
    timestamp: action.timestamp,
  });
  if (!applied.ok) return applied;
  return { ok: true, state: advanceSnake(applied.state, action.timestamp) };
}
```

```ts
// src/draft-engine/reduce.ts
import type { DraftAction, StartDraftAction } from "@/domain/draft";
import type { DraftReduceResult, DraftState } from "./state";
import { reduceMakePick } from "./snake";

export type { DraftReduceResult } from "./state";

function reduceStart(state: DraftState, action: StartDraftAction): DraftReduceResult {
  if (state.phase !== "scheduled") return { ok: false, reason: "This draft has already started." };
  if (action.draftOrder.length < 2) return { ok: false, reason: "A draft needs at least two teams." };
  if (new Set(action.draftOrder).size !== action.draftOrder.length) {
    return { ok: false, reason: "Every team may appear in the draft order only once." };
  }
  if (new Set(action.pool.map((p) => p.playerId)).size !== action.pool.length) {
    return { ok: false, reason: "Every player may appear in the draft pool only once." };
  }
  const isAuction = state.config.format === "auction";
  const budget = state.config.auctionBudget;
  if (isAuction && (budget === null || budget <= 0)) {
    return { ok: false, reason: "An auction draft needs a budget before it can start." };
  }
  const rosters = Object.fromEntries(action.draftOrder.map((teamId) => [teamId, []]));
  const budgets = isAuction ? Object.fromEntries(action.draftOrder.map((teamId) => [teamId, budget as number])) : {};
  return {
    ok: true,
    state: {
      ...state,
      phase: "in_progress",
      draftOrder: action.draftOrder,
      pool: action.pool,
      rosters,
      budgets,
      auction: isAuction ? { nominatingTeamId: action.draftOrder[0] ?? null, lot: null } : null,
      pickNumber: 1,
      turnStartedAt: action.timestamp,
    },
  };
}

/**
 * The one draft reducer. Pure: no I/O, no ambient clock — every action carries its own
 * `timestamp`. On success the returned state's `sequence` is exactly one higher, which is
 * what the durable store uses as its optimistic-concurrency expectation.
 */
export function reduceDraft(state: DraftState, action: DraftAction): DraftReduceResult {
  if (action.type !== "START_DRAFT") {
    if (state.phase === "scheduled") return { ok: false, reason: "This draft hasn't started yet." };
    if (state.phase === "complete") return { ok: false, reason: "This draft has already finished." };
  }
  const result = dispatch(state, action);
  if (!result.ok) return result;
  return { ok: true, state: { ...result.state, sequence: state.sequence + 1 } };
}

function dispatch(state: DraftState, action: DraftAction): DraftReduceResult {
  switch (action.type) {
    case "START_DRAFT":
      return reduceStart(state, action);
    case "MAKE_PICK":
      return reduceMakePick(state, action);
    default:
      return { ok: false, reason: "That action isn't supported yet." };
  }
}
```

The `default` arm is temporary scaffolding for this task only — Task 3 replaces it with `NOMINATE`/`BID` arms and Task 4 adds `TIMER_EXPIRE`, after which the switch is exhaustive and the `default` disappears.

```ts
// src/draft-engine/selectors.ts
import type { DraftPoolEntry } from "@/domain/draft";
import { rosterFor, totalRosterSlots, type DraftState } from "./state";
import { snakeTeamForPick } from "./order";
import { assignSlot } from "./slotting";

export function draftedPlayerIds(state: DraftState): ReadonlySet<string> {
  return new Set(state.picks.map((p) => p.playerId));
}

/** The undrafted pool, still in ranking order. */
export function availablePool(state: DraftState): readonly DraftPoolEntry[] {
  const drafted = draftedPlayerIds(state);
  return state.pool.filter((p) => !drafted.has(p.playerId));
}

export function openSlotCount(state: DraftState, teamId: string): number {
  return totalRosterSlots(state.config.slotConfig) - rosterFor(state, teamId).length;
}

export function isComplete(state: DraftState): boolean {
  return state.phase === "complete";
}

/** Whose turn it is: to pick (snake) or to nominate (auction — extended in Task 3). */
export function teamOnClock(state: DraftState): string | null {
  if (state.phase !== "in_progress") return null;
  return snakeTeamForPick(state.draftOrder, state.pickNumber);
}

/**
 * The autopick policy, stated once: the highest-ranked undrafted player this team can
 * legally roster. Ranking is `state.pool`'s order — an explicit input snapshotted at
 * START_DRAFT, never an ambient lookup — so the same log always autopicks the same player.
 */
export function bestAvailableFor(state: DraftState, teamId: string): DraftPoolEntry | null {
  const roster = rosterFor(state, teamId);
  for (const entry of availablePool(state)) {
    if (assignSlot({ position: entry.position, roster, slotConfig: state.config.slotConfig }).ok) return entry;
  }
  return null;
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npm test -- src/draft-engine && npm run typecheck && npm run lint`
Expected: PASS (all Task 1 tests plus 10 order + 16 reduce-snake); typecheck and lint clean.

- [ ] **Step 9: Commit**

```bash
git add src/draft-engine
git commit -m "feat(draft-engine): pure snake reducer — START_DRAFT, serpentine turn order, MAKE_PICK

Roster capacity is enforced by delegating to domain/roster-eligibility's validateRosterAdd
rather than restating slot rules in the reducer, and every rejection carries a plain-language
reason because these strings are what the API returns to a drafter mid-pick."
```

---

### Task 3: Auction reducer + timer-expiry transitions for both formats

**Model tier:** capable model (budget arithmetic and turn resolution are the highest-risk logic after snake order).

**Files:**
- Create: `src/draft-engine/auction.ts`
- Modify: `src/draft-engine/reduce.ts` (dispatch `NOMINATE`, `BID`, `TIMER_EXPIRE`), `src/draft-engine/snake.ts` (add `reduceSnakeExpiry`), `src/draft-engine/selectors.ts` (auction-aware `teamOnClock`, budget selectors)
- Test: `src/draft-engine/reduce-auction.test.ts`, `src/draft-engine/reduce-expiry.test.ts`

**Interfaces:**
- Consumes: `reduceDraft`, `applyPick`, `advanceSnake`, `bestAvailableFor`, `openSlotCount`, `availablePool`, `assignSlot`, `AUCTION_CONFIG`, `DraftReduceResult`.
- Produces:
  - `reduceNominate(state: DraftState, auction: AuctionState, action: NominateAction): DraftReduceResult`, `reduceBid(state: DraftState, auction: AuctionState, action: BidAction): DraftReduceResult`, `reduceAuctionExpiry(state: DraftState, auction: AuctionState, timestamp: string): DraftReduceResult`, `nextNominator(state: DraftState, afterTeamId: string): string | null`. Each takes the already-resolved `AuctionState` — `reduce.ts` resolves it once via `auctionOf`.
  - `reduceSnakeExpiry(state, timestamp: string): DraftReduceResult` (autopick).
  - Selectors `remainingBudget(state, teamId): number`, `maxBidFor(state, teamId): number`, `minBidFor(state): number`.
  - `reduceDraft`'s switch becomes exhaustive over the five action types — the temporary `default` arm from Task 2 is deleted.

**Rules this task locks in (also documented in `docs/draft-engine.md` in Task 9):**
- A nomination **is** the nominator's opening bid.
- Every bid must clear `highBid + AUCTION_CONFIG.bidIncrement`; a team may not outbid itself.
- **Budget reserve:** a team must keep `AUCTION_CONFIG.reservePerOpenSlot` for each roster spot it still has to fill, so `maxBid = remainingBudget - (openSlots - 1) * reservePerOpenSlot`. Combined with the START-time check that the budget covers at least $1 per roster spot, this makes "a team with an open slot can always afford the minimum bid" an invariant, which is what keeps auto-nomination from deadlocking.
- **Timer expiry, auction:** an open lot is awarded to the high bidder at the high bid; no open lot means the nominating team stalled, so the clock auto-nominates their best available player at the minimum bid.
- **Timer expiry, snake:** autopick the team's best available player — the highest-ranked undrafted player they can legally roster, ranking taken from `state.pool` (snapshotted at START_DRAFT), never an ambient lookup.
- Nomination order rotates through `draftOrder` from the team that nominated the resolved lot, skipping teams whose rosters are full. When no team can nominate, the draft is complete.

- [ ] **Step 1: Write the failing auction tests**

```ts
// src/draft-engine/reduce-auction.test.ts
import { describe, it, expect } from "vitest";
import type { BidAction, DraftPoolEntry, NominateAction, StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { maxBidFor, minBidFor, remainingBudget, teamOnClock } from "./selectors";

const SPRINT_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "BENCH", count: 1, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
  { playerId: "wr1", position: "WR" },
  { playerId: "wr2", position: "WR" },
];

const CONFIG: DraftConfig = {
  draftId: "draft_a",
  leagueId: "league_1",
  format: "auction",
  kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: 10,
  slotConfig: SPRINT_SLOTS,
  clockSchedule: DRAFT_CLOCK_SCHEDULE,
};

const T = "2026-09-01T00:00:00.000Z";
const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: T, draftOrder: ["t1", "t2"], pool: POOL };

function apply(state: DraftState, action: Parameters<typeof reduceDraft>[1]): DraftState {
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

function started(): DraftState {
  return apply(initialDraftState(CONFIG), START);
}

const nominate = (teamId: string, playerId: string, openingBid: number, timestamp = T): NominateAction => ({
  v: 1, type: "NOMINATE", timestamp, teamId, playerId, openingBid,
});
const bid = (teamId: string, amount: number, timestamp = T): BidAction => ({ v: 1, type: "BID", timestamp, teamId, amount });

describe("START_DRAFT (auction)", () => {
  it("seeds every team's budget and puts team one up to nominate", () => {
    const state = started();
    expect(state.budgets).toEqual({ t1: 10, t2: 10 });
    expect(state.auction).toEqual({ nominatingTeamId: "t1", lot: null });
    expect(teamOnClock(state)).toBe("t1");
    // $10 with 3 spots to fill: $2 is reserved for the other two spots.
    expect(maxBidFor(state, "t1")).toBe(8);
  });

  it("rejects a budget that can't cover $1 per roster spot", () => {
    const broke: DraftConfig = { ...CONFIG, auctionBudget: 2 };
    expect(reduceDraft(initialDraftState(broke), START)).toEqual({
      ok: false,
      reason: "An auction budget must be at least $1 for every roster spot.",
    });
  });
});

describe("NOMINATE", () => {
  it("opens a lot at the nominator's own opening bid and restarts the clock", () => {
    const state = apply(started(), nominate("t1", "qb1", 3, "2026-09-01T00:05:00.000Z"));
    expect(state.auction).toEqual({
      nominatingTeamId: "t1",
      lot: { playerId: "qb1", highBid: 3, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: false },
    });
    expect(state.turnStartedAt).toBe("2026-09-01T00:05:00.000Z");
    // Nothing is spent until the lot is awarded.
    expect(remainingBudget(state, "t1")).toBe(10);
  });

  it("rejects a nomination from a team that isn't up", () => {
    expect(reduceDraft(started(), nominate("t2", "qb1", 1))).toEqual({ ok: false, reason: "It's not your turn to nominate." });
  });

  it("rejects a nomination while a player is already up for bid", () => {
    const state = apply(started(), nominate("t1", "qb1", 1));
    expect(reduceDraft(state, nominate("t1", "rb1", 1))).toEqual({ ok: false, reason: "There's already a player up for bid." });
  });

  it("rejects a player who isn't in the pool", () => {
    expect(reduceDraft(started(), nominate("t1", "ghost", 1))).toEqual({ ok: false, reason: "That player isn't in this draft's player pool." });
  });

  it("rejects an opening bid above the nominator's maximum", () => {
    expect(reduceDraft(started(), nominate("t1", "qb1", 9))).toEqual({
      ok: false,
      reason: "You can only bid up to $8 — you need $1 for each of your remaining roster spots.",
    });
  });

  it("rejects a pick in an auction draft", () => {
    expect(reduceDraft(started(), { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" })).toEqual({
      ok: false,
      reason: "This is an auction draft — nominate a player instead of picking.",
    });
  });
});

describe("BID", () => {
  const withLot = () => apply(started(), nominate("t1", "qb1", 3));

  it("raises the lot, records the new high bidder and restarts the bid window", () => {
    const state = apply(withLot(), bid("t2", 4, "2026-09-01T00:06:00.000Z"));
    expect(state.auction?.lot).toEqual({
      playerId: "qb1", highBid: 4, highBidTeamId: "t2", nominatedByTeamId: "t1", autoNominated: false,
    });
    expect(state.turnStartedAt).toBe("2026-09-01T00:06:00.000Z");
  });

  it("rejects a bid that doesn't clear the increment", () => {
    expect(reduceDraft(withLot(), bid("t2", 3))).toEqual({ ok: false, reason: "Your bid must be at least $4." });
  });

  it("rejects a team outbidding itself", () => {
    expect(reduceDraft(withLot(), bid("t1", 5))).toEqual({ ok: false, reason: "You can't outbid yourself." });
  });

  it("rejects a bid when nothing is up for auction", () => {
    expect(reduceDraft(started(), bid("t2", 5))).toEqual({ ok: false, reason: "There's no player up for bid right now." });
  });

  it("rejects a bid above the bidder's maximum", () => {
    expect(reduceDraft(withLot(), bid("t2", 9))).toEqual({
      ok: false,
      reason: "You can only bid up to $8 — you need $1 for each of your remaining roster spots.",
    });
  });

  it("rejects a bid in a snake draft", () => {
    const snake: DraftConfig = { ...CONFIG, format: "snake", auctionBudget: null };
    const state = apply(initialDraftState(snake), START);
    expect(reduceDraft(state, bid("t2", 5))).toEqual({ ok: false, reason: "This is a snake draft — there's nothing to bid on." });
  });
});

describe("auction selectors", () => {
  it("reports the minimum legal bid before and during a lot, and $1 in a snake draft", () => {
    expect(minBidFor(started())).toBe(1);
    expect(minBidFor(apply(started(), nominate("t1", "qb1", 3)))).toBe(4);
    const snake: DraftConfig = { ...CONFIG, format: "snake", auctionBudget: null };
    expect(minBidFor(apply(initialDraftState(snake), START))).toBe(1);
  });

  it("reports no budget and no bidding room for a team it has never seen", () => {
    expect(remainingBudget(started(), "nobody")).toBe(0);
    expect(maxBidFor(started(), "nobody")).toBe(0);
  });

  it("puts nobody on the clock while a lot is live — during bidding the clock belongs to everyone", () => {
    expect(teamOnClock(apply(started(), nominate("t1", "qb1", 3)))).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing timer-expiry tests**

```ts
// src/draft-engine/reduce-expiry.test.ts
import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction, TimerExpireAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { isComplete, remainingBudget, teamOnClock } from "./selectors";

const SPRINT_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];

const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
];

const T = "2026-09-01T00:00:00.000Z";
const EXPIRE: TimerExpireAction = { v: 1, type: "TIMER_EXPIRE", timestamp: "2026-09-01T01:00:00.000Z" };
const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: T, draftOrder: ["t1", "t2"], pool: POOL };

function apply(state: DraftState, action: Parameters<typeof reduceDraft>[1]): DraftState {
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

const snakeConfig: DraftConfig = {
  draftId: "d_s", leagueId: "l1", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null, slotConfig: SPRINT_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
};
const auctionConfig: DraftConfig = { ...snakeConfig, draftId: "d_a", format: "auction", auctionBudget: 10 };

describe("TIMER_EXPIRE (snake)", () => {
  it("autopicks the best available player the team can roster and hands over the turn", () => {
    const state = apply(apply(initialDraftState(snakeConfig), START), EXPIRE);
    expect(state.picks).toEqual([
      { pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB", price: null, timestamp: EXPIRE.timestamp, auto: true },
    ]);
    expect(teamOnClock(state)).toBe("t2");
  });

  it("skips a player the team can't roster and takes the next one it can", () => {
    // t1 takes qb1 by hand; on expiry t1's next autopick must be an RB, not qb2.
    let state = apply(initialDraftState(snakeConfig), START);
    state = apply(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" });
    state = apply(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t2", playerId: "qb2" });
    state = apply(state, EXPIRE); // round 2 reverses: t2 picks first
    expect(state.picks[2]?.teamId).toBe("t2");
    expect(state.picks[2]?.playerId).toBe("rb1");
  });

  it("completes the draft when the final autopick lands", () => {
    let state = apply(initialDraftState(snakeConfig), START);
    for (let i = 0; i < 4; i++) state = apply(state, EXPIRE);
    expect(isComplete(state)).toBe(true);
    expect(state.picks).toHaveLength(4);
    expect(state.picks.every((p) => p.auto)).toBe(true);
  });

  it("rejects an expiry before the draft has started", () => {
    expect(reduceDraft(initialDraftState(snakeConfig), EXPIRE)).toEqual({ ok: false, reason: "This draft hasn't started yet." });
  });

  it("rejects an expiry when no eligible player is available to auto-pick", () => {
    // SPRINT_SLOTS here has no BENCH, so a kicker fits nowhere in this league at all.
    const state = apply(initialDraftState(snakeConfig), { ...START, pool: [{ playerId: "k1", position: "K" }] });
    expect(reduceDraft(state, EXPIRE)).toEqual({ ok: false, reason: "No eligible player is available to auto-pick." });
  });
});

describe("TIMER_EXPIRE (auction)", () => {
  const started = () => apply(initialDraftState(auctionConfig), START);

  it("awards an open lot to the high bidder at the high bid and rotates the nomination", () => {
    let state = apply(started(), { v: 1, type: "NOMINATE", timestamp: T, teamId: "t1", playerId: "qb1", openingBid: 3 });
    state = apply(state, { v: 1, type: "BID", timestamp: T, teamId: "t2", amount: 4 });
    state = apply(state, EXPIRE);
    expect(state.picks).toEqual([
      { pickNumber: 1, round: 1, teamId: "t2", playerId: "qb1", slot: "QB", price: 4, timestamp: EXPIRE.timestamp, auto: false },
    ]);
    expect(remainingBudget(state, "t2")).toBe(6);
    expect(remainingBudget(state, "t1")).toBe(10);
    expect(state.pickNumber).toBe(2);
    expect(state.auction).toEqual({ nominatingTeamId: "t2", lot: null });
  });

  it("awards an unchallenged lot to the nominator at their opening bid", () => {
    let state = apply(started(), { v: 1, type: "NOMINATE", timestamp: T, teamId: "t1", playerId: "qb1", openingBid: 3 });
    state = apply(state, EXPIRE);
    expect(state.picks[0]?.teamId).toBe("t1");
    expect(state.picks[0]?.price).toBe(3);
    expect(state.picks[0]?.auto).toBe(false);
  });

  it("auto-nominates the nominating team's best available player at the minimum bid when they stall", () => {
    const state = apply(started(), EXPIRE);
    expect(state.picks).toEqual([]);
    expect(state.auction?.lot).toEqual({
      playerId: "qb1", highBid: 1, highBidTeamId: "t1", nominatedByTeamId: "t1", autoNominated: true,
    });
    expect(state.turnStartedAt).toBe(EXPIRE.timestamp);
  });

  it("marks a pick auto when an auto-nominated lot goes unchallenged", () => {
    const state = apply(apply(started(), EXPIRE), EXPIRE);
    expect(state.picks[0]).toMatchObject({ teamId: "t1", playerId: "qb1", price: 1, auto: true });
  });

  it("runs a whole auction to completion on the clock alone", () => {
    let state = started();
    for (let i = 0; i < 8; i++) state = apply(state, EXPIRE);
    expect(isComplete(state)).toBe(true);
    expect(state.picks).toHaveLength(4);
    expect(state.auction?.nominatingTeamId).toBeNull();
    expect(state.auction?.lot).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- src/draft-engine/reduce-auction src/draft-engine/reduce-expiry`
Expected: FAIL — `reduceDraft` answers "That action isn't supported yet." for NOMINATE/BID/TIMER_EXPIRE.

- [ ] **Step 4: Implement the auction reducer**

```ts
// src/draft-engine/auction.ts
import type { BidAction, NominateAction } from "@/domain/draft";
import { rosterFor, type AuctionState, type DraftReduceResult, type DraftState } from "./state";
import { AUCTION_CONFIG } from "./config";
import { assignSlot } from "./slotting";
import { applyPick } from "./apply-pick";
import { bestAvailableFor, maxBidFor, openSlotCount, remainingBudget } from "./selectors";

/**
 * Every function here takes the already-resolved `AuctionState`. The "is this even an
 * auction" question is answered once, in `reduce.ts`'s dispatch, so these functions have no
 * unreachable null-guard to defend (and no unreachable branch to chase for coverage).
 */

/** Next team in nomination order after `afterTeamId`, skipping full rosters. Null when nobody can nominate. */
export function nextNominator(state: DraftState, afterTeamId: string): string | null {
  const order = state.draftOrder;
  const start = order.indexOf(afterTeamId);
  const rotated = [...order.slice(start + 1), ...order.slice(0, start + 1)];
  return rotated.find((teamId) => openSlotCount(state, teamId) > 0) ?? null;
}

/** Shared guard: this team can still roster this player, and the amount is within their budget. */
function checkAffordable(state: DraftState, teamId: string, playerId: string, amount: number): string | null {
  const entry = state.pool.find((p) => p.playerId === playerId);
  if (entry === undefined) return "That player isn't in this draft's player pool.";
  const assignment = assignSlot({ position: entry.position, roster: rosterFor(state, teamId), slotConfig: state.config.slotConfig });
  if (!assignment.ok) return assignment.reason;
  const max = maxBidFor(state, teamId);
  if (amount > max) {
    return `You can only bid up to $${max} — you need $${AUCTION_CONFIG.reservePerOpenSlot} for each of your remaining roster spots.`;
  }
  return null;
}

export function reduceNominate(state: DraftState, auction: AuctionState, action: NominateAction): DraftReduceResult {
  if (auction.lot !== null) return { ok: false, reason: "There's already a player up for bid." };
  if (auction.nominatingTeamId !== action.teamId) return { ok: false, reason: "It's not your turn to nominate." };
  if (action.openingBid < AUCTION_CONFIG.minBid) {
    return { ok: false, reason: `The opening bid must be at least $${AUCTION_CONFIG.minBid}.` };
  }
  if (state.picks.some((p) => p.playerId === action.playerId)) {
    return { ok: false, reason: "That player has already been drafted." };
  }
  const problem = checkAffordable(state, action.teamId, action.playerId, action.openingBid);
  if (problem !== null) return { ok: false, reason: problem };
  return { ok: true, state: openLot(state, action.teamId, action.playerId, action.openingBid, action.timestamp, false) };
}

function openLot(
  state: DraftState,
  teamId: string,
  playerId: string,
  amount: number,
  timestamp: string,
  autoNominated: boolean,
): DraftState {
  return {
    ...state,
    auction: {
      nominatingTeamId: teamId,
      lot: { playerId, highBid: amount, highBidTeamId: teamId, nominatedByTeamId: teamId, autoNominated },
    },
    turnStartedAt: timestamp,
  };
}

export function reduceBid(state: DraftState, auction: AuctionState, action: BidAction): DraftReduceResult {
  const lot = auction.lot;
  if (lot === null) return { ok: false, reason: "There's no player up for bid right now." };
  if (lot.highBidTeamId === action.teamId) return { ok: false, reason: "You can't outbid yourself." };
  const minimum = lot.highBid + AUCTION_CONFIG.bidIncrement;
  if (action.amount < minimum) return { ok: false, reason: `Your bid must be at least $${minimum}.` };
  const problem = checkAffordable(state, action.teamId, lot.playerId, action.amount);
  if (problem !== null) return { ok: false, reason: problem };
  return {
    ok: true,
    state: {
      ...state,
      auction: { ...auction, lot: { ...lot, highBid: action.amount, highBidTeamId: action.teamId } },
      turnStartedAt: action.timestamp,
    },
  };
}

/**
 * The clock ran out. With a lot open, the high bidder wins it at the high bid and the
 * nomination rotates. With no lot open, the nominating team stalled, so the clock
 * nominates their best available player at the minimum bid.
 */
export function reduceAuctionExpiry(state: DraftState, auction: AuctionState, timestamp: string): DraftReduceResult {
  const lot = auction.lot;

  if (lot === null) {
    const nominator = auction.nominatingTeamId;
    if (nominator === null) return { ok: false, reason: "This draft has already finished." };
    const best = bestAvailableFor(state, nominator);
    if (best === null) return { ok: false, reason: "No eligible player is available to auto-pick." };
    return { ok: true, state: openLot(state, nominator, best.playerId, AUCTION_CONFIG.minBid, timestamp, true) };
  }

  const winner = lot.highBidTeamId;
  const applied = applyPick(state, {
    teamId: winner,
    playerId: lot.playerId,
    price: lot.highBid,
    auto: lot.autoNominated && winner === lot.nominatedByTeamId,
    timestamp,
  });
  if (!applied.ok) return applied;

  const paid: DraftState = {
    ...applied.state,
    budgets: { ...applied.state.budgets, [winner]: remainingBudget(applied.state, winner) - lot.highBid },
    pickNumber: applied.state.pickNumber + 1,
  };
  const nominator = nextNominator(paid, lot.nominatedByTeamId);
  return {
    ok: true,
    state:
      nominator === null
        ? { ...paid, phase: "complete", auction: { nominatingTeamId: null, lot: null }, turnStartedAt: null }
        : { ...paid, auction: { nominatingTeamId: nominator, lot: null }, turnStartedAt: timestamp },
  };
}
```

- [ ] **Step 5: Add snake autopick, wire the dispatcher, extend the selectors**

Append to `src/draft-engine/snake.ts`:

```ts
import { bestAvailableFor } from "./selectors";

/**
 * Autopick policy: the highest-ranked undrafted player the team on the clock can legally
 * roster. `state.pool` is the ranking — an explicit input snapshotted at START_DRAFT — so
 * the same action log always produces the same autopick.
 */
export function reduceSnakeExpiry(state: DraftState, timestamp: string): DraftReduceResult {
  const teamId = snakeTeamForPick(state.draftOrder, state.pickNumber);
  const best = bestAvailableFor(state, teamId);
  if (best === null) return { ok: false, reason: "No eligible player is available to auto-pick." };
  const applied = applyPick(state, { teamId, playerId: best.playerId, price: null, auto: true, timestamp });
  if (!applied.ok) return applied;
  return { ok: true, state: advanceSnake(applied.state, timestamp) };
}
```

Replace `dispatch` in `src/draft-engine/reduce.ts` (the `default` arm goes away — the switch is
now exhaustive). Its import block grows to:

```ts
import type { DraftAction, StartDraftAction } from "@/domain/draft";
import { auctionOf, totalRosterSlots, type DraftReduceResult, type DraftState } from "./state";
import { reduceMakePick, reduceSnakeExpiry } from "./snake";
import { reduceAuctionExpiry, reduceBid, reduceNominate } from "./auction";

export type { DraftReduceResult } from "./state";
```


```ts
function dispatch(state: DraftState, action: DraftAction): DraftReduceResult {
  switch (action.type) {
    case "START_DRAFT":
      return reduceStart(state, action);
    case "MAKE_PICK":
      return reduceMakePick(state, action);
    case "NOMINATE": {
      const auction = auctionOf(state);
      return auction === null
        ? { ok: false, reason: "This is a snake draft — make a pick instead of nominating." }
        : reduceNominate(state, auction, action);
    }
    case "BID": {
      const auction = auctionOf(state);
      return auction === null
        ? { ok: false, reason: "This is a snake draft — there's nothing to bid on." }
        : reduceBid(state, auction, action);
    }
    case "TIMER_EXPIRE": {
      const auction = auctionOf(state);
      return auction === null
        ? reduceSnakeExpiry(state, action.timestamp)
        : reduceAuctionExpiry(state, auction, action.timestamp);
    }
  }
}
```

`auctionOf` is the single "is this an auction" decision, so `auction.ts` never re-checks the
format and never carries an unreachable null guard.

```ts
```

Add the budget check to `reduceStart`, immediately after the existing auction-budget guard:

```ts
  if (isAuction && (budget as number) < totalRosterSlots(state.config.slotConfig)) {
    return { ok: false, reason: "An auction budget must be at least $1 for every roster spot." };
  }
```

Append to `src/draft-engine/selectors.ts`, and replace `teamOnClock` with the auction-aware version:

```ts
import { AUCTION_CONFIG } from "./config";
import { auctionOf } from "./state";

export function remainingBudget(state: DraftState, teamId: string): number {
  return state.budgets[teamId] ?? 0;
}

export function minBidFor(state: DraftState): number {
  const auction = auctionOf(state);
  if (auction === null || auction.lot === null) return AUCTION_CONFIG.minBid;
  return auction.lot.highBid + AUCTION_CONFIG.bidIncrement;
}

/**
 * The most this team may commit right now: their budget less $1 held back for every other
 * roster spot they still have to fill. Guarantees a team with an open slot can always afford
 * the minimum bid, which is what stops auto-nomination from deadlocking.
 */
export function maxBidFor(state: DraftState, teamId: string): number {
  const open = openSlotCount(state, teamId);
  if (open <= 0) return 0;
  return remainingBudget(state, teamId) - (open - 1) * AUCTION_CONFIG.reservePerOpenSlot;
}

/**
 * Whose turn it is. Snake: the team on the clock. Auction: the team due to nominate —
 * null while a lot is live, because during bidding the clock belongs to everyone.
 */
export function teamOnClock(state: DraftState): string | null {
  if (state.phase !== "in_progress") return null;
  const auction = auctionOf(state);
  if (auction === null) return snakeTeamForPick(state.draftOrder, state.pickNumber);
  return auction.lot === null ? auction.nominatingTeamId : null;
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- src/draft-engine && npm run typecheck && npm run lint`
Expected: PASS (18 auction + 10 expiry tests plus every earlier engine test); typecheck and lint clean.

If `reduce-expiry.test.ts`'s "no eligible player" case doesn't produce that reason, check that `SPRINT_SLOTS` in that file has **no BENCH slot** (a BENCH that accepts every position would make a K rosterable) — that is deliberate.

- [ ] **Step 7: Commit**

```bash
git add src/draft-engine
git commit -m "feat(draft-engine): auction nomination/bidding/award and timer-expiry transitions for both formats

Auction is first-class in the same reducer rather than a parallel engine — this is the wedge
against Apex handing its auctions to ESPN. The per-open-slot budget reserve makes 'a team with
an open roster spot can always afford the minimum bid' an invariant, which is what keeps
auto-nomination from deadlocking a stalled auction."
```

---

### Task 4: Auto-tightening pick clock + derived selectors

**Model tier:** standard.

**Files:**
- Create: `src/draft-engine/clock-schedule.ts`
- Modify: `src/draft-engine/selectors.ts`
- Test: `src/draft-engine/clock-schedule.test.ts`, `src/draft-engine/selectors-clock.test.ts`

**Interfaces:**
- Consumes: `ClockTier`, `DRAFT_CLOCK_SCHEDULE`, `AUCTION_CONFIG`, `DraftState`, `auctionOf`.
- Produces:
  - `hoursUntil(fromIso: string, kickoffIso: string): number`
  - `tierIndexFor(atIso: string, kickoffIso: string, schedule?: readonly ClockTier[]): number`
  - `clockTierFor(atIso: string, kickoffIso: string, schedule?: readonly ClockTier[]): ClockTier`
  - `nextTighteningAfter(atIso: string, kickoffIso: string, schedule?: readonly ClockTier[]): Tightening | null` where `Tightening = { readonly at: string; readonly pickSeconds: number }`
  - Selectors `currentClockSeconds(state): number | null`, `currentDeadline(state): string | null`, `currentTier(state): ClockTier | null`, `nextTightening(state): Tightening | null`, and `draftStateView(state): DraftStateView` — the one serialization the API returns and Plan C renders.

**Semantics (these exact rules are what the tests pin):** tiers are ordered farthest-from-kickoff first. A tier applies while `hoursUntilKickoff > tier.untilHoursBeforeKickoff`; the first matching tier from the top wins; at or past kickoff the last tier is the floor. `nextTighteningAfter` answers Plan C's "picks shorten to 10 minutes in 2h 14m" — it returns the instant the **current** tier runs out (`kickoff − currentTier.untilHoursBeforeKickoff`) paired with the **next** tier's `pickSeconds`, or null on the final tier.

- [ ] **Step 1: Write the failing clock-schedule tests**

```ts
// src/draft-engine/clock-schedule.test.ts
import { describe, it, expect } from "vitest";
import { clockTierFor, hoursUntil, nextTighteningAfter, tierIndexFor } from "./clock-schedule";

const KICKOFF = "2026-09-10T17:00:00.000Z";

describe("hoursUntil", () => {
  it("measures whole and fractional hours to kickoff", () => {
    expect(hoursUntil("2026-09-10T15:00:00.000Z", KICKOFF)).toBe(2);
    expect(hoursUntil("2026-09-10T16:30:00.000Z", KICKOFF)).toBe(0.5);
  });
  it("goes negative once kickoff has passed", () => {
    expect(hoursUntil("2026-09-10T20:00:00.000Z", KICKOFF)).toBe(-3);
  });
  it("throws a clear error for an unparseable timestamp", () => {
    expect(() => hoursUntil("not-a-date", KICKOFF)).toThrow(/ISO timestamp/);
    expect(() => hoursUntil(KICKOFF, "not-a-date")).toThrow(/ISO timestamp/);
  });
});

describe("clockTierFor — every boundary of the 8h → 4h → 1h → 10m → 60s schedule", () => {
  it.each([
    ["8 days out", "2026-09-02T09:00:00.000Z", 8 * 3600],
    ["exactly 168h out (boundary)", "2026-09-03T17:00:00.000Z", 4 * 3600],
    ["100h out", "2026-09-06T13:00:00.000Z", 4 * 3600],
    ["exactly 48h out (boundary)", "2026-09-08T17:00:00.000Z", 3600],
    ["13h out", "2026-09-10T04:00:00.000Z", 3600],
    ["exactly 12h out (boundary)", "2026-09-10T05:00:00.000Z", 600],
    ["2.5h out", "2026-09-10T14:30:00.000Z", 600],
    ["exactly 2h out (boundary)", "2026-09-10T15:00:00.000Z", 60],
    ["30m out", "2026-09-10T16:30:00.000Z", 60],
    ["exactly at kickoff", "2026-09-10T17:00:00.000Z", 60],
    ["after kickoff", "2026-09-10T20:00:00.000Z", 60],
  ])("%s → %i second picks", (_label, at, pickSeconds) => {
    expect(clockTierFor(at, KICKOFF).pickSeconds).toBe(pickSeconds);
  });

  it("returns the index of the applicable tier", () => {
    expect(tierIndexFor("2026-09-02T09:00:00.000Z", KICKOFF)).toBe(0);
    expect(tierIndexFor("2026-09-10T16:30:00.000Z", KICKOFF)).toBe(4);
  });

  it("uses a caller-supplied schedule instead of the default", () => {
    const schedule = [
      { untilHoursBeforeKickoff: 24, pickSeconds: 120 },
      { untilHoursBeforeKickoff: 0, pickSeconds: 30 },
    ];
    expect(clockTierFor("2026-09-01T00:00:00.000Z", KICKOFF, schedule).pickSeconds).toBe(120);
    expect(clockTierFor("2026-09-10T16:00:00.000Z", KICKOFF, schedule).pickSeconds).toBe(30);
  });

  it("throws on an empty schedule rather than silently having no clock", () => {
    expect(() => clockTierFor("2026-09-01T00:00:00.000Z", KICKOFF, [])).toThrow(/schedule/i);
  });
});

describe("nextTighteningAfter", () => {
  it.each([
    ["8 days out", "2026-09-02T09:00:00.000Z", "2026-09-03T17:00:00.000Z", 4 * 3600],
    ["100h out", "2026-09-06T13:00:00.000Z", "2026-09-08T17:00:00.000Z", 3600],
    ["13h out", "2026-09-10T04:00:00.000Z", "2026-09-10T05:00:00.000Z", 600],
    ["2.5h out", "2026-09-10T14:30:00.000Z", "2026-09-10T15:00:00.000Z", 60],
  ])("from %s the clock next shortens at %s to %i seconds", (_label, at, expectedAt, pickSeconds) => {
    expect(nextTighteningAfter(at, KICKOFF)).toEqual({ at: expectedAt, pickSeconds });
  });

  it("returns null on the final tier — the clock can't tighten further", () => {
    expect(nextTighteningAfter("2026-09-10T16:30:00.000Z", KICKOFF)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/draft-engine/clock-schedule`
Expected: FAIL — cannot find module `./clock-schedule`.

- [ ] **Step 3: Implement the schedule**

```ts
// src/draft-engine/clock-schedule.ts
import { DRAFT_CLOCK_SCHEDULE, type ClockTier } from "./config";

const MS_PER_HOUR = 60 * 60 * 1000;

export interface Tightening {
  /** The instant the next, shorter tier takes effect. */
  readonly at: string;
  readonly pickSeconds: number;
}

function parseIso(value: string, label: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Expected an ISO timestamp for ${label}, got "${value}".`);
  return ms;
}

/**
 * Hours from `fromIso` until kickoff — negative once kickoff has passed. Parses supplied
 * timestamps only; it never reads the wall clock, which is why the engine stays pure.
 */
export function hoursUntil(fromIso: string, kickoffIso: string): number {
  return (parseIso(kickoffIso, "kickoff") - parseIso(fromIso, "the current time")) / MS_PER_HOUR;
}

/**
 * Index of the tier in force. Tiers are ordered farthest-out first and a tier applies while
 * the draft is strictly more than `untilHoursBeforeKickoff` hours from kickoff, so the last
 * tier is the floor that applies at and after kickoff.
 */
export function tierIndexFor(
  atIso: string,
  kickoffIso: string,
  schedule: readonly ClockTier[] = DRAFT_CLOCK_SCHEDULE,
): number {
  if (schedule.length === 0) throw new Error("The draft clock schedule must have at least one tier.");
  const hours = hoursUntil(atIso, kickoffIso);
  const index = schedule.findIndex((tier) => hours > tier.untilHoursBeforeKickoff);
  return index === -1 ? schedule.length - 1 : index;
}

export function clockTierFor(
  atIso: string,
  kickoffIso: string,
  schedule: readonly ClockTier[] = DRAFT_CLOCK_SCHEDULE,
): ClockTier {
  const tier = schedule[tierIndexFor(atIso, kickoffIso, schedule)];
  if (tier === undefined) throw new Error("The draft clock schedule must have at least one tier.");
  return tier;
}

/**
 * When the clock next shortens, and to what — the data behind "picks shorten to 10 minutes
 * in 2h 14m". Null once the shortest tier is in force.
 */
export function nextTighteningAfter(
  atIso: string,
  kickoffIso: string,
  schedule: readonly ClockTier[] = DRAFT_CLOCK_SCHEDULE,
): Tightening | null {
  const index = tierIndexFor(atIso, kickoffIso, schedule);
  const next = schedule[index + 1];
  if (next === undefined) return null;
  // The current tier applies while the draft is more than its threshold from kickoff, so the
  // clock tightens the moment that threshold is reached — and it tightens to the NEXT tier's
  // pick clock. (8h picks run until 168h before kickoff, then become 4h picks.)
  const current = schedule[index]!;
  const at = new Date(parseIso(kickoffIso, "kickoff") - current.untilHoursBeforeKickoff * MS_PER_HOUR).toISOString();
  return { at, pickSeconds: next.pickSeconds };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/draft-engine/clock-schedule`
Expected: PASS (22 tests).

- [ ] **Step 5: Write the failing clock-selector tests**

```ts
// src/draft-engine/selectors-clock.test.ts
import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { currentClockSeconds, currentDeadline, currentTier, draftStateView, nextTightening } from "./selectors";

const SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];
const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
];
const KICKOFF = "2026-09-10T17:00:00.000Z";
const CONFIG: DraftConfig = {
  draftId: "d1", leagueId: "l1", format: "snake", kickoffAt: KICKOFF,
  auctionBudget: null, slotConfig: SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
};

function startedAt(timestamp: string, config: DraftConfig = CONFIG): DraftState {
  const start: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp, draftOrder: ["t1", "t2"], pool: POOL };
  const result = reduceDraft(initialDraftState(config), start);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

describe("the auto-tightening clock, seen through the state", () => {
  it("gives four different pick durations for the same draft at four distances from kickoff", () => {
    const durations = [
      "2026-09-02T09:00:00.000Z",
      "2026-09-06T13:00:00.000Z",
      "2026-09-10T04:00:00.000Z",
      "2026-09-10T14:30:00.000Z",
    ].map((at) => currentClockSeconds(startedAt(at)));
    expect(durations).toEqual([8 * 3600, 4 * 3600, 3600, 600]);
    expect(new Set(durations).size).toBe(4);
  });

  it("derives the deadline from when the turn started plus the tier's pick seconds", () => {
    const state = startedAt("2026-09-10T14:30:00.000Z"); // 10-minute tier
    expect(currentDeadline(state)).toBe("2026-09-10T14:40:00.000Z");
    expect(currentTier(state)?.pickSeconds).toBe(600);
  });

  it("reports when the clock next shortens and to what", () => {
    expect(nextTightening(startedAt("2026-09-10T04:00:00.000Z"))).toEqual({ at: "2026-09-10T05:00:00.000Z", pickSeconds: 600 });
  });

  it("has no clock before the draft starts or after it finishes", () => {
    const scheduled = initialDraftState(CONFIG);
    expect(currentDeadline(scheduled)).toBeNull();
    expect(currentClockSeconds(scheduled)).toBeNull();
    expect(currentTier(scheduled)).toBeNull();
    expect(nextTightening(scheduled)).toBeNull();
  });

  it("shortens the window to the auction bid window while a lot is live", () => {
    const auctionConfig: DraftConfig = { ...CONFIG, format: "auction", auctionBudget: 10 };
    let state = startedAt("2026-09-02T09:00:00.000Z", auctionConfig); // 8-hour tier
    expect(currentClockSeconds(state)).toBe(8 * 3600);
    const nominated = reduceDraft(state, { v: 1, type: "NOMINATE", timestamp: "2026-09-02T09:05:00.000Z", teamId: "t1", playerId: "qb1", openingBid: 1 });
    if (!nominated.ok) throw new Error(nominated.reason);
    state = nominated.state;
    // Live bidding uses the shorter of the tier and the configured bid window.
    expect(currentClockSeconds(state)).toBe(15);
    expect(currentDeadline(state)).toBe("2026-09-02T09:05:15.000Z");
  });
});

describe("draftStateView", () => {
  it("serializes everything a client needs in one shape", () => {
    const state = startedAt("2026-09-10T14:30:00.000Z");
    const view = draftStateView(state);
    expect(view).toMatchObject({
      draftId: "d1",
      leagueId: "l1",
      format: "snake",
      phase: "in_progress",
      sequence: 1,
      draftOrder: ["t1", "t2"],
      pickNumber: 1,
      onClockTeamId: "t1",
      deadlineAt: "2026-09-10T14:40:00.000Z",
      clockSeconds: 600,
      nextTightening: { at: "2026-09-10T15:00:00.000Z", pickSeconds: 60 },
      picks: [],
      budgets: {},
      auction: null,
    });
    expect(view.availablePlayerIds).toEqual(["qb1", "rb1", "qb2", "rb2"]);
    expect(view.rosters).toEqual({ t1: [], t2: [] });
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npm test -- src/draft-engine/selectors-clock`
Expected: FAIL — `currentDeadline` is not exported from `./selectors`.

- [ ] **Step 7: Implement the clock selectors and the view**

Append to `src/draft-engine/selectors.ts`:

```ts
import type { CompletedPick, AuctionState } from "./state";
import type { RosterSlot } from "@/domain/roster";
import type { DraftFormat } from "@/domain/league";
import type { DraftStatus } from "@/domain/draft";
import { clockTierFor, nextTighteningAfter, type Tightening } from "./clock-schedule";
import type { ClockTier } from "./config";

/** Seconds allowed for the current turn: the tier's pick clock, or the shorter live bid window. */
export function currentClockSeconds(state: DraftState): number | null {
  const tier = currentTier(state);
  if (tier === null) return null;
  const auction = auctionOf(state);
  if (auction !== null && auction.lot !== null) return Math.min(tier.pickSeconds, AUCTION_CONFIG.bidWindowSeconds);
  return tier.pickSeconds;
}

export function currentTier(state: DraftState): ClockTier | null {
  if (state.phase !== "in_progress" || state.turnStartedAt === null) return null;
  return clockTierFor(state.turnStartedAt, state.config.kickoffAt, state.config.clockSchedule);
}

export function currentDeadline(state: DraftState): string | null {
  const seconds = currentClockSeconds(state);
  if (seconds === null || state.turnStartedAt === null) return null;
  return new Date(Date.parse(state.turnStartedAt) + seconds * 1000).toISOString();
}

export function nextTightening(state: DraftState): Tightening | null {
  if (state.phase !== "in_progress" || state.turnStartedAt === null) return null;
  return nextTighteningAfter(state.turnStartedAt, state.config.kickoffAt, state.config.clockSchedule);
}

/** The one serialization of a draft: what `GET /api/drafts/:id` returns and Plan C renders. */
export interface DraftStateView {
  readonly draftId: string;
  readonly leagueId: string;
  readonly format: DraftFormat;
  readonly phase: DraftStatus;
  readonly sequence: number;
  readonly draftOrder: readonly string[];
  readonly picks: readonly CompletedPick[];
  readonly rosters: Readonly<Record<string, readonly RosterSlot[]>>;
  readonly budgets: Readonly<Record<string, number>>;
  readonly auction: AuctionState | null;
  readonly pickNumber: number;
  readonly onClockTeamId: string | null;
  readonly deadlineAt: string | null;
  readonly clockSeconds: number | null;
  readonly nextTightening: Tightening | null;
  readonly availablePlayerIds: readonly string[];
}

export function draftStateView(state: DraftState): DraftStateView {
  return {
    draftId: state.config.draftId,
    leagueId: state.config.leagueId,
    format: state.config.format,
    phase: state.phase,
    sequence: state.sequence,
    draftOrder: state.draftOrder,
    picks: state.picks,
    rosters: state.rosters,
    budgets: state.budgets,
    auction: state.auction,
    pickNumber: state.pickNumber,
    onClockTeamId: teamOnClock(state),
    deadlineAt: currentDeadline(state),
    clockSeconds: currentClockSeconds(state),
    nextTightening: nextTightening(state),
    availablePlayerIds: availablePool(state).map((p) => p.playerId),
  };
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npm test -- src/draft-engine && npm run typecheck && npm run lint`
Expected: PASS (22 clock-schedule + 6 selectors-clock plus every earlier engine test); typecheck and lint clean.

- [ ] **Step 9: Commit**

```bash
git add src/draft-engine
git commit -m "feat(draft-engine): auto-tightening pick clock (8h→4h→1h→10m→60s) and derived clock selectors

The schedule is the direct answer to a multi-day email draft: schedule flexibility without
leaving a live room. Deadlines are derived from the turn's start timestamp rather than stored,
so replaying an action log can never resurrect a stale deadline, and nextTightening gives the
UI the 'picks shorten to 10 minutes in 2h 14m' line the schedule is only a feature with."
```

---

### Task 5: Events, replay, full mock drafts, and the 100% coverage gate

**Model tier:** standard.

**Files:**
- Create: `src/draft-engine/events.ts`, `src/draft-engine/replay.ts`, `src/draft-engine/index.ts`
- Modify: `vitest.config.mts` (add the `src/draft-engine/**` coverage threshold)
- Test: `src/draft-engine/events.test.ts`, `src/draft-engine/replay.test.ts`, `src/draft-engine/full-draft.test.ts`

**Interfaces:**
- Consumes: `reduceDraft`, `initialDraftState`, `auctionOf`, `DraftState`, `DraftConfig`, the `DraftAction` union, `RealtimeEventType` (**type-only** import from `@/lib/realtime/events` — the event taxonomy stays enumerated in exactly one place).
- Produces:
  - `DraftEventType = Extract<RealtimeEventType, "draft.pick" | "draft.nominate" | "draft.bid" | "draft.timer_expire" | "draft.status">`
  - `DraftEventEnvelope = { readonly type: DraftEventType; readonly payload: Readonly<Record<string, unknown>> }`
  - `draftEventsFor(prev: DraftState, next: DraftState, action: DraftAction): readonly DraftEventEnvelope[]`
  - `replayDraft(config: DraftConfig, actions: readonly DraftAction[]): DraftState`, `class DraftReplayError extends Error { readonly sequence: number }`
  - `src/draft-engine/index.ts` — the engine's public surface, re-exporting the reducer, replay, events, selectors, slotting, clock schedule, state types and config.

- [ ] **Step 1: Write the failing events and replay tests**

```ts
// src/draft-engine/events.test.ts
import { describe, it, expect } from "vitest";
import type { DraftAction, DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { draftEventsFor } from "./events";

const SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];
const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
];
const T = "2026-09-01T00:00:00.000Z";
const CONFIG: DraftConfig = {
  draftId: "d1", leagueId: "l1", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null, slotConfig: SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
};
const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: T, draftOrder: ["t1", "t2"], pool: POOL };

/** Applies an action and returns both the new state and the events it produced. */
function step(state: DraftState, action: DraftAction) {
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(result.reason);
  return { state: result.state, events: draftEventsFor(state, result.state, action) };
}

describe("draftEventsFor", () => {
  it("announces the draft opening as a status event", () => {
    const { events } = step(initialDraftState(CONFIG), START);
    expect(events).toEqual([{ type: "draft.status", payload: { draftId: "d1", sequence: 1, phase: "in_progress" } }]);
  });

  it("emits one draft.pick carrying the whole pick", () => {
    const opened = step(initialDraftState(CONFIG), START).state;
    const { events } = step(opened, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" });
    expect(events).toEqual([
      {
        type: "draft.pick",
        payload: {
          draftId: "d1", sequence: 2, pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1",
          slot: "QB", price: null, timestamp: T, auto: false,
        },
      },
    ]);
  });

  it("emits the expiry before the autopick it caused, so clients render them in order", () => {
    const opened = step(initialDraftState(CONFIG), START).state;
    const { events } = step(opened, { v: 1, type: "TIMER_EXPIRE", timestamp: T });
    expect(events.map((e) => e.type)).toEqual(["draft.timer_expire", "draft.pick"]);
  });

  it("emits draft.status when the last pick completes the draft", () => {
    let state = step(initialDraftState(CONFIG), START).state;
    let events: readonly { type: string }[] = [];
    for (let i = 0; i < 4; i++) {
      const next = step(state, { v: 1, type: "TIMER_EXPIRE", timestamp: T });
      state = next.state;
      events = next.events;
    }
    expect(events.map((e) => e.type)).toEqual(["draft.timer_expire", "draft.pick", "draft.status"]);
  });

  it("emits draft.nominate and draft.bid for auction lots", () => {
    const auctionConfig: DraftConfig = { ...CONFIG, format: "auction", auctionBudget: 10 };
    const opened = step(initialDraftState(auctionConfig), START).state;
    const nominated = step(opened, { v: 1, type: "NOMINATE", timestamp: T, teamId: "t1", playerId: "qb1", openingBid: 2 });
    expect(nominated.events).toEqual([
      { type: "draft.nominate", payload: { draftId: "d1", sequence: 2, teamId: "t1", playerId: "qb1", openingBid: 2, auto: false } },
    ]);
    const raised = step(nominated.state, { v: 1, type: "BID", timestamp: T, teamId: "t2", amount: 3 });
    expect(raised.events).toEqual([
      { type: "draft.bid", payload: { draftId: "d1", sequence: 3, teamId: "t2", playerId: "qb1", amount: 3 } },
    ]);
  });

  it("emits the expiry then the nomination when the clock auto-nominates", () => {
    const auctionConfig: DraftConfig = { ...CONFIG, format: "auction", auctionBudget: 10 };
    const opened = step(initialDraftState(auctionConfig), START).state;
    const { events } = step(opened, { v: 1, type: "TIMER_EXPIRE", timestamp: T });
    expect(events.map((e) => e.type)).toEqual(["draft.timer_expire", "draft.nominate"]);
    expect(events[1]?.payload).toMatchObject({ auto: true, openingBid: 1 });
  });
});
```

```ts
// src/draft-engine/replay.test.ts
import { describe, it, expect } from "vitest";
import type { DraftAction, DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { initialDraftState, type DraftConfig } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { DraftReplayError, replayDraft } from "./replay";

const SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];
const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
];
const T = "2026-09-01T00:00:00.000Z";
const CONFIG: DraftConfig = {
  draftId: "d1", leagueId: "l1", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
  auctionBudget: null, slotConfig: SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
};
const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: T, draftOrder: ["t1", "t2"], pool: POOL };
const LOG: readonly DraftAction[] = [
  START,
  { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" },
  { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t2", playerId: "rb1" },
];

describe("replayDraft", () => {
  it("reconstructs exactly the state produced by applying the same actions live", () => {
    let live = initialDraftState(CONFIG);
    for (const action of LOG) {
      const result = reduceDraft(live, action);
      if (!result.ok) throw new Error(result.reason);
      live = result.state;
    }
    expect(replayDraft(CONFIG, LOG)).toEqual(live);
  });

  it("returns the initial state for an empty log", () => {
    expect(replayDraft(CONFIG, [])).toEqual(initialDraftState(CONFIG));
  });

  it("throws a DraftReplayError naming the offending sequence when a persisted action can't apply", () => {
    const corrupt: readonly DraftAction[] = [...LOG, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: "t1", playerId: "qb1" }];
    expect(() => replayDraft(CONFIG, corrupt)).toThrow(DraftReplayError);
    expect(() => replayDraft(CONFIG, corrupt)).toThrow(/action 4/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/draft-engine/events src/draft-engine/replay`
Expected: FAIL — cannot find modules `./events` and `./replay`.

- [ ] **Step 3: Implement events, replay and the barrel**

```ts
// src/draft-engine/events.ts
import type { DraftAction } from "@/domain/draft";
import type { RealtimeEventType } from "@/lib/realtime/events";
import { auctionOf, type DraftState } from "./state";

/**
 * The draft slice of the one event taxonomy. Types are not re-declared here — they are
 * narrowed from `src/lib/realtime/events.ts`, which stays the single enumeration.
 */
export type DraftEventType = Extract<
  RealtimeEventType,
  "draft.pick" | "draft.nominate" | "draft.bid" | "draft.timer_expire" | "draft.status"
>;

export interface DraftEventEnvelope {
  readonly type: DraftEventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * What to broadcast for a transition. Derived from the state diff rather than the action
 * alone, so a clock-driven autopick or auto-nomination produces the same events a human
 * action would. Ordering is deliberate: the cause (`draft.timer_expire`) precedes its
 * effects, so a client can render them in arrival order without reordering.
 */
export function draftEventsFor(prev: DraftState, next: DraftState, action: DraftAction): readonly DraftEventEnvelope[] {
  const base = { draftId: next.config.draftId, sequence: next.sequence };
  const events: DraftEventEnvelope[] = [];

  if (action.type === "TIMER_EXPIRE") {
    events.push({ type: "draft.timer_expire", payload: { ...base, pickNumber: prev.pickNumber } });
  }

  for (const pick of next.picks.slice(prev.picks.length)) {
    events.push({ type: "draft.pick", payload: { ...base, ...pick } });
  }

  const beforeAuction = auctionOf(prev);
  const afterAuction = auctionOf(next);
  const before = beforeAuction === null ? null : beforeAuction.lot;
  const after = afterAuction === null ? null : afterAuction.lot;
  if (after !== null) {
    events.push(
      before === null || before.playerId !== after.playerId
        ? {
            type: "draft.nominate",
            payload: { ...base, teamId: after.nominatedByTeamId, playerId: after.playerId, openingBid: after.highBid, auto: after.autoNominated },
          }
        : {
            type: "draft.bid",
            payload: { ...base, teamId: after.highBidTeamId, playerId: after.playerId, amount: after.highBid },
          },
    );
  }

  if (next.phase !== prev.phase) {
    events.push({ type: "draft.status", payload: { ...base, phase: next.phase } });
  }

  return events;
}
```

```ts
// src/draft-engine/replay.ts
import type { DraftAction } from "@/domain/draft";
import { initialDraftState, type DraftConfig, type DraftState } from "./state";
import { reduceDraft } from "./reduce";

/** A persisted action that no longer applies — corruption, not a user error. Fail loudly. */
export class DraftReplayError extends Error {
  readonly sequence: number;
  constructor(sequence: number, reason: string) {
    super(`Draft action ${sequence} could not be replayed: ${reason}`);
    this.name = "DraftReplayError";
    this.sequence = sequence;
  }
}

/**
 * Rebuilds draft state from the persisted action log. This — not any cache — is what makes
 * the durable store recoverable: the log is the source of truth and this is the only way to
 * turn it back into state. The local accumulator is reassigned; no input is mutated.
 */
export function replayDraft(config: DraftConfig, actions: readonly DraftAction[]): DraftState {
  let state = initialDraftState(config);
  for (const action of actions) {
    const result = reduceDraft(state, action);
    if (!result.ok) throw new DraftReplayError(state.sequence + 1, result.reason);
    state = result.state;
  }
  return state;
}
```

```ts
// src/draft-engine/index.ts
export { DRAFT_CLOCK_SCHEDULE, AUCTION_CONFIG, type ClockTier } from "./config";
export {
  initialDraftState, totalRosterSlots, rosterFor, auctionOf,
  type DraftConfig, type DraftState, type CompletedPick, type AuctionLot, type AuctionState, type DraftReduceResult,
} from "./state";
export { assignSlot, type SlotAssignment } from "./slotting";
export { snakeTeamForPick, roundForPick } from "./order";
export { reduceDraft } from "./reduce";
export { replayDraft, DraftReplayError } from "./replay";
export { draftEventsFor, type DraftEventEnvelope, type DraftEventType } from "./events";
export { clockTierFor, tierIndexFor, nextTighteningAfter, hoursUntil, type Tightening } from "./clock-schedule";
export {
  draftedPlayerIds, availablePool, openSlotCount, isComplete, teamOnClock, bestAvailableFor,
  remainingBudget, minBidFor, maxBidFor, currentTier, currentClockSeconds, currentDeadline, nextTightening,
  draftStateView, type DraftStateView,
} from "./selectors";
export { draftActionSchema, clientDraftActionSchema, type ClientDraftAction } from "./action-schema";
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/draft-engine/events src/draft-engine/replay`
Expected: PASS (6 events + 3 replay tests).

- [ ] **Step 5: Write the full-draft exit-criteria tests**

```ts
// src/draft-engine/full-draft.test.ts
import { describe, it, expect } from "vitest";
import type { DraftPoolEntry, StartDraftAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { initialDraftState, totalRosterSlots, type DraftConfig, type DraftState } from "./state";
import { DRAFT_CLOCK_SCHEDULE } from "./config";
import { reduceDraft } from "./reduce";
import { snakeTeamForPick } from "./order";
import { isComplete, remainingBudget } from "./selectors";

const TEAMS = Array.from({ length: 12 }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);

/**
 * A 250-player pool with a realistic position mix, interleaved so the ranking isn't
 * position-sorted. Deterministic: no randomness, so the draft is reproducible.
 */
const POOL: readonly DraftPoolEntry[] = (() => {
  const plan: readonly (readonly [Position, number])[] = [["QB", 30], ["RB", 70], ["WR", 80], ["TE", 30], ["K", 20], ["DEF", 20]];
  const buckets = plan.map(([position, count]) =>
    Array.from({ length: count }, (_, i) => ({ playerId: `${position.toLowerCase()}${i + 1}`, position })),
  );
  const out: DraftPoolEntry[] = [];
  for (let i = 0; out.length < 250; i++) {
    for (const bucket of buckets) {
      const entry = bucket[i];
      if (entry !== undefined) out.push(entry);
    }
  }
  return out;
})();

const T = "2026-09-01T00:00:00.000Z";
const START: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: T, draftOrder: TEAMS, pool: POOL };

function apply(state: DraftState, action: Parameters<typeof reduceDraft>[1]): DraftState {
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.reason}`);
  return result.state;
}

describe("a full 12-team, 15-round snake draft", () => {
  const config: DraftConfig = {
    draftId: "d_snake", leagueId: "l1", format: "snake", kickoffAt: "2026-09-10T17:00:00.000Z",
    auctionBudget: null, slotConfig: STANDARD_ROSTER_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };

  const final = (() => {
    let state = apply(initialDraftState(config), START);
    while (!isComplete(state)) state = apply(state, { v: 1, type: "TIMER_EXPIRE", timestamp: T });
    return state;
  })();

  it("runs to completion with exactly one pick per roster spot", () => {
    expect(final.picks).toHaveLength(TEAMS.length * totalRosterSlots(STANDARD_ROSTER_SLOTS));
    expect(final.picks).toHaveLength(180);
    expect(final.phase).toBe("complete");
  });

  it("never drafts the same player twice", () => {
    expect(new Set(final.picks.map((p) => p.playerId)).size).toBe(final.picks.length);
  });

  it("follows serpentine order for every one of the 180 picks", () => {
    for (const pick of final.picks) {
      expect(pick.teamId).toBe(snakeTeamForPick(TEAMS, pick.pickNumber));
    }
  });

  it("fills every roster completely and legally", () => {
    for (const teamId of TEAMS) {
      const roster = final.rosters[teamId] ?? [];
      expect(roster).toHaveLength(15);
      // Every configured slot is filled to its exact count — no slot over-filled.
      for (const slotConfig of STANDARD_ROSTER_SLOTS) {
        expect(roster.filter((s) => s.slot === slotConfig.slot)).toHaveLength(slotConfig.count);
      }
    }
  });

  it("rejects a pick for an already-drafted player at any point in the draft", () => {
    const drafted = final.picks[0]!.playerId;
    let state = apply(initialDraftState(config), START);
    state = apply(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: TEAMS[0]!, playerId: drafted });
    expect(reduceDraft(state, { v: 1, type: "MAKE_PICK", timestamp: T, teamId: TEAMS[1]!, playerId: drafted })).toEqual({
      ok: false,
      reason: "That player has already been drafted.",
    });
  });
});

describe("a full 12-team auction draft", () => {
  const config: DraftConfig = {
    draftId: "d_auction", leagueId: "l1", format: "auction", kickoffAt: "2026-09-10T17:00:00.000Z",
    auctionBudget: 200, slotConfig: STANDARD_ROSTER_SLOTS, clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };

  it("runs to completion on the clock alone, filling every roster and charging every budget", () => {
    let state = apply(initialDraftState(config), START);
    let guard = 0;
    while (!isComplete(state)) {
      state = apply(state, { v: 1, type: "TIMER_EXPIRE", timestamp: T });
      guard += 1;
      expect(guard).toBeLessThan(1000); // fails loudly instead of hanging if the auction can't finish
    }
    expect(state.picks).toHaveLength(180);
    for (const teamId of TEAMS) {
      expect(state.rosters[teamId]).toHaveLength(15);
      // Every unchallenged auto-nomination goes for the $1 minimum.
      expect(remainingBudget(state, teamId)).toBe(200 - 15);
    }
  });

  it("enforces budgets through a real bidding war", () => {
    let state = apply(initialDraftState(config), START);
    state = apply(state, { v: 1, type: "NOMINATE", timestamp: T, teamId: TEAMS[0]!, playerId: "qb1", openingBid: 50 });
    state = apply(state, { v: 1, type: "BID", timestamp: T, teamId: TEAMS[1]!, amount: 120 });
    state = apply(state, { v: 1, type: "BID", timestamp: T, teamId: TEAMS[0]!, amount: 186 });
    // $200 less $14 held back for 14 unfilled spots.
    expect(reduceDraft(state, { v: 1, type: "BID", timestamp: T, teamId: TEAMS[1]!, amount: 187 })).toEqual({
      ok: false,
      reason: "You can only bid up to $186 — you need $1 for each of your remaining roster spots.",
    });
    state = apply(state, { v: 1, type: "TIMER_EXPIRE", timestamp: T });
    expect(remainingBudget(state, TEAMS[0]!)).toBe(14);
    expect(state.picks[0]).toMatchObject({ teamId: TEAMS[0], playerId: "qb1", price: 186 });
  });
});
```

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- src/draft-engine/full-draft`
Expected: PASS (7 tests). If the snake draft fails to complete, the pool is short of kickers or defenses — the plan's mix (20 K, 20 DEF for 12 teams) covers it; do not "fix" it by removing the K/DEF slots.

- [ ] **Step 7: Add the coverage threshold and close every gap**

In `vitest.config.mts`, extend `coverage.thresholds`:

```ts
      thresholds: {
        "src/scoring/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/draft-engine/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
```

Run: `npm run test:coverage -- src/draft-engine`
Expected: all tests PASS and `src/draft-engine/**` reports 100% on all four metrics.

If a branch is uncovered, add a test for it — **never lower the threshold and never add an `istanbul ignore`.** The likely gaps and the test that closes each:
- `maxBidFor` when a team's roster is full → assert it returns 0 for a team with 15 filled slots.
- `roundForPick`/`snakeTeamForPick` guard for an out-of-range pick number → already covered by `order.test.ts`.
- `applyPick`'s auction `round` branch → covered by the auction tests; if not, assert `picks[1].round === 2` for a team that wins two lots.
- `clockTierFor`'s empty-schedule throw → covered by `clock-schedule.test.ts`.

- [ ] **Step 8: Full verification and commit**

Run: `npm run typecheck && npm run lint && npm test -- src/draft-engine`
Expected: clean.

```bash
git add src/draft-engine vitest.config.mts
git commit -m "feat(draft-engine): event derivation, action-log replay, full 12x15 snake and full auction drafts at 100% coverage

Events are derived from the state diff, not the action, so a clock-driven autopick broadcasts
exactly what a human pick would. Replay is the reason the durable store can be crash-recovered:
the action log is the source of truth and this is the only function that turns it back into state."
```

---

### Task 6: Schema migration + the durable, replay-based draft session store

**Model tier:** capable model (persistence ordering and concurrency are the correctness risk here).

**Files:**
- Modify: `src/db/schema.ts` (`leagues.roster_slots`, `draft_actions.sequence` + unique index)
- Create: `drizzle/0003_*.sql` (generated), `src/draft-service/config.ts`, `src/draft-service/mutex.ts`, `src/draft-service/setup.ts`, `src/draft-service/store.ts`, `src/draft-service/test-support.ts`
- Test: `src/draft-service/mutex.test.ts`, `src/draft-service/store.test.ts`

**Interfaces:**
- Consumes: `reduceDraft`, `replayDraft`, `draftEventsFor`, `draftActionSchema`, `DraftState`, `DraftConfig`, `DRAFT_CLOCK_SCHEDULE` (all from `@/draft-engine`); `Db`, `createTestDb`, `truncateAll`; `Clock` (`@/domain/timing`); `RealtimeEventType`.
- Produces:
  - `createKeyedMutex(): KeyedMutex` with `run<T>(key: string, task: () => Promise<T>): Promise<T>`.
  - `loadDraftConfig(db: Db, draftId: string): Promise<DraftConfig | null>`.
  - `createDraftStore(deps: DraftStoreDeps): DraftStore` where `DraftStoreDeps = { readonly db: Db; readonly publish: PublishFn; readonly clock: Clock }`, `PublishFn = (input: { leagueId: string; type: RealtimeEventType; payload: unknown }) => Promise<string | null>`, and `DraftStore = { getDraftState(draftId): Promise<DraftState | null>; applyAction(draftId, action: DraftAction): Promise<ApplyResult>; invalidate(draftId): void }`. **Task 7 extends this same interface and factory with `startDraft` and `commitDraftResults` — it does not create a second store.**
  - `ApplyResult = { readonly ok: true; readonly state: DraftState } | { readonly ok: false; readonly reason: string }`.
  - `SPRINT_ROSTER_SLOTS` and `seedDraftFixture(db, input): Promise<DraftFixture>` in `test-support.ts` (reused by Tasks 7, 8 and 9).

**The ordering contract, stated once:** load (cache or replay) → validate through the reducer → **persist the action row** → update the cache → publish, best-effort. Postgres is authoritative; the cache is only a cache; a Redis failure can never turn an accepted action into a rejected one.

- [ ] **Step 1: Extend the schema and generate the migration**

In `src/db/schema.ts`, import the roster config type and constant, add the column to `leagues`, and add the sequence to `draft_actions`:

```ts
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
```

Inside `leagues`, after `commissionerUserId`:

```ts
  /** The league's roster shape. The draft reads this to know its rounds and slot rules. */
  rosterSlots: jsonb("roster_slots").$type<readonly RosterSlotConfig[]>().notNull().default([...STANDARD_ROSTER_SLOTS]),
```

Replace the `draft_actions` table with:

```ts
export const draftActions = pgTable(
  "draft_actions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    draftId: text("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    /**
     * 1-based position in this draft's action log. The unique index below is the database's
     * own backstop against two writers appending at the same position — a bug in the
     * in-process lock can then cost a rejected action, never a double-drafted player.
     */
    sequence: integer("sequence").notNull(),
    action: jsonb("action").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("draft_actions_draft_id_id_idx").on(t.draftId, t.id),
    uniqueIndex("draft_actions_draft_sequence_idx").on(t.draftId, t.sequence),
  ],
);
```

`draft_actions` has never held a row (no draft has ever run), so `sequence NOT NULL` without a default is allowed under the Migrations rule in `docs/conventions.md`. `leagues.roster_slots` gets a `DEFAULT` regardless, so it is safe on a populated table.

Run: `npm run db:generate && npm run db:migrate && npm run db:migrate:test`
Expected: a new `drizzle/0003_*.sql`; both databases migrate cleanly. Commit the generated SQL.

- [ ] **Step 2: Write the failing mutex test**

```ts
// src/draft-service/mutex.test.ts
import { describe, it, expect } from "vitest";
import { createKeyedMutex } from "./mutex";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("createKeyedMutex", () => {
  it("runs tasks for the same key strictly one after another", async () => {
    const mutex = createKeyedMutex();
    const order: string[] = [];
    const task = (label: string) => async () => {
      order.push(`${label}:start`);
      await tick();
      order.push(`${label}:end`);
      return label;
    };
    const results = await Promise.all([mutex.run("d1", task("a")), mutex.run("d1", task("b")), mutex.run("d1", task("c"))]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("lets different keys run concurrently", async () => {
    const mutex = createKeyedMutex();
    const order: string[] = [];
    const task = (label: string) => async () => {
      order.push(`${label}:start`);
      await tick();
      order.push(`${label}:end`);
    };
    await Promise.all([mutex.run("d1", task("a")), mutex.run("d2", task("b"))]);
    expect(order.slice(0, 2).sort()).toEqual(["a:start", "b:start"]);
  });

  it("keeps the queue moving after a task throws", async () => {
    const mutex = createKeyedMutex();
    const failed = mutex.run("d1", async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    await expect(mutex.run("d1", async () => "next")).resolves.toBe("next");
  });
});
```

- [ ] **Step 3: Run to verify failure, then implement the mutex**

Run: `npm test -- src/draft-service/mutex`
Expected: FAIL — cannot find module `./mutex`.

```ts
// src/draft-service/mutex.ts

export interface KeyedMutex {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

/**
 * Serializes work per key by chaining promises.
 *
 * Phase 1 runs a single Node process, so an in-process queue is enough to keep two
 * submissions for the same draft from interleaving their read-validate-write. Phase 2 (multi
 * instance) replaces this with a Postgres advisory lock — which is exactly why the unique
 * index on (draft_id, sequence) exists as well: the database, not this map, is what makes a
 * double append impossible.
 */
export function createKeyedMutex(): KeyedMutex {
  const tails = new Map<string, Promise<unknown>>();
  return {
    async run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      // Run whether the previous task fulfilled or rejected — one failure must not wedge the queue.
      const result = previous.then(task, task);
      const settled = result.then(
        () => undefined,
        () => undefined,
      );
      tails.set(key, settled);
      try {
        return await result;
      } finally {
        // Only the last queued task clears the key, so a follower is never orphaned.
        if (tails.get(key) === settled) tails.delete(key);
      }
    },
  };
}
```

- [ ] **Step 4: Write the failing store test**

```ts
// src/draft-service/store.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftActions } from "@/db/schema";
import type { DraftAction, DraftPoolEntry } from "@/domain/draft";
import { createDraftStore, type PublishFn } from "./store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
const clock = { now: () => "2026-09-01T00:00:00.000Z" };
const T = "2026-09-01T00:00:00.000Z";

const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "wr1", position: "WR" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
  { playerId: "wr2", position: "WR" },
];

let published: { type: string; leagueId: string; payload: unknown }[] = [];
const publish: PublishFn = async (input) => {
  published.push({ type: input.type, leagueId: input.leagueId, payload: input.payload });
  return "1-0";
};

function newStore(publishFn: PublishFn = publish) {
  return createDraftStore({ db, publish: publishFn, clock });
}

async function fixture() {
  return seedDraftFixture(db, {
    draftId: "draft_1",
    leagueId: "league_1",
    format: "snake",
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: null,
  });
}

const start = (teamIds: readonly string[]): DraftAction => ({
  v: 1, type: "START_DRAFT", timestamp: T, draftOrder: teamIds, pool: POOL,
});
const pick = (teamId: string, playerId: string): DraftAction => ({ v: 1, type: "MAKE_PICK", timestamp: T, teamId, playerId });

async function actionRows(draftId: string) {
  return db.select().from(draftActions).where(eq(draftActions.draftId, draftId)).orderBy(asc(draftActions.sequence));
}

beforeEach(async () => {
  await truncateAll(db);
  published = [];
});

afterAll(async () => {
  await truncateAll(db);
});

describe("draft store — persistence", () => {
  it("returns null for a draft that doesn't exist", async () => {
    expect(await newStore().getDraftState("nope")).toBeNull();
  });

  it("appends one numbered action row per accepted action and materializes the state", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    expect((await store.applyAction(draftId, start(teamIds))).ok).toBe(true);
    const result = await store.applyAction(draftId, pick(teamIds[0]!, "qb1"));
    expect(result.ok).toBe(true);
    const rows = await actionRows(draftId);
    expect(rows.map((r) => r.sequence)).toEqual([1, 2]);
    expect(rows[1]?.action).toEqual(pick(teamIds[0]!, "qb1"));
    const state = await store.getDraftState(draftId);
    expect(state?.sequence).toBe(2);
    expect(state?.picks).toHaveLength(1);
  });

  it("persists nothing when the reducer rejects the action", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    const result = await store.applyAction(draftId, pick(teamIds[1]!, "qb1"));
    expect(result).toEqual({ ok: false, reason: "It's not your turn to pick." });
    expect(await actionRows(draftId)).toHaveLength(1);
  });

  it("publishes draft events after the write, on the league stream", async () => {
    const { draftId, teamIds, leagueId } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    await store.applyAction(draftId, pick(teamIds[0]!, "qb1"));
    expect(published.map((e) => e.type)).toEqual(["draft.status", "draft.pick"]);
    expect(published.every((e) => e.leagueId === leagueId)).toBe(true);
    expect(published[1]?.payload).toMatchObject({ draftId, playerId: "qb1", teamId: teamIds[0], sequence: 2 });
  });

  it("accepts the action even when publishing blows up — Postgres is authoritative", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore(async () => {
      throw new Error("redis is down");
    });
    expect((await store.applyAction(draftId, start(teamIds))).ok).toBe(true);
    const result = await store.applyAction(draftId, pick(teamIds[0]!, "qb1"));
    expect(result.ok).toBe(true);
    expect(await actionRows(draftId)).toHaveLength(2);
  });
});

describe("draft store — crash recovery", () => {
  it("rebuilds identical state from the action log alone after the cache is lost", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    await store.applyAction(draftId, pick(teamIds[0]!, "qb1"));
    await store.applyAction(draftId, pick(teamIds[1]!, "rb1"));
    const before = await store.getDraftState(draftId);

    // Simulate a process restart: a brand-new store, same database, empty cache.
    const restarted = newStore();
    expect(await restarted.getDraftState(draftId)).toEqual(before);

    // And an explicit cache drop on the original store reconstructs the same state.
    store.invalidate(draftId);
    expect(await store.getDraftState(draftId)).toEqual(before);
  });
});

describe("draft store — concurrency", () => {
  it("lets only one of two simultaneous submissions through, in-process", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    const [a, b] = await Promise.all([
      store.applyAction(draftId, pick(teamIds[0]!, "qb1")),
      store.applyAction(draftId, pick(teamIds[0]!, "rb1")),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await actionRows(draftId)).toHaveLength(2);
  });

  it("stops a double append at the database when two independent stores race", async () => {
    const { draftId, teamIds } = await fixture();
    const storeA = newStore();
    const storeB = newStore();
    await storeA.applyAction(draftId, start(teamIds));
    // Warm B's cache so both stores believe the next sequence is 2 — the in-process lock
    // can't help across processes; the unique index is what must stop this.
    await storeB.getDraftState(draftId);
    const results = await Promise.all([
      storeA.applyAction(draftId, pick(teamIds[0]!, "qb1")),
      storeB.applyAction(draftId, pick(teamIds[0]!, "rb1")),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser).toEqual({ ok: false, reason: "Someone else acted first. Try again." });
    expect(await actionRows(draftId)).toHaveLength(2);
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npm test -- src/draft-service/store`
Expected: FAIL — cannot find module `./store`.

- [ ] **Step 6: Implement the fixtures, config, setup loader and store**

```ts
// src/draft-service/config.ts
export const DRAFT_SERVICE_CONFIG = {
  /** How often the server checks live drafts for an expired clock (ms). */
  tickIntervalMs: 1_000,
  /** Ceiling on drafts examined per tick, so one tick can't starve the event loop. */
  maxDraftsPerTick: 50,
} as const;
```

```ts
// src/draft-service/setup.ts
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues } from "@/db/schema";
import { DRAFT_CLOCK_SCHEDULE, type DraftConfig } from "@/draft-engine";

/**
 * The static half of a draft's state: what the reducer needs and the action log doesn't
 * carry, read straight from the rows that own it. Null when the draft doesn't exist.
 */
export async function loadDraftConfig(db: Db, draftId: string): Promise<DraftConfig | null> {
  const [row] = await db
    .select({
      draftId: drafts.id,
      leagueId: drafts.leagueId,
      format: drafts.format,
      kickoffAt: drafts.kickoffAt,
      auctionBudget: drafts.auctionBudget,
      slotConfig: leagues.rosterSlots,
    })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(eq(drafts.id, draftId));
  if (row === undefined) return null;
  return {
    draftId: row.draftId,
    leagueId: row.leagueId,
    format: row.format,
    kickoffAt: row.kickoffAt.toISOString(),
    auctionBudget: row.auctionBudget,
    slotConfig: row.slotConfig,
    clockSchedule: DRAFT_CLOCK_SCHEDULE,
  };
}
```

```ts
// src/draft-service/test-support.ts
import type { Db } from "@/db/client";
import { drafts, leagues, teams, users } from "@/db/schema";
import type { DraftFormat } from "@/domain/league";
import type { RosterSlotConfig } from "@/domain/roster";

/** Three roster spots — enough to exercise every rule, short enough that a 12-team draft is fast. */
export const SPRINT_ROSTER_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
  { slot: "WR", count: 1, eligiblePositions: ["WR"] },
];

export interface SeedDraftInput {
  readonly draftId: string;
  readonly leagueId: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly slotConfig: readonly RosterSlotConfig[];
  readonly kickoffAt: Date;
  readonly auctionBudget: number | null;
}

export interface DraftFixture {
  readonly draftId: string;
  readonly leagueId: string;
  readonly teamIds: readonly string[];
  readonly userIds: readonly string[];
}

/** Inserts users, a league, its teams and a scheduled draft. Test-only. */
export async function seedDraftFixture(db: Db, input: SeedDraftInput): Promise<DraftFixture> {
  const userIds = Array.from({ length: input.teamCount }, (_, i) => `${input.leagueId}_user_${i + 1}`);
  const teamIds = Array.from({ length: input.teamCount }, (_, i) => `${input.leagueId}_team_${i + 1}`);

  await db.insert(users).values(userIds.map((id) => ({ id, email: `${id}@test.local`, displayName: id })));
  await db.insert(leagues).values({
    id: input.leagueId,
    name: input.leagueId,
    format: input.format,
    teamCount: input.teamCount,
    inviteCode: `${input.leagueId}_invite`,
    commissionerUserId: userIds[0]!,
    rosterSlots: [...input.slotConfig],
  });
  await db.insert(teams).values(
    teamIds.map((id, i) => ({ id, leagueId: input.leagueId, userId: userIds[i]!, name: `Team ${i + 1}` })),
  );
  await db.insert(drafts).values({
    id: input.draftId,
    leagueId: input.leagueId,
    format: input.format,
    status: "scheduled",
    kickoffAt: input.kickoffAt,
    auctionBudget: input.auctionBudget,
  });

  return { draftId: input.draftId, leagueId: input.leagueId, teamIds, userIds };
}
```

```ts
// src/draft-service/store.ts
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { draftActions } from "@/db/schema";
import type { DraftAction } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import {
  draftActionSchema,
  draftEventsFor,
  reduceDraft,
  replayDraft,
  type DraftState,
} from "@/draft-engine";
import type { RealtimeEventType } from "@/lib/realtime/events";
import { createKeyedMutex } from "./mutex";
import { loadDraftConfig } from "./setup";

export type PublishFn = (input: {
  readonly leagueId: string;
  readonly type: RealtimeEventType;
  readonly payload: unknown;
}) => Promise<string | null>;

export interface DraftStoreDeps {
  readonly db: Db;
  readonly publish: PublishFn;
  readonly clock: Clock;
}

export type ApplyResult =
  | { readonly ok: true; readonly state: DraftState }
  | { readonly ok: false; readonly reason: string };

export interface DraftStore {
  getDraftState(draftId: string): Promise<DraftState | null>;
  applyAction(draftId: string, action: DraftAction): Promise<ApplyResult>;
  invalidate(draftId: string): void;
}

/** Postgres unique-violation SQLSTATE, as surfaced by the `postgres` driver. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

/**
 * The durable draft session store.
 *
 * The `draft_actions` log is the source of truth; `cache` is only a materialization of it,
 * so losing the process loses nothing. Every accepted action is persisted BEFORE it reaches
 * the cache or the wire, and publishing is best-effort after the write — a Redis outage must
 * never make a committed pick look rejected.
 */
export function createDraftStore({ db, publish }: DraftStoreDeps): DraftStore {
  const cache = new Map<string, DraftState>();
  const mutex = createKeyedMutex();

  async function load(draftId: string): Promise<DraftState | null> {
    const cached = cache.get(draftId);
    if (cached !== undefined) return cached;
    const config = await loadDraftConfig(db, draftId);
    if (config === null) return null;
    const rows = await db
      .select()
      .from(draftActions)
      .where(eq(draftActions.draftId, draftId))
      .orderBy(asc(draftActions.sequence));
    const state = replayDraft(config, rows.map((row) => draftActionSchema.parse(row.action)));
    cache.set(draftId, state);
    return state;
  }

  async function broadcast(previous: DraftState, next: DraftState, action: DraftAction): Promise<void> {
    for (const event of draftEventsFor(previous, next, action)) {
      try {
        await publish({ leagueId: next.config.leagueId, type: event.type, payload: event.payload });
      } catch {
        // Best-effort by contract: the write is already committed and clients can refetch.
      }
    }
  }

  return {
    async getDraftState(draftId) {
      return mutex.run(draftId, () => load(draftId));
    },

    invalidate(draftId) {
      cache.delete(draftId);
    },

    async applyAction(draftId, action) {
      return mutex.run(draftId, async (): Promise<ApplyResult> => {
        const state = await load(draftId);
        if (state === null) return { ok: false, reason: "That draft doesn't exist." };

        const result = reduceDraft(state, action);
        if (!result.ok) return result;

        try {
          await db.insert(draftActions).values({
            draftId,
            sequence: result.state.sequence,
            action,
            timestamp: new Date(action.timestamp),
          });
        } catch (error: unknown) {
          // Our view of the log is provably stale — drop it so the next read replays.
          cache.delete(draftId);
          if (isUniqueViolation(error)) return { ok: false, reason: "Someone else acted first. Try again." };
          throw error;
        }

        cache.set(draftId, result.state);
        await broadcast(state, result.state, action);
        return { ok: true, state: result.state };
      });
    },
  };
}
```

- [ ] **Step 7: Run to verify pass**

Run: `npm run infra:up && npm test -- src/draft-service && npm run typecheck && npm run lint`
Expected: PASS (3 mutex + 8 store tests); typecheck and lint clean.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts drizzle src/draft-service
git commit -m "feat(draft-service): durable replay-based draft store — persist before publish, cache is only a cache

The draft_actions log is the source of truth and the in-memory map is a materialization of it,
so a crash mid-draft costs nothing: a fresh store replays the log to byte-identical state. Two
guards stop a double append — an in-process per-draft queue for Phase 1's single instance, and
a unique index on (draft_id, sequence) so a bug in the lock costs a retry, not a duplicated pick."
```

---

### Task 7: `startDraft`, `commitDraftResults`, the ranked pool, and the dev-league seed

**Model tier:** capable model.

**Files:**
- Create: `src/draft-service/order.ts`, `src/draft-service/pool.ts`, `src/draft-service/commit.ts`, `src/data/seed/config.ts`, `src/data/seed/seed-dev-leagues.ts`
- Modify: `src/db/client.ts` (export `DbTx`), `src/draft-service/store.ts` (add `startDraft`, `commitDraftResults`, transactional append), `src/data/seed/index.ts`
- Test: `src/draft-service/order.test.ts`, `src/draft-service/pool.test.ts`, `src/draft-service/commit.test.ts`, `src/data/seed/seed-dev-leagues.test.ts`

**Interfaces:**
- Consumes: `createDraftStore`, `seedDraftFixture`, `SPRINT_ROSTER_SLOTS`, `loadDraftConfig`, `computeFantasyPoints` (`@/scoring`), `PPR_SCORING` (`@/domain/scoring`), `STANDARD_ROSTER_SLOTS`.
- Produces:
  - `draftOrderFor(draftId: string, teamIds: readonly string[]): readonly string[]` — deterministic seeded shuffle.
  - `buildDraftPool(db: Db, leagueId: string): Promise<readonly DraftPoolEntry[]>` — every player, ranked by projected season points under the league's scoring settings, tie-broken by `playerId` ascending.
  - `DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0]` — **exported from `src/db/client.ts`**, so `store.ts` and `commit.ts` share it without importing each other; `applyAction(draftId, action, options?: { readonly alsoInTransaction?: (tx: DbTx) => Promise<void> })`.
  - `store.startDraft(draftId: string): Promise<ApplyResult>`.
  - `store.commitDraftResults(draftId: string): Promise<CommitResult>` where `CommitResult = { readonly ok: true; readonly picks: number; readonly teams: number; readonly alreadyCommitted: boolean } | { readonly ok: false; readonly reason: string }`.
  - `commitDraftState(tx: DbTx, state: DraftState): Promise<{ picks: number; teams: number }>` in `commit.ts`.
  - `seedDevLeagues(db: Db, clock: Clock): Promise<{ leagues: number; teams: number; drafts: number }>`; `DEV_SEED` config.

**Design decisions this task locks in:**
- **How a draft gets its order:** `draftOrderFor` shuffles the league's team ids with a PRNG seeded from the draft id, so the same draft always produces the same order (reproducible bug reports) while different drafts differ. The result is written into the `START_DRAFT` action, so the log — not this function — is what any later replay reads.
- **How the pool gets ranked:** projected season points, computed with the existing scoring engine over `player_stat_lines` under the league's own `scoring_settings` (PPR when a league has none yet). Deterministic and explainable, and it reuses Plan A's engine rather than inventing a rating. Ties break on `playerId` ascending so the order is total.
- **Commit is the one seam between "a draft happened" and "a season exists."** It runs automatically the moment the reducer completes a draft (inside the same `applyAction` call, before it returns), and is also callable directly and idempotently. It writes `draft_picks`, fills `roster_slots`, and flips `drafts.status` to `complete` in **one transaction**, identically for snake and auction — auction picks simply carry a `price`.

- [ ] **Step 1: Write the failing order and pool tests**

```ts
// src/draft-service/order.test.ts
import { describe, it, expect } from "vitest";
import { draftOrderFor } from "./order";

const TEAMS = Array.from({ length: 12 }, (_, i) => `t${String(i + 1).padStart(2, "0")}`);

describe("draftOrderFor", () => {
  it("is deterministic for a given draft id", () => {
    expect(draftOrderFor("draft_abc", TEAMS)).toEqual(draftOrderFor("draft_abc", TEAMS));
  });

  it("is a permutation of the teams — every team drafts exactly once per round", () => {
    expect([...draftOrderFor("draft_abc", TEAMS)].sort()).toEqual([...TEAMS].sort());
  });

  it("does not simply preserve input order", () => {
    expect(draftOrderFor("draft_abc", TEAMS)).not.toEqual(TEAMS);
  });

  it("gives different drafts different orders", () => {
    // With 12 teams a collision has probability 1/12!, but if these two ids do collide,
    // pick a different pair — do not delete the test.
    expect(draftOrderFor("draft_abc", TEAMS)).not.toEqual(draftOrderFor("draft_xyz", TEAMS));
  });

  it("ignores the order the team ids arrive in", () => {
    expect(draftOrderFor("draft_abc", [...TEAMS].reverse())).toEqual(draftOrderFor("draft_abc", TEAMS));
  });
});
```

```ts
// src/draft-service/pool.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { players, playerStatLines } from "@/db/schema";
import { buildDraftPool } from "./pool";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();

const zeroLine = {
  passingYards: 0, passingTouchdowns: 0, interceptions: 0, rushingYards: 0, rushingTouchdowns: 0,
  receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0, fieldGoalsMade: 0,
  extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
};

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("buildDraftPool", () => {
  it("ranks every player by projected season points, best first", async () => {
    const { leagueId } = await seedDraftFixture(db, {
      draftId: "draft_p", leagueId: "league_p", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await db.insert(players).values([
      { id: "star", name: "Star Back", position: "RB", nflTeam: "KC" },
      { id: "scrub", name: "Scrub Back", position: "RB", nflTeam: "NYJ" },
      { id: "middle", name: "Middle Receiver", position: "WR", nflTeam: "SF" },
    ]);
    await db.insert(playerStatLines).values([
      { ...zeroLine, playerId: "star", week: 1, rushingYards: 200, rushingTouchdowns: 2 },
      { ...zeroLine, playerId: "middle", week: 1, receivingYards: 100, receptions: 5 },
      { ...zeroLine, playerId: "scrub", week: 1, rushingYards: 10 },
    ]);

    const pool = await buildDraftPool(db, leagueId);
    expect(pool.map((p) => p.playerId)).toEqual(["star", "middle", "scrub"]);
    expect(pool.map((p) => p.position)).toEqual(["RB", "WR", "RB"]);
  });

  it("includes players with no stat lines at all, ranked last and ordered by id", async () => {
    const { leagueId } = await seedDraftFixture(db, {
      draftId: "draft_q", leagueId: "league_q", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await db.insert(players).values([
      { id: "b_rookie", name: "B Rookie", position: "WR", nflTeam: "SF" },
      { id: "a_rookie", name: "A Rookie", position: "WR", nflTeam: "SF" },
      { id: "vet", name: "Vet", position: "WR", nflTeam: "SF" },
    ]);
    await db.insert(playerStatLines).values([{ ...zeroLine, playerId: "vet", week: 1, receivingYards: 50 }]);

    expect((await buildDraftPool(db, leagueId)).map((p) => p.playerId)).toEqual(["vet", "a_rookie", "b_rookie"]);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement order and pool**

Run: `npm test -- src/draft-service/order src/draft-service/pool`
Expected: FAIL — cannot find modules `./order` and `./pool`.

```ts
// src/draft-service/order.ts

/** FNV-1a — a small, stable string hash. Same id, same seed, forever. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32 — the same deterministic PRNG the mock dataset generator uses. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A fair, reproducible draft order: the team ids are sorted (so the caller's query order
 * can't influence the result) and then Fisher-Yates shuffled with a PRNG seeded from the
 * draft id. Reproducible matters for debugging a real draft; the authoritative record is
 * still the order written into the START_DRAFT action, not this function.
 *
 * The shuffle mutates a local copy only — the caller's array is never touched.
 */
export function draftOrderFor(draftId: string, teamIds: readonly string[]): readonly string[] {
  const random = mulberry32(hashString(draftId));
  const out = [...teamIds].sort();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = out[i]!;
    out[i] = out[j]!;
    out[j] = swap;
  }
  return out;
}
```

```ts
// src/draft-service/pool.ts
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { players, playerStatLines, scoringSettings } from "@/db/schema";
import type { DraftPoolEntry } from "@/domain/draft";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring";

/**
 * The draftable pool, ranked. Ranking is projected season points under the league's own
 * scoring settings, computed with the same scoring engine that scores real weeks — so a
 * PPR league's board looks like a PPR board. Ties break on player id so the order is total,
 * which is what makes autopick reproducible.
 *
 * The ranking is snapshotted into the START_DRAFT action; nothing re-ranks mid-draft.
 */
export async function buildDraftPool(db: Db, leagueId: string): Promise<readonly DraftPoolEntry[]> {
  const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
  const rules = settings === undefined ? PPR_SCORING : settings;

  const roster = await db.select().from(players);
  const lines = await db.select().from(playerStatLines);
  const positionById = new Map(roster.map((p) => [p.id, p.position]));

  const projected = new Map<string, number>();
  for (const line of lines) {
    const position = positionById.get(line.playerId);
    if (position === undefined) continue;
    projected.set(line.playerId, (projected.get(line.playerId) ?? 0) + computeFantasyPoints(line, position, rules));
  }

  return [...roster]
    .sort((a, b) => {
      const diff = (projected.get(b.id) ?? 0) - (projected.get(a.id) ?? 0);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    })
    .map((p) => ({ playerId: p.id, position: p.position }));
}
```

Run: `npm test -- src/draft-service/order src/draft-service/pool`
Expected: PASS (5 order + 2 pool tests).

- [ ] **Step 3: Write the failing start + commit tests**

```ts
// src/draft-service/commit.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftPicks, drafts, players, rosterSlots } from "@/db/schema";
import { createDraftStore } from "./store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
const clock = { now: () => "2026-09-01T00:00:00.000Z" };
const publish = async () => "1-0";
// Rebuilt per test: the store caches materialized state, and truncating the tables between
// tests would otherwise leave a stale cache pointing at a draft id that no longer exists.
let store = createDraftStore({ db, publish, clock });

/** One player per position per team slot, so a 2-team sprint draft always fills. */
const POOL_ROWS = [
  { id: "qb1", name: "QB One", position: "QB" as const, nflTeam: "KC" },
  { id: "qb2", name: "QB Two", position: "QB" as const, nflTeam: "SF" },
  { id: "rb1", name: "RB One", position: "RB" as const, nflTeam: "KC" },
  { id: "rb2", name: "RB Two", position: "RB" as const, nflTeam: "SF" },
  { id: "wr1", name: "WR One", position: "WR" as const, nflTeam: "KC" },
  { id: "wr2", name: "WR Two", position: "WR" as const, nflTeam: "SF" },
];

async function fixture(format: "snake" | "auction") {
  const f = await seedDraftFixture(db, {
    draftId: `draft_${format}`,
    leagueId: `league_${format}`,
    format,
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: format === "auction" ? 50 : null,
  });
  await db.insert(players).values(POOL_ROWS);
  return f;
}

/** Runs the draft to completion on the clock alone. */
async function runOnTheClock(draftId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const state = await store.getDraftState(draftId);
    if (state === null || state.phase === "complete") return;
    const result = await store.applyAction(draftId, { v: 1, type: "TIMER_EXPIRE", timestamp: clock.now() });
    if (!result.ok) throw new Error(result.reason);
  }
  throw new Error("draft did not finish");
}

beforeEach(async () => {
  await truncateAll(db);
  store = createDraftStore({ db, publish, clock });
});

afterAll(async () => {
  await truncateAll(db);
});

describe("startDraft", () => {
  it("opens the draft with a full ranked pool and every team in the order, and marks the row in progress", async () => {
    const { draftId, teamIds } = await fixture("snake");
    const result = await store.startDraft(draftId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.state.draftOrder].sort()).toEqual([...teamIds].sort());
    expect(result.state.pool).toHaveLength(POOL_ROWS.length);
    expect(result.state.phase).toBe("in_progress");
    const [row] = await db.select().from(drafts).where(eq(drafts.id, draftId));
    expect(row?.status).toBe("in_progress");
  });

  it("refuses to start the same draft twice", async () => {
    const { draftId } = await fixture("snake");
    await store.startDraft(draftId);
    expect(await store.startDraft(draftId)).toEqual({ ok: false, reason: "This draft has already started." });
  });

  it("refuses to start a draft that doesn't exist", async () => {
    expect(await store.startDraft("nope")).toEqual({ ok: false, reason: "That draft doesn't exist." });
  });
});

describe("commitDraftResults — snake", () => {
  it("writes every pick and fills every roster slot when the draft completes", async () => {
    const { draftId, teamIds } = await fixture("snake");
    await store.startDraft(draftId);
    await runOnTheClock(draftId);

    const picks = await db.select().from(draftPicks).where(eq(draftPicks.draftId, draftId)).orderBy(asc(draftPicks.pickNumber));
    expect(picks).toHaveLength(6);
    expect(picks.map((p) => p.pickNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(picks.map((p) => p.playerId)).size).toBe(6);
    expect(picks.every((p) => p.price === null)).toBe(true);

    for (const teamId of teamIds) {
      const slots = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, teamId));
      expect(slots).toHaveLength(3);
      expect([...slots.map((s) => s.slot)].sort()).toEqual(["QB", "RB", "WR"]);
      expect(slots.every((s) => s.playerId !== null)).toBe(true);
    }

    const [row] = await db.select().from(drafts).where(eq(drafts.id, draftId));
    expect(row?.status).toBe("complete");
  });

  it("is idempotent — committing an already-committed draft changes nothing", async () => {
    const { draftId } = await fixture("snake");
    await store.startDraft(draftId);
    await runOnTheClock(draftId);
    const again = await store.commitDraftResults(draftId);
    expect(again).toEqual({ ok: true, picks: 6, teams: 2, alreadyCommitted: true });
    expect(await db.select().from(draftPicks).where(eq(draftPicks.draftId, draftId))).toHaveLength(6);
  });

  it("refuses to commit a draft that hasn't finished", async () => {
    const { draftId } = await fixture("snake");
    await store.startDraft(draftId);
    expect(await store.commitDraftResults(draftId)).toEqual({ ok: false, reason: "This draft isn't finished yet." });
  });
});

describe("commitDraftResults — auction", () => {
  it("persists auction rosters through the same seam, carrying the winning price", async () => {
    const { draftId, teamIds } = await fixture("auction");
    await store.startDraft(draftId);
    await runOnTheClock(draftId);

    const picks = await db.select().from(draftPicks).where(eq(draftPicks.draftId, draftId));
    expect(picks).toHaveLength(6);
    // Every unchallenged auto-nomination clears at the $1 minimum.
    expect(picks.every((p) => p.price === 1)).toBe(true);
    for (const teamId of teamIds) {
      expect(await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, teamId))).toHaveLength(3);
    }
    const [row] = await db.select().from(drafts).where(eq(drafts.id, draftId));
    expect(row?.status).toBe("complete");
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npm test -- src/draft-service/commit`
Expected: FAIL — `store.startDraft` is not a function.

- [ ] **Step 5: Implement commit, and extend the store with `startDraft` / `commitDraftResults`**

Add to `src/db/client.ts` (one line, next to `Db`):

```ts
/** The transaction handle Drizzle hands a `db.transaction` callback. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
```

```ts
// src/draft-service/commit.ts
import { eq } from "drizzle-orm";
import type { DbTx } from "@/db/client";
import { draftPicks, drafts, rosterSlots } from "@/db/schema";
import type { DraftState } from "@/draft-engine";

export interface CommittedCounts {
  readonly picks: number;
  readonly teams: number;
}

/**
 * The one seam between "a draft happened" and "a season exists": the picks become rows, the
 * rosters become roster slots, and the draft is closed — all in the caller's transaction, so
 * a half-committed draft is impossible. Snake and auction go through this identically; an
 * auction pick simply carries the price it cleared at.
 */
export async function commitDraftState(tx: DbTx, state: DraftState): Promise<CommittedCounts> {
  const draftId = state.config.draftId;

  await tx.insert(draftPicks).values(
    state.picks.map((pick) => ({
      draftId,
      teamId: pick.teamId,
      playerId: pick.playerId,
      round: pick.round,
      pickNumber: pick.pickNumber,
      price: pick.price,
    })),
  );

  const slotRows = Object.entries(state.rosters).flatMap(([teamId, slots]) =>
    slots.map((slot) => ({ teamId, slot: slot.slot, slotIndex: slot.slotIndex, playerId: slot.playerId })),
  );
  if (slotRows.length > 0) {
    await tx
      .insert(rosterSlots)
      .values(slotRows)
      .onConflictDoUpdate({
        target: [rosterSlots.teamId, rosterSlots.slot, rosterSlots.slotIndex],
        set: { playerId: rosterSlots.playerId },
      });
  }

  await tx.update(drafts).set({ status: "complete" }).where(eq(drafts.id, draftId));

  return { picks: state.picks.length, teams: Object.keys(state.rosters).length };
}
```

Modify `src/draft-service/store.ts`:

```ts
// add to the imports
import { eq } from "drizzle-orm";
import type { DbTx } from "@/db/client";
import { drafts, teams } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import { commitDraftState } from "./commit";
import { buildDraftPool } from "./pool";
import { draftOrderFor } from "./order";

export interface ApplyOptions {
  /** Extra work to commit atomically with the action row (e.g. flipping `drafts.status`). */
  readonly alsoInTransaction?: (tx: DbTx) => Promise<void>;
}

export type CommitResult =
  | { readonly ok: true; readonly picks: number; readonly teams: number; readonly alreadyCommitted: boolean }
  | { readonly ok: false; readonly reason: string };
```

Extend the `DraftStore` interface with:

```ts
  startDraft(draftId: string): Promise<ApplyResult>;
  commitDraftResults(draftId: string): Promise<CommitResult>;
```

Replace the body of `applyAction` so the insert (plus any caller-supplied work, plus an
automatic commit when the draft completes) happens in one transaction:

```ts
    async applyAction(draftId, action, options?: ApplyOptions) {
      return mutex.run(draftId, async (): Promise<ApplyResult> => {
        const state = await load(draftId);
        if (state === null) return { ok: false, reason: "That draft doesn't exist." };

        const result = reduceDraft(state, action);
        if (!result.ok) return result;

        try {
          await db.transaction(async (tx) => {
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
          });
        } catch (error: unknown) {
          cache.delete(draftId);
          if (isUniqueViolation(error)) return { ok: false, reason: "Someone else acted first. Try again." };
          throw error;
        }

        cache.set(draftId, result.state);
        await broadcast(state, result.state, action);
        return { ok: true, state: result.state };
      });
    },
```

Add the two new methods:

```ts
    async startDraft(draftId) {
      const config = await loadDraftConfig(db, draftId);
      if (config === null) return { ok: false, reason: "That draft doesn't exist." };
      const teamRows = await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, config.leagueId));
      const pool = await buildDraftPool(db, config.leagueId);
      if (pool.length === 0) return { ok: false, reason: "There are no players to draft yet." };
      return this.applyAction(
        draftId,
        {
          v: DRAFT_ACTION_VERSION,
          type: "START_DRAFT",
          timestamp: clock.now(),
          draftOrder: draftOrderFor(draftId, teamRows.map((t) => t.id)),
          pool,
        },
        { alsoInTransaction: async (tx) => { await tx.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, draftId)); } },
      );
    },

    async commitDraftResults(draftId) {
      return mutex.run(draftId, async (): Promise<CommitResult> => {
        const state = await load(draftId);
        if (state === null) return { ok: false, reason: "That draft doesn't exist." };
        if (state.phase !== "complete") return { ok: false, reason: "This draft isn't finished yet." };
        const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, draftId));
        if (row?.status === "complete") {
          return { ok: true, picks: state.picks.length, teams: Object.keys(state.rosters).length, alreadyCommitted: true };
        }
        const counts = await db.transaction((tx) => commitDraftState(tx, state));
        return { ok: true, ...counts, alreadyCommitted: false };
      });
    },
```

The factory's parameter destructuring becomes `{ db, publish, clock }` — `startDraft` stamps
the `START_DRAFT` timestamp with the injected clock, which is why the store takes one.

`startDraft` calls `applyAction` (which takes the mutex) and must therefore **not** hold the
mutex itself — the queue is not reentrant. `applyAction`'s automatic commit calls
`commitDraftState` directly for the same reason, never the public `commitDraftResults`.
The store factory must return an object literal that can reference itself; declare it as a
`const store: DraftStore = { … }` and `return store`, using `store.applyAction(...)` inside
`startDraft` rather than `this`.

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- src/draft-service && npm run typecheck`
Expected: PASS (7 commit + earlier draft-service tests); typecheck clean.

- [ ] **Step 7: Write the failing dev-seed test**

```ts
// src/data/seed/seed-dev-leagues.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, teams } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { DEV_SEED } from "./config";
import { seedDevLeagues } from "./seed-dev-leagues";

const db = createTestDb();
const clock = { now: () => "2026-09-01T00:00:00.000Z" };

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("seedDevLeagues", () => {
  it("creates a snake and an auction dev league, each with a full set of teams and a scheduled draft", async () => {
    const result = await seedDevLeagues(db, clock);
    expect(result).toEqual({ leagues: 2, teams: DEV_SEED.teamCount * 2, drafts: 2 });

    const [snake] = await db.select().from(leagues).where(eq(leagues.id, DEV_SEED.snake.leagueId));
    expect(snake?.format).toBe("snake");
    expect(snake?.rosterSlots).toHaveLength(STANDARD_ROSTER_SLOTS.length);

    expect(await db.select().from(teams).where(eq(teams.leagueId, DEV_SEED.snake.leagueId))).toHaveLength(DEV_SEED.teamCount);

    const [draft] = await db.select().from(drafts).where(eq(drafts.id, DEV_SEED.snake.draftId));
    expect(draft?.status).toBe("scheduled");
    expect(draft?.kickoffAt.toISOString()).toBe("2026-09-02T02:00:00.000Z"); // clock.now() + 26h

    const [auctionDraft] = await db.select().from(drafts).where(eq(drafts.id, DEV_SEED.auction.draftId));
    expect(auctionDraft?.auctionBudget).toBe(DEV_SEED.auction.budget);
  });

  it("is idempotent — running it twice leaves exactly one of everything", async () => {
    await seedDevLeagues(db, clock);
    await seedDevLeagues(db, clock);
    expect(await db.select().from(leagues)).toHaveLength(2);
    expect(await db.select().from(teams)).toHaveLength(DEV_SEED.teamCount * 2);
    expect(await db.select().from(drafts)).toHaveLength(2);
  });
});
```

- [ ] **Step 8: Run to verify failure, then implement the seed**

Run: `npm test -- src/data/seed/seed-dev-leagues`
Expected: FAIL — cannot find module `./config`.

```ts
// src/data/seed/config.ts
export const DEV_SEED = {
  teamCount: 12,
  /** Hours from "now" to the seeded drafts' kickoff — far enough out to sit in a slow clock tier. */
  kickoffHoursFromNow: 26,
  /**
   * Dev-only local user ids. These are NOT WorkOS user ids: WorkOS owns real identity and
   * writes its own `users` rows from the AuthKit callback. These placeholder rows exist so a
   * seeded league has 12 owners to draft against locally, and nothing else.
   */
  userIdPrefix: "dev_user_",
  emailDomain: "dev.commish.local",
  /**
   * Set DEV_SEED_CLAIM_USER_ID to your real (WorkOS) user id after signing in once, and the
   * seed hands you team 1 and the commissioner's chair in both leagues — so you can actually
   * start and act in a seeded draft.
   */
  claimUserIdEnvVar: "DEV_SEED_CLAIM_USER_ID",
  snake: { leagueId: "dev_league_snake", draftId: "dev_draft_snake", inviteCode: "DEVSNAKE", name: "Dev Snake League" },
  auction: { leagueId: "dev_league_auction", draftId: "dev_draft_auction", inviteCode: "DEVAUCTION", name: "Dev Auction League", budget: 200 },
} as const;
```

```ts
// src/data/seed/seed-dev-leagues.ts
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, scoringSettings, teams, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import { DEV_SEED } from "./config";

const MS_PER_HOUR = 60 * 60 * 1000;

interface LeaguePlan {
  readonly leagueId: string;
  readonly draftId: string;
  readonly inviteCode: string;
  readonly name: string;
  readonly format: "snake" | "auction";
  readonly auctionBudget: number | null;
}

/**
 * A dev league you can point a browser at. Placeholder owners only — real identity is
 * WorkOS's, so these rows are clearly namespaced and this function refuses to run in
 * production. Idempotent: re-running updates rather than duplicating.
 */
export async function seedDevLeagues(db: Db, clock: Clock): Promise<{ leagues: number; teams: number; drafts: number }> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedDevLeagues creates placeholder users and must never run in production.");
  }

  const claimUserId = process.env[DEV_SEED.claimUserIdEnvVar];
  const kickoffAt = new Date(Date.parse(clock.now()) + DEV_SEED.kickoffHoursFromNow * MS_PER_HOUR);

  const devUserIds = Array.from({ length: DEV_SEED.teamCount }, (_, i) => `${DEV_SEED.userIdPrefix}${String(i + 1).padStart(2, "0")}`);
  await db
    .insert(users)
    .values(devUserIds.map((id) => ({ id, email: `${id}@${DEV_SEED.emailDomain}`, displayName: `Dev Manager ${id.slice(-2)}` })))
    .onConflictDoNothing({ target: users.id });

  const ownerIds = devUserIds.map((id, index) => (index === 0 && claimUserId !== undefined ? claimUserId : id));

  const plans: readonly LeaguePlan[] = [
    { ...DEV_SEED.snake, format: "snake", auctionBudget: null },
    { ...DEV_SEED.auction, format: "auction", auctionBudget: DEV_SEED.auction.budget },
  ];

  for (const plan of plans) {
    await db
      .insert(leagues)
      .values({
        id: plan.leagueId,
        name: plan.name,
        format: plan.format,
        teamCount: DEV_SEED.teamCount,
        inviteCode: plan.inviteCode,
        commissionerUserId: ownerIds[0]!,
        rosterSlots: [...STANDARD_ROSTER_SLOTS],
      })
      .onConflictDoUpdate({ target: leagues.id, set: { commissionerUserId: sql`excluded.commissioner_user_id` } });

    await db
      .insert(scoringSettings)
      .values({ leagueId: plan.leagueId, ...PPR_SCORING })
      .onConflictDoNothing({ target: scoringSettings.leagueId });

    await db
      .insert(teams)
      .values(
        ownerIds.map((userId, i) => ({
          id: `${plan.leagueId}_team_${String(i + 1).padStart(2, "0")}`,
          leagueId: plan.leagueId,
          userId,
          name: `Team ${i + 1}`,
        })),
      )
      .onConflictDoUpdate({ target: teams.id, set: { userId: sql`excluded.user_id` } });

    await db
      .insert(drafts)
      .values({
        id: plan.draftId,
        leagueId: plan.leagueId,
        format: plan.format,
        status: "scheduled",
        kickoffAt,
        auctionBudget: plan.auctionBudget,
      })
      .onConflictDoUpdate({ target: drafts.id, set: { kickoffAt } });
  }

  return { leagues: plans.length, teams: plans.length * DEV_SEED.teamCount, drafts: plans.length };
}
```

Wire it into the ONE seed entry point — replace the body of `main()` in `src/data/seed/index.ts`:

```ts
async function main(): Promise<void> {
  const db = getDb();
  const playerCounts = await seedPlayers(db, createMockStatsProvider());
  console.log(`seeded ${playerCounts.players} players and ${playerCounts.statLines} stat lines`);
  const dev = await seedDevLeagues(db, { now: () => new Date().toISOString() });
  console.log(`seeded ${dev.leagues} dev leagues, ${dev.teams} teams and ${dev.drafts} scheduled drafts`);
}
```

- [ ] **Step 9: Run to verify pass and seed a real database**

Run: `npm test -- src/data/seed && npm run seed`
Expected: tests PASS (2 dev-league tests plus the existing player-seed tests); `npm run seed` prints both lines and exits 0.

- [ ] **Step 10: Full verification and commit**

Run: `npm run typecheck && npm run lint && npm test -- src/draft-service src/data/seed`
Expected: clean.

```bash
git add src/draft-service src/data/seed
git commit -m "feat(draft-service): startDraft with a deterministic order and ranked pool; commitDraftResults for snake and auction

Commit is the single seam between a draft and a season, and it runs inside the same transaction
that completed the draft, so a half-committed draft cannot exist. The pool is ranked by projected
points through the existing scoring engine rather than a new rating, and the order is a seeded
shuffle so a real draft can be reproduced exactly when someone reports a bug."
```

---

### Task 8: API routes, authorization seam, and the server-side clock ticker

**Model tier:** standard.

**Files:**
- Create: `src/draft-service/authz.ts`, `src/draft-service/ticker.ts`, `src/draft-service/index.ts`, `src/app/api/drafts/[draftId]/route.ts`, `src/app/api/drafts/[draftId]/actions/route.ts`, `src/app/api/drafts/[draftId]/start/route.ts`, `src/instrumentation.ts`
- Modify: `src/draft-engine/action-schema.ts` (add `toDraftAction`), `src/draft-engine/index.ts` (export it)
- Test: `src/draft-service/ticker.test.ts`, `src/draft-service/api-routes.test.ts`

**Interfaces:**
- Consumes: `getDraftStore`, `createDraftStore`, `draftStateView`, `clientDraftActionSchema`, `getCurrentUser`, `ok`/`fail`/`parseJson`, `getPublisher`, `getDb`.
- Produces:
  - `resolveDraftActor(db: Db, draftId: string, userId: string): Promise<ActorResult>` with `DraftActor = { readonly draftId: string; readonly leagueId: string; readonly teamId: string | null; readonly isCommissioner: boolean }` and `ActorResult = { readonly ok: true; readonly actor: DraftActor } | { readonly ok: false; readonly status: number; readonly error: string }`.
  - `toDraftAction(input: ClientDraftAction, teamId: string, timestamp: string): DraftAction`.
  - `createDraftTicker(deps: { db: Db; store: DraftStore; clock: Clock; intervalMs?: number }): DraftTicker` with `tick(): Promise<readonly TickOutcome[]>`, `start(): void`, `stop(): void`, and `TickOutcome = { readonly draftId: string; readonly applied: boolean; readonly reason?: string }`.
  - `getDraftStore(): DraftStore`, `getDraftTicker(): DraftTicker` (process singletons).
  - Routes: `GET /api/drafts/[draftId]`, `POST /api/drafts/[draftId]/actions`, `POST /api/drafts/[draftId]/start`.

**Security rules this task enforces (and tests):**
- `teamId` comes from `resolveDraftActor(db, draftId, user.id)` — **never** from the request body. `clientDraftActionSchema` has no `teamId` field, so a client that sends one has it dropped by Zod before the handler ever sees it.
- Only the commissioner may start a draft.
- `TIMER_EXPIRE` has no HTTP path at all. The ticker is the only producer, so a client cannot expire someone else's clock early.
- API routes return JSON 401/403/404/409 — never a redirect (page redirects are `src/middleware.ts`'s job, for `/app` only).
- Real-time fan-out reuses the existing `GET /api/leagues/[leagueId]/events` SSE route. **No new stream, no new transport.**

- [ ] **Step 1: Write the failing ticker test**

```ts
// src/draft-service/ticker.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { players } from "@/db/schema";
import { createDraftStore } from "./store";
import { createDraftTicker } from "./ticker";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
let now = "2026-09-01T00:00:00.000Z";
const clock = { now: () => now };

beforeEach(async () => {
  await truncateAll(db);
  now = "2026-09-01T00:00:00.000Z";
});

afterAll(async () => {
  await truncateAll(db);
});

async function liveDraft() {
  const fixture = await seedDraftFixture(db, {
    draftId: "draft_tick", leagueId: "league_tick", format: "snake", teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
  });
  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "rb1", name: "RB One", position: "RB", nflTeam: "SF" },
    { id: "wr1", name: "WR One", position: "WR", nflTeam: "NYJ" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
    { id: "rb2", name: "RB Two", position: "RB", nflTeam: "SF" },
    { id: "wr2", name: "WR Two", position: "WR", nflTeam: "NYJ" },
  ]);
  const store = createDraftStore({ db, publish: async () => "1-0", clock });
  await store.startDraft(fixture.draftId);
  return { fixture, store, ticker: createDraftTicker({ db, store, clock }) };
}

describe("draft ticker", () => {
  it("does nothing while the clock is still running", async () => {
    const { ticker, store, fixture } = await liveDraft();
    // Started 9+ days from kickoff: the 8-hour tier is in force, so 07:00 is still early.
    now = "2026-09-01T07:00:00.000Z";
    expect(await ticker.tick()).toEqual([]);
    expect((await store.getDraftState(fixture.draftId))?.picks).toHaveLength(0);
  });

  it("submits TIMER_EXPIRE once the deadline has passed, producing an autopick", async () => {
    const { ticker, store, fixture } = await liveDraft();
    now = "2026-09-01T09:00:00.000Z";
    expect(await ticker.tick()).toEqual([{ draftId: fixture.draftId, applied: true }]);
    const state = await store.getDraftState(fixture.draftId);
    expect(state?.picks).toHaveLength(1);
    expect(state?.picks[0]?.auto).toBe(true);
  });

  it("ignores drafts that aren't in progress", async () => {
    const { ticker } = await liveDraft();
    await truncateAll(db);
    expect(await ticker.tick()).toEqual([]);
  });

  it("starts and stops without leaving an interval behind", async () => {
    const { ticker } = await liveDraft();
    ticker.start();
    ticker.start(); // idempotent
    ticker.stop();
    ticker.stop();
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement the authz seam, ticker and singletons**

Run: `npm test -- src/draft-service/ticker`
Expected: FAIL — cannot find module `./ticker`.

```ts
// src/draft-service/authz.ts
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";

export interface DraftActor {
  readonly draftId: string;
  readonly leagueId: string;
  /** The caller's team in this draft's league, or null if they don't have one. */
  readonly teamId: string | null;
  readonly isCommissioner: boolean;
}

export type ActorResult =
  | { readonly ok: true; readonly actor: DraftActor }
  | { readonly ok: false; readonly status: number; readonly error: string };

/**
 * The one place a route learns who the caller is *in this draft*. Routes never read a team id
 * from a request body — this resolves it from the authenticated user id, so a client cannot
 * act as another manager by asking nicely.
 */
export async function resolveDraftActor(db: Db, draftId: string, userId: string): Promise<ActorResult> {
  const [draft] = await db
    .select({ leagueId: drafts.leagueId, commissionerUserId: leagues.commissionerUserId })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(eq(drafts.id, draftId));
  if (draft === undefined) return { ok: false, status: 404, error: "That draft doesn't exist." };

  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.leagueId, draft.leagueId), eq(teams.userId, userId)));

  return {
    ok: true,
    actor: {
      draftId,
      leagueId: draft.leagueId,
      teamId: team?.id ?? null,
      isCommissioner: draft.commissionerUserId === userId,
    },
  };
}
```

```ts
// src/draft-service/ticker.ts
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import { currentDeadline } from "@/draft-engine";
import { DRAFT_SERVICE_CONFIG } from "./config";
import type { DraftStore } from "./store";

export interface TickOutcome {
  readonly draftId: string;
  readonly applied: boolean;
  readonly reason?: string;
}

export interface DraftTicker {
  /** Expire every clock that has run out, once. Tests drive this directly. */
  tick(): Promise<readonly TickOutcome[]>;
  start(): void;
  stop(): void;
}

interface TickerDeps {
  readonly db: Db;
  readonly store: DraftStore;
  readonly clock: Clock;
  readonly intervalMs?: number;
}

/**
 * The only producer of TIMER_EXPIRE actions. Built around an injected `Clock` and an explicit
 * `tick()` so tests drive expiry deterministically instead of sleeping; `start()` is just a
 * setInterval around the same function for the running server.
 */
export function createDraftTicker({ db, store, clock, intervalMs = DRAFT_SERVICE_CONFIG.tickIntervalMs }: TickerDeps): DraftTicker {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  async function tick(): Promise<readonly TickOutcome[]> {
    const rows = await db
      .select({ id: drafts.id })
      .from(drafts)
      .where(eq(drafts.status, "in_progress"))
      .limit(DRAFT_SERVICE_CONFIG.maxDraftsPerTick);

    const now = clock.now();
    const outcomes: TickOutcome[] = [];
    for (const row of rows) {
      const state = await store.getDraftState(row.id);
      if (state === null) continue;
      const deadline = currentDeadline(state);
      if (deadline === null || Date.parse(now) < Date.parse(deadline)) continue;
      const result = await store.applyAction(row.id, { v: DRAFT_ACTION_VERSION, type: "TIMER_EXPIRE", timestamp: now });
      outcomes.push(result.ok ? { draftId: row.id, applied: true } : { draftId: row.id, applied: false, reason: result.reason });
    }
    return outcomes;
  }

  return {
    tick,
    start() {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        // Never overlap ticks: a slow tick must not stack another on top of it.
        if (running) return;
        running = true;
        void tick()
          .catch((error: unknown) => {
            console.error("[draft] ticker failed", error);
          })
          .finally(() => {
            running = false;
          });
      }, intervalMs);
    },
    stop() {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
```

```ts
// src/draft-service/index.ts
import { getDb } from "@/db/client";
import { getPublisher } from "@/lib/realtime/publisher";
import { createDraftStore, type DraftStore } from "./store";
import { createDraftTicker, type DraftTicker } from "./ticker";

/** The outermost edge is the only place a wall clock is allowed. */
const systemClock = { now: () => new Date().toISOString() };

let store: DraftStore | undefined;
let ticker: DraftTicker | undefined;

export function getDraftStore(): DraftStore {
  if (store === undefined) {
    store = createDraftStore({
      db: getDb(),
      publish: (input) => getPublisher().publish(input),
      clock: systemClock,
    });
  }
  return store;
}

export function getDraftTicker(): DraftTicker {
  if (ticker === undefined) {
    ticker = createDraftTicker({ db: getDb(), store: getDraftStore(), clock: systemClock });
  }
  return ticker;
}

export { resolveDraftActor, type DraftActor, type ActorResult } from "./authz";
export type { ApplyResult, CommitResult, DraftStore } from "./store";
```

```ts
// src/instrumentation.ts

/** Next.js calls this once per server process. The draft clock has to keep running whether
 * or not anyone has a browser tab open, so it starts here rather than on first request. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDraftTicker } = await import("@/draft-service");
  getDraftTicker().start();
}
```

Run: `npm test -- src/draft-service/ticker`
Expected: PASS (4 tests).

- [ ] **Step 3: Write the failing route tests**

```ts
// src/draft-service/api-routes.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// The route handlers use the process-wide getDb()/getPublisher(); point them at the test
// infrastructure before any module is imported. vi.hoisted runs before the import graph.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftActions, players } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { GET as getDraft } from "@/app/api/drafts/[draftId]/route";
import { POST as postAction } from "@/app/api/drafts/[draftId]/actions/route";
import { POST as postStart } from "@/app/api/drafts/[draftId]/start/route";
import { getDraftStore } from "@/draft-service";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
const DRAFT_ID = "draft_api";
const params = Promise.resolve({ draftId: DRAFT_ID });
const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null ? null : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z" },
  );

async function fixture() {
  const f = await seedDraftFixture(db, {
    draftId: DRAFT_ID, leagueId: "league_api", format: "snake", teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
  });
  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "rb1", name: "RB One", position: "RB", nflTeam: "SF" },
    { id: "wr1", name: "WR One", position: "WR", nflTeam: "NYJ" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
    { id: "rb2", name: "RB Two", position: "RB", nflTeam: "SF" },
    { id: "wr2", name: "WR Two", position: "WR", nflTeam: "NYJ" },
  ]);
  return f;
}

function postJson(body: unknown): Request {
  return new Request(`http://test/api/drafts/${DRAFT_ID}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await truncateAll(db);
  getDraftStore().invalidate(DRAFT_ID);
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/drafts/[draftId]", () => {
  it("answers 401 JSON — never a redirect — when nobody is signed in", async () => {
    await fixture();
    signedInAs(null);
    const response = await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params });
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("answers 404 for a draft that doesn't exist", async () => {
    signedInAs("someone");
    const response = await getDraft(new Request("http://test/api/drafts/nope"), { params: Promise.resolve({ draftId: "nope" }) });
    expect(response.status).toBe(404);
  });

  it("returns the materialized state and the caller's own team", async () => {
    const f = await fixture();
    signedInAs(f.userIds[1]!);
    await getDraftStore().startDraft(DRAFT_ID);
    const response = await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.teamId).toBe(f.teamIds[1]);
    expect(body.data.draft.phase).toBe("in_progress");
    expect(body.data.draft.onClockTeamId).not.toBeNull();
    expect(body.data.draft.deadlineAt).not.toBeNull();
  });
});

describe("POST /api/drafts/[draftId]/actions", () => {
  it("rejects a malformed body with 400", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    await getDraftStore().startDraft(DRAFT_ID);
    const response = await postAction(postJson({ type: "MAKE_PICK" }), { params });
    expect(response.status).toBe(400);
  });

  it("refuses TIMER_EXPIRE from a client — only the server ticker expires a clock", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    await getDraftStore().startDraft(DRAFT_ID);
    const response = await postAction(postJson({ type: "TIMER_EXPIRE" }), { params });
    expect(response.status).toBe(400);
    expect(await db.select().from(draftActions).where(eq(draftActions.draftId, DRAFT_ID))).toHaveLength(1);
  });

  it("records a pick for the caller's own team, ignoring any teamId in the body", async () => {
    const f = await fixture();
    const state = await getDraftStore().startDraft(DRAFT_ID);
    if (!state.ok) throw new Error(state.reason);
    const onClockTeamId = state.state.draftOrder[0]!;
    const onClockUserId = f.userIds[f.teamIds.indexOf(onClockTeamId)]!;
    signedInAs(onClockUserId);

    const response = await postAction(postJson({ type: "MAKE_PICK", playerId: "qb1", teamId: "some_other_team" }), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.draft.picks[0]).toMatchObject({ teamId: onClockTeamId, playerId: "qb1" });
  });

  it("answers 409 with the reducer's plain-language reason when the action isn't legal", async () => {
    const f = await fixture();
    const state = await getDraftStore().startDraft(DRAFT_ID);
    if (!state.ok) throw new Error(state.reason);
    const offClockTeamId = state.state.draftOrder[1]!;
    signedInAs(f.userIds[f.teamIds.indexOf(offClockTeamId)]!);
    const response = await postAction(postJson({ type: "MAKE_PICK", playerId: "qb1" }), { params });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "It's not your turn to pick." });
  });

  it("answers 403 for a signed-in user with no team in this league", async () => {
    await fixture();
    signedInAs("stranger");
    await getDraftStore().startDraft(DRAFT_ID);
    const response = await postAction(postJson({ type: "MAKE_PICK", playerId: "qb1" }), { params });
    expect(response.status).toBe(403);
  });
});

describe("POST /api/drafts/[draftId]/start", () => {
  it("lets only the commissioner start the draft", async () => {
    const f = await fixture();
    signedInAs(f.userIds[1]!);
    const denied = await postStart(new Request(`http://test/api/drafts/${DRAFT_ID}/start`, { method: "POST" }), { params });
    expect(denied.status).toBe(403);

    signedInAs(f.userIds[0]!); // seedDraftFixture makes the first user the commissioner
    const allowed = await postStart(new Request(`http://test/api/drafts/${DRAFT_ID}/start`, { method: "POST" }), { params });
    expect(allowed.status).toBe(200);
    const body = await allowed.json();
    expect(body.data.draft.phase).toBe("in_progress");
  });

  it("answers 409 when the draft has already started", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    await postStart(new Request(`http://test/api/drafts/${DRAFT_ID}/start`, { method: "POST" }), { params });
    const again = await postStart(new Request(`http://test/api/drafts/${DRAFT_ID}/start`, { method: "POST" }), { params });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ ok: false, error: "This draft has already started." });
  });
});
```

Note the deliberate deviation from "tests live beside the code": these live in `src/draft-service/` rather than under `src/app/api/**` so `npm test -- src/draft-service` covers the whole feature in one command and nothing test-shaped sits inside the App Router tree. Record it in the task report.

- [ ] **Step 4: Run to verify failure, then implement `toDraftAction` and the three routes**

Run: `npm test -- src/draft-service/api-routes`
Expected: FAIL — cannot find module `@/app/api/drafts/[draftId]/route`.

Append to `src/draft-engine/action-schema.ts` (and export it from `src/draft-engine/index.ts`):

```ts
import { DRAFT_ACTION_VERSION, type DraftAction } from "@/domain/draft";

/**
 * Turns a validated client submission into a persisted action by stamping the two fields a
 * client is never allowed to choose: which team is acting, and when.
 */
export function toDraftAction(input: ClientDraftAction, teamId: string, timestamp: string): DraftAction {
  switch (input.type) {
    case "MAKE_PICK":
      return { v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp, teamId, playerId: input.playerId };
    case "NOMINATE":
      return { v: DRAFT_ACTION_VERSION, type: "NOMINATE", timestamp, teamId, playerId: input.playerId, openingBid: input.openingBid };
    case "BID":
      return { v: DRAFT_ACTION_VERSION, type: "BID", timestamp, teamId, amount: input.amount };
  }
}
```

```ts
// src/app/api/drafts/[draftId]/route.ts
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fail, ok } from "@/lib/api/respond";
import { draftStateView } from "@/draft-engine";
import { getDraftStore, resolveDraftActor } from "@/draft-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly draftId: string }>;
}

/** The current materialized draft state plus the derived clock the UI renders. */
export async function GET(_request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (user === null) return fail("Not signed in.", 401);
  const { draftId } = await params;

  const actor = await resolveDraftActor(getDb(), draftId, user.id);
  if (!actor.ok) return fail(actor.error, actor.status);

  const state = await getDraftStore().getDraftState(draftId);
  if (state === null) return fail("That draft doesn't exist.", 404);

  return ok({ draft: draftStateView(state), teamId: actor.actor.teamId, isCommissioner: actor.actor.isCommissioner });
}
```

```ts
// src/app/api/drafts/[draftId]/actions/route.ts
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { clientDraftActionSchema, draftStateView, toDraftAction } from "@/draft-engine";
import { getDraftStore, resolveDraftActor } from "@/draft-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly draftId: string }>;
}

/**
 * Submit a pick, nomination or bid. The acting team is resolved from the session — the body
 * schema has no teamId, and TIMER_EXPIRE isn't in it either: only the server ticker may
 * expire a clock.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (user === null) return fail("Not signed in.", 401);
  const { draftId } = await params;

  const parsed = await parseJson(request, clientDraftActionSchema);
  if (!parsed.ok) return parsed.response;

  const actor = await resolveDraftActor(getDb(), draftId, user.id);
  if (!actor.ok) return fail(actor.error, actor.status);
  if (actor.actor.teamId === null) return fail("You don't have a team in this league.", 403);

  const action = toDraftAction(parsed.value, actor.actor.teamId, new Date().toISOString());
  const result = await getDraftStore().applyAction(draftId, action);
  if (!result.ok) return fail(result.reason, 409);

  return ok({ draft: draftStateView(result.state) });
}
```

```ts
// src/app/api/drafts/[draftId]/start/route.ts
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fail, ok } from "@/lib/api/respond";
import { draftStateView } from "@/draft-engine";
import { getDraftStore, resolveDraftActor } from "@/draft-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly draftId: string }>;
}

/** Commissioner-only: opens the draft, fixing its order and its ranked player pool. */
export async function POST(_request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (user === null) return fail("Not signed in.", 401);
  const { draftId } = await params;

  const actor = await resolveDraftActor(getDb(), draftId, user.id);
  if (!actor.ok) return fail(actor.error, actor.status);
  if (!actor.actor.isCommissioner) return fail("Only the commissioner can start this draft.", 403);

  const result = await getDraftStore().startDraft(draftId);
  if (!result.ok) return fail(result.reason, 409);

  return ok({ draft: draftStateView(result.state) });
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- src/draft-service && npm run typecheck && npm run lint`
Expected: PASS (10 route tests plus every earlier draft-service test); typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/draft-service src/app/api/drafts src/instrumentation.ts src/draft-engine
git commit -m "feat(api): draft state/action/start routes and the server-side clock ticker

The acting team is always resolved from the session, never read from the body — the request
schema has no teamId field at all — and TIMER_EXPIRE has no HTTP path, so only the ticker can
expire a clock. Fan-out reuses the existing league SSE stream rather than adding a transport."
```

---

### Task 9: Two-SSE-client integration tests (snake and auction) + documentation

**Model tier:** standard.

**Files:**
- Create: `src/draft-service/draft-realtime.test.ts`, `docs/draft-engine.md`
- Modify: `docs/conventions.md`

**Interfaces:**
- Consumes: `createPublisher` and `subscribe` from `src/lib/realtime/*` (the same harness `src/lib/realtime/realtime.test.ts` already uses), `createDraftStore`, `seedDraftFixture`, `SPRINT_ROSTER_SLOTS`, engine selectors.
- Produces: no new source modules — this task proves the whole stack end-to-end and writes the docs.

**Exactly what the drafts in this test use:**
- **Snake:** 12 teams, roster config `SPRINT_ROSTER_SLOTS` (QB×1, RB×1, WR×1) → 3 rounds, **36 picks**, driven by explicit `MAKE_PICK` actions choosing each team's best available player.
- **Auction:** 4 teams, roster config `{ QB×1, RB×1 }` → **8 lots**, each nominated, contested by one rival bid, then awarded on `TIMER_EXPIRE`.

- [ ] **Step 1: Write the failing two-client integration test**

```ts
// src/draft-service/draft-realtime.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { createTestDb, truncateAll } from "@/db/test-db";
import { players } from "@/db/schema";
import type { RosterSlotConfig } from "@/domain/roster";
import { bestAvailableFor, teamOnClock, type DraftState } from "@/draft-engine";
import { createPublisher } from "@/lib/realtime/publish";
import { subscribe } from "@/lib/realtime/subscribe";
import { REALTIME_CONFIG } from "@/lib/realtime/config";
import type { RealtimeEvent } from "@/lib/realtime/events";
import { createDraftStore } from "./store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const db = createTestDb();
const control = new Redis(REDIS_URL);
const clock = { now: () => "2026-09-01T00:00:00.000Z" };
const publisher = createPublisher({ redis: new Redis(REDIS_URL), clock });
const store = () => createDraftStore({ db, publish: (input) => publisher.publish(input), clock });

const AUCTION_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];

/** Enough players that a 12-team, 3-round draft and a 4-team auction both fill. */
async function insertPlayers(count: number): Promise<void> {
  const positions = ["QB", "RB", "WR"] as const;
  await db.insert(players).values(
    Array.from({ length: count }, (_, i) => ({
      id: `p${String(i + 1).padStart(3, "0")}`,
      name: `Player ${i + 1}`,
      position: positions[i % positions.length]!,
      nflTeam: "KC",
    })),
  );
}

/** One SSE-equivalent client: reads the league stream until the draft is announced complete. */
async function watchUntilComplete(leagueId: string, signal: AbortSignal): Promise<readonly RealtimeEvent[]> {
  const seen: RealtimeEvent[] = [];
  const redis = new Redis(REDIS_URL);
  try {
    for await (const event of subscribe({ redis, leagueId, afterId: "$", signal })) {
      seen.push(event);
      if (event.type === "draft.status" && (event.payload as { phase?: string }).phase === "complete") break;
    }
  } finally {
    redis.disconnect();
  }
  return seen;
}

function picksFromEvents(events: readonly RealtimeEvent[]) {
  return events
    .filter((e) => e.type === "draft.pick")
    .map((e) => e.payload as { pickNumber: number; teamId: string; playerId: string; price: number | null });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
  control.disconnect();
  publisher.close();
});

describe("two SSE clients watching a live snake draft", () => {
  it("both see every pick, in the same order, and can reconstruct the server's final state", async () => {
    const fixture = await seedDraftFixture(db, {
      draftId: "draft_sse_snake", leagueId: "league_sse_snake", format: "snake", teamCount: 12,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await insertPlayers(60);
    await control.del(REALTIME_CONFIG.leagueStreamKey(fixture.leagueId));

    const draft = store();
    const ac = new AbortController();
    const clients = [
      watchUntilComplete(fixture.leagueId, ac.signal),
      watchUntilComplete(fixture.leagueId, ac.signal),
    ];
    await new Promise((resolve) => setTimeout(resolve, 150)); // let both XREADs register

    const started = await draft.startDraft(fixture.draftId);
    if (!started.ok) throw new Error(started.reason);

    let state: DraftState = started.state;
    while (state.phase !== "complete") {
      const teamId = teamOnClock(state);
      if (teamId === null) throw new Error("nobody on the clock mid-draft");
      const best = bestAvailableFor(state, teamId);
      if (best === null) throw new Error("no draftable player left");
      const result = await draft.applyAction(fixture.draftId, {
        v: 1, type: "MAKE_PICK", timestamp: clock.now(), teamId, playerId: best.playerId,
      });
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }

    const [first, second] = await Promise.all(clients);
    ac.abort();

    // 12 teams x 3 roster spots.
    expect(state.picks).toHaveLength(36);
    // Broadcast, not partitioned: both clients saw the identical stream (this is what
    // XREADGROUP would have broken).
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
    expect(picksFromEvents(first)).toHaveLength(36);
    // Each client can rebuild the server's pick list from what it received.
    for (const client of [first, second]) {
      expect(picksFromEvents(client).map((p) => [p.pickNumber, p.teamId, p.playerId])).toEqual(
        state.picks.map((p) => [p.pickNumber, p.teamId, p.playerId]),
      );
    }
    expect(first[0]?.type).toBe("draft.status");
    expect(first.at(-1)?.type).toBe("draft.status");
  }, 60_000);
});

describe("two SSE clients watching a live auction draft", () => {
  it("both see every nomination, bid and award with the winning price", async () => {
    const fixture = await seedDraftFixture(db, {
      draftId: "draft_sse_auction", leagueId: "league_sse_auction", format: "auction", teamCount: 4,
      slotConfig: AUCTION_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: 50,
    });
    await insertPlayers(30);
    await control.del(REALTIME_CONFIG.leagueStreamKey(fixture.leagueId));

    const draft = store();
    const ac = new AbortController();
    const clients = [
      watchUntilComplete(fixture.leagueId, ac.signal),
      watchUntilComplete(fixture.leagueId, ac.signal),
    ];
    await new Promise((resolve) => setTimeout(resolve, 150));

    const started = await draft.startDraft(fixture.draftId);
    if (!started.ok) throw new Error(started.reason);

    let state: DraftState = started.state;
    const act = async (action: Parameters<typeof draft.applyAction>[1]) => {
      const result = await draft.applyAction(fixture.draftId, action);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    };

    while (state.phase !== "complete") {
      const nominator = state.auction?.nominatingTeamId;
      if (nominator === undefined || nominator === null) throw new Error("nobody up to nominate");
      const best = bestAvailableFor(state, nominator);
      if (best === null) throw new Error("no draftable player left");
      await act({ v: 1, type: "NOMINATE", timestamp: clock.now(), teamId: nominator, playerId: best.playerId, openingBid: 1 });

      // Let one rival contest the lot. Whether a given team can legally roster this player
      // depends on its roster, so try each in turn and keep the first bid that lands.
      for (const teamId of state.draftOrder) {
        if (teamId === nominator) continue;
        const attempt = await draft.applyAction(fixture.draftId, { v: 1, type: "BID", timestamp: clock.now(), teamId, amount: 2 });
        if (attempt.ok) {
          state = attempt.state;
          break;
        }
      }
      await act({ v: 1, type: "TIMER_EXPIRE", timestamp: clock.now() });
    }

    const [first, second] = await Promise.all(clients);
    ac.abort();

    // 4 teams x 2 roster spots.
    expect(state.picks).toHaveLength(8);
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
    for (const client of [first, second]) {
      expect(client.filter((e) => e.type === "draft.nominate")).toHaveLength(8);
      expect(client.filter((e) => e.type === "draft.bid").length).toBeGreaterThan(0);
      expect(picksFromEvents(client).map((p) => [p.playerId, p.price])).toEqual(
        state.picks.map((p) => [p.playerId, p.price]),
      );
    }
  }, 60_000);
});
```

- [ ] **Step 2: Run to verify it exercises the real stack**

Run: `npm run infra:up && npm test -- src/draft-service/draft-realtime`
Expected: PASS (2 tests). These run against the real Redis and the real test Postgres — no mocks. If a client hangs, the 150 ms warm-up before `startDraft` is what guarantees both `XREAD`s are registered before the first event is published; do not remove it.

- [ ] **Step 3: Write `docs/draft-engine.md`**

```markdown
# Commish — Draft Engine & Draft Service

Read this with `docs/conventions.md` before touching anything under `src/draft-engine/` or
`src/draft-service/`. The engine is pure; the service is the only part that talks to Postgres
or Redis. One system runs both snake and auction drafts natively — that is the wedge (strategy
doc §1.1: our closest competitor hands its auctions to ESPN).

## The two layers

| Layer | Path | Rule |
|---|---|---|
| Engine | `src/draft-engine/` | Pure. No I/O, no `Date.now()`, `readonly` everywhere, 100% test coverage enforced. |
| Service | `src/draft-service/` | Owns persistence, publishing, locking, the ticker, and authorization lookups. |

## The action union (persisted forever)

`draft_actions.action` stores a `DraftAction` (see `src/domain/draft.ts`) as jsonb. Every
member carries `v: 1`. A future shape change adds `v: 2` members plus an explicit upgrade path
in `draftActionSchema` — it never reinterprets an old row.

- `START_DRAFT` — carries `draftOrder` **and** the ranked `pool`. Snapshotting both is what
  makes replay deterministic: nothing about a past draft depends on today's rankings.
- `MAKE_PICK` — `{ teamId, playerId }` (snake).
- `NOMINATE` — `{ teamId, playerId, openingBid }` (auction; a nomination is a bid).
- `BID` — `{ teamId, amount }` (auction).
- `TIMER_EXPIRE` — no payload. **Server-only**: produced by the ticker, never accepted over HTTP.

## State shape

`DraftState` = static `config` (from the `drafts` + `leagues` rows) + `phase` + `sequence` +
`draftOrder` + `pool` + `picks` + `rosters` (filled slots only) + `budgets` + `auction` +
`pickNumber` + `turnStartedAt`. Deadlines are **derived** from `turnStartedAt`, never stored,
so no replay can resurrect a stale deadline.

## Invariants

1. The reducer is total and pure: `reduceDraft(state, action)` returns `{ ok: true, state }`
   with `sequence + 1`, or `{ ok: false, reason }` with a plain-language reason that is safe to
   show a user (the API returns it verbatim as a 409).
2. Roster legality is never restated: `assignSlot` delegates to
   `src/domain/roster-eligibility.ts`'s `validateRosterAdd`.
3. A player can be drafted once. Turn order is enforced for snake picks and auction nominations.
4. Auction: a team keeps $1 in reserve for every roster spot it still has to fill, so a team
   with an open spot can always afford the minimum bid — that is why auto-nomination can't
   deadlock. A draft can't start unless the budget covers at least $1 per roster spot.
5. Autopick and auto-nomination take the highest-ranked player the team can legally roster,
   ranked by `state.pool`'s order — an input, never an ambient lookup.
6. The pick clock auto-tightens against kickoff: `DRAFT_CLOCK_SCHEDULE` = 8h → 4h → 1h → 10m →
   60s. A tier applies while the draft is more than `untilHoursBeforeKickoff` hours out; the
   last tier is the floor. Live auction bidding uses the shorter of the tier and
   `AUCTION_CONFIG.bidWindowSeconds`.

## The replay model

The `draft_actions` log is the source of truth. `replayDraft(config, actions)` rebuilds state
from it, and the store's in-memory map is only a materialization — dropping it costs nothing.
`applyAction` therefore always: **load → validate → persist → cache → publish (best-effort)**.
Two guards stop a double append: an in-process per-draft queue (Phase 1 is single-instance;
Phase 2 replaces it with a Postgres advisory lock) and a unique index on
`(draft_id, sequence)`, so a bug in the lock costs a retry, never a duplicated pick.

`commitDraftResults` is the single seam between "a draft happened" and "a season exists": in
one transaction it writes `draft_picks`, fills `roster_slots`, and flips `drafts.status` to
`complete`. It runs automatically inside the `applyAction` that completes a draft, and is
idempotent when called again.

## Event payloads (`draft.*`, on the league stream)

All carry `draftId` and `sequence`.

| Event | Extra payload |
|---|---|
| `draft.status` | `phase` (`in_progress` \| `complete`) |
| `draft.pick` | `pickNumber`, `round`, `teamId`, `playerId`, `slot`, `price`, `timestamp`, `auto` |
| `draft.nominate` | `teamId`, `playerId`, `openingBid`, `auto` |
| `draft.bid` | `teamId`, `playerId`, `amount` |
| `draft.timer_expire` | `pickNumber` (the pick the clock ran out on) |

Ordering is meaningful: a `draft.timer_expire` always precedes the `draft.pick` or
`draft.nominate` it caused, so a client can render events in arrival order.

## API

| Route | Who | Notes |
|---|---|---|
| `GET /api/drafts/[draftId]` | any signed-in user | `draftStateView` + the caller's own `teamId`. |
| `POST /api/drafts/[draftId]/actions` | a manager with a team in the league | Body: `{ type: "MAKE_PICK" \| "NOMINATE" \| "BID", … }`. **No `teamId`** — the server resolves it from the session. A rejected action is a 409 with the reducer's reason. |
| `POST /api/drafts/[draftId]/start` | commissioner only | Fixes the order and the ranked pool. |

Real-time fan-out is the existing `GET /api/leagues/[leagueId]/events` SSE stream. There is no
second transport and no per-draft stream.
```

- [ ] **Step 4: Update `docs/conventions.md`**

In the **Directory map** block, add these two lines after the `domain/` line:

```
  draft-engine/           Pure draft reducer (snake + auction), clock schedule, selectors. 100% coverage.
  draft-service/          Durable replay-based draft store, commit seam, clock ticker, draft authz.
```

Under **Real-time — one mechanism**, after the "Event types" bullet, add:

```
- **Draft events** (`draft.pick`, `draft.nominate`, `draft.bid`, `draft.timer_expire`, `draft.status`) ride the **league** stream — there is no per-draft stream. Their payload contracts live in `docs/draft-engine.md`.
```

Under **Tests**, change the coverage line to:

```
- Coverage thresholds: 100% for `src/scoring/**` and `src/draft-engine/**` (configured in `vitest.config.mts`).
```

Add a new rule section after **Real-time — one mechanism**:

```markdown
### Draft state — the action log is the source of truth
An in-progress draft's state is *derived*, by replaying `draft_actions` through the pure
reducer in `src/draft-engine/`. Any in-memory materialization is a cache and must be safe to
drop at any moment. Every accepted action is persisted before it is cached or published, and
`teamId` is always resolved from the authenticated session, never from a request body.
See `docs/draft-engine.md`.
```

- [ ] **Step 5: Full verification**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: everything clean; the build succeeds. Then confirm the coverage gates still hold:

Run: `npm run test:coverage -- src/scoring src/draft-engine`
Expected: both directories at 100% on all four metrics.

- [ ] **Step 6: Commit**

```bash
git add src/draft-service/draft-realtime.test.ts docs/draft-engine.md docs/conventions.md
git commit -m "test(draft): two-SSE-client integration proof for snake and auction; document the engine

Both clients read the same league stream and observe every pick in order, which is the
machine-checkable version of 'the draft room stays in sync' — and the property XREADGROUP
would have silently broken by partitioning entries across viewers."
```

---

## Self-Review

**1. Spec coverage — Step 3 (all of it):**

| Spec bullet | Task |
|---|---|
| Tests first for turn order (snake reversal; auction nomination + bidding) | 2, 3 |
| Pick validation **via `validateRosterAdd`, not reimplemented** | 1 (`assignSlot`), enforced in 2/3 |
| Timer-expiry transitions driven by injected timestamps | 3 (both formats), 4 (the clock that decides *when*) |
| `DraftEngine` as a pure reducer with `MAKE_PICK` / `NOMINATE` / `BID` / `TIMER_EXPIRE`, every action carrying a `timestamp` | 1 (union), 2–4 (reducer) |
| Auction: nomination order, **config-driven** bid increment, "won" resolution on timer expiry | 3 (`AUCTION_CONFIG`, `nextNominator`, `reduceAuctionExpiry`) |
| Auto-tightening pick clock `DRAFT_CLOCK_SCHEDULE`, table-driven tests at every boundary | 4 (11 boundary cases + 5 `nextTightening` cases) |
| No persistence in the engine | Enforced: `src/draft-engine/**` imports nothing from `db/` or `lib/realtime/` except a **type-only** `RealtimeEventType` |
| Exit: full 12-team/15-round snake draft end-to-end | 5 |
| Exit: full auction with nomination order and budget enforcement | 5 |
| Exit: explicit rejection test for every invalid action (already-picked, roster overflow, bidding when nothing is up) | 2, 3, 5 |
| Exit: zero ambient-clock calls in the reducer | Global constraint; the only `new Date(...)` in the engine converts a *supplied* timestamp plus a duration into an ISO string, never reads the wall clock |
| Exit: four simulated distances from kickoff → four different pick durations | 4 (that exact assertion) |

**Step 4 — backend bullets only:**

| Spec bullet | Task |
|---|---|
| Durable, replay-based session store; validate → persist → cache → publish | 6 |
| Crash-recovery test (partial log → drop cache → replay → identical state) | 6 |
| `commitDraftResults(draftId)` writing into the team/roster tables | 7 |
| Wire to `publishEvent` with `draft.pick` / `draft.nominate` / `draft.bid` / `draft.timer_expire` | 5 (derivation), 6 (publish after the write) |
| Automated two-SSE-client integration test, headless, full mock snake draft | 9 |
| Reconnect resumes from the server-side state | Already shipped: `Last-Event-ID` resume is covered by `src/lib/realtime/realtime.test.ts`, and `GET /api/drafts/[draftId]` (Task 8) is the full-state refetch fallback. Not duplicated here. |

**Step 5 — the backend bullet:** "Extend (not duplicate) Step 4's session store and `commitDraftResults` to handle auction-drafted rosters" → auction is first-class in the same reducer (Task 3), the same store (Task 6), the same commit function (Task 7, with an explicit auction commit test), and gets its own two-client test (Task 9).

**Deliberate exclusions (with reasons):**
- **All UI** — snake draft board, auction bidding UI, pick-landing celebration motion, the read-only TV draftboard at `/draft/<id>/board`, optimistic client updates. Plan C builds them on the state, selectors, API and events shipped here. Stated in the header.
- **Client-side reconnect/resync hardening** (Step 5's last bullet) — the server half is done (`Last-Event-ID` replay, full-state refetch endpoint); the browser-side reconciliation of a missed bid war is a component concern, so it belongs with the auction UI in Plan C.
- **Commissioner pick-undo** — named in the strategy doc's competitor feature list but not in Steps 3–5. It is a new action type (`UNDO_PICK`) on the same log and slots in cleanly later; adding it now would be scope creep.
- **Per-league clock-schedule editing** — `DraftConfig.clockSchedule` is already an input, so a per-league override is a config change, not a rewrite. No settings UI or column in Phase 1.
- **AI draft moderator / nudges** — Step 6 of the spec, a separate plan.

**2. Placeholder scan:** no "TBD", "TODO", "similar to Task N", or "add error handling" anywhere. Every code step carries real code; every test step carries real assertions with hand-computed expectations (e.g. the 8h/4h/1h/10m/60s boundaries use concrete ISO instants, and the auction bidding war's `$186` is `$200 − $14` reserved). Task 2's `default: "That action isn't supported yet."` arm is explicitly labelled as scaffolding that Task 3 deletes, and Task 5's coverage step lists the exact likely gaps and the test that closes each.

**3. Type and name consistency across tasks:**
- `reduceDraft(state, action): DraftReduceResult` — declared in Task 2 (`DraftReduceResult` lives in `state.ts` to avoid a `reduce.ts` ⇄ `snake.ts`/`auction.ts` cycle), used verbatim in Tasks 3, 5, 6.
- `applyPick(state, { teamId, playerId, price, auto, timestamp })` — Task 2, reused unchanged by `reduceAuctionExpiry` (Task 3) and `reduceSnakeExpiry` (Task 3).
- `assignSlot({ position, roster, slotConfig }) → { ok, slot, slotIndex } | { ok: false, reason }` — Task 1, used in Tasks 2 and 3 and by `bestAvailableFor`.
- `auctionOf(state)` — Task 1 (`state.ts`), the single format check used by `reduce.ts`, `selectors.ts` and `events.ts`.
- `draftEventsFor(prev, next, action)` — Task 5, called with exactly that argument order by the store in Task 6.
- `createDraftStore(deps) → DraftStore` — Task 6 defines `getDraftState` / `applyAction` / `invalidate`; Task 7 extends **the same** interface and factory with `startDraft` / `commitDraftResults`; Task 8 wraps it in `getDraftStore()`. No second store anywhere.
- `DbTx` is exported from `src/db/client.ts` (Task 7) so `store.ts` and `commit.ts` share it without importing each other.
- `seedDraftFixture(db, input) → { draftId, leagueId, teamIds, userIds }` and `SPRINT_ROSTER_SLOTS` — Task 6, reused by Tasks 7, 8 and 9 with those exact field names.
- `DraftStateView` / `draftStateView(state)` — Task 4, returned by all three routes in Task 8 and asserted in Task 8's tests.
- `toDraftAction(input, teamId, timestamp)` — Task 8, built on `ClientDraftAction` from Task 1.
- `DRAFT_ACTION_VERSION` (`1`) is the only place the persisted version literal appears; `draftActionSchema` pins it and `toDraftAction` / `startDraft` / the ticker all stamp it.

**4. Process checks:**
- **Every verification command exists in `package.json`:** `npm test`, `npm test -- <dir>`, `npm run test:coverage`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:generate`, `npm run db:migrate`, `npm run db:migrate:test`, `npm run seed`, `npm run infra:up`. No new scripts are needed and none are invented.
- **Ambient clock:** nothing in `src/domain/**` or `src/draft-engine/**` calls `Date.now()` or constructs a "now". `Date.parse(...)` and `new Date(parsedMs + duration).toISOString()` operate only on timestamps supplied by an action or by `DraftConfig`. The wall clock appears exactly three times, all at the edge: `src/draft-service/index.ts`'s `systemClock`, the actions route's `new Date().toISOString()`, and the seed entry point.
- **Transport:** no `XREADGROUP`, no Socket.io, no second transport, no per-draft stream. `draft.*` events ride `league:<id>:events` through the existing `createPublisher`/`subscribe`/`createLeagueEventStream`, and Task 9's clients use the very harness `src/lib/realtime/realtime.test.ts` already uses.
- **`teamId` is never trusted from the client:** `clientDraftActionSchema` has no `teamId` field (Task 1 test asserts a supplied one is stripped), `resolveDraftActor` derives it from the session (Task 8), and a route test drafts with `teamId: "some_other_team"` in the body and asserts the pick lands on the caller's own team.
- **Migrations:** `leagues.roster_slots` ships with a `DEFAULT`; `draft_actions.sequence` is `NOT NULL` without one, which the conventions allow only because that table has never held a row — stated inline in Task 6.
