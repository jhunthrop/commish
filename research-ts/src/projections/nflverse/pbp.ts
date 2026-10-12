import type { TeamWeekObservation } from "../team-store";
import { NFLVERSE_CONFIG } from "./config";
import type { CsvRow } from "./csv";

/**
 * PLAY-BY-PLAY, REDUCED TO TEAM-WEEK FACTS AS IT STREAMS.
 *
 * This is the file the derived offensive line composite and the scheme table are made of, and it is
 * a hundred megabytes a season across three hundred and seventy-two columns. Nothing here ever
 * holds a season of plays: the client streams the fifteen columns named below, this accumulates one
 * small record per team-week, and the plays are discarded as they arrive. A five-season backfill is
 * therefore bounded by download time and not by memory.
 *
 * WHY DERIVE THESE RATHER THAN LICENSE THEM. The founder ruled on 2026-08-27 that PFF grades are
 * development-time calibration only and never a runtime dependency — no live scrape to break during
 * draft week. So the line composite is ours: adjusted line yards, stuffed rate and sack rate
 * allowed come from here, and continuity comes from snap participation we already ingest. The
 * arithmetic is public and every constant in it is named.
 *
 * PASS RATE OVER EXPECTED IS NOT RECOMPUTED. nflfastR publishes `xpass` and `pass_oe` in this very
 * file, fitted on two decades of plays. Re-deriving a worse expected-pass model from the same rows
 * to avoid depending on a column would be pride, not engineering — and the spec names nflverse's
 * derived models as a source we take.
 */

export const PBP_SOURCE = "nflverse_pbp";

export const PBP_METRICS = {
  /**
   * Yards per designed carry, ATTRIBUTED TO THE LINE rather than to the back, by the Football
   * Outsiders weighting: losses count 120%, the first three yards count in full, the next five
   * count half, and everything past nine counts nothing. The shape encodes the actual division of
   * labour — a stuff is the line's fault, a fifty-yard run is the back's — and it is what makes
   * this a line measurement rather than a rushing-offence measurement.
   */
  adjustedLineYards: "line_adjusted_line_yards",
  /** Designed carries stopped at or behind the line. The most direct read on push at the point of attack. */
  stuffedRate: "line_stuffed_rate",
  /** Sacks per dropback. Partly the quarterback's own, which the composite's weighting accounts for. */
  sackRateAllowed: "line_sack_rate_allowed",
  /** Situation-neutral seconds per offensive play — the numeric half of a scheme's fingerprint. */
  paceSecondsPerPlay: "pace_seconds_per_play",
  /** Situation-neutral share of plays that were passes. The other half. */
  passRate: "pass_rate",
  /** nflfastR's own: pass rate minus the rate the down, distance and score suggested, in points. */
  passRateOverExpected: "pass_rate_over_expected",
  /** How many situation-neutral plays the three numbers above rest on. A confidence, not a feature. */
  neutralPlays: "neutral_plays",
  /** Designed carries the line metrics rest on. Same purpose. */
  designedRushes: "designed_rushes",
  /** Dropbacks the sack rate rests on. */
  dropbacks: "dropbacks",
  /**
   * WHAT A DEFENCE ALLOWED, keyed to the DEFENCE rather than to the offence that gained it. The raw
   * material of the opponent adjustment: a defence's own numbers mean nothing until the offences
   * that produced them are divided out, and that division needs the raw halves stored separately.
   */
  passYardsAllowedPerDropback: "defence_pass_yards_allowed_per_dropback",
  rushYardsAllowedPerCarry: "defence_rush_yards_allowed_per_carry",
  dropbacksFaced: "defence_dropbacks_faced",
  carriesFaced: "defence_carries_faced",
} as const;

/** Exactly the columns the aggregation reads. A shorter list is a faster stream and a smaller heap. */
export const PBP_COLUMNS: readonly string[] = [
  "season",
  "week",
  "season_type",
  "posteam",
  "defteam",
  "game_id",
  "game_date",
  "play_type",
  "rush_attempt",
  "qb_scramble",
  "qb_kneel",
  "qb_spike",
  "qb_dropback",
  "sack",
  "yards_gained",
  "game_seconds_remaining",
  "half_seconds_remaining",
  "qtr",
  "wp",
  "fixed_drive",
  "pass_oe",
];

/**
 * The window a play must fall in to count as SITUATION NEUTRAL.
 *
 * Pace and pass rate are meaningless without one. A team trailing by three scores in the fourth
 * quarter throws on every down and snaps the ball every twenty seconds, and averaging those plays
 * in measures the scoreboard rather than the scheme — so the offence that lost most would look like
 * the fastest in the league. Win probability between a fifth and four fifths, outside the two-minute
 * drill, in regulation, is the conventional window and the one these numbers mean.
 */
export const NEUTRAL_WINDOW = {
  minWinProbability: 0.2,
  maxWinProbability: 0.8,
  /** Inside two minutes of either half the clock, not the coordinator, is calling the tempo. */
  minHalfSecondsRemaining: 120,
  lastRegulationQuarter: 4,
  /**
   * The longest gap between two plays that counts as tempo rather than as a stoppage. Beyond this
   * something happened that no offence controls — a measurement, an injury, a replay, a timeout —
   * and including it would credit the delay to the coordinator.
   */
  maxSecondsBetweenPlays: 60,
} as const;

/**
 * The Football Outsiders adjusted-line-yards weighting, as bands of yards gained.
 *
 * Stated as data rather than as a chain of `if`s so the whole shape is visible in one place: the
 * numbers are conventional, they are the reason this is a line metric, and anyone reviewing it
 * should be able to disagree with them without reading a function.
 */
const LINE_YARD_BANDS: readonly { readonly upTo: number; readonly weight: number }[] = [
  { upTo: 3, weight: 1 },
  { upTo: 8, weight: 0.5 },
  { upTo: Number.POSITIVE_INFINITY, weight: 0 },
];

/** A loss is the line's, and then some — the back never had a chance to make anything of it. */
const LOSS_WEIGHT = 1.2;

/**
 * The line's share of one carry's yardage.
 *
 * Only the yards INSIDE each band carry that band's weight, which is the part of the formula most
 * often got wrong: a nine-yard run is three yards at full credit plus five at half plus one at
 * none, giving 5.5 — not nine yards at the top band's zero, which would credit the line nothing for
 * a run that reached the second level.
 */
export function lineYardsFor(yardsGained: number): number {
  if (yardsGained < 0) return yardsGained * LOSS_WEIGHT;
  let credited = 0;
  let floor = 0;
  for (const band of LINE_YARD_BANDS) {
    const ceiling = Math.min(yardsGained, band.upTo);
    if (ceiling > floor) credited += (ceiling - floor) * band.weight;
    floor = Math.max(floor, band.upTo);
  }
  return credited;
}

/** One offence's accumulated plays for one week, before any division. */
interface TeamWeekTally {
  season: number;
  week: number;
  team: string;
  designedRushes: number;
  lineYards: number;
  stuffs: number;
  dropbacks: number;
  sacks: number;
  neutralPlays: number;
  neutralPasses: number;
  neutralSeconds: number;
  neutralSecondsPlays: number;
  passOverExpectedSum: number;
  passOverExpectedPlays: number;
  gameDate: string;
  /** Filled on the DEFENCE's tally for the same week: what this team gave up, and to whom. */
  dropbacksFaced: number;
  passYardsAllowed: number;
  carriesFaced: number;
  rushYardsAllowed: number;
  /** The offences faced this week. Almost always one; two only if a feed is wrong. */
  readonly opponents: Set<string>;
}

/** The team-week numbers the store holds, once the tallies are divided out. */
export interface TeamWeekPlayProfile {
  readonly season: number;
  readonly week: number;
  readonly team: string;
  readonly adjustedLineYards: number | null;
  readonly stuffedRate: number | null;
  readonly sackRateAllowed: number | null;
  readonly paceSecondsPerPlay: number | null;
  readonly passRate: number | null;
  readonly passRateOverExpected: number | null;
  readonly neutralPlays: number;
  readonly designedRushes: number;
  readonly dropbacks: number;
  /** What this team's DEFENCE gave up in the same week. `null` where it faced no such play. */
  readonly passYardsAllowedPerDropback: number | null;
  readonly rushYardsAllowedPerCarry: number | null;
  readonly dropbacksFaced: number;
  readonly carriesFaced: number;
  /** The offences this team's defence faced. The other half of the opponent adjustment. */
  readonly opponents: readonly string[];
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

/**
 * Accumulates streamed plays into one tally per team-week. Feed it every row; it keeps nothing else.
 *
 * The previous play's clock is tracked PER DRIVE rather than per game, because the gap across a
 * change of possession is a punt, a kickoff and a television break — not tempo. A drive boundary
 * therefore resets the clock rather than contributing a two-minute "play".
 */
export class PlayByPlayAggregator {
  private readonly tallies = new Map<string, TeamWeekTally>();
  private lastDriveKey: string | null = null;
  private lastDriveSeconds: number | null = null;

  private tallyFor(season: number, week: number, team: string, gameDate: string): TeamWeekTally {
    const key = `${season}|${week}|${team}`;
    const existing = this.tallies.get(key);
    if (existing !== undefined) return existing;
    const fresh: TeamWeekTally = {
      season,
      week,
      team,
      designedRushes: 0,
      lineYards: 0,
      stuffs: 0,
      dropbacks: 0,
      sacks: 0,
      neutralPlays: 0,
      neutralPasses: 0,
      neutralSeconds: 0,
      neutralSecondsPlays: 0,
      passOverExpectedSum: 0,
      passOverExpectedPlays: 0,
      gameDate,
      dropbacksFaced: 0,
      passYardsAllowed: 0,
      carriesFaced: 0,
      rushYardsAllowed: 0,
      opponents: new Set<string>(),
    };
    this.tallies.set(key, fresh);
    return fresh;
  }

  add(row: CsvRow): void {
    if (row.season_type !== NFLVERSE_CONFIG.seasonType) return;
    const team = row.posteam;
    if (team === undefined || team.trim() === "") return;
    const season = numberOrNull(row, "season");
    const week = numberOrNull(row, "week");
    if (season === null || week === null) return;

    const gameDate = row.game_date ?? "";
    const tally = this.tallyFor(season, week, team, gameDate);
    const defence = row.defteam;
    // The same play is counted twice on purpose, once for each side: an offence's adjusted line
    // yards and a defence's yards allowed are the same yards read from opposite ends, and joining
    // two separate passes on a game key would be a second place for the join to go wrong.
    const against =
      defence === undefined || defence.trim() === "" ? null : this.tallyFor(season, week, defence, gameDate);
    if (against !== null) against.opponents.add(team);

    const yardsGained = numberOrNull(row, "yards_gained") ?? 0;
    const kneel = flag(row, "qb_kneel");
    const spike = flag(row, "qb_spike");

    // A DESIGNED run: the back's carry, never a scramble (that is a pass play that broke down) and
    // never a kneel (that is the clock). Both would flatter the line — a scramble's yards are the
    // quarterback's, and a kneel is a guaranteed loss no line could prevent.
    if (flag(row, "rush_attempt") && !flag(row, "qb_scramble") && !kneel) {
      tally.designedRushes += 1;
      tally.lineYards += lineYardsFor(yardsGained);
      if (yardsGained <= 0) tally.stuffs += 1;
      if (against !== null) {
        against.carriesFaced += 1;
        against.rushYardsAllowed += yardsGained;
      }
    }
    if (flag(row, "qb_dropback") && !kneel && !spike) {
      tally.dropbacks += 1;
      if (flag(row, "sack")) tally.sacks += 1;
      if (against !== null) {
        // Yards per DROPBACK rather than per attempt, so a sack counts against the defence's
        // opponent exactly as it counts for the defence. Per-attempt would reward a pass rush by
        // deleting the plays it won.
        against.dropbacksFaced += 1;
        against.passYardsAllowed += yardsGained;
      }
    }

    const playType = row.play_type ?? "";
    const scrimmage = playType === "run" || playType === "pass";
    if (!scrimmage || kneel || spike) {
      // A non-scrimmage play still ENDS a tempo measurement: the clock after a punt says nothing
      // about the offence that follows it.
      this.lastDriveKey = null;
      this.lastDriveSeconds = null;
      return;
    }

    const winProbability = numberOrNull(row, "wp");
    const halfSeconds = numberOrNull(row, "half_seconds_remaining");
    const quarter = numberOrNull(row, "qtr");
    const neutral =
      winProbability !== null &&
      winProbability >= NEUTRAL_WINDOW.minWinProbability &&
      winProbability <= NEUTRAL_WINDOW.maxWinProbability &&
      halfSeconds !== null &&
      halfSeconds >= NEUTRAL_WINDOW.minHalfSecondsRemaining &&
      quarter !== null &&
      quarter <= NEUTRAL_WINDOW.lastRegulationQuarter;

    const driveKey = `${team}|${row.game_id ?? ""}|${row.fixed_drive ?? ""}`;
    const gameSeconds = numberOrNull(row, "game_seconds_remaining");
    if (neutral) {
      tally.neutralPlays += 1;
      if (playType === "pass") tally.neutralPasses += 1;
      const passOverExpected = numberOrNull(row, "pass_oe");
      if (passOverExpected !== null) {
        tally.passOverExpectedSum += passOverExpected;
        tally.passOverExpectedPlays += 1;
      }
      if (this.lastDriveKey === driveKey && this.lastDriveSeconds !== null && gameSeconds !== null) {
        const elapsed = this.lastDriveSeconds - gameSeconds;
        if (elapsed > 0 && elapsed <= NEUTRAL_WINDOW.maxSecondsBetweenPlays) {
          tally.neutralSeconds += elapsed;
          tally.neutralSecondsPlays += 1;
        }
      }
    }
    this.lastDriveKey = driveKey;
    this.lastDriveSeconds = gameSeconds;
  }

  /**
   * The finished profiles, sorted so a store write is deterministic.
   *
   * A rate over zero opportunities is `null`, never zero: a team that took no designed carries in a
   * week has no stuffed rate, and a zero would read as a line that was never once beaten.
   */
  profiles(): readonly TeamWeekPlayProfile[] {
    const over = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);
    return [...this.tallies.values()]
      .sort((a, b) => a.season - b.season || a.week - b.week || a.team.localeCompare(b.team))
      .map((tally) => ({
        season: tally.season,
        week: tally.week,
        team: tally.team,
        adjustedLineYards: over(tally.lineYards, tally.designedRushes),
        stuffedRate: over(tally.stuffs, tally.designedRushes),
        sackRateAllowed: over(tally.sacks, tally.dropbacks),
        paceSecondsPerPlay: over(tally.neutralSeconds, tally.neutralSecondsPlays),
        passRate: over(tally.neutralPasses, tally.neutralPlays),
        passRateOverExpected: over(tally.passOverExpectedSum, tally.passOverExpectedPlays),
        neutralPlays: tally.neutralPlays,
        designedRushes: tally.designedRushes,
        dropbacks: tally.dropbacks,
        passYardsAllowedPerDropback: over(tally.passYardsAllowed, tally.dropbacksFaced),
        rushYardsAllowedPerCarry: over(tally.rushYardsAllowed, tally.carriesFaced),
        dropbacksFaced: tally.dropbacksFaced,
        carriesFaced: tally.carriesFaced,
        opponents: [...tally.opponents].sort(),
        gameDate: tally.gameDate,
      }));
  }
}

/**
 * Flattens profiles into team-week observations, stamped when the game they describe finished.
 *
 * A `null` rate emits NO ROW. The store cannot tell a missing row from a zero afterwards, and every
 * one of these quantities has a real zero that means something completely different.
 */
export function playProfileObservations(
  profiles: readonly TeamWeekPlayProfile[],
  asOfFor: (profile: TeamWeekPlayProfile) => Date,
): readonly TeamWeekObservation[] {
  return profiles.flatMap((profile) => {
    const stamp = { season: profile.season, week: profile.week, team: profile.team, source: PBP_SOURCE, asOf: asOfFor(profile) };
    const pairs: readonly (readonly [string, number | null])[] = [
      [PBP_METRICS.adjustedLineYards, profile.adjustedLineYards],
      [PBP_METRICS.stuffedRate, profile.stuffedRate],
      [PBP_METRICS.sackRateAllowed, profile.sackRateAllowed],
      [PBP_METRICS.paceSecondsPerPlay, profile.paceSecondsPerPlay],
      [PBP_METRICS.passRate, profile.passRate],
      [PBP_METRICS.passRateOverExpected, profile.passRateOverExpected],
      [PBP_METRICS.neutralPlays, profile.neutralPlays],
      [PBP_METRICS.designedRushes, profile.designedRushes],
      [PBP_METRICS.dropbacks, profile.dropbacks],
      [PBP_METRICS.passYardsAllowedPerDropback, profile.passYardsAllowedPerDropback],
      [PBP_METRICS.rushYardsAllowedPerCarry, profile.rushYardsAllowedPerCarry],
      [PBP_METRICS.dropbacksFaced, profile.dropbacksFaced],
      [PBP_METRICS.carriesFaced, profile.carriesFaced],
    ];
    return pairs
      .filter((pair): pair is readonly [string, number] => pair[1] !== null)
      .map(([metric, value]) => ({ ...stamp, metric, value }));
  });
}
