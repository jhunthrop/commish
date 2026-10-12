import type { Player, Position, StatLine } from "@research/domain/player";
import { mulberry32 } from "@/lib/random/mulberry32";

export const DATASET_SEED = 20260817;
export const PLAYER_COUNT = 250;
export const SEASON_WEEKS = 17;

export interface Dataset {
  readonly players: readonly Player[];
  readonly statLines: readonly StatLine[];
}

const NFL_TEAMS = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB","HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO","NYG","NYJ","PHI","PIT","SF","SEA","TB","TEN","WAS"] as const;

const FIRST = ["Jalen","Marcus","DeShawn","Tyler","Malik","Jordan","Caleb","Xavier","Elijah","Kenny","Trey","Rashad","Bryce","Devon","Isaiah","Cam","Zach","Jaylen","Andre","Kyle","Drake","Chris","Josh","Justin","Amari"] as const;
const LAST = ["Harris","Walker","Johnson","Brooks","Reed","Carter","Mitchell","Bell","Hill","Watson","Robinson","Sanders","Cook","Green","Adams","Jenkins","Coleman","Price","Ward","Powell","Barnes","Fisher","Hayes","Perry","Long"] as const;

/** Position mix for 250 players: 30 QB, 70 RB, 80 WR, 30 TE, 20 K, 20 DEF. */
const POSITION_PLAN: readonly { readonly position: Position; readonly count: number }[] = [
  { position: "QB", count: 30 },
  { position: "RB", count: 70 },
  { position: "WR", count: 80 },
  { position: "TE", count: 30 },
  { position: "K", count: 20 },
  { position: "DEF", count: 20 },
];

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}
function int(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}
/** Chance-weighted small counts (TDs, INTs). */
function count(rand: () => number, p: number, max: number): number {
  let n = 0;
  for (let i = 0; i < max; i++) if (rand() < p) n++;
  return n;
}

/**
 * One player's line for one week, at realistic per-position magnitudes — exported (2026-09-04)
 * so `scripts/dev-seed-stat-fixtures.ts` can reuse the SAME distributions for a small, bounded
 * current-season fixture without duplicating the per-position ranges here a second time. That
 * script seeds REAL local players, never this file's own synthetic roster — only the shape of a
 * plausible week, which is exactly what this function decides and nothing else.
 */
export function statLineFor(rand: () => number, player: Player, week: number): StatLine {
  const zero: StatLine = {
    playerId: player.id, week,
    passingYards: 0, passingTouchdowns: 0, interceptions: 0,
    rushingYards: 0, rushingTouchdowns: 0,
    receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0,
    fieldGoalsMade: 0, extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
  };
  // ~6% chance of a zero line (bye/injury), except DEF which always plays.
  if (player.position !== "DEF" && rand() < 0.06) return zero;
  switch (player.position) {
    case "QB": return { ...zero, passingYards: int(rand, 150, 380), passingTouchdowns: count(rand, 0.45, 4), interceptions: count(rand, 0.3, 2), rushingYards: int(rand, 0, 45), rushingTouchdowns: count(rand, 0.12, 1), fumblesLost: count(rand, 0.06, 1) };
    case "RB": return { ...zero, rushingYards: int(rand, 20, 140), rushingTouchdowns: count(rand, 0.3, 2), receptions: int(rand, 0, 6), receivingYards: int(rand, 0, 55), receivingTouchdowns: count(rand, 0.08, 1), fumblesLost: count(rand, 0.05, 1) };
    case "WR": return { ...zero, receptions: int(rand, 1, 10), receivingYards: int(rand, 10, 140), receivingTouchdowns: count(rand, 0.28, 2), rushingYards: int(rand, 0, 12), fumblesLost: count(rand, 0.03, 1) };
    case "TE": return { ...zero, receptions: int(rand, 0, 8), receivingYards: int(rand, 0, 95), receivingTouchdowns: count(rand, 0.22, 2), fumblesLost: count(rand, 0.03, 1) };
    case "K":  return { ...zero, fieldGoalsMade: int(rand, 0, 4), extraPointsMade: int(rand, 0, 5) };
    // A defense that plays always registers something; floor sacks so no DEF line is all-zero.
    case "DEF": return { ...zero, sacks: Math.max(1, int(rand, 0, 5)), defensiveInterceptions: count(rand, 0.35, 3), defensiveTouchdowns: count(rand, 0.1, 1) };
  }
}

export function generateDataset(seed: number): Dataset {
  const rand = mulberry32(seed);
  const players: Player[] = [];
  let n = 0;
  for (const { position, count: c } of POSITION_PLAN) {
    for (let i = 0; i < c; i++) {
      n++;
      const id = `player_${String(n).padStart(3, "0")}`;
      const nflTeam = pick(rand, NFL_TEAMS);
      const name = position === "DEF" ? `${nflTeam} Defense` : `${pick(rand, FIRST)} ${pick(rand, LAST)}`;
      // The mock dataset ships no photos at all (founder directive 2026-08-26): every mock player
      // exercises the SAME `Avatar` initials fallback a real player with no ESPN photo gets,
      // rather than a fabricated data URI nothing in production ever produces.
      // `adp: null` is the only honest value the GENERATOR can write: the mock's ADP is derived
      // from the dataset's own season totals at read time (`createMockStatsProvider`'s
      // `listAdpEntries`), never stored beside it, so storing a number here would be a second
      // copy of that fact free to disagree with the first. Written rather than omitted so the
      // committed `dataset.json` parses straight back to a `Dataset` with no widening.
      players.push({ id, name, position, nflTeam, headshotUrl: null, adp: null });
    }
  }
  const statLines: StatLine[] = [];
  for (let week = 1; week <= SEASON_WEEKS; week++) {
    for (const p of players) statLines.push(statLineFor(rand, p, week));
  }
  return { players, statLines };
}
