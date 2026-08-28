import type { CsvRow } from "./csv";

/**
 * THE WEEK-ONE ROSTER — the only fact about a season that this engine may read before the season.
 *
 * Everything else the store holds about a player becomes knowable when a game produces it, which is
 * the right rule for a snap count and a catastrophic one for a draft board. `player_week_teams` says
 * so plainly in its own docblock: a man's team is only visible once he has taken a snap for it. A
 * board built in August that did not know a receiver had signed somewhere else in March would be
 * projecting last year's offence, and reading his new team off a week-1 box score would be reading
 * the future.
 *
 * nflverse's `weekly_rosters` release answers it honestly. Week 1 of each season carries every
 * club's roster with the league's own status for each man, plus the biography that never changes:
 * birth date, draft year, overall draft pick, drafting club. All of it was settled at the cutdown
 * deadline, which is a league-wide date in the last days of August, so all of it describes a world
 * that existed before the opener.
 *
 * WHAT IS DELIBERATELY THROWN AWAY, and this is the load-bearing part. The file distinguishes ACT
 * from INA, and a game-day inactive list is published ninety minutes before kickoff. Reading it here
 * would smuggle a Sunday fact into a stamp that claims late August, and it would do it in the one
 * place it would flatter us most: availability. INA is therefore folded into `active` and the two
 * are indistinguishable downstream. Injured reserve and the physically-unable-to-perform list ARE
 * kept, because those designations are made at the cutdown and are genuinely knowable then.
 */

export const ROSTER_SOURCE_CONFIG = {
  release: "weekly_rosters",
  /** `roster_weekly_2024.csv`. */
  file: (season: number): string => `roster_weekly_${season}.csv`,
  /** Only week 1 of the regular season. Every later week is `player_week_teams`' job, with better
   *  provenance, and storing them here would be a parallel table nobody could choose between. */
  week: 1,
  seasonType: "REG",
  /**
   * The first season this ingestion will accept, and it is a correctness bound rather than a
   * convenience.
   *
   * `week1RosterAsOf` claims the roster was settled by the first of September. That is true of every
   * season from 2021 onwards — the final cutdown ran 31 August 2021, 30 August 2022, 29 August 2023
   * and 27 August 2024, and no opener since 2021 has fallen before 5 September. It is FALSE of 2020,
   * whose pandemic calendar pushed the cutdown to 5 September, after the stamp this module would
   * give it. Ingesting 2020 would therefore assert we knew a roster five days before it existed, so
   * it is refused rather than approximated.
   */
  earliestSeason: 2021,
} as const;

/**
 * When a season's week-one roster became knowable: the first of September that year.
 *
 * Errs in the same direction as `schedulePublishedAsOf` and for the same reason, but the bound is
 * two-sided here and both sides matter. Too EARLY and we claim to have read a roster before the
 * cutdown that produced it, which is leakage. Too LATE and the stamp slides past the opener, at
 * which point a preseason board could not see it at all and the whole ingestion would be pointless.
 * The first of September sits between the two for every season this module accepts, and
 * `ROSTER_SOURCE_CONFIG.earliestSeason` is what keeps it that way.
 */
export function week1RosterAsOf(season: number): Date {
  return new Date(Date.UTC(season, 8, 1));
}

/** The four statuses that survive the coarsening. Ordered by how much football they imply. */
export const ROSTER_STATUSES = ["active", "reserve", "practice_squad", "off_roster"] as const;
export type RosterStatus = (typeof ROSTER_STATUSES)[number];

/**
 * nflverse's status code, coarsened to what was knowable at the cutdown.
 *
 * ACT and INA both map to `active` on purpose — see the module docblock. Everything the league files
 * under a reserve list (injured reserve, physically unable to perform, the exempt list and the
 * numbered E-codes) is `reserve`, because those are cutdown-day decisions and they are the single
 * strongest preseason signal that a man will miss games. DEV is the practice squad. CUT and RET are
 * off the roster entirely, and are kept as rows rather than dropped so that "he was not on anybody's
 * roster" reads as a fact rather than as an absence somebody has to interpret.
 */
export function rosterStatusOf(code: string): RosterStatus {
  switch (code.trim().toUpperCase()) {
    case "ACT":
    case "INA":
      return "active";
    case "DEV":
      return "practice_squad";
    case "CUT":
    case "RET":
      return "off_roster";
    default:
      // Every remaining code the release emits is a reserve list of some kind (RES, PUP, EXE, NON,
      // and the numbered exemptions). Defaulting to `reserve` rather than throwing is right because
      // a code we have not seen is far likelier to be a new reserve designation than a new way of
      // being available, and the conservative reading costs a player games rather than inventing him
      // some.
      return "reserve";
  }
}

/** One man on one club's week-one roster, as the preseason layer needs to see him. */
export interface PreseasonRosterEntry {
  readonly season: number;
  readonly team: string;
  /** The gsis id, which is `nfl_players.id`. */
  readonly playerId: string;
  /** nflverse's own spelling, unnarrowed, exactly as `nfl_players.position` is. */
  readonly position: string;
  readonly status: RosterStatus;
  /** ISO `yyyy-mm-dd`, or null where the release does not carry one. */
  readonly birthDate: string | null;
  readonly draftYear: number | null;
  /** OVERALL pick number, or null for the undrafted — which is a status, not a missing value. */
  readonly draftPick: number | null;
  readonly draftClub: string | null;
  readonly asOf: Date;
}

function text(row: CsvRow, column: string): string | null {
  const raw = row[column];
  return raw === undefined || raw.trim() === "" ? null : raw.trim();
}

function whole(row: CsvRow, column: string, atLeast: number): number | null {
  const raw = text(row, column);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= atLeast ? value : null;
}

/**
 * Reads one season's `weekly_rosters` asset into week-one entries.
 *
 * Rows without a gsis id are DROPPED rather than thrown on, which is the opposite of what
 * `mapNflPlayers` does and the difference is deliberate. The universe is keyed on the id, so a row
 * without one there is a schema change; a weekly roster legitimately carries practice-squad bodies
 * and camp arms the NFL has never issued an id to, and refusing the whole file over one of them
 * would make the ingestion hostage to the thirty-second man on a roster nobody projects.
 *
 * A player listed twice in week 1 (claimed off waivers mid-week, so he appears for two clubs) keeps
 * the LAST row, because the table stores one row per player per season and the later listing is the
 * one the season started under.
 */
export function mapWeek1Rosters(rows: readonly CsvRow[], season: number): readonly PreseasonRosterEntry[] {
  if (season < ROSTER_SOURCE_CONFIG.earliestSeason) {
    throw new Error(
      `Week-one rosters are only ingested from ${ROSTER_SOURCE_CONFIG.earliestSeason} onwards; ${season}'s cutdown fell after the date this module would stamp it with. See ROSTER_SOURCE_CONFIG.earliestSeason.`,
    );
  }
  const asOf = week1RosterAsOf(season);
  const byPlayer = new Map<string, PreseasonRosterEntry>();
  for (const row of rows) {
    if (Number(text(row, "week") ?? "") !== ROSTER_SOURCE_CONFIG.week) continue;
    const gameType = text(row, "game_type");
    if (gameType !== null && gameType !== ROSTER_SOURCE_CONFIG.seasonType) continue;
    if (Number(text(row, "season") ?? "") !== season) continue;
    const playerId = text(row, "gsis_id");
    const team = text(row, "team");
    const position = text(row, "position");
    if (playerId === null || team === null || position === null) continue;
    byPlayer.set(playerId, {
      season,
      team,
      playerId,
      position,
      status: rosterStatusOf(text(row, "status") ?? ""),
      birthDate: text(row, "birth_date"),
      // `entry_year` is the season he first entered the league, which for a drafted man IS his
      // draft year and for an undrafted one is the year he signed. The undrafted case is why the
      // column is read here rather than `draft_number` alone: a rookie is somebody whose entry year
      // is this season, drafted or not. A value below 1936 is not a year — the release writes 0
      // where it knows nothing, and reading that as one would put a rookie in the universe eighty
      // years early. Same guard as `players.ts`' `season`, for the same reason.
      draftYear: whole(row, "entry_year", 1936) ?? whole(row, "rookie_year", 1936),
      draftPick: whole(row, "draft_number", 1),
      draftClub: text(row, "draft_club"),
      asOf,
    });
  }
  return [...byPlayer.values()].sort((a, b) => a.playerId.localeCompare(b.playerId));
}
