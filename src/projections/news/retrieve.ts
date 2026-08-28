import type { PlayerWeekObservation } from "../store";
import { NFLVERSE_CONFIG } from "../nflverse/config";
import type { CsvRow } from "../nflverse/csv";

/**
 * THE NEWS PASS, TASK 6: RETRIEVAL — an INGESTION concern, never a runtime fetch.
 *
 * The spec's rule and the plan's rule are the same one: a projection may not reach the network. A
 * draft-week feature that depends on a third party being up is a feature that breaks on the busiest
 * day of the year, and a retrieval performed inside a projection could not be replayed at all — the
 * backtest would be showing a 2023 model today's headlines. So the feed lands in the point-in-time
 * store with an honest `as_of`, and the model reads it through exactly the gate everything else goes
 * through.
 *
 * WHY THE INJURY REPORT AND NOT A HEADLINE WIRE. The plan named Tank01's news endpoint. Tank01
 * publishes what is happening NOW and keeps no archive, so a layer built on it could be shipped and
 * could never be measured — there is no 2023 to replay it against, and this phase exists to catch a
 * layer that feels smart and adds nothing. The official injury report is the same class of fact
 * (published by a named source, on a timestamp, about one player's availability) and nflverse
 * archives it back to 2009 with the publication time on every row. That is what makes an ablation
 * possible, and an unmeasurable layer is the one thing this gate exists to refuse.
 *
 * The departure follows the precedent Phase 3 set with the play-caller table: a source we can point
 * at beats a source the plan named but nobody can verify. The contract in `adjust.ts` is indifferent
 * to which feed fills it, so a live wire drops in beside this one without a line of change.
 *
 * NOTHING HERE IS PROSE. The store holds numbers, and that is the first half of "the model weighs
 * retrieved facts and never generates them": a designation is an ordinal published by the league,
 * and the mapping from its four words to four integers is the whole of the interpretation this file
 * performs. There is nowhere in this pipeline for a sentence to be written.
 */

export const INJURY_SOURCE = "nflverse_injuries";

export const INJURY_METRICS = {
  /**
   * The GAME-STATUS designation: Out, Doubtful, Questionable, or listed with no status. Published
   * late in the week and the decisive one.
   */
  reportStatus: "injury_report_status",
  /**
   * The PRACTICE participation designation, published from the Wednesday. Weaker evidence than a
   * game status and available days earlier, which turns out to be the whole of what a weekly replay
   * can reach — see `docs/research/2026-08-27-model-v3.md`.
   */
  practiceStatus: "injury_practice_status",
} as const;

/**
 * The published designations, as ordinals, worst first.
 *
 * Ordered so that a LARGER number is a worse outlook, which is the only convention that reads the
 * same at every call site. Zero is reserved for "on the report, with no designation of this kind",
 * which is a real and different fact from not being on the report at all — the latter emits no row.
 */
export const REPORT_STATUS = { none: 0, questionable: 1, doubtful: 2, out: 3 } as const;
export const PRACTICE_STATUS = { none: 0, full: 1, limited: 2, didNotParticipate: 3 } as const;

/**
 * Exactly the strings nflverse publishes, mapped to those ordinals.
 *
 * An unrecognised string is a SCHEMA CHANGE and throws rather than falling back to zero. A silent
 * zero here would read as "no designation" for every player in the league the day the league renames
 * a status, and a news layer that had quietly stopped seeing injuries would look exactly like a news
 * layer that had decided nobody was hurt.
 */
const REPORT_STATUS_BY_NAME: Readonly<Record<string, number>> = {
  "": REPORT_STATUS.none,
  // "Note" is the league's catch-all for a report row carrying a comment and no game status.
  Note: REPORT_STATUS.none,
  Questionable: REPORT_STATUS.questionable,
  Doubtful: REPORT_STATUS.doubtful,
  Out: REPORT_STATUS.out,
};

const PRACTICE_STATUS_BY_NAME: Readonly<Record<string, number>> = {
  "": PRACTICE_STATUS.none,
  "Full Participation in Practice": PRACTICE_STATUS.full,
  "Limited Participation in Practice": PRACTICE_STATUS.limited,
  "Did Not Participate In Practice": PRACTICE_STATUS.didNotParticipate,
};

function ordinal(raw: string | undefined, table: Readonly<Record<string, number>>, column: string): number {
  const value = table[(raw ?? "").trim()];
  if (value === undefined) {
    throw new Error(
      `nflverse injuries row has an unrecognised ${column} (${JSON.stringify(raw)}). The published vocabulary changed; a silent zero here would read as "nobody is hurt".`,
    );
  }
  return value;
}

/**
 * When a report row became knowable: the timestamp the league's own filing carries.
 *
 * The ONE stamp in this engine that is not derived from a game's date, and the reason the news pass
 * is interesting at all. Every other fact here becomes knowable when a game ends; an injury
 * designation is knowable when it is filed, which is BEFORE the game it describes. That is what a
 * news layer is for, and it is also why the stamp has to be taken literally from the file rather
 * than rounded to a day: rounding down would leak, and rounding up would delete the feature.
 */
export function reportFiledAt(dateModified: string | undefined): Date {
  const raw = (dateModified ?? "").trim();
  const filed = raw === "" ? new Date(Number.NaN) : new Date(raw);
  if (Number.isNaN(filed.getTime())) {
    throw new Error(
      `nflverse injuries row has no readable date_modified (got ${JSON.stringify(dateModified)}); an injury report cannot be stamped, and an unstamped fact cannot be replayed.`,
    );
  }
  return filed;
}

export interface MapInjuriesResult {
  readonly observations: readonly PlayerWeekObservation[];
  /** Report rows naming a player the universe does not project. Reported, never silently dropped. */
  readonly unknownPlayers: readonly string[];
}

/**
 * Turns one season of `injuries_YYYY.csv` into stamped observations.
 *
 * Narrowed to players the engine projects, exactly as the participation and play-by-play ingestions
 * are: the store is keyed on a player the backtest can score through, and an offensive lineman's
 * ankle has nowhere to go. The universe decides, not the file's own position column, so a player
 * ingested here is a player the scorer will recognise.
 *
 * Both designations are emitted for every row, zeros included. A player who practised in full is on
 * the report and is a different fact from a player who is not on it, and only a stored zero can say
 * so — an absent row is how "nothing was published about him" is spelled.
 */
export function mapInjuries(rows: readonly CsvRow[], projected: ReadonlySet<string>): MapInjuriesResult {
  const observations: PlayerWeekObservation[] = [];
  const unknown = new Set<string>();
  for (const row of rows) {
    if (row.game_type !== NFLVERSE_CONFIG.seasonType) continue;
    const playerId = (row.gsis_id ?? "").trim();
    if (playerId === "") continue;
    if (!projected.has(playerId)) {
      unknown.add(playerId);
      continue;
    }
    const season = Number(row.season);
    const week = Number(row.week);
    if (!Number.isInteger(season) || !Number.isInteger(week)) {
      throw new Error(`nflverse injuries row has no readable season/week (got ${JSON.stringify(row.season)}/${JSON.stringify(row.week)}).`);
    }
    const stamp = { season, week, playerId, source: INJURY_SOURCE, asOf: reportFiledAt(row.date_modified) };
    observations.push({
      ...stamp,
      metric: INJURY_METRICS.reportStatus,
      value: ordinal(row.report_status, REPORT_STATUS_BY_NAME, "report_status"),
    });
    observations.push({
      ...stamp,
      metric: INJURY_METRICS.practiceStatus,
      value: ordinal(row.practice_status, PRACTICE_STATUS_BY_NAME, "practice_status"),
    });
  }
  return { observations, unknownPlayers: [...unknown].sort() };
}
