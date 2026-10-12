import type { PlayerWeekTeam, TeamWeekObservation } from "./team-store";

/**
 * EVERYTHING THE CONTEXT LAYERS ARE ALLOWED TO KNOW ABOUT THE TEAMS, in one shape, read once per
 * replayed week through the as-of gate and handed to every source.
 *
 * A bag of rows rather than a set of computed features, deliberately. Each feature group decides
 * what its own numbers mean — a line composite averages one set of metrics over one window, the
 * scheme prior averages a different set over a different one — and pre-computing them here would
 * put four features' worth of decisions in the transport. It would also make an ablation
 * meaningless: the flag would switch off the CONSUMER while the producer still ran.
 *
 * THE WEEK BOUNDS ON THE TWO HALVES ARE DIFFERENT, and the difference is the whole point of having
 * stamped these facts carefully.
 *
 *   - `playerTeams` stops at the week BEFORE the one being predicted. Which offence a man is in is
 *     only knowable once he has played a down for it; the transaction wire is a Phase 4 concern.
 *   - `teamObservations` INCLUDES the week being predicted, and is filtered by the `as_of` gate
 *     alone. That is not a loosening. Half of what the schedule carries — the opponent, the venue,
 *     the days of rest — was published in May and is genuinely knowable; the other half (the
 *     closing line, the recorded temperature) is stamped at kickoff and cannot pass the gate. A
 *     week bound would have hidden the first half along with the second, and the engine would have
 *     concluded that rest does not matter when in fact it had never been shown any.
 */
export interface TeamContext {
  /** Which offence each player was in, up to the week before the one being predicted. */
  readonly playerTeams: readonly PlayerWeekTeam[];
  /** Every team-level fact that passes the as-of gate, including facts about the target week. */
  readonly teamObservations: readonly TeamWeekObservation[];
}

/**
 * No team context at all — what a source is handed when nothing has been ingested.
 *
 * Exported rather than written inline in each test, so that "the context is empty" is one value
 * every caller shares. A feature reading this gets `null` from every lookup and must fall back to
 * the model without it, which is the behaviour the ablation's `before` arm depends on.
 */
export const emptyTeamContext: TeamContext = { playerTeams: [], teamObservations: [] };

/** One week of one season. Every context window is a list of these, never a bare week number. */
export interface WeekRef {
  readonly season: number;
  readonly week: number;
}

/** One team's value for one metric in one week, or `null` where there is no evidence. */
export type TeamMetricLookup = (team: string, at: WeekRef, metric: string) => number | null;

/**
 * Indexes a context for lookup by `(team, season, week, metric)`.
 *
 * THE SEASON IS PART OF THE KEY and leaving it out is the bug this docblock exists to prevent: a
 * context carries two seasons, so week 5 of 2023 and week 5 of 2024 would collide, and an offence's
 * line would be measured on a season that has not happened for half the rows. The collision is
 * silent — every number stays plausible — which is exactly the kind that survives review.
 *
 * Built once per projected week rather than scanned per player: a week's context is a few thousand
 * rows and a projection touches it once per player per metric, which is a linear scan a few hundred
 * thousand times over. `null` for an absent fact, never zero — a team with no pace row did not play
 * at zero seconds per play.
 */
export function indexTeamMetrics(context: TeamContext): TeamMetricLookup {
  const byKey = new Map<string, number>();
  for (const row of context.teamObservations) {
    byKey.set(`${row.team}|${row.season}|${row.week}|${row.metric}`, row.value);
  }
  return (team, at, metric) => byKey.get(`${team}|${at.season}|${at.week}|${metric}`) ?? null;
}

/**
 * The weeks a prediction of `season` week `week` may read a team fact from: all of the prior
 * season, then this season up to but not including the target week.
 *
 * The prior season is included because a line, a scheme and a pace persist across a January — a
 * week-2 projection that could see only week 1 would have almost no context at all, which is
 * precisely the part of the season where context is most of what anyone has. The target week is
 * excluded here rather than left to each feature: one feature forgetting would be invisible in
 * every number downstream.
 */
export function contextWindow(season: number, week: number, lastPossibleWeek: number): readonly WeekRef[] {
  const priorSeason = Array.from({ length: lastPossibleWeek }, (_, index) => ({ season: season - 1, week: index + 1 }));
  const thisSeason = Array.from({ length: Math.max(0, week - 1) }, (_, index) => ({ season, week: index + 1 }));
  return [...priorSeason, ...thisSeason];
}

/**
 * The offence each player was in as of the latest week the context carries for him.
 *
 * "Latest" rather than "the target week's", because the target week's is by construction unknown —
 * a man's team this Sunday is a fact this Sunday produces. A player who last played for Cleveland
 * in week 6 is a Cleveland player for the purposes of a week-7 projection, and becomes a Buffalo
 * player the moment a week-7 snap says so, which is one week later than a transaction wire would
 * have said it and is the earliest this engine can honestly claim to have known.
 */
export function latestTeams(context: TeamContext): ReadonlyMap<string, string> {
  const latestWeek = new Map<string, number>();
  const team = new Map<string, string>();
  for (const row of context.playerTeams) {
    const known = latestWeek.get(row.playerId);
    if (known !== undefined && known >= row.week) continue;
    latestWeek.set(row.playerId, row.week);
    team.set(row.playerId, row.team);
  }
  return team;
}

/** Every player each team had, as of the latest week the context carries. The reverse index. */
export function rostersFrom(teams: ReadonlyMap<string, string>): ReadonlyMap<string, readonly string[]> {
  const byTeam = new Map<string, string[]>();
  for (const [playerId, team] of [...teams.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    (byTeam.get(team) ?? byTeam.set(team, []).get(team)!).push(playerId);
  }
  return byTeam;
}
