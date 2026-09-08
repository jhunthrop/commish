import type { TeamMetricRow } from "@/capsules/facts/team-context";
import { PBP_METRICS } from "@/projections/nflverse/pbp";
import type { RankedFigure, TeamOffenseProfile } from "./contract";

/**
 * THE OFFENCE'S FINGERPRINT WITH ITS PLACE AMONG THE CLUBS (coordinator's section 3). Pure over
 * every club's prior-season team-week rows at once, because a rank is a fact about the whole
 * league and cannot be computed from one team's rows.
 *
 * THE MEAN OF THE WEEKS THE STORE HOLDS, the identical rule `teamContextFor` keeps: a missing week
 * shortens the average rather than zeroing into it. `of` is the number of clubs with a real reading
 * for that metric, never a hard-coded 32: a half-ingested season ranks among the clubs it holds
 * and says so.
 *
 * DIRECTION IS STATED PER METRIC, not judged: pace ranks fastest first because "rank 1" of a
 * seconds-per-play figure is the club that snaps soonest; the two pass-rate figures rank highest
 * first. Neither is a verdict about the offence; the page prints the direction beside the rank.
 */

type Direction = "ascending" | "descending";

interface RankedMetric {
  readonly key: keyof Pick<TeamOffenseProfile, "pace" | "passRate" | "passRateOverExpected">;
  readonly metric: string;
  readonly direction: Direction;
  readonly digits: number;
}

const RANKED_METRICS: readonly RankedMetric[] = [
  { key: "pace", metric: PBP_METRICS.paceSecondsPerPlay, direction: "ascending", digits: 1 },
  { key: "passRate", metric: PBP_METRICS.passRate, direction: "descending", digits: 3 },
  { key: "passRateOverExpected", metric: PBP_METRICS.passRateOverExpected, direction: "descending", digits: 1 },
];

function meanOf(rows: readonly TeamMetricRow[], metric: string, digits: number): number | null {
  const values = rows.filter((row) => row.metric === metric).map((row) => row.value);
  if (values.length === 0) return null;
  const factor = 10 ** digits;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * factor) / factor;
}

function sumOf(rows: readonly TeamMetricRow[], metric: string): number | null {
  const values = rows.filter((row) => row.metric === metric).map((row) => row.value);
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
}

/** Every club's mean for one metric, ranked in the metric's own direction. Ties share a rank
 *  (1, 2, 2, 4), so two clubs with the same mean never disagree about who is ahead. */
function rankedMeans(rowsByTeam: ReadonlyMap<string, readonly TeamMetricRow[]>, metric: RankedMetric): ReadonlyMap<string, RankedFigure> {
  const means: { readonly team: string; readonly value: number }[] = [];
  for (const [team, rows] of rowsByTeam) {
    const value = meanOf(rows, metric.metric, metric.digits);
    if (value !== null) means.push({ team, value });
  }
  const sorted = [...means].sort((a, b) => (metric.direction === "ascending" ? a.value - b.value : b.value - a.value));
  const out = new Map<string, RankedFigure>();
  for (const entry of sorted) {
    const ahead = sorted.findIndex((other) => other.value === entry.value);
    out.set(entry.team, { value: entry.value, rank: ahead + 1, of: sorted.length });
  }
  return out;
}

/** One profile per club with at least one figure, from every club's rows for the season. */
export function offenseProfilesFor(season: number, rowsByTeam: ReadonlyMap<string, readonly TeamMetricRow[]>): ReadonlyMap<string, TeamOffenseProfile> {
  const ranked = new Map(RANKED_METRICS.map((metric) => [metric.key, rankedMeans(rowsByTeam, metric)] as const));
  const out = new Map<string, TeamOffenseProfile>();
  for (const [team, rows] of rowsByTeam) {
    const profile: TeamOffenseProfile = {
      season,
      pace: ranked.get("pace")?.get(team) ?? null,
      passRate: ranked.get("passRate")?.get(team) ?? null,
      passRateOverExpected: ranked.get("passRateOverExpected")?.get(team) ?? null,
      neutralPlays: sumOf(rows, PBP_METRICS.neutralPlays),
    };
    if (profile.pace !== null || profile.passRate !== null || profile.passRateOverExpected !== null) out.set(team, profile);
  }
  return out;
}
