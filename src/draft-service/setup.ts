import { eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { drafts, leagues, mockRooms } from "@/db/schema";
import { DRAFT_CLOCK_SCHEDULE, DRAFT_PAUSE_WINDOW, type DraftConfig } from "@/draft-engine";

/**
 * The static half of a draft's state: what the reducer needs and the action log doesn't
 * carry, read straight from the rows that own it. Null when the draft doesn't exist.
 *
 * Takes `Db | DbTx` so `store.ts`'s `load` can call it with an open transaction (Task 7's
 * locked write path) as well as the plain pooled connection — the query is identical either way.
 *
 * Task 4: LEFT-joins `mock_rooms` beside the existing `leagues` join. `mock_rooms.league_id` is
 * that table's own primary key (one row per mock league, always — see its own docblock), so this
 * adds no fan-out to the one-draft-per-league shape this query already assumes. A matched row is
 * what `isMock`/`clockSchedule`/`pauseWindow` below key off — not `leagues.is_mock` itself, which
 * exists for the aggregates that need to exclude a mock without paying for this join
 * (`leaguesFilledQuery`, `myLeaguesOverview`), never for this per-draft read.
 */
export async function loadDraftConfig(db: Db | DbTx, draftId: string): Promise<DraftConfig | null> {
  const [row] = await db
    .select({
      draftId: drafts.id,
      leagueId: drafts.leagueId,
      format: drafts.format,
      kickoffAt: drafts.kickoffAt,
      auctionBudget: drafts.auctionBudget,
      slotConfig: leagues.rosterSlots,
      mockPickSeconds: mockRooms.pickSeconds,
    })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .leftJoin(mockRooms, eq(mockRooms.leagueId, leagues.id))
    .where(eq(drafts.id, draftId));
  if (row === undefined) return null;
  // `mockPickSeconds` is non-null exactly when the left join matched a `mock_rooms` row — the
  // one fact this whole config branches on.
  const isMock = row.mockPickSeconds !== null;
  return {
    draftId: row.draftId,
    leagueId: row.leagueId,
    format: row.format,
    kickoffAt: row.kickoffAt.toISOString(),
    auctionBudget: row.auctionBudget,
    slotConfig: row.slotConfig,
    isMock,
    // A mock's own room-chosen pace, as the single tier a mock draft ever runs at — never
    // tightening toward kickoff the way a real league's ladder does, because a mock's "kickoff"
    // is invented scheduling with nothing real to race against. `DRAFT_CLOCK_SCHEDULE` otherwise,
    // travelling beside `clockSchedule` because it is the same kind of thing: a deploy-flippable
    // clock rule, consumed at command time (`admit.ts`'s TIMER_EXPIRE guard) and at view time
    // (`selectors.ts`), never by the reducer itself (Task 4's ruling — see `pause.ts`).
    clockSchedule: isMock ? [{ untilHoursBeforeKickoff: 0, pickSeconds: row.mockPickSeconds! }] : DRAFT_CLOCK_SCHEDULE,
    // No overnight freeze for a mock: `selectors.ts` treats a null window as "compute the plain
    // deadline" (`state.config.pauseWindow ?? null`), which is exactly the courtesy a practice
    // room with an invented kickoff has no reason to apply.
    pauseWindow: isMock ? null : DRAFT_PAUSE_WINDOW,
  };
}
