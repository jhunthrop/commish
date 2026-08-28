import type { ReadonlyDb } from "@/db/client";
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
  /** The raw numerators, which layer 2 divides its rates by. */
  readonly targets: number;
  readonly carries: number;
  readonly passAttempts: number;
  /** His team's totals for that week — the volume layer 3 multiplies a predicted share back up by. */
  readonly teamTargets: number;
  readonly teamCarries: number;
  readonly teamPassAttempts: number;
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
    const at = (metric: string): number => entry.metrics.get(metric) ?? 0;
    const teamTargets = at(PARTICIPATION_METRICS.teamTargets);
    const teamCarries = at(PARTICIPATION_METRICS.teamCarries);
    const teamPassAttempts = at(PARTICIPATION_METRICS.teamPassAttempts);
    rows.push({
      season: entry.season,
      week: entry.week,
      playerId: entry.playerId,
      snapShare: snapShare(at(PARTICIPATION_METRICS.offensiveSnaps), teamSnaps),
      targetShare: targetShare(at(PARTICIPATION_METRICS.targets), teamTargets),
      carryShare: carryShare(at(PARTICIPATION_METRICS.carries), teamCarries),
      passAttemptShare: passAttemptShare(at(PARTICIPATION_METRICS.passAttempts), teamPassAttempts),
      targets: at(PARTICIPATION_METRICS.targets),
      carries: at(PARTICIPATION_METRICS.carries),
      passAttempts: at(PARTICIPATION_METRICS.passAttempts),
      teamTargets,
      teamCarries,
      teamPassAttempts,
      touches: entry.metrics.has(PBP_PLAYER_METRICS.carries)
        ? {
            carries: at(PBP_PLAYER_METRICS.carries),
            targets: at(PBP_PLAYER_METRICS.targets),
            redZoneCarries: at(PBP_PLAYER_METRICS.redZoneCarries),
            redZoneTargets: at(PBP_PLAYER_METRICS.redZoneTargets),
            insideTenCarries: at(PBP_PLAYER_METRICS.insideTenCarries),
            insideTenTargets: at(PBP_PLAYER_METRICS.insideTenTargets),
            airYards: at(PBP_PLAYER_METRICS.airYards),
            airYardTargets: at(PBP_PLAYER_METRICS.airYardTargets),
          }
        : null,
      asOf: entry.asOf,
    });
  }
  return rows;
}
