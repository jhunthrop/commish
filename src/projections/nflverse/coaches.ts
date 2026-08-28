import type { TeamWeekObservation } from "../team-store";
import type { WeekRef } from "../team-context";
import { PBP_METRICS } from "./pbp";
import { schedulePublishedAsOf, SCHEDULE_SOURCE, type TeamGame } from "./schedule";

/**
 * THE PLAY-CALLER TABLE — sourced, not curated, and the difference is deliberate.
 *
 * The plan asked for a hand-maintained play-caller by team-season, thirty-two rows a year. We do
 * not ship one, and the reason is the same reason the news pass will require a citation: a table
 * typed from memory is a table of unverifiable claims, and a wrong coordinator in 2022 is a wrong
 * prior that nothing downstream can detect. What we ship instead is the HEAD COACH, which
 * `games.csv` carries for every game back to 1999 from a source we can point at.
 *
 * The cost is real and is stated here rather than buried: where a head coach keeps his job and
 * replaces his coordinator, this table sees no change and the prior does not move. That is the
 * commonest kind of play-calling change there is. The mechanism below is indifferent to which
 * name it is given, so the day a sourced coordinator table exists it drops straight in.
 *
 * WHAT THE COACHING CHANGE IS FOR. A team's own pace and pass rate are the numeric fingerprint of
 * whoever was calling the plays, and when that person leaves the fingerprint is no longer evidence
 * about this season. So a new coach's arrival does two things: it discounts the team's own history,
 * and it substitutes HIS — the pace and pass-rate-over-expected of the offences he ran elsewhere.
 * A coach with no history we can see falls back to the league, which is the honest answer for a
 * first-time head coach rather than a pretence that his last team tells us something.
 */

export const COACH_METRICS = {
  /** Seasons this head coach has already had with this team. Zero is a coaching change. */
  tenureSeasons: "coach_tenure_seasons",
  /** This coach's own situation-neutral pace at every team he ran before this season. */
  priorPace: "coach_prior_pace_seconds_per_play",
  /** The same for pass rate over expected — the other half of a scheme's fingerprint. */
  priorPassRateOverExpected: "coach_prior_pass_rate_over_expected",
} as const;

/** One team-season and who was in charge of it. */
interface TeamSeasonCoach {
  readonly season: number;
  readonly team: string;
  readonly coach: string;
}

/**
 * Who coached each team-season, from the games themselves.
 *
 * The MOST FREQUENT name across a team's games, not the first: an interim coach appointed in
 * November should not be recorded as the man who set the offence's tendencies in September, and a
 * coach fired in November should. Ties break toward whoever appears alphabetically first, which is
 * arbitrary and is the right kind of arbitrary — it makes the answer deterministic.
 */
export function coachByTeamSeason(games: readonly TeamGame[]): readonly TeamSeasonCoach[] {
  const counts = new Map<string, Map<string, number>>();
  for (const game of games) {
    const key = `${game.season}|${game.team}`;
    const forTeam = counts.get(key) ?? counts.set(key, new Map()).get(key)!;
    forTeam.set(game.coach, (forTeam.get(game.coach) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, forTeam]) => {
      const [season, team] = key.split("|");
      const coach = [...forTeam.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
      return { season: Number(season), team: team!, coach };
    })
    .sort((a, b) => a.season - b.season || a.team.localeCompare(b.team));
}

/** Reads one team-season's mean of a per-week metric. `null` where the store holds none. */
export type SeasonMetricLookup = (team: string, season: number, metric: string) => number | null;

/**
 * Builds a season-mean lookup from a week-level one, over a fixed set of weeks.
 *
 * A team-season's pace is the mean of its weeks, and a mean of the weeks a store actually holds is
 * the honest version — a season interrupted by a missing week is a season with fewer weeks in the
 * average, not a season with a zero in it.
 */
export function seasonMeans(read: (team: string, at: WeekRef, metric: string) => number | null, weeks: readonly number[]): SeasonMetricLookup {
  return (team, season, metric) => {
    const values = weeks
      .map((week) => read(team, { season, week }, metric))
      .filter((value): value is number => value !== null);
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  };
}

/**
 * Tenure and the incoming coach's own history, as team-week observations.
 *
 * STAMPED AT SCHEDULE PUBLICATION, which is the honest moment for both. Head coaching hires are
 * complete by February and the schedule is published in May, and every number that feeds the prior
 * comes from seasons strictly BEFORE the one being stamped — so nothing here can reach forward.
 * The stamp is the same one the rest of the schedule carries, so a replay sees them together.
 *
 * A coach with no measurable history emits NO ROW rather than a league-average one. The consumer
 * has to decide what to do with an unknown coach, and handing it a league mean disguised as a
 * measurement would take that decision away from the one place it is visible.
 */
export function coachObservations(
  games: readonly TeamGame[],
  seasonMean: SeasonMetricLookup,
  seasons: readonly number[],
): readonly TeamWeekObservation[] {
  const byTeamSeason = coachByTeamSeason(games);
  const coachOf = new Map(byTeamSeason.map((row) => [`${row.season}|${row.team}`, row.coach] as const));
  const wanted = new Set(seasons);

  /** Every team-season this coach ran strictly before `season`, earliest first. */
  const historyOf = (coach: string, season: number): readonly TeamSeasonCoach[] =>
    byTeamSeason.filter((row) => row.coach === coach && row.season < season);

  const rows: TeamWeekObservation[] = [];
  for (const { season, team, coach } of byTeamSeason) {
    if (!wanted.has(season)) continue;
    let tenure = 0;
    while (coachOf.get(`${season - tenure - 1}|${team}`) === coach) tenure += 1;

    // His history AT OTHER TEAMS only. A continuing coach's history with this team is already the
    // team's own history, and counting it twice would make the prior agree with itself.
    const elsewhere = historyOf(coach, season).filter((row) => row.team !== team);
    const priorOf = (metric: string): number | null => {
      const values = elsewhere
        .map((row) => seasonMean(row.team, row.season, metric))
        .filter((value): value is number => value !== null);
      return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    const pace = priorOf(PBP_METRICS.paceSecondsPerPlay);
    const passRateOverExpected = priorOf(PBP_METRICS.passRateOverExpected);

    // One row per WEEK, because every other team fact in the store is week-keyed and a consumer
    // that had to special-case season-keyed rows would eventually forget to.
    for (const game of games.filter((row) => row.season === season && row.team === team)) {
      const stamp = { season, week: game.week, team, source: SCHEDULE_SOURCE.schedule, asOf: schedulePublishedAsOf(season) } as const;
      rows.push({ ...stamp, metric: COACH_METRICS.tenureSeasons, value: tenure });
      if (pace !== null) rows.push({ ...stamp, metric: COACH_METRICS.priorPace, value: pace });
      if (passRateOverExpected !== null) {
        rows.push({ ...stamp, metric: COACH_METRICS.priorPassRateOverExpected, value: passRateOverExpected });
      }
    }
  }
  return rows;
}
