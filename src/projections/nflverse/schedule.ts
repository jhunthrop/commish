import type { TeamWeekObservation } from "../team-store";
import { NFLVERSE_CONFIG } from "./config";
import type { CsvRow } from "./csv";

/**
 * THE SCHEDULE — opponent, rest, venue, weather and the closing betting line, from the one free
 * file that carries all of them (`nflverse/nfldata`'s `games.csv`, back to 1999).
 *
 * It is a different repository from the release assets the rest of this module reads, which is why
 * it carries its own base URL. Worth the second source: the alternative for a betting line is a
 * paid odds feed with no history endpoint, and the alternative for weather is nothing at all.
 *
 * THE TWO SOURCE STAMPS ARE THE POINT OF THIS FILE, and they are not cosmetic. Half of what
 * `games.csv` carries is knowable in MAY — who plays whom, where, on how many days of rest — and
 * half is knowable only at KICKOFF: the closing spread, the closing total, the temperature and the
 * wind that were actually recorded. Those two halves are stamped differently and given different
 * `source` names so the difference survives into the store, where an ablation can see it.
 *
 * The consequence is deliberate and is reported rather than worked around: a week-W projection is
 * replayed from the moment week W-1's numbers landed, so it can see the schedule half and CANNOT
 * see the kickoff half. Game script therefore measures as no effect under the current replay
 * moment. That is the honest result. Stamping a closing line as though it had been knowable on the
 * Tuesday would make the feature measure well and make every number in the harness a lie.
 */

/** The second nflverse repository, and the file within it. Not a release asset. */
export const SCHEDULE_SOURCE_CONFIG = {
  baseUrl: "https://raw.githubusercontent.com/nflverse/nfldata/master/",
  release: "data",
  file: "games.csv",
} as const;

/** Provenance stamps, and the axis an ablation holds a feed out on. */
export const SCHEDULE_SOURCE = {
  /** Knowable when the schedule is published — opponent, venue, rest. */
  schedule: "nflverse_schedule",
  /** Knowable only at kickoff — the closing line and the recorded weather. See the module docblock. */
  kickoff: "nflverse_kickoff",
} as const;

export const SCHEDULE_METRICS = {
  /** Days since this team's previous game. Fewer than six is a short week. */
  restDays: "rest_days",
  /** 1 at home, 0 away. */
  homeField: "home_field",
  /** 1 under a roof or a dome, 0 outdoors. Weather cannot matter where there is none. */
  indoors: "indoors",
  /** 1 when the opponent is a division rival. */
  divisionGame: "division_game",
  /** Positive when THIS team is favoured, in points. Kickoff-stamped. */
  pointSpread: "point_spread",
  /** The market's expectation of this team's own score: half the total plus half the spread. */
  impliedTeamTotal: "implied_team_total",
  /** Recorded, not forecast — which is exactly why it is kickoff-stamped. */
  temperature: "temperature_f",
  windSpeed: "wind_mph",
  /**
   * THE KICKOFF INSTANT ITSELF, unconditional — the ONE fact `scheduleObservations` promises for
   * EVERY scheduled game, whether or not the file carries a betting line for it. A plain marker
   * (value `1`; the fact this metric carries is its `as_of`, not its `value`).
   *
   * `pointSpread`'s own kickoff stamp is contingent: `scheduleObservations` only emits it
   * `if (game.pointSpread !== null)`, and a real market line can be MISSING for a real, scheduled
   * game — checked directly against 2026: a game past week 6 can carry no line at all, because a
   * book stops pricing a game that far out. Any reader that needs "when did this team's game kick
   * off" (a season's own FIRST kickoff, in particular) and keys off `pointSpread` for it is reading
   * a fact that can silently go missing for exactly the games most likely to matter — a lined-games
   * minimum can return a moment AFTER the season has actually started, because the game that really
   * kicked off first happened to be the one with no line yet. This metric is the honest,
   * unconditional answer `firstKickoffFor` (`team-store.ts`) reads instead.
   */
  kickoffInstant: "kickoff_instant",
} as const;

/** One regular-season game, from one team's point of view. Every game yields two of these. */
export interface TeamGame {
  readonly season: number;
  readonly week: number;
  readonly team: string;
  readonly opponent: string;
  readonly home: boolean;
  readonly restDays: number;
  readonly indoors: boolean;
  readonly divisionGame: boolean;
  /** This team's head coach for the game. The play-caller proxy — see `scheme.ts`. */
  readonly coach: string;
  /** Points scored, and allowed. `null` for a game not yet played. */
  readonly pointsFor: number | null;
  readonly pointsAgainst: number | null;
  /** Positive when this team is favoured. `null` where the file carries no line. */
  readonly pointSpread: number | null;
  readonly totalLine: number | null;
  readonly temperature: number | null;
  readonly windSpeed: number | null;
  /** When the game finished and its facts became knowable, on the same basis as `gameDayAsOf`. */
  readonly kickoffAsOf: Date;
  /**
   * The real instant the ball was kicked off. The stamp for the CLOSING LINE, which is settled then
   * — see `kickoffInstant`. The recorded weather keeps `kickoffAsOf`, because a temperature is
   * recorded over the course of a game rather than at its start.
   *
   * OPTIONAL, and the omission is a claim rather than a convenience: a game whose local start time
   * is not known cannot have its line stamped at kickoff, and `scheduleObservations` falls back to
   * the publication-lag stamp for it. That is the conservative direction — a line nobody could reach
   * costs a replay some accuracy, and one reachable before it was settled would be a leak.
   */
  readonly kickoffAt?: Date;
}

const MILLISECONDS_PER_HOUR = 3_600_000;

/**
 * When the NFL schedule for a season becomes knowable: the twentieth of May that year.
 *
 * The release is mid-May and the exact hour is not in the file, so this errs LATE for the same
 * reason `NFLVERSE_CONFIG.publicationLagHours` does — a late stamp costs a replay a little
 * legitimately-knowable data, an early one invalidates every number the harness produces. Late
 * enough to be safe, early enough that every week from the second onwards can still read it.
 *
 * Flex scheduling moves kickoff TIMES within a week late in the season, which can move a rest-day
 * count by a day. The opponent and the venue never move, and a day of rest is the smallest of the
 * three, so the whole set is stamped together at publication rather than split again.
 */
export function schedulePublishedAsOf(season: number): Date {
  return new Date(Date.UTC(season, 4, 20));
}

/**
 * When a game's kickoff-time facts became knowable: the end of its UTC calendar day plus the
 * publication lag, exactly as `gameDayAsOf` computes it for a box score.
 *
 * Same arithmetic and same reason: a Monday night game finishes after midnight UTC, so stamping
 * from the bare date would claim a fact was knowable before the game producing it had ended.
 */
/**
 * THE REAL KICKOFF INSTANT, from the file's own date and local start time.
 *
 * `kickoffAsOf` below is the right stamp for a fact a game PRODUCED and the wrong one for a fact
 * that is settled AT kickoff. A closing line is the market's last word before the ball is thrown; a
 * stamp of "the end of the game's day plus a publication lag" puts it thirty-six hours after the
 * moment any replay could act on it, which is why Phase 3 had to record the betting line as
 * unmeasurable rather than as worthless. This is the honest stamp for that half of the file.
 *
 * `gametime` is local Eastern, and the season crosses the daylight-saving boundary in early
 * November, so the offset is resolved from the zone database rather than assumed. Two passes,
 * because the offset depends on the instant and the instant depends on the offset: the first pass
 * is right except within an hour of a transition and the second settles it.
 */
export function kickoffInstant(gameday: string, gametime: string): Date {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(gameday);
  const time = /^(\d{1,2}):(\d{2})$/.exec(gametime);
  if (day === null || time === null) {
    throw new Error(
      `Schedule row has no readable kickoff (gameday ${JSON.stringify(gameday)}, gametime ${JSON.stringify(gametime)}); a closing line cannot be stamped.`,
    );
  }
  const asIfUtc = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(time[1]), Number(time[2]));
  let instant = asIfUtc;
  for (let pass = 0; pass < 2; pass += 1) instant = asIfUtc + easternOffsetMillis(new Date(instant));
  return new Date(instant);
}

const EASTERN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** How far behind UTC Eastern time is at `instant`, in milliseconds. Positive. */
function easternOffsetMillis(instant: Date): number {
  const parts = new Map(EASTERN.formatToParts(instant).map((part) => [part.type, part.value] as const));
  const local = Date.UTC(
    Number(parts.get("year")),
    Number(parts.get("month")) - 1,
    Number(parts.get("day")),
    Number(parts.get("hour")) % 24,
    Number(parts.get("minute")),
    Number(parts.get("second")),
  );
  return instant.getTime() - local;
}

export function kickoffAsOf(gameday: string, lagHours: number): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(gameday);
  if (match === null) {
    throw new Error(`Schedule row has no readable gameday (got ${JSON.stringify(gameday)}); a game cannot be stamped.`);
  }
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1) + lagHours * MILLISECONDS_PER_HOUR);
}

function required(row: CsvRow, column: string): string {
  const value = row[column];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Schedule row has no ${column}; the games.csv schema changed.`);
  }
  return value.trim();
}

/** A column that is legitimately blank for a game not yet played, or with no line, or indoors. */
function optional(row: CsvRow, column: string): number | null {
  const raw = row[column];
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Schedule row has an unreadable ${column} (got ${JSON.stringify(raw)}).`);
  }
  return value;
}

function integer(row: CsvRow, column: string): number {
  const value = optional(row, column);
  if (value === null) throw new Error(`Schedule row has no ${column}; the games.csv schema changed.`);
  return value;
}

/** Roof values that mean no weather. `open` is a retractable roof that was open, so it is outdoors. */
const INDOOR_ROOFS: readonly string[] = ["dome", "closed"];

/**
 * Turns `games.csv` into two rows per game, one per team.
 *
 * Per TEAM rather than per game because every consumer is team-keyed — a projection is made for a
 * player on one side of one game — and a game-shaped row would make every read a two-branch
 * "am I home or away" that one call site would eventually get backwards.
 *
 * `spread_line` in the file is from the HOME team's point of view. It is flipped for the away row
 * so that positive always means "this team is favoured", which is the only convention that reads
 * the same at every call site.
 */
export function mapSchedule(rows: readonly CsvRow[], seasons: readonly number[], lagHours = NFLVERSE_CONFIG.publicationLagHours): readonly TeamGame[] {
  const wanted = new Set(seasons);
  const games: TeamGame[] = [];
  for (const row of rows) {
    if (row.game_type !== NFLVERSE_CONFIG.seasonType) continue;
    const season = integer(row, "season");
    if (!wanted.has(season)) continue;

    const week = integer(row, "week");
    const gameday = required(row, "gameday");
    const stamp = kickoffAsOf(gameday, lagHours);
    // A row with no `gametime` COLUMN at all predates the field or is a narrowed fixture, and it
    // simply has no kickoff instant. A row that carries the column and leaves it BLANK is a schema
    // problem and `kickoffInstant` throws, because a silently unstamped line is a feature that has
    // quietly stopped existing.
    const kickoffAt = row.gametime === undefined ? undefined : kickoffInstant(gameday, row.gametime);
    const homeSpread = optional(row, "spread_line");
    const totalLine = optional(row, "total_line");
    const homeScore = optional(row, "home_score");
    const awayScore = optional(row, "away_score");
    const shared = {
      season,
      week,
      indoors: INDOOR_ROOFS.includes(row.roof ?? ""),
      divisionGame: optional(row, "div_game") === 1,
      totalLine,
      temperature: optional(row, "temp"),
      windSpeed: optional(row, "wind"),
      kickoffAsOf: stamp,
      kickoffAt,
    } as const;
    games.push({
      ...shared,
      team: required(row, "home_team"),
      opponent: required(row, "away_team"),
      home: true,
      restDays: integer(row, "home_rest"),
      coach: required(row, "home_coach"),
      pointsFor: homeScore,
      pointsAgainst: awayScore,
      pointSpread: homeSpread,
    });
    games.push({
      ...shared,
      team: required(row, "away_team"),
      opponent: required(row, "home_team"),
      home: false,
      restDays: integer(row, "away_rest"),
      coach: required(row, "away_coach"),
      pointsFor: awayScore,
      pointsAgainst: homeScore,
      pointSpread: homeSpread === null ? null : -homeSpread,
    });
  }
  return games;
}

/**
 * Flattens the schedule into team-week observations, under the two source stamps.
 *
 * A metric the file does not carry emits NO ROW rather than a row of zero — the store cannot tell
 * those apart afterwards, and "the wind was 0 mph" is a different claim from "this game was played
 * indoors and nobody recorded the wind".
 */
export function scheduleObservations(games: readonly TeamGame[]): readonly TeamWeekObservation[] {
  return games.flatMap((game) => {
    const key = { season: game.season, week: game.week, team: game.team } as const;
    const published = { ...key, source: SCHEDULE_SOURCE.schedule, asOf: schedulePublishedAsOf(game.season) };
    // TWO STAMPS UNDER ONE SOURCE, and the difference is what each fact is. The line is settled at
    // kickoff and is stamped there; the recorded temperature and wind are observations taken during
    // the game and keep the publication-lag stamp every other game-derived fact carries.
    const atKickoff = { ...key, source: SCHEDULE_SOURCE.kickoff, asOf: game.kickoffAt ?? game.kickoffAsOf };
    const afterTheGame = { ...key, source: SCHEDULE_SOURCE.kickoff, asOf: game.kickoffAsOf };
    const rows: TeamWeekObservation[] = [
      { ...published, metric: SCHEDULE_METRICS.restDays, value: game.restDays },
      { ...published, metric: SCHEDULE_METRICS.homeField, value: game.home ? 1 : 0 },
      { ...published, metric: SCHEDULE_METRICS.indoors, value: game.indoors ? 1 : 0 },
      { ...published, metric: SCHEDULE_METRICS.divisionGame, value: game.divisionGame ? 1 : 0 },
      // UNCONDITIONAL, unlike every kickoff-stamped row below it — every scheduled game has a
      // kickoff whether or not the market ever priced it. See SCHEDULE_METRICS.kickoffInstant's own
      // docblock for why nothing that needs "when did this game kick off" may key off pointSpread.
      { ...atKickoff, metric: SCHEDULE_METRICS.kickoffInstant, value: 1 },
    ];
    if (game.pointSpread !== null) {
      rows.push({ ...atKickoff, metric: SCHEDULE_METRICS.pointSpread, value: game.pointSpread });
      if (game.totalLine !== null) {
        // The market's view of this team's own score. Half the total plus half the spread is the
        // standard decomposition, and it is the single most direct proxy for game script there is.
        rows.push({
          ...atKickoff,
          metric: SCHEDULE_METRICS.impliedTeamTotal,
          value: game.totalLine / 2 + game.pointSpread / 2,
        });
      }
    }
    if (game.temperature !== null) rows.push({ ...afterTheGame, metric: SCHEDULE_METRICS.temperature, value: game.temperature });
    if (game.windSpeed !== null) rows.push({ ...afterTheGame, metric: SCHEDULE_METRICS.windSpeed, value: game.windSpeed });
    return rows;
  });
}
