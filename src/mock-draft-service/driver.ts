import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, mockRooms, teams, users } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import { currentClockSeconds, teamOnClock, type DraftState } from "@/draft-engine";
import type { DraftStore } from "@/draft-service/store";
import { assignArchetypes, type BotArchetype } from "@/mock-draft/archetypes";
import { botThinkDelaySeconds, chooseBotPick } from "@/mock-draft/bots";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { rngFor, type Rng } from "@/mock-draft/rng";
import type { MockLifecycleDeps } from "./claim";
import { startMockDraft } from "./start";

/**
 * The ticker's two mock GO lanes (Phase 4.5, Task 6): the due scan that starts rooms whose
 * window has fired, and the bot driver that makes a mock room's bots pick on the clock. The
 * third lane — retention — lives in `./sweep`. All three ride `createDraftTicker`'s own tick
 * (`@/draft-service/ticker`), never a second `setInterval`, the same "one heartbeat" rule
 * Task 7's auto-start and the house reconcile already keep.
 */

/** The outcome reason the due scan reports when `startMockDraft` itself throws — product copy
 *  in the ticker-outcome voice (`"Something went wrong checking this draft's clock."`). */
export const MOCK_START_FAILED_REASON = "Something went wrong starting this practice draft.";

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
       * scan wanted to bring about already exists. The ticker absorbs it silently; only a
       * NON-benign failure reaches the rate-limited outcome log.
       */
      readonly benignRace: boolean;
      readonly reason: string;
    };

/**
 * The due-start lane: scan, then `startMockDraft` per row — the ONE callable every start path
 * shares (`./start`), so bot top-up and the guarded status transition happen exactly the way a
 * solo room's own self-start does. Per-row try/catch, the same "one room's failure must not
 * starve the rooms after it" shape every ticker lane keeps.
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
 * every tick for up to a day — enough finished mocks could crowd REAL drafts out of the expiry
 * scan. Settled, the row leaves the scan on the very next tick, and the sweep's started-room
 * windows become pure SQL (`./sweep`) because status now tells completed and abandoned apart.
 *
 * Guarded three ways, so it is idempotent and mock-only by construction: the draft id, the
 * `'in_progress'` precondition (a second call — or a race with another instance's settle —
 * updates zero rows), and `is_mock = true` on the owning league (the writer-level refusal the
 * sweep's own `deleteMockLeagueRow` also carries; a real league's status is only ever written
 * by `claimAutoStart`/`commitDraftState`). Returns whether THIS call did the flip.
 *
 * Called from `driveBotPick` below, level-triggered like everything else in this module: the
 * tick after the last pick lands observes `phase === "complete"` with no team on the clock and
 * settles — no stored "needs settling" flag, so a restart cannot lose the transition.
 */
export async function settleMockDraftCompletion(db: Db, draftId: string): Promise<boolean> {
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

/** What one driver call did: a pick landed through the real store, or the store refused it.
 *  `null` means there was nothing for the driver to do this tick — a human on the clock, a
 *  think-delay still running, or a roster that can take nothing (the T3 carry: not an error). */
export type BotDriveOutcome = { readonly picked: true } | { readonly picked: false; readonly reason: string };

export type MockBotDriveFn = (state: DraftState, now: string) => Promise<BotDriveOutcome | null>;

export interface MockBotDriverDeps {
  readonly db: Db;
  readonly store: DraftStore;
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
 * one draw per sampled pick, and a bot's driver picks are exactly its non-`auto` picks), never
 * held in memory. That derivation is what makes the driver level-triggered all the way down: a
 * restarted server rebuilds the identical stream position from the log alone and resumes
 * mid-draft with picks byte-identical to the ones an uninterrupted run would have made —
 * `driver.test.ts`'s replay proof drives both runs and compares the logs.
 *
 * The bijection leans on two structural facts: a bot's autopicked turn (`auto: true` — only
 * possible if the driver was down past the room's whole clock) consumed no draw and is excluded
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
 * The bot driver (brief, Step 3): at most ONE bot pick for ONE mock draft per call, invoked by
 * `tickOne` (`@/draft-service/ticker`) for each live mock the expiry scan already fetched — no
 * second scan, and no throttle beyond `maxBotPicksPerTick`'s tick-wide budget (held by the
 * ticker), because one pick per draft per tick IS the pace: at `tickIntervalMs: 1_000` the next
 * bot's own think-delay (`minSeconds: 3`) cannot have elapsed on the tick its turn began.
 *
 * Level-triggered and derived-only: everything here is a pure function of the draft state the
 * caller handed in, the room's stored seed, and `now` — no "bot is thinking" flag exists
 * anywhere, so a restarted server resumes any in-flight mock cleanly (see `pickStreamFor`).
 *
 * The think-delay is drawn from each pick's OWN stream (`${teamId}:delay:${pickNumber}` — the
 * T3 report's shape), uniform within `MOCK_CONFIG.botDelay`, whose cap (`config.test.ts` pins
 * it) sits under half the fastest offered clock: a bot can never be autopicked by its own
 * dawdling — the T1 arithmetic guarantee — and never collides with the moderator's nudge
 * threshold (which `nudge.ts` additionally short-circuits for bots).
 *
 * The pick itself is a plain `MAKE_PICK` through the REAL `store.applyAction` — the same mutex,
 * the same row locks, the same admit+reduce, the same sequence-conflict backstop, the same SSE
 * broadcast as every human pick (bots ride MAKE_PICK, never TIMER_EXPIRE — the T3-era ruling),
 * with `actor` absent because the mock lane skips attribution machinery outright (Task 4).
 *
 * The per-draft meta cache is keyed by draft id; every cached fact (the stored seed, which
 * seats are bots, the archetype deal) is immutable for the draft's life — teams are
 * delete-and-recreate, never reassigned — so the ONE invalidation moment is the room ceasing to
 * exist: the retention sweep drops each swept draft's entry through `invalidateDraft` below
 * (fix round, review MEDIUM: the ticker wires it into `MockSweepDeps.invalidateDriverMeta`),
 * the identical lifecycle the sweep already gives `pool.ts`'s ranking cache and the store's own
 * state cache. No size cap beyond that, the `isBotCache` precedent (`nudge.ts`).
 */
export interface MockBotDriver {
  readonly driveBotPick: MockBotDriveFn;
  /** Drops one draft's cached meta — the sweep's seam, called per swept room. */
  readonly invalidateDraft: (draftId: string) => void;
}

export function createMockBotDriver({ db, store }: MockBotDriverDeps): MockBotDriver {
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

  async function driveBotPick(state: DraftState, now: string): Promise<BotDriveOutcome | null> {
    // Resolved BEFORE any other database read. No team on the clock means either a finished
    // room — settled below (fix round, ruled), so the expiry scan stops re-fetching it on the
    // very next tick instead of holding a scan slot for the whole retention window — or a state
    // no snake mock reaches mid-draft (nothing to drive either way).
    const onClockTeamId = teamOnClock(state);
    if (onClockTeamId === null) {
      if (state.phase === "complete") await settleMockDraftCompletion(db, state.config.draftId);
      return null;
    }
    const meta = await metaFor(state);
    if (meta === null) return null;
    if (!meta.botTeamIds.has(onClockTeamId)) return null;

    const clockSeconds = currentClockSeconds(state);
    if (clockSeconds === null) return null; // no turn is running, so there is no delay to measure
    // Non-null exactly when a clock is running: `currentTier` (which `currentClockSeconds` just
    // answered through) is null whenever `turnStartedAt` is — one fact, checked once above.
    const startedAt = state.turnStartedAt!;
    const delaySeconds = botThinkDelaySeconds(clockSeconds, rngFor(meta.botSeed, `${onClockTeamId}:delay:${state.pickNumber}`));
    if (Date.parse(now) < Date.parse(startedAt) + delaySeconds * 1000) return null;

    const playerId = chooseBotPick(state, onClockTeamId, meta.archetypes[onClockTeamId]!, pickStreamFor(meta.botSeed, onClockTeamId, state));
    if (playerId === null) return null;

    const result = await store.applyAction(state.config.draftId, {
      v: DRAFT_ACTION_VERSION,
      type: "MAKE_PICK",
      timestamp: now,
      teamId: onClockTeamId,
      playerId,
    });
    return result.ok ? { picked: true } : { picked: false, reason: result.reason };
  }

  return {
    driveBotPick,
    invalidateDraft(draftId: string): void {
      metaCache.delete(draftId);
    },
  };
}
