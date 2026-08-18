import type { Db } from "@/db/client";
import type { ScoringPresetName } from "@/domain/scoring";
import { players, playerStatLines, rosterSlots, teams, users } from "@/db/schema";
import { createLeague } from "@/league-service/creation";
import { writeSchedule } from "@/league-service/schedule";

const clock = { now: () => "2026-08-18T12:00:00.000Z" };

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
  const newId = () => `id${idSuffix}_${++sequence}`;

  await db.insert(users).values([
    { id: commissioner, email: `${commissioner}@test.local`, displayName: "Alex Rivera" },
    { id: rival, email: `${rival}@test.local`, displayName: "Jordan Lee" },
  ]);

  const created = await createLeague({ db, clock, newId }, {
    name: "Sunday Money",
    format: "snake",
    teamCount: 2,
    scoringPreset,
    auctionBudget: null,
    rosterSlots: ADVISOR_SLOTS,
    commissionerUserId: commissioner,
    teamName: "Bay Bandits",
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
