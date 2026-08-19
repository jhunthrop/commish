import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { ScoringPresetName } from "@/domain/scoring";
import { drafts, players, playerStatLines, rosterSlots, teams, users } from "@/db/schema";
import { createLeague } from "./creation";
import { writeSchedule } from "./schedule";

/** Shared across `lineups.test.ts` and `lineup-routes.test.ts` — one fixture shape, not two. */
export const SLOTS = [
  { slot: "QB" as const, count: 1, eligiblePositions: ["QB" as const] },
  { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
  { slot: "BENCH" as const, count: 2, eligiblePositions: ["QB" as const, "RB" as const] },
];

const clock = { now: () => "2026-08-17T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

/**
 * Two teams, a legal starting QB/RB each, two bench spots, and a schedule (two weeks by
 * default; `weeks` widens it for a test that needs a week further out, e.g. the lock tests
 * probing a week the ingestion worker has never reached). Both lineup test files build off this
 * exact roster shape so a lineup swap ("start the bench QB and RB") means the same thing in
 * both places.
 */
export async function twoTeamLeague(db: Db, { weeks = 2 }: { readonly weeks?: number } = {}) {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Duel", format: "snake", teamCount: 2, scoringPreset: "ppr", auctionBudget: null,
    rosterSlots: SLOTS, commissionerUserId: "u1", teamName: "Team One",
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  await db.insert(teams).values({ id: "team_2", leagueId: created.leagueId, userId: "u2", name: "Team Two" });
  // `finalizeWeek` refuses an undrafted league (Plan B Task 5's guard) — this fixture stands
  // in for a season already underway, so the draft it's built on is done.
  await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, created.leagueId));
  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "SF" },
    { id: "rb1", name: "RB One", position: "RB", nflTeam: "NYJ" },
    { id: "rb2", name: "RB Two", position: "RB", nflTeam: "DAL" },
  ]);
  await db.insert(rosterSlots).values([
    { teamId: created.teamId, slot: "QB", slotIndex: 0, playerId: "qb1" },
    { teamId: created.teamId, slot: "RB", slotIndex: 0, playerId: "rb1" },
    { teamId: created.teamId, slot: "BENCH", slotIndex: 0, playerId: "qb2" },
    { teamId: created.teamId, slot: "BENCH", slotIndex: 1, playerId: "rb2" },
  ]);
  await db.transaction((tx) => writeSchedule(tx, { leagueId: created.leagueId, teamIds: [created.teamId, "team_2"], weeks }));
  return created;
}

/** Swaps the starting QB/RB for their bench counterparts — the one "legal edit" both files exercise. */
export const validSwap = [
  { slot: "QB" as const, slotIndex: 0, playerId: "qb2" },
  { slot: "RB" as const, slotIndex: 0, playerId: "rb1" },
  { slot: "BENCH" as const, slotIndex: 0, playerId: "qb1" },
  { slot: "BENCH" as const, slotIndex: 1, playerId: "rb2" },
];

// --- The advisor's fixtures ------------------------------------------------------------
//
// These live HERE, next to the league fixtures they are built from (`createLeague`,
// `writeSchedule`), rather than in `src/ai-advisor/` — and not as a matter of taste.
// `advisory-only.test.ts` scans every non-test source file under `src/ai-advisor/**` for a
// write verb, recursively and with no name carve-outs. A DB fixture is nothing but write
// verbs, so a fixture inside that directory can only be tolerated by punching a
// rename-shaped hole in the guard. Moving it out keeps the guard total.

const advisorClock = { now: () => "2026-08-18T12:00:00.000Z" };

export const ADVISOR_SLOTS = [
  { slot: "WR" as const, count: 1, eligiblePositions: ["WR" as const] },
  { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
  { slot: "BENCH" as const, count: 2, eligiblePositions: ["WR" as const, "RB" as const] },
];

/**
 * Two teams, four players, three completed weeks of stats. The WRs' receptions are what make
 * PPR and standard scoring disagree about the same roster — the spec's exit criterion in
 * fixture form.
 */
export async function advisorFixture(
  db: Db,
  scoringPreset: ScoringPresetName,
  idSuffix = "",
): Promise<{ readonly leagueId: string; readonly teamId: string; readonly opponentTeamId: string }> {
  const commissioner = `u1${idSuffix}`;
  const rival = `u2${idSuffix}`;
  let sequence = 0;
  const nextAdvisorId = () => `id${idSuffix}_${++sequence}`;

  await db.insert(users).values([
    { id: commissioner, email: `${commissioner}@test.local`, displayName: "Alex Rivera" },
    { id: rival, email: `${rival}@test.local`, displayName: "Jordan Lee" },
  ]);

  const created = await createLeague({ db, clock: advisorClock, newId: nextAdvisorId }, {
    name: "Sunday Money",
    format: "snake",
    teamCount: 2,
    scoringPreset,
    auctionBudget: null,
    rosterSlots: ADVISOR_SLOTS,
    commissionerUserId: commissioner,
    teamName: "Bay Bandits",
    experienceTier: "beginner",
    stakeTier: 0,
    isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);

  const opponentTeamId = `team_2${idSuffix}`;
  await db.insert(teams).values({ id: opponentTeamId, leagueId: created.leagueId, userId: rival, name: "Iron Owls" });

  // Players are shared across fixtures, so insert once and ignore a repeat.
  await db
    .insert(players)
    .values([
      { id: "wr_volume", name: "Volume Slot", position: "WR", nflTeam: "KC" },
      { id: "wr_deep", name: "Deep Threat", position: "WR", nflTeam: "SF" },
      { id: "rb_bell", name: "Bell Cow", position: "RB", nflTeam: "NYJ" },
      { id: "rb_change", name: "Change Up", position: "RB", nflTeam: "DAL" },
    ])
    .onConflictDoNothing();

  await db
    .insert(playerStatLines)
    .values(
      [1, 2, 3].flatMap((week) => [
        // 10 catches, 80 yards: a PPR monster (18 pts) and a standard-scoring afterthought (8
        // pts). Yards score identically under both rulesets, so bumping them widens the PPR-vs-
        // deep-threat gap below without disturbing the exit criterion's exact 10-point delta
        // (that delta is carried entirely by the 10 receptions, at 1 point apiece under PPR).
        { playerId: "wr_volume", week, receivingYards: 80, receptions: 10 },
        // 1 catch, 90 yards and a score: barely moved by scoring rules either way (15 pts
        // standard, 16 pts PPR) — squarely between wr_volume's two scores (8 pts standard, 18
        // pts PPR), so the ranking flip below is a real reversal, not two blowouts.
        { playerId: "wr_deep", week, receivingYards: 90, receptions: 1, receivingTouchdowns: 1 },
        { playerId: "rb_bell", week, rushingYards: 90, rushingTouchdowns: 1 },
        { playerId: "rb_change", week, rushingYards: 30, receptions: 2, receivingYards: 20 },
      ]),
    )
    .onConflictDoNothing();

  await db.insert(rosterSlots).values([
    { teamId: created.teamId, slot: "WR", slotIndex: 0, playerId: "wr_deep" },
    { teamId: created.teamId, slot: "RB", slotIndex: 0, playerId: "rb_bell" },
    { teamId: created.teamId, slot: "BENCH", slotIndex: 0, playerId: "wr_volume" },
    { teamId: created.teamId, slot: "BENCH", slotIndex: 1, playerId: "rb_change" },
    // The opponent fields the same four players, starters and bench swapped — real enough for
    // the trade route to assemble both sides of an actual proposal, not just reject one.
    { teamId: opponentTeamId, slot: "WR", slotIndex: 0, playerId: "wr_volume" },
    { teamId: opponentTeamId, slot: "RB", slotIndex: 0, playerId: "rb_change" },
    { teamId: opponentTeamId, slot: "BENCH", slotIndex: 0, playerId: "wr_deep" },
    { teamId: opponentTeamId, slot: "BENCH", slotIndex: 1, playerId: "rb_bell" },
  ]);

  await db.transaction((tx) =>
    writeSchedule(tx, { leagueId: created.leagueId, teamIds: [created.teamId, opponentTeamId], weeks: 4 }),
  );

  return { leagueId: created.leagueId, teamId: created.teamId, opponentTeamId };
}

export interface ForeignLeague {
  /** A team that genuinely exists — in a league the caller is not in. */
  readonly teamId: string;
  /** A player genuinely rostered on that team, and on no team in the caller's league. */
  readonly playerId: string;
}

/**
 * A second, unrelated league whose team fields one genuinely real, rostered player — for
 * proving that neither a TEAM nor a PLAYER that is real and rostered ELSEWHERE, rather than
 * merely a nonexistent id, can be read into a DIFFERENT league's trade. Built on
 * `advisorFixture` and then repoints one of that team's real slots at the new player, so the
 * id is exactly as "real" (an actual roster_slots row on an actual team) as any player named
 * in this league.
 */
export async function foreignLeague(db: Db): Promise<ForeignLeague> {
  const fixture = await advisorFixture(db, "ppr", "_foreign");
  const playerId = "wr_foreign_league";
  await db.insert(players).values({ id: playerId, name: "Foreign Wideout", position: "WR", nflTeam: "LAC" }).onConflictDoNothing();
  await db
    .update(rosterSlots)
    .set({ playerId })
    .where(and(eq(rosterSlots.teamId, fixture.teamId), eq(rosterSlots.slot, "BENCH"), eq(rosterSlots.slotIndex, 0)));
  return { teamId: fixture.teamId, playerId };
}
