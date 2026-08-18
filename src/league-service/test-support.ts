import type { Db } from "@/db/client";
import { players, rosterSlots, teams, users } from "@/db/schema";
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
 * Two teams, a legal starting QB/RB each, two bench spots, and a two-week schedule. Both
 * lineup test files build off this exact roster shape so a lineup swap ("start the bench QB
 * and RB") means the same thing in both places.
 */
export async function twoTeamLeague(db: Db) {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Duel", format: "snake", teamCount: 2, scoringPreset: "ppr", auctionBudget: null,
    rosterSlots: SLOTS, commissionerUserId: "u1", teamName: "Team One",
  });
  if (!created.ok) throw new Error(created.reason);
  await db.insert(teams).values({ id: "team_2", leagueId: created.leagueId, userId: "u2", name: "Team Two" });
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
  await db.transaction((tx) => writeSchedule(tx, { leagueId: created.leagueId, teamIds: [created.teamId, "team_2"], weeks: 2 }));
  return created;
}

/** Swaps the starting QB/RB for their bench counterparts — the one "legal edit" both files exercise. */
export const validSwap = [
  { slot: "QB" as const, slotIndex: 0, playerId: "qb2" },
  { slot: "RB" as const, slotIndex: 0, playerId: "rb1" },
  { slot: "BENCH" as const, slotIndex: 0, playerId: "qb1" },
  { slot: "BENCH" as const, slotIndex: 1, playerId: "rb2" },
];
