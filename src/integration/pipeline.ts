import type { Db } from "@/db/client";
import { players, playerStatLines } from "@/db/schema";
import type { DraftFormat } from "@/domain/league";
import { currentDeadline } from "@/draft-engine";
import { createDraftStore } from "@/draft-service/store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";

/**
 * Shared by every test in `src/integration/**`. NOT a test file — no `describe`, no `it` — so
 * it is imported rather than run.
 *
 * `SPRINT_ROSTER_SLOTS` (QB/RB/WR) keeps a full, genuinely-finished draft to six picks for two
 * teams. Short is the point: this suite exists to prove the SEAM, and a sixteen-round standard
 * roster would prove the same seam twenty times more slowly.
 */

/** One player per position per team slot, so a two-team sprint draft always fills. */
const POOL_ROWS = [
  { id: "qb1", name: "QB One", position: "QB" as const, nflTeam: "KC" },
  { id: "qb2", name: "QB Two", position: "QB" as const, nflTeam: "SF" },
  { id: "rb1", name: "RB One", position: "RB" as const, nflTeam: "KC" },
  { id: "rb2", name: "RB Two", position: "RB" as const, nflTeam: "SF" },
  { id: "wr1", name: "WR One", position: "WR" as const, nflTeam: "KC" },
  { id: "wr2", name: "WR Two", position: "WR" as const, nflTeam: "SF" },
];

/** Weekly production for the six pool players, so a scored week is not a table of zeroes. */
const STAT_LINES = [
  { playerId: "qb1", passingYards: 300, passingTouchdowns: 3 },
  { playerId: "qb2", passingYards: 210, passingTouchdowns: 1 },
  { playerId: "rb1", rushingYards: 120, rushingTouchdowns: 1 },
  { playerId: "rb2", rushingYards: 60, receptions: 3, receivingYards: 25 },
  { playerId: "wr1", receivingYards: 110, receptions: 8, receivingTouchdowns: 1 },
  { playerId: "wr2", receivingYards: 45, receptions: 4 },
];

export interface DraftedLeague {
  readonly draftId: string;
  readonly leagueId: string;
  readonly teamIds: readonly string[];
  readonly userIds: readonly string[];
}

const CLOCK = { now: () => "2026-09-01T00:00:00.000Z" };
/** Publishing is best-effort by contract; this suite proves persistence, not fan-out. */
const PUBLISH = async () => "1-0";
/** A finished six-pick draft cannot need more turns than this; the cap is a hang guard. */
const MAX_TURNS = 100;

/**
 * Seeds a league and runs a REAL draft in it to completion, letting the clock autopick every
 * turn. The commit into rosters, picks and the season schedule is the store's OWN
 * commit-on-completion — nothing here calls `commitDraftState` by hand, because a test that
 * commits for itself proves only that the commit function works, not that a finished draft
 * actually triggers it.
 *
 * `key` namespaces the ids so several drafted leagues can coexist inside one test.
 */
export async function runRealDraft(db: Db, format: DraftFormat, key: string): Promise<DraftedLeague> {
  const fixture = await seedDraftFixture(db, {
    draftId: `${key}_draft`,
    leagueId: `${key}_league`,
    format,
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: format === "auction" ? 50 : null,
  });
  await db.insert(players).values(POOL_ROWS).onConflictDoNothing({ target: players.id });

  const store = createDraftStore({ db, publish: PUBLISH, clock: CLOCK });
  const started = await store.startDraft(fixture.draftId);
  if (!started.ok) throw new Error(`start failed: ${started.reason}`);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const state = await store.getDraftState(fixture.draftId);
    if (state === null) throw new Error("draft vanished mid-run");
    if (state.phase === "complete") {
      return { draftId: fixture.draftId, leagueId: fixture.leagueId, teamIds: fixture.teamIds, userIds: fixture.userIds };
    }
    // The reducer rejects an expiry before the deadline it actually set, so advance to that
    // deadline rather than reasoning about the clock's tightening tiers here.
    const result = await store.applyAction(fixture.draftId, {
      v: 1,
      type: "TIMER_EXPIRE",
      timestamp: currentDeadline(state) ?? CLOCK.now(),
    });
    if (!result.ok) throw new Error(`turn ${turn} rejected: ${result.reason}`);
  }
  throw new Error("draft did not finish");
}

/** Inserts one week of production for the sprint pool. Callers score against it. */
export async function seedWeekStats(db: Db, weekNumber: number): Promise<void> {
  await db
    .insert(playerStatLines)
    .values(STAT_LINES.map((line) => ({ ...line, week: weekNumber })))
    .onConflictDoNothing();
}
