import type { RankedStat } from "../rank";

/**
 * THE DEPTH FACTS (spec `2026-09-07-fact-sheet-depth-design.md` §4) — every verified fact this
 * store holds that an expert would cite and the sheet did not carry. Types only; each group's
 * builder lives in its own sibling module, `ledger.ts` turns the whole group into ledger entries,
 * and `../render-depth.ts` is the only place any of it becomes a sentence.
 *
 * ONE GROUP RATHER THAN FOURTEEN TOP-LEVEL FIELDS, deliberately. `PlayerFacts` is the object a
 * parallel round is editing at the same time, and a single additive field is a single additive
 * merge. It also gives `render-depth.ts` one natural heading to gather under, which is what keeps
 * the stable half of the prompt ahead of the new lines byte-identical and therefore cacheable.
 *
 * EVERY FIELD IS NULLABLE OR A LIST, AND EVERY ABSENCE IS AN ABSENCE. A season the store holds no
 * rows for produces no entry — never a zero, never an estimate, never a borrowed neighbouring
 * season. `EMPTY_DEPTH` is the honest value for a player nothing was found for, and it renders no
 * line at all.
 */

/** WHY A PRIOR SEASON ENDED, from `deriveSeasonEnding` (`@/projections/availability/season-end`).
 *  `source` names which input answered: `"report"` carries the league's own words for the body part,
 *  `"status"` carries the roster's code and NEVER a guessed injury. */
export interface PlayerFactsSeasonEnding {
  readonly season: number;
  readonly lastPlayedWeek: number;
  readonly firstMissedWeek: number;
  readonly source: "report" | "status";
  /** The injury report's own status at the anchor week ("Out"), or `null` on a status-sourced read. */
  readonly reportStatus: string | null;
  /** The weekly roster's own code at the anchor week ("RES"), or `null` on a report-sourced read. */
  readonly rosterStatus: string | null;
  /** The report's own injury text ("Knee"), verbatim. `null` when the source published none, and
   *  always `null` on a status-sourced read: the roster file carries no such column. */
  readonly primaryInjury: string | null;
}

/** ONE SEASON'S RECORD: games played, the first week he appeared, the weeks the designation
 *  archives say he was UNAVAILABLE (the only weeks the sheet calls missed) and the rostered weeks he
 *  was healthy and did not play (a role fact, printed as such). See `availability.ts`'s own
 *  `gamesMissedFor` docblock. A season neither store knows him in yields NO entry. */
export interface PlayerFactsGamesMissed {
  readonly season: number;
  /** The team's own scheduled games that season, carried so the sentence can state an honest
   *  denominator rather than leaving "11 played" to float against an unstated total. */
  readonly teamGames: number;
  readonly gamesPlayed: number;
  /** `null` for a man who never played that season. */
  readonly firstPlayedWeek: number | null;
  /** Ascending. `null` where the injury and roster archives do not cover the season: absence, never
   *  a zero the store did not observe. */
  readonly unavailableWeeks: readonly number[] | null;
  /** `null` under the same coverage rule. */
  readonly healthyDidNotPlay: number | null;
}

/** ONE RUN of the same designation in this season's harvest captures. A run is collapsed into a
 *  single entry so "questionable for three straight weeks" is one fact rather than three identical
 *  lines; a genuine change opens a new entry. */
export interface PlayerFactsInjuryDesignation {
  /** The feed's own code, verbatim ("Q", "O", "IR"). */
  readonly designation: string;
  /** The feed's own description text ("Hamstring"), or `null` when the capture carried none.
   *  NEVER inferred from the designation. */
  readonly description: string | null;
  /** ISO date (yyyy-mm-dd) of the first capture in this run. */
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  /** How many captures carried it, which is what makes "for three straight weeks" a counted fact. */
  readonly captureCount: number;
}

/** WHO IS IN CHARGE, from the curated play-caller table. `*IsNew` is `null`, never `false`, when
 *  the table holds nothing for the prior season: "we cannot tell" is not "he is not new". */
export interface PlayerFactsCoaching {
  readonly season: number;
  readonly headCoach: string | null;
  readonly headCoachIsNew: boolean | null;
  readonly playCaller: string | null;
  readonly playCallerRole: "HC" | "OC" | null;
  readonly playCallerIsNew: boolean | null;
}

/** AGE, EXPERIENCE AND PEDIGREE. Age comes from a stored birth date against a stored kickoff
 *  instant, never from a clock. */
export interface PlayerFactsPedigree {
  readonly ageOnOpeningDay: number | null;
  /** The harvest roster sweep's own `school` field. `null` when no sweep has been captured yet,
   *  which is production's state today. No relational table in this store carries a college. */
  readonly college: string | null;
  readonly seasonsPlayed: number | null;
  readonly draftYear: number | null;
  /** Only `nfl_draft_picks` carries a round, and production holds none of those rows — `null` there
   *  until the backfill named in the inventory runs. */
  readonly draftRound: number | null;
  readonly draftPick: number | null;
  readonly draftClub: string | null;
  /** `true` only when the roster row itself carries a real entry year and no pick. `null` when
   *  there is no roster row at all: a missing row is not evidence of anything. */
  readonly undrafted: boolean | null;
}

export interface PlayerFactsDepthChartNeighbor {
  readonly name: string;
  readonly slot: number;
}

/** HIS LISTED SLOT AND WHO IS LISTED AROUND HIM, dated to the release the slot came from. */
export interface PlayerFactsDepthChart {
  readonly season: number;
  /** ISO date (yyyy-mm-dd) of the observation's own `as_of`. */
  readonly asOf: string;
  readonly slot: number;
  /** Every teammate at his own position with a real slot, ascending, at most four, excluding him. */
  readonly aroundHim: readonly PlayerFactsDepthChartNeighbor[];
}

export interface PlayerFactsSplitShare {
  readonly early: number;
  readonly late: number;
}

/** HOW THE ROLE MOVED INSIDE ONE SEASON — the first four weeks he has a real reading for against
 *  the last four. The two windows are named on the object so the sentence can state them rather
 *  than implying "September" and "December" the store never said. */
export interface PlayerFactsRoleTrend {
  readonly season: number;
  readonly earlyWeeks: readonly number[];
  readonly lateWeeks: readonly number[];
  readonly snapShare: PlayerFactsSplitShare | null;
  readonly targetShare: PlayerFactsSplitShare | null;
}

export interface PlayerFactsTargetLeader {
  readonly name: string;
  readonly share: number;
}

/** WHO ELSE EATS — his team's two biggest target earners last season, and their combined share. */
export interface PlayerFactsTargetCompetition {
  readonly season: number;
  readonly team: string;
  readonly leaders: readonly PlayerFactsTargetLeader[];
  readonly combinedShare: number;
}

/** SCORING-RANGE USAGE, in counts rather than the share of his own touches `PlayerFactsUsage`
 *  already carries. Each is `null` when the play-by-play holds no real reading of it. */
export interface PlayerFactsScoringUsage {
  readonly season: number;
  /** Carries plus targets snapped from inside the opponent's twenty. */
  readonly redZoneTouches: RankedStat | null;
  /** The same inside the ten, where a touchdown is the likely outcome of a single play. */
  readonly insideTenTouches: RankedStat | null;
  /** Average intended air yards per target that carried a readable one. `null` when no target did:
   *  a ratio with a zero denominator is not a number. */
  readonly targetDepth: RankedStat | null;
}

/** THE OFFENCE HE PLAYS IN. The prior-season halves are the mean of the weeks the store holds, the
 *  same honest rule `coaches.ts`'s `seasonMeans` already keeps. */
export interface PlayerFactsTeamContext {
  readonly priorSeason: number;
  readonly paceSecondsPerPlay: number | null;
  readonly passRate: number | null;
  /**
   * THE TEAM'S OWN REGULAR-SEASON WINS THAT YEAR, from the schedule store's `game_result` rows
   * (a win 1, a tie a half, a loss 0), summed over the weeks the store holds.
   *
   * WINS RATHER THAN POINTS SCORED, which the spec asked for and this store deliberately does not
   * hold: `schema`'s own `points_allowed` docblock says "a team's own points are deliberately not
   * stored beside this, they are its opponent's points allowed, one join away", and the store
   * carries no prior-season schedule to make that join through. A win is a fact keyed directly to
   * the team, needs no join, and answers the same question a fact sheet is asking here.
   */
  readonly wins: number | null;
  readonly weekOneImpliedTotal: number | null;
  readonly weekOneSpread: number | null;
}

export interface PlayerFactsFixture {
  readonly week: number;
  readonly opponent: string;
  readonly home: boolean;
}

/** THE PUBLISHED SCHEDULE, named and counted, with no strength judgment anywhere: this engine has
 *  measured no opponent strength for a season that has not started. */
export interface PlayerFactsSchedule {
  readonly weekOneOpponent: PlayerFactsFixture | null;
  readonly homeGames: number;
  readonly roadGames: number;
  /** `null` when the schedule store carries no `indoors` row for the team at all, never zero. */
  readonly indoorGames: number | null;
  /** Weeks 15, 16 and 17, the fantasy playoff weeks, as fixtures only. */
  readonly playoffWeeks: readonly PlayerFactsFixture[];
}

/** WHERE THE MARKET HAS MOVED HIM, between the two captures the archive actually holds. Both dates
 *  are printed so the sentence never claims a window the archive does not cover. */
export interface PlayerFactsMarketMovement {
  readonly latestAdp: number;
  readonly latestAt: string;
  readonly earlierAdp: number;
  readonly earlierAt: string;
  /** `earlierAdp - latestAdp`: positive when the market has moved him UP the board. */
  readonly picks: number;
}

/** THE BAD WEEKS, which is the half of last season's spread the sheet never showed. */
export interface PlayerFactsVolatility {
  readonly season: number;
  readonly weeksPlayed: number;
  readonly weeksAboveThreshold: number;
  /** Stated on the object so the rendered sentence prints the bar rather than hiding it. */
  readonly threshold: number;
  readonly worstWeek: { readonly week: number; readonly points: number };
}

/** ONE PRIOR SEASON'S HEADLINE, so a career arc is visible in one line. */
export interface PlayerFactsPriorSeason {
  readonly season: number;
  readonly points: number;
  readonly gamesPlayed: number;
  readonly positionRank: number;
  readonly qualifierCount: number;
}

/** THE WHOLE DEPTH GROUP — one field on `PlayerFacts`, in the spec's own fact order. */
export interface PlayerFactsDepth {
  readonly seasonEndings: readonly PlayerFactsSeasonEnding[];
  readonly gamesMissed: readonly PlayerFactsGamesMissed[];
  readonly injuryHistory: readonly PlayerFactsInjuryDesignation[];
  readonly coaching: PlayerFactsCoaching | null;
  readonly pedigree: PlayerFactsPedigree | null;
  readonly depthChart: PlayerFactsDepthChart | null;
  readonly roleTrend: PlayerFactsRoleTrend | null;
  readonly targetCompetition: PlayerFactsTargetCompetition | null;
  readonly scoringUsage: PlayerFactsScoringUsage | null;
  readonly teamContext: PlayerFactsTeamContext | null;
  readonly schedule: PlayerFactsSchedule | null;
  readonly marketMovement: PlayerFactsMarketMovement | null;
  readonly volatility: PlayerFactsVolatility | null;
  readonly priorSeasons: readonly PlayerFactsPriorSeason[];
}

/** THE HONEST "NOTHING WAS FOUND" VALUE — every list empty, every object `null`. Renders no line,
 *  contributes nothing to either ledger, and is what every collector hands a player the depth
 *  stores carry no row for. */
export const EMPTY_DEPTH: PlayerFactsDepth = {
  seasonEndings: [],
  gamesMissed: [],
  injuryHistory: [],
  coaching: null,
  pedigree: null,
  depthChart: null,
  roleTrend: null,
  targetCompetition: null,
  scoringUsage: null,
  teamContext: null,
  schedule: null,
  marketMovement: null,
  volatility: null,
  priorSeasons: [],
};
