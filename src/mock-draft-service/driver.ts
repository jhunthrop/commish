import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { drafts, leagues, mockRooms, teams, users } from "@/db/schema";
import { currentClockSeconds, teamOnClock, type DraftState } from "@/draft-engine";
import { assignArchetypes, type BotArchetype } from "@/mock-draft/archetypes";
import { botDelayStreamKey, botThinkDelayMs, chooseBotPick } from "@/mock-draft/bots";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { rngFor, type Rng } from "@/mock-draft/rng";
import type { MockLifecycleDeps } from "./claim";
import { startMockDraft } from "./start";

/**
 * The mock room's two service lanes beyond the store itself: the due scan that starts rooms
 * whose window has fired (the sweep job's, `@/jobs/defs/draft-sweep-job`), and the bot policy
 * the draft store runs forward inside the transaction that lands a human's action (the batched
 * bots round, 2026-09-25: `DraftStoreDeps.botTurn`). Retention lives in `./sweep`.
 */

/** The outcome reason the due scan reports when `startMockDraft` itself throws — product copy
 *  in the sweep-outcome voice (`"Something went wrong checking this draft's clock."`). */
export const MOCK_START_FAILED_REASON = "Something went wrong starting this mock draft.";

/**
 * THE due scan (brief, Step 2): every mock room whose `starts_at` has passed and whose draft is
 * still `'scheduled'` — the fill-window expiry, the early-start grace stamp AND a solo room
 * whose own self-start failed (`startsAt = now` at creation, the T5 carry) are all this ONE
 * predicate, which is what lets `drafts.status` never lie: unfinished work is always findable.
 *
 * A builder, not an awaited result, for the reason `liveDraftsQuery` records: the EXPLAIN
 * assertion (`src/db/index-plans.test.ts`) measures the REAL query, not a hand copy. Range on
 * `mock_rooms_starts_at_idx`'s own column, ordered by that column FIRST (the index's own order —
 * oldest due room served first) with `league_id` as the total-order tiebreak, bounded by
 * `MOCK_CONFIG.maxMockStartsPerTick` — no scan in this codebase is unbounded.
 */
export function dueMockRoomsQuery(db: Db, now: Date) {
  return db
    .select({ leagueId: mockRooms.leagueId })
    .from(mockRooms)
    .innerJoin(drafts, eq(drafts.leagueId, mockRooms.leagueId))
    .where(and(lte(mockRooms.startsAt, now), eq(drafts.status, "scheduled")))
    .orderBy(asc(mockRooms.startsAt), asc(mockRooms.leagueId))
    .limit(MOCK_CONFIG.maxMockStartsPerTick);
}

export type MockStartOutcome =
  | { readonly leagueId: string; readonly started: true; readonly draftId: string }
  | {
      readonly leagueId: string;
      readonly started: false;
      /**
       * `true` for a mapped 409 — the race answer, not an error (the T5 carry): another
       * instance's scan (or the room's own solo self-start) got there first, so the state this
       * scan wanted to bring about already exists. The sweep absorbs it silently; only a
       * NON-benign failure reaches the outcome log.
       */
      readonly benignRace: boolean;
      readonly reason: string;
    };

/**
 * The due-start lane: scan, then `startMockDraft` per row — the ONE callable every start path
 * shares (`./start`), so bot top-up and the guarded status transition happen exactly the way a
 * solo room's own self-start does. Per-row try/catch, the same "one room's failure must not
 * starve the rooms after it" shape every sweep lane keeps.
 */
export async function startDueMockRooms(db: Db, deps: Pick<MockLifecycleDeps, "store" | "clock" | "newId">): Promise<readonly MockStartOutcome[]> {
  const rows = await dueMockRoomsQuery(db, new Date(Date.parse(deps.clock.now())));
  const outcomes: MockStartOutcome[] = [];
  for (const row of rows) {
    try {
      const started = await startMockDraft(db, row.leagueId, deps);
      outcomes.push(
        started.ok
          ? { leagueId: row.leagueId, started: true, draftId: started.draftId }
          : { leagueId: row.leagueId, started: false, benignRace: started.status === 409, reason: started.reason },
      );
    } catch (error: unknown) {
      console.error("[mock-draft] due start failed", { leagueId: row.leagueId }, error);
      outcomes.push({ leagueId: row.leagueId, started: false, benignRace: false, reason: MOCK_START_FAILED_REASON });
    }
  }
  return outcomes;
}

/**
 * THE STATUS SETTLE (Task 6 fix round, ruled): flips a FINISHED mock draft's `drafts.status`
 * from `'in_progress'` to `'complete'` — one bare, guarded column write, NEVER `applyAction`
 * and NEVER `commitDraftState` (whose absence for mocks is Task 4's law: no season commit, no
 * audit, no notice — the differential trace in `store.test.ts` extends over this write too).
 *
 * Why it exists: without it a finished mock stayed `'in_progress'` for its whole retention
 * window, occupying one of `liveDraftsQuery`'s bounded scan slots (LIMIT `maxDraftsPerTick`)
 * every sweep for up to a day — enough finished mocks could crowd REAL drafts out of the expiry
 * scan. Settled, the row leaves the scan at once, and the sweep's started-room windows become
 * pure SQL (`./sweep`) because status now tells completed and abandoned apart.
 *
 * Guarded three ways, so it is idempotent and mock-only by construction: the draft id, the
 * `'in_progress'` precondition (a second call — or a race with another instance's settle —
 * updates zero rows), and `is_mock = true` on the owning league (the writer-level refusal the
 * sweep's own `deleteMockLeagueRow` also carries; a real league's status is only ever written
 * by `claimAutoStart`/`commitDraftState`). Returns whether THIS call did the flip.
 *
 * Takes `Db | DbTx`: the store settles a mock its own batch completed inside that batch's
 * transaction (the batched bots round), and the advance funnel settles one it observes complete
 * on a plain connection, level-triggered, so a restart cannot lose the transition.
 */
export async function settleMockDraftCompletion(db: Db | DbTx, draftId: string): Promise<boolean> {
  const settled = await db
    .update(drafts)
    .set({ status: "complete" })
    .where(
      and(
        eq(drafts.id, draftId),
        eq(drafts.status, "in_progress"),
        inArray(drafts.leagueId, db.select({ id: leagues.id }).from(leagues).where(eq(leagues.isMock, true))),
      ),
    )
    .returning({ id: drafts.id });
  return settled.length > 0;
}

/**
 * THE BOT ON THE CLOCK, PRICED (the batched bots round, 2026-09-25): which bot holds the clock,
 * WHEN its pick is revealed, and — behind `choosePick` — WHAT it picks. `revealAtMs` is the
 * exact (fractional-millisecond) instant `turnStartedAt + botThinkDelayMs(...)`, kept as a number
 * so the stamp the store writes (`Math.ceil`, the first whole millisecond at or after it) is the
 * arithmetic the delay pins cover (`PIN_BOT_DELAYS_MS`, `@/draft-engine/replay-pins.fixture`)
 * rather than a rounded copy. The store runs this forward through every consecutive bot seat
 * inside the transaction that lands a human's action (or starts the draft, or expires a human's
 * clock), each pick stamped at its own reveal instant, each instant the next turn's start: the
 * picks are a function of the seeded state, only their reveal is time-shaped.
 *
 * `choosePick` is a THUNK: the rank-weighted selection walks the pool, so it runs only once the
 * caller has decided to land the pick. Pure over the state this answer was derived from (the
 * pick stream rebuilds its cursor from the log), so calling it never moves an RNG cursor and two
 * calls answer identically. Null when the roster can take nothing (the T3 carry: not an error;
 * the turn then falls to the clock's own expiry).
 */
export interface BotTurn {
  readonly teamId: string;
  readonly revealAtMs: number;
  readonly choosePick: () => string | null;
}

export interface MockBotDriverDeps {
  readonly db: Db;
}

/** The per-draft facts the driver needs beyond `DraftState`: the room's stored seed, which
 *  seats are bots, and the archetype deal — all immutable for the draft's life. */
interface MockDraftMeta {
  readonly botSeed: number;
  readonly botTeamIds: ReadonlySet<string>;
  readonly archetypes: Readonly<Record<string, BotArchetype>>;
}

/**
 * A bot's pick-selection stream, positioned exactly where the draft's own log says it is.
 *
 * THE REPLAY LAW, restated as arithmetic: pick N of a bot's own draft always consumes draw N of
 * `rngFor(botSeed, teamId)` — "one stream per bot, held for the draft's life" is a fact about
 * the SEQUENCE, and the cursor into it is derived from state (`chooseBotPick` consumes exactly
 * one draw per sampled pick, and a bot's picks are exactly its non-`auto` picks), never held in
 * memory. That derivation is what makes the batch level-triggered all the way down: the batch
 * loop hands each iteration the state the previous pick produced, so every pick reads the
 * identical stream position a pick-by-pick driver would have read, and a restarted server
 * resumes an in-flight room with picks byte-identical to the ones an uninterrupted run made.
 *
 * The bijection leans on two structural facts: a bot's autopicked turn (`auto: true` — only
 * possible if every driver was down past the room's whole clock) consumed no draw and is excluded
 * from the count; and a queue-honored pick would consume no draw while still counting — but a
 * bot cannot hold a queue (queue writes ride authenticated member routes, and a bot account is
 * structurally refused everywhere a member acts).
 */
function pickStreamFor(botSeed: number, teamId: string, state: DraftState): Rng {
  const rng = rngFor(botSeed, teamId);
  const priorDraws = state.picks.filter((pick) => pick.teamId === teamId && !pick.auto).length;
  for (let i = 0; i < priorDraws; i += 1) rng.next();
  return rng;
}

/**
 * The bot policy the store runs forward (see `BotTurn`). Level-triggered and derived-only:
 * everything here is a pure function of the draft state the caller handed in and the room's
 * stored seed — no "bot is thinking" flag exists anywhere.
 *
 * The think-delay is drawn from each pick's OWN stream (`botDelayStreamKey`), uniform within
 * `MOCK_CONFIG.botDelay` (450 to 950 ms), whose top (`config.test.ts` pins it) sits under half
 * the fastest offered clock: a bot can never be autopicked by its own dawdling — the T1
 * arithmetic guarantee — and never collides with the moderator's nudge threshold (which
 * `nudge.ts` additionally short-circuits for bots).
 *
 * The per-draft meta cache is keyed by draft id; every cached fact (the stored seed, which
 * seats are bots, the archetype deal) is immutable for the draft's life — teams are
 * delete-and-recreate, never reassigned — so the ONE invalidation moment is the room ceasing to
 * exist: the retention sweep drops each swept draft's entry through `invalidateDraft` below,
 * the identical lifecycle the sweep already gives `pool.ts`'s ranking cache and the store's own
 * state cache. No size cap beyond that, the `isBotCache` precedent (`nudge.ts`).
 */
export interface MockBotDriver {
  /**
   * The bot on the clock, priced (`BotTurn`): null unless a BOT holds a running clock in a room
   * whose sidecar still exists. Pure over the handed-in state, the stored seed and the cached
   * meta — it draws from the delay stream and the pick stream the batch itself consumes, so
   * pricing a turn never moves either cursor.
   */
  readonly botTurn: (state: DraftState) => Promise<BotTurn | null>;
  /** Drops one draft's cached meta — the sweep's seam, called per swept room. */
  readonly invalidateDraft: (draftId: string) => void;
}

export function createMockBotDriver({ db }: MockBotDriverDeps): MockBotDriver {
  const metaCache = new Map<string, MockDraftMeta>();

  async function metaFor(state: DraftState): Promise<MockDraftMeta | null> {
    const cached = metaCache.get(state.config.draftId);
    if (cached !== undefined) return cached;
    const [room] = await db.select({ botSeed: mockRooms.botSeed }).from(mockRooms).where(eq(mockRooms.leagueId, state.config.leagueId));
    // No sidecar row, no bots to drive: the room vanished (a concurrent sweep) out from under a
    // state the caller still holds. Not cached — an answer derived from a missing row has no
    // life to cache for.
    if (room === undefined) return null;
    const seatRows = await db
      .select({ teamId: teams.id, isBot: users.isBot })
      .from(teams)
      .innerJoin(users, eq(users.id, teams.userId))
      .where(eq(teams.leagueId, state.config.leagueId));
    // Sorted DETERMINISTICALLY before the archetype deal (the T5 carry): row order off a SELECT
    // with no ORDER BY is whatever the planner felt like, and `assignArchetypes` deals
    // round-robin off a seeded shuffle — an unsorted id list would re-deal every brain in the
    // room from one process to the next, breaking replay without touching a single seed.
    const botTeamIds = seatRows
      .filter((row) => row.isBot)
      .map((row) => row.teamId)
      .sort();
    const meta: MockDraftMeta = {
      botSeed: room.botSeed,
      botTeamIds: new Set(botTeamIds),
      archetypes: assignArchetypes(room.botSeed, botTeamIds),
    };
    metaCache.set(state.config.draftId, meta);
    return meta;
  }

  async function botTurn(state: DraftState): Promise<BotTurn | null> {
    const onClockTeamId = teamOnClock(state);
    if (onClockTeamId === null) return null;
    const meta = await metaFor(state);
    if (meta === null) return null;
    if (!meta.botTeamIds.has(onClockTeamId)) return null;
    const clockSeconds = currentClockSeconds(state);
    if (clockSeconds === null) return null; // no turn is running, so there is no delay to measure
    // Non-null exactly when a clock is running: `currentTier` (which `currentClockSeconds` just
    // answered through) is null whenever `turnStartedAt` is — one fact, checked once above.
    const startedAtMs = Date.parse(state.turnStartedAt!);
    const revealAtMs = startedAtMs + botThinkDelayMs(clockSeconds, rngFor(meta.botSeed, botDelayStreamKey(onClockTeamId, state.pickNumber)));
    return {
      teamId: onClockTeamId,
      revealAtMs,
      choosePick: () => chooseBotPick(state, onClockTeamId, meta.archetypes[onClockTeamId]!, pickStreamFor(meta.botSeed, onClockTeamId, state)),
    };
  }

  return {
    botTurn,
    invalidateDraft(draftId: string): void {
      metaCache.delete(draftId);
    },
  };
}
