import type { PlayerWeekObservation } from "../store";
import { NFLVERSE_CONFIG } from "./config";
import type { CsvRow } from "./csv";

/**
 * PLAY-BY-PLAY, REDUCED TO PLAYER-WEEK FACTS — the half of the file `pbp.ts` deliberately does not
 * read, and the one that separates teammates.
 *
 * Phase 3 measured four context groups and recorded the lesson in
 * `docs/research/2026-08-27-model-v2.md`: three of them were TEAM-LEVEL multipliers, so every player
 * on an offence moved together and almost nothing in a ranking was reordered. The pooled rank
 * correlation did not move. Its closing prediction was that the features which WILL move it are the
 * ones that separate a man from his own teammates, and it named red-zone share first.
 *
 * That is what this file produces, and it produces it from a file already being streamed. Two backs
 * can split carries evenly and only one of them scores, because only one of them is on the field at
 * the two-yard line; two receivers can take the same target share and only one runs routes past the
 * sticks. Neither difference is visible anywhere in `stats_player_week.csv`, which reports what a
 * man DID rather than where he was standing when he was given the chance.
 *
 * COUNTS, NEVER RATES. Everything here is a numerator with its own denominator stored beside it, and
 * the division happens in the feature layer. The store cannot express "no evidence" in a rate — a
 * red-zone rate of zero over one carry and one over forty carries are the same number — so the
 * shrinkage that makes those two different has to happen where the counts are still visible.
 *
 * THE DENOMINATORS ARE THIS FILE'S OWN. `pbp_carries` and `pbp_targets` are stored even though the
 * weekly stats release already carries a `carries` and a `targets` column, because a ratio built
 * from two feeds' definitions is a ratio nobody can check: nflverse's weekly `targets` counts a
 * throwaway with no identified receiver and this stream cannot, so a red-zone share taken against
 * the other file's denominator would be biased low by a different amount for every player. Both
 * halves of every ratio come from the same pass over the same plays.
 */

export const PBP_PLAYER_SOURCE = "nflverse_pbp_player";

export const PBP_PLAYER_METRICS = {
  /** Designed carries this stream attributed to this man. The denominator of every carry ratio. */
  carries: "pbp_carries",
  /** Passes thrown at him, by the same attribution. The denominator of every target ratio. */
  targets: "pbp_targets",
  /** Carries snapped from inside the opponent's twenty. */
  redZoneCarries: "red_zone_carries",
  redZoneTargets: "red_zone_targets",
  /**
   * Inside the TEN, stored separately rather than folded into the red zone. The twenty-yard line is
   * a convention; the ten is where a touchdown becomes the likely outcome of a single play, and a
   * back who gets one and not the other is a different player from one who gets both.
   */
  insideTenCarries: "inside_ten_carries",
  insideTenTargets: "inside_ten_targets",
  /** Total intended air yards over the targets that carried a readable one. */
  airYards: "air_yards",
  /**
   * How many targets the air-yard total rests on. Not the same as `pbp_targets`: nflverse leaves
   * `air_yards` blank on a handful of plays, and dividing by the wrong count would read a
   * field-stretcher as a checkdown back.
   */
  airYardTargets: "air_yard_targets",
} as const;

/** The columns this aggregation adds to the stream `pbp.ts` already asks for. */
export const PBP_PLAYER_COLUMNS: readonly string[] = [
  "yardline_100",
  "rusher_player_id",
  "receiver_player_id",
  "air_yards",
  "two_point_attempt",
];

/**
 * The two distances a touch is counted at, as yards from the opponent's goal line.
 *
 * Conventional, and named here rather than written into a comparison so that a reviewer can
 * disagree with the convention without reading a function.
 */
export const SCORING_RANGE = { redZone: 20, insideTen: 10 } as const;

/** One player's accumulated touches for one week, before any division. */
interface PlayerWeekTally {
  season: number;
  week: number;
  playerId: string;
  carries: number;
  targets: number;
  redZoneCarries: number;
  redZoneTargets: number;
  insideTenCarries: number;
  insideTenTargets: number;
  airYards: number;
  airYardTargets: number;
  gameDate: string;
}

/** The player-week counts the store holds. Every field is a count; nothing here is a rate. */
export interface PlayerWeekTouches {
  readonly season: number;
  readonly week: number;
  readonly playerId: string;
  readonly carries: number;
  readonly targets: number;
  readonly redZoneCarries: number;
  readonly redZoneTargets: number;
  readonly insideTenCarries: number;
  readonly insideTenTargets: number;
  readonly airYards: number;
  readonly airYardTargets: number;
  /** `YYYY-MM-DD` of the game, which the caller turns into an `as_of`. */
  readonly gameDate: string;
}

function flag(row: CsvRow, column: string): boolean {
  return row[column] === "1";
}

function numberOrNull(row: CsvRow, column: string): number | null {
  const raw = row[column];
  if (raw === undefined || raw.trim() === "" || raw === "NA") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function identifier(row: CsvRow, column: string): string | null {
  const raw = row[column];
  if (raw === undefined || raw.trim() === "" || raw === "NA") return null;
  return raw;
}

/**
 * Accumulates streamed plays into one tally per player-week. Feed it every row; it keeps nothing
 * else.
 *
 * The ids nflverse writes into `rusher_player_id` and `receiver_player_id` are GSIS ids, which is
 * the same identity `players.ts` resolves the participation feed onto and the same one the store is
 * keyed by. So this joins on an id and never on a name — the defect Phase 2 measured at ten points
 * of resolution per season going backwards, and the reason nothing here consults the crosswalk.
 */
export class PlayerPlayAggregator {
  private readonly tallies = new Map<string, PlayerWeekTally>();

  private tallyFor(season: number, week: number, playerId: string, gameDate: string): PlayerWeekTally {
    const key = `${season}|${week}|${playerId}`;
    const existing = this.tallies.get(key);
    if (existing !== undefined) return existing;
    const fresh: PlayerWeekTally = {
      season,
      week,
      playerId,
      carries: 0,
      targets: 0,
      redZoneCarries: 0,
      redZoneTargets: 0,
      insideTenCarries: 0,
      insideTenTargets: 0,
      airYards: 0,
      airYardTargets: 0,
      gameDate,
    };
    this.tallies.set(key, fresh);
    return fresh;
  }

  add(row: CsvRow): void {
    if (row.season_type !== NFLVERSE_CONFIG.seasonType) return;
    const season = numberOrNull(row, "season");
    const week = numberOrNull(row, "week");
    if (season === null || week === null) return;
    // A two-point conversion is not a carry or a target in any fantasy scoring this product
    // supports, and every one of them is snapped from inside the two. Counting them would make the
    // inside-ten numbers a measure of how often an offence went for two.
    if (flag(row, "two_point_attempt")) return;

    const gameDate = row.game_date ?? "";
    const yardline = numberOrNull(row, "yardline_100");
    const inRedZone = yardline !== null && yardline <= SCORING_RANGE.redZone;
    const insideTen = yardline !== null && yardline <= SCORING_RANGE.insideTen;

    // A DESIGNED run, on exactly the definition `pbp.ts` uses for the line composite: never a
    // scramble (a pass play that broke down) and never a kneel (the clock). The two files must agree
    // about what a carry is or a red-zone share and a stuffed rate would be taken over different
    // populations of plays.
    const rusher = identifier(row, "rusher_player_id");
    if (rusher !== null && flag(row, "rush_attempt") && !flag(row, "qb_scramble") && !flag(row, "qb_kneel")) {
      const tally = this.tallyFor(season, week, rusher, gameDate);
      tally.carries += 1;
      if (inRedZone) tally.redZoneCarries += 1;
      if (insideTen) tally.insideTenCarries += 1;
    }

    // A TARGET is a pass with an identified intended receiver. A sack carries `play_type = "pass"`
    // and no receiver, so requiring the id excludes it without a second flag to keep in step.
    const receiver = identifier(row, "receiver_player_id");
    if (receiver !== null && row.play_type === "pass") {
      const tally = this.tallyFor(season, week, receiver, gameDate);
      tally.targets += 1;
      if (inRedZone) tally.redZoneTargets += 1;
      if (insideTen) tally.insideTenTargets += 1;
      const airYards = numberOrNull(row, "air_yards");
      if (airYards !== null) {
        tally.airYards += airYards;
        tally.airYardTargets += 1;
      }
    }
  }

  /** The finished tallies, sorted so a store write is deterministic. */
  touches(): readonly PlayerWeekTouches[] {
    return [...this.tallies.values()]
      .sort((a, b) => a.season - b.season || a.week - b.week || a.playerId.localeCompare(b.playerId))
      .map((tally) => ({ ...tally }));
  }
}

/**
 * Flattens touches into player-week observations, stamped when the game they describe finished.
 *
 * EVERY COUNT IS EMITTED, ZEROS INCLUDED, and that is the opposite of what `pbp.ts` does with its
 * rates — for a reason worth stating. A rate over no opportunities is genuinely unknown, so it emits
 * nothing; a count is known exactly whenever the player appears in this stream at all. A receiver
 * with eight targets and none inside the twenty really did have zero red-zone targets, and that is
 * the fact the whole feature turns on. What "no evidence" looks like here is the player-week being
 * ABSENT, which is what happens to a man who touched the ball not once.
 */
export function playerTouchObservations(
  touches: readonly PlayerWeekTouches[],
  asOfFor: (touch: PlayerWeekTouches) => Date,
  /** GSIS ids the store knows about. A play attributed to anybody else is reported, never stored. */
  known: ReadonlySet<string>,
): { readonly observations: readonly PlayerWeekObservation[]; readonly unknownPlayers: readonly string[] } {
  const unknown = new Set<string>();
  const observations: PlayerWeekObservation[] = [];
  for (const touch of touches) {
    if (!known.has(touch.playerId)) {
      // Named and counted rather than silently dropped, following `players.ts`: an absent player is
      // indistinguishable from one who did not play, and a feed that quietly lost eight per cent of
      // its backs would look like a lot of healthy scratches.
      unknown.add(touch.playerId);
      continue;
    }
    const stamp = {
      season: touch.season,
      week: touch.week,
      playerId: touch.playerId,
      source: PBP_PLAYER_SOURCE,
      asOf: asOfFor(touch),
    };
    const pairs: readonly (readonly [string, number])[] = [
      [PBP_PLAYER_METRICS.carries, touch.carries],
      [PBP_PLAYER_METRICS.targets, touch.targets],
      [PBP_PLAYER_METRICS.redZoneCarries, touch.redZoneCarries],
      [PBP_PLAYER_METRICS.redZoneTargets, touch.redZoneTargets],
      [PBP_PLAYER_METRICS.insideTenCarries, touch.insideTenCarries],
      [PBP_PLAYER_METRICS.insideTenTargets, touch.insideTenTargets],
      [PBP_PLAYER_METRICS.airYards, touch.airYards],
      [PBP_PLAYER_METRICS.airYardTargets, touch.airYardTargets],
    ];
    for (const [metric, value] of pairs) observations.push({ ...stamp, metric, value });
  }
  return { observations, unknownPlayers: [...unknown].sort() };
}
