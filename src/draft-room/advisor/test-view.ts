/** A complete `AdvisorView` for the room's own tests, overridable field by field. Not a test
 *  file itself (no `.test.`), so several suites can share it. */
import type { Player } from "@research/domain/player";
import type { AdvisorView, Candidate, NextPick } from "@/draft-service/assistant/view";

const CANDIDATE_NAMES: Readonly<Record<string, readonly [string, string]>> = {
  rb1: ["Marcus Reed", "KC"],
  wr1: ["Andre Salas", "DAL"],
  te1: ["Cole Whitfield", "SF"],
  rb2: ["Devon Marsh", "PHI"],
  wr2: ["Tariq Bell", "MIA"],
  qb1: ["Eli Vance", "BUF"],
  rb3: ["Jalen Cross", "DET"],
  wr3: ["Noah Pruitt", "SEA"],
  te2: ["Grant Oyelaran", "BAL"],
  rb4: ["Reese Calder", "GB"],
};

/** The room's own player facts for every candidate above, keyed by id. */
export function candidatePlayers(): ReadonlyMap<string, Player> {
  return new Map(
    CANDIDATES.map((candidate) => {
      const [name, nflTeam] = CANDIDATE_NAMES[candidate.playerId]!;
      return [candidate.playerId, { id: candidate.playerId, name, position: candidate.position, nflTeam, headshotUrl: null, adp: null }] as const;
    }),
  );
}

/** Ten candidates, the card's pick (`rb1`) first, then a mix the odds table below covers. */
export const CANDIDATES: readonly Candidate[] = [
  { playerId: "rb1", position: "RB", positionRank: 3, valueOverReplacement: 41.2 },
  { playerId: "wr1", position: "WR", positionRank: 4, valueOverReplacement: 38.5 },
  { playerId: "te1", position: "TE", positionRank: 1, valueOverReplacement: 30.1 },
  { playerId: "rb2", position: "RB", positionRank: 4, valueOverReplacement: 27.7 },
  { playerId: "wr2", position: "WR", positionRank: 5, valueOverReplacement: 25.0 },
  { playerId: "qb1", position: "QB", positionRank: 2, valueOverReplacement: 22.3 },
  { playerId: "rb3", position: "RB", positionRank: 5, valueOverReplacement: 20.9 },
  { playerId: "wr3", position: "WR", positionRank: 6, valueOverReplacement: 18.2 },
  { playerId: "te2", position: "TE", positionRank: 2, valueOverReplacement: 15.4 },
  { playerId: "rb4", position: "RB", positionRank: 6, valueOverReplacement: 12.8 },
];

export function nextPick(over: Partial<NextPick> = {}): NextPick {
  return {
    playerId: "rb1",
    position: "RB",
    positionRank: 3,
    valueOverReplacement: 41.2,
    fillsSlot: "RB",
    makeItBack: { survival: 0.46, runs: 200 },
    why: "He is the last back before a 20.6 point drop, and he fills your RB slot. 2 of the 3 seats before you take a back most often in our 200 runs.",
    whyShape: "cliff:0",
    ...over,
  };
}

export function advisorView(over: Partial<AdvisorView> = {}): AdvisorView {
  return {
    pickNumber: 1,
    onTheClock: true,
    picksUntilYourTurn: 0,
    teamCount: 10,
    stamp: { computedAtPick: 1, sequence: 1 },
    runs: 200,
    pick: nextPick(),
    candidates: CANDIDATES,
    signals: { run: null, collapses: [] },
    odds: { pickNumber: 20, runs: 200, survived: { rb1: 92, wr1: 160, te1: 30, rb2: 120, wr2: 180, qb1: 199, rb3: 70, wr3: 150, te2: 40, rb4: 100 } },
    tiers: { rb1: { tier: 1, left: 2, size: 4 }, wr1: { tier: 2, left: 5, size: 6 }, te1: { tier: 1, left: 1, size: 3 } },
    ...over,
  };
}
