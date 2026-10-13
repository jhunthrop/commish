import type { ReadonlyDb } from "@research-ts/db/client";
import type { Position } from "@research-ts/domain/player";
import { carryShare, passAttemptShare, snapShare, targetShare } from "./features/opportunity";
import { PARTICIPATION_METRICS } from "./nflverse/map";
import { PBP_PLAYER_METRICS } from "./nflverse/pbp-players";
import { observationsAsOf, type ObservationQuery } from "./store";

/**
 * READING OPPORTUNITY BACK OUT OF THE POINT-IN-TIME STORE — the layer-1 counterpart to `lines.ts`.
 *
 * `lines.ts` reassembles what a player DID; this reassembles what he was GIVEN. The engine spec
 * calls opportunity the keystone for a measured reason: volume is stable and efficiency is mostly
 * noise, so a receiver's target share barely moves week to week while his catch rate swings wildly.
 * Predicting the share is therefore the part of the problem that can actually be predicted.
 *
 * It goes through `observationsAsOf` and nothing else, exactly as `lines.ts` does, so a week's
 * usage is structurally unable to include a row stamped after the replay moment. A second read path
 * would be a second place for leakage, and leakage does not announce itself — it looks like a very
 * good model.
 *
 * NULL IS NOT ZERO here, following `features/opportunity.ts`' own discipline. A player whose team
 * attempted no passes has no target share — not a share of zero — and averaging that zero in would
 * quietly halve a receiver's projected share for the crime of having been in a run-heavy blowout.
 */

/**
 * WHERE a player's touches came, for one week, from the play-by-play.
 *
 * A separate group rather than eight more fields on `PlayerWeekUsage`, and nullable as a whole,
 * because the whole group has exactly one presence condition: either the play-by-play saw this man
 * touch the ball that week or it did not. Spreading it across eight independently-nullable fields
 * would invite a caller to find six of them and reason about the seventh's absence, which for counts
 * that share a denominator is never a sensible thing to do.
 *
 * COUNTS, not rates, and both halves of every ratio taken from the same feed — see `pbp-players.ts`
 * for why a red-zone share against the weekly file's target count would be biased differently for
 * every player.
 */
export interface PlayerWeekTouches {
  /** This feed's own carry and target totals. The denominators, never the other file's. */
  readonly carries: number;
  readonly targets: number;
  readonly redZoneCarries: number;
  readonly redZoneTargets: number;
  readonly insideTenCarries: number;
  readonly insideTenTargets: number;
  readonly airYards: number;
  /** Targets the air-yard sum rests on, which is not always the target count. */
  readonly airYardTargets: number;
}

/** One player's opportunity in one week, as it was known at a moment. */
export interface PlayerWeekUsage {
  readonly season: number;
  readonly week: number;
  readonly playerId: string;
  /** `null` where the denominator was zero — no evidence, not no opportunity. */
  readonly snapShare: number | null;
  readonly targetShare: number | null;
  readonly carryShare: number | null;
  /** A quarterback's share of his offence's throws. Near 1 for a starter, and that is the point:
   *  the interesting quantity for a QB is whether he is THE quarterback, not by how much. */
  readonly passAttemptShare: number | null;
  /**
   * The raw numerators, which layer 2 divides its rates by, and `null` where the weekly stats file
   * this season never arrived — see `WITHHELD_IS_NULL` below for why absence is spelled out rather
   * than collapsed to zero.
   */
  readonly targets: number | null;
  readonly carries: number | null;
  readonly passAttempts: number | null;
  /** His team's totals for that week — the volume layer 3 multiplies a predicted share back up by.
   *  Nullable for the same reason, and from the same absence. */
  readonly teamTargets: number | null;
  readonly teamCarries: number | null;
  readonly teamPassAttempts: number | null;
  /**
   * Where his touches came from, or `null` where the play-by-play has nothing for him this week.
   *
   * `null` rather than a group of zeros, and the distinction is the feature: a back with no
   * red-zone carries in a week he took fifteen is a real and damning fact about him, while a back
   * the play-by-play never saw is a week we know nothing about. Averaging the second in as the first
   * would read every un-ingested season as a league of players who never reach the goal line.
   */
  readonly touches: PlayerWeekTouches | null;
  readonly asOf: Date;
}

/** Every metric this reader consumes. A name not on this list is somebody else's fact. */
const USAGE_METRICS: readonly string[] = [
  PARTICIPATION_METRICS.offensiveSnaps,
  PARTICIPATION_METRICS.teamOffensiveSnaps,
  PARTICIPATION_METRICS.targets,
  PARTICIPATION_METRICS.teamTargets,
  PARTICIPATION_METRICS.carries,
  PARTICIPATION_METRICS.teamCarries,
  PARTICIPATION_METRICS.passAttempts,
  PARTICIPATION_METRICS.teamPassAttempts,
];

/**
 * The play-by-play's own player-week counts, read through the same gate and on the same row.
 *
 * Listed separately from `USAGE_METRICS` because presence means something different: a usage metric
 * is expected on every player-week and its absence is a gap, while these arrive only for the weeks
 * the play-by-play ingestion has been run for. `pbp_carries` is the sentinel — it is the one metric
 * this source writes for every player-week it saw at all, so its presence is what makes the group
 * present.
 */
const TOUCH_METRICS: readonly string[] = Object.values(PBP_PLAYER_METRICS);

const USAGE_METRIC_SET = new Set([...USAGE_METRICS, ...TOUCH_METRICS]);

/**
 * Every player's opportunity for a week (or a span of them), as it was known at `asOf`.
 *
 * Reads across BOTH nflverse sources rather than filtering to one, because a share needs its
 * numerator and denominator together and they arrive on different files: snaps from the snap-counts
 * release, targets and carries from the weekly stats. A source filter here would silently produce a
 * snap share with no target share beside it, which reads as "he was never thrown to".
 *
 * A player-week with no snap row is absent entirely rather than present with zeros, and that
 * distinction is the whole reason the reader is careful: an inactive player did not have a zero
 * percent target share, he had no week at all, and averaging his absence in as a zero is how a
 * returning starter's projection quietly collapses.
 */
export async function usageAsOf(
  db: ReadonlyDb,
  query: Omit<ObservationQuery, "source">,
): Promise<readonly PlayerWeekUsage[]> {
  const observations = await observationsAsOf(db, query);

  const values = new Map<string, { season: number; week: number; playerId: string; asOf: Date; metrics: Map<string, number> }>();
  for (const observation of observations) {
    if (!USAGE_METRIC_SET.has(observation.metric)) continue;
    const key = `${observation.week}|${observation.playerId}`;
    const existing = values.get(key);
    if (existing === undefined) {
      values.set(key, {
        season: observation.season,
        week: observation.week,
        playerId: observation.playerId,
        asOf: observation.asOf,
        metrics: new Map([[observation.metric, observation.value]]),
      });
      continue;
    }
    existing.metrics.set(observation.metric, observation.value);
    if (observation.asOf > existing.asOf) existing.asOf = observation.asOf;
  }

  const rows: PlayerWeekUsage[] = [];
  for (const entry of values.values()) {
    // A row without the snap denominator is not a usable week: every share it could offer would be
    // taken against a number we do not have. Skipping it keeps "absent" meaning absent.
    const teamSnaps = entry.metrics.get(PARTICIPATION_METRICS.teamOffensiveSnaps);
    if (teamSnaps === undefined) continue;
    const at = (metric: string): number | null => entry.metrics.get(metric) ?? null;
    const snaps = at(PARTICIPATION_METRICS.offensiveSnaps);
    const targets = at(PARTICIPATION_METRICS.targets);
    const carries = at(PARTICIPATION_METRICS.carries);
    const passAttempts = at(PARTICIPATION_METRICS.passAttempts);
    const teamTargets = at(PARTICIPATION_METRICS.teamTargets);
    const teamCarries = at(PARTICIPATION_METRICS.teamCarries);
    const teamPassAttempts = at(PARTICIPATION_METRICS.teamPassAttempts);
    rows.push({
      season: entry.season,
      week: entry.week,
      playerId: entry.playerId,
      snapShare: shareOrNull(snapShare, snaps, teamSnaps),
      targetShare: shareOrNull(targetShare, targets, teamTargets),
      carryShare: shareOrNull(carryShare, carries, teamCarries),
      passAttemptShare: shareOrNull(passAttemptShare, passAttempts, teamPassAttempts),
      targets,
      carries,
      passAttempts,
      teamTargets,
      teamCarries,
      teamPassAttempts,
      touches: touchesOf(entry.metrics),
      asOf: entry.asOf,
    });
  }
  return rows;
}

/**
 * WITHHELD IS NULL, NOT ZERO — the seam the final fix round closed (whole-branch review, M1).
 *
 * This reader used to take every participation metric through `?? 0`, which reintroduced at READ
 * time exactly the false zeros `scripts/projection-backfill.ts` refuses to WRITE ("withheld rather
 * than written as false zeros"). For a fully published season the eight participation metrics always
 * co-arrive — verified against the live store: on every season from 2013 to 2024 except the gap
 * years, zero player-weeks carry the snap denominator without all six weekly counts beside it — so
 * the two spellings are numerically identical there and this change moves nothing that was ever
 * measured. On a GAP season (2019, 2025) the weekly stats file does not exist at all and every one
 * of the six is missing on every row, which is where "zero" became a fact nobody observed: a target
 * share of exactly zero for all 759 players, averaged into a live board as evidence.
 *
 * Absence now travels to each consumer's OWN absence handling, all of which predates this change:
 * `share()` returns `null` for a missing half, `predictVolume` already reads a zero team volume as
 * "no evidence" in so many words, and `predictRates` already answers "no opportunities" with the
 * position prior rather than a rate of zero.
 */
function shareOrNull(
  of: (part: number, whole: number) => number | null,
  part: number | null,
  whole: number | null,
): number | null {
  return part === null || whole === null ? null : of(part, whole);
}

/**
 * The play-by-play group, all eight members or none.
 *
 * `pbp_carries` is the sentinel (see `TOUCH_METRICS`), and the ingestion writes all eight metrics
 * for every tally it emits — so a group present but incomplete is a corrupt store, not a season
 * shape. Verified live: 72,420 player-week groups, zero partial. It THROWS rather than filling the
 * hole with a zero, because a zero here is a claim about where a man's touches came from.
 */
function touchesOf(metrics: ReadonlyMap<string, number>): PlayerWeekTouches | null {
  if (!metrics.has(PBP_PLAYER_METRICS.carries)) return null;
  const member = (metric: string): number => {
    const value = metrics.get(metric);
    if (value === undefined) {
      throw new Error(
        `A play-by-play touch row carries ${PBP_PLAYER_METRICS.carries} but not ${metric}; the group is written all-or-nothing and a zero here would invent a fact about where this player's touches came from.`,
      );
    }
    return value;
  };
  return {
    carries: member(PBP_PLAYER_METRICS.carries),
    targets: member(PBP_PLAYER_METRICS.targets),
    redZoneCarries: member(PBP_PLAYER_METRICS.redZoneCarries),
    redZoneTargets: member(PBP_PLAYER_METRICS.redZoneTargets),
    insideTenCarries: member(PBP_PLAYER_METRICS.insideTenCarries),
    insideTenTargets: member(PBP_PLAYER_METRICS.insideTenTargets),
    airYards: member(PBP_PLAYER_METRICS.airYards),
    airYardTargets: member(PBP_PLAYER_METRICS.airYardTargets),
  };
}

/**
 * THE HONEST SUBSTITUTE — the play-by-play's own touch counts standing in for the opportunity counts
 * a gap season's missing weekly stats file never carried.
 *
 * PURE, and applied by the CALLER rather than folded into `usageAsOf`, for the same reason
 * `statLinesAsOfForMeasurement` is a wrapper rather than a change to `statLinesAsOf`: every reader
 * that does not ask for it keeps reading exactly what it always read. `preseason/source.ts`'s
 * `loadPreseason` applies it on the LIVE arm alone, for a prior season in
 * `LIVE_ADMITTED_DERIVED_SEASONS`, beside the matching derived-history read — so a replay board and
 * the laws harness are untouched by construction, not by measurement.
 *
 * WHAT IS SUBSTITUTED, AND WHAT IS NOT. Measured on 2024, the one season that carries both feeds:
 *   - `targets`: pbp 10,219 against the weekly file's 10,216 for WR (ratio 1.0003), 1.0070 for RB,
 *     1.0003 for TE. The two definitions differ only by a throwaway with no identified receiver, and
 *     the derived stat line's receptions and receiving yards are tallied over exactly the same
 *     identified-receiver pass plays — numerator and denominator from one pass over one stream, the
 *     discipline `pbp-players.ts` already states for its own ratios.
 *   - `carries`, EXCEPT FOR A QUARTERBACK: RB 1.0013, TE 1.0000, WR 0.9953 — but QB 0.3771, because
 *     `pbp-players.ts` counts DESIGNED runs and a quarterback's scrambles and kneels are most of his
 *     rush attempts, while the derived stat line counts scrambles as the rushing attempts they are.
 *     Substituting there would divide a quarterback's real rushing yards by a third of his real
 *     carries and read every scrambler as a 10-yards-per-carry back. His rushing rates stay absent.
 *   - `passAttempts`: NOTHING is substituted. The play-by-play player feed carries no attempt count,
 *     so a quarterback's passing rates on a gap season fall to the position prior, which is what "no
 *     evidence" is supposed to mean.
 *   - The three TEAM totals: NOTHING is substituted. A team total cannot be reconstructed from a
 *     player-level feed, so the shares stay `null` and `predictShare` regresses to the role's own
 *     slope against the MEASURED snap share, exactly as it does for any player with no share history.
 */
export function admitTouchesAsOpportunity(
  rows: readonly PlayerWeekUsage[],
  positions: ReadonlyMap<string, Position>,
): readonly PlayerWeekUsage[] {
  return rows.map((row) => {
    if (row.touches === null) return row;
    const targets = row.targets ?? row.touches.targets;
    const carries = row.carries ?? (positions.get(row.playerId) === "QB" ? null : row.touches.carries);
    if (targets === row.targets && carries === row.carries) return row;
    return { ...row, targets, carries };
  });
}
