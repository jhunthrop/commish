"""THE CONTEXT INGESTS (`src/projections/nflverse/ingest.ts`'s play-by-play, coach and opponent
halves, with `coaches.ts`, `team-context.ts` and `features/context.ts`).

Order matters and is the operator script's (`projection-context.ts`): play-by-play first, because
a coach's prior pace and a defence's rating are both derived from what play-by-play stored. The
two derivations read the store at a far-future instant (the final, corrected word on seasons that
are over); the facts they write carry their own stamps.
"""

import functools
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import Connection, text

from research.pipeline.coaches import PlayCallerLookup, play_caller_lookup, read_coach_rows
from research.pipeline.jscompat import js_locale_compare, js_sum
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import PUBLICATION_LAG_HOURS, Releases
from research.pipeline.nflverse.ingest import schedule_client
from research.pipeline.nflverse.pbp import (
    PBP_COLUMNS,
    PBP_PLAYER_COLUMNS,
    PbpMetric,
    PlayByPlayAggregator,
    PlayerPlayAggregator,
    play_profile_observations,
    player_touch_observations,
)
from research.pipeline.nflverse.schedule import (
    SCHEDULE_FILE,
    SCHEDULE_RELEASE,
    ScheduleSource,
    TeamGame,
    kickoff_as_of,
    map_schedule,
    schedule_published_as_of,
)
from research.pipeline.nflverse.universe_reads import all_positions
from research.pipeline.observations import (
    LAST_POSSIBLE_WEEK,
    TeamWeekObservation,
    record_observations,
    record_team_observations,
)

FAR_FUTURE = datetime(9999, 12, 31, tzinfo=UTC)
CONTEXT_SOURCE = "commish_opponent_adjustment"
_RATING_SHRINKAGE_GAMES = 6


class CoachMetric:
    TENURE_SEASONS = "coach_tenure_seasons"
    PRIOR_PACE = "coach_prior_pace_seconds_per_play"
    PRIOR_PASS_RATE_OVER_EXPECTED = "coach_prior_pass_rate_over_expected"


class ContextMetric:
    OPPONENT_PASS_DEFENCE = "opponent_pass_defence_adjusted"
    OPPONENT_RUSH_DEFENCE = "opponent_rush_defence_adjusted"


# --- play-by-play -------------------------------------------------------------------------------


@dataclass(frozen=True)
class ContextIngestReport:
    season: int
    plays_read: int
    team_weeks: int
    player_weeks: int
    observations_written: int
    unknown_players: int


def ingest_play_by_play(conn: Connection, client: NflverseClient, season: int) -> ContextIngestReport:
    """`ingestPlayByPlay`: one stream, two accumulators, team-week and player-week facts."""
    teams = PlayByPlayAggregator()
    players = PlayerPlayAggregator()
    columns = tuple(dict.fromkeys((*PBP_COLUMNS, *PBP_PLAYER_COLUMNS)))

    def on_row(row: Mapping[str, str]) -> None:
        teams.add(row)
        players.add(row)

    plays = client.stream_csv(Releases.PBP, f"play_by_play_{season}.csv", columns, on_row)
    profiles = teams.profiles()
    observations = play_profile_observations(profiles, lambda p: kickoff_as_of(p.game_date, PUBLICATION_LAG_HOURS))
    projected = frozenset(all_positions(conn))
    touches = player_touch_observations(
        players.touches(), lambda game_date: kickoff_as_of(game_date, PUBLICATION_LAG_HOURS), projected
    )
    player_weeks = len({f"{o.week}|{o.player_id}" for o in touches.observations})
    written = record_team_observations(conn, observations) + record_observations(conn, touches.observations)
    return ContextIngestReport(season, plays, len(profiles), player_weeks, written, len(touches.unknown_players))


# --- reading the team store back ----------------------------------------------------------------

_TEAM_OBSERVATIONS_AS_OF = text(
    "select distinct on (week, team, source, metric) season, week, team, source, metric, value, as_of "
    "from team_week_observations "
    "where season = :season and week >= :week_from and week <= :week_to and as_of <= :as_of "
    "order by week asc, team asc, source asc, metric asc, as_of desc"
)


def team_observations_as_of(conn: Connection, season: int, as_of: datetime) -> list[TeamWeekObservation]:
    """`teamObservationsAsOf` over the whole season: the latest statement of each fact at `as_of`.
    The same SQL, so the same order, which `index_team_metrics` (last row wins) depends on."""
    rows = conn.execute(
        _TEAM_OBSERVATIONS_AS_OF, {"season": season, "week_from": 1, "week_to": LAST_POSSIBLE_WEEK, "as_of": as_of}
    )
    return [TeamWeekObservation(r.season, r.week, r.team, r.source, r.metric, r.value, r.as_of) for r in rows]


TeamMetricLookup = Callable[[str, int, int, str], float | None]


def index_team_metrics(observations: Sequence[TeamWeekObservation]) -> TeamMetricLookup:
    """`indexTeamMetrics`: keyed on team, season, week and metric, NOT source; the last row wins."""
    by_key: dict[str, float] = {}
    for row in observations:
        by_key[f"{row.team}|{row.season}|{row.week}|{row.metric}"] = row.value
    return lambda team, season, week, metric: by_key.get(f"{team}|{season}|{week}|{metric}")


def _history_observations(conn: Connection, seasons: range) -> list[TeamWeekObservation]:
    observations: list[TeamWeekObservation] = []
    for season in seasons:
        observations.extend(team_observations_as_of(conn, season, FAR_FUTURE))
    return observations


def _mean(values: Sequence[float]) -> float | None:
    return None if not values else js_sum(values) / len(values)


# --- coaches ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class _TeamSeasonCoach:
    season: int
    team: str
    coach: str


def _most_frequent(counts: dict[str, int]) -> str:
    def order(a: tuple[str, int], b: tuple[str, int]) -> int:
        return (b[1] - a[1]) or js_locale_compare(a[0], b[0])

    return sorted(counts.items(), key=functools.cmp_to_key(order))[0][0]


def coach_by_team_season(games: Sequence[TeamGame]) -> list[_TeamSeasonCoach]:
    counts: dict[str, dict[str, int]] = {}
    for game in games:
        for_team = counts.setdefault(f"{game.season}|{game.team}", {})
        for_team[game.coach] = for_team.get(game.coach, 0) + 1
    rows = []
    for key, for_team in counts.items():
        season, team = key.split("|")[:2]
        rows.append(_TeamSeasonCoach(int(season), team, _most_frequent(for_team)))

    def order(a: _TeamSeasonCoach, b: _TeamSeasonCoach) -> int:
        return (a.season - b.season) or js_locale_compare(a.team, b.team)

    return sorted(rows, key=functools.cmp_to_key(order))


def _attributed(
    games: Sequence[TeamGame], head_coaches: list[_TeamSeasonCoach], play_caller: PlayCallerLookup | None
) -> list[_TeamSeasonCoach]:
    if play_caller is None:
        return head_coaches
    attributed = []
    for row in head_coaches:
        counts: dict[str, int] = {}
        for game in games:
            if game.season != row.season or game.team != row.team:
                continue
            name = play_caller(row.team, row.season, game.week)
            if name is not None:
                counts[name] = counts.get(name, 0) + 1
        attributed.append(row if not counts else _TeamSeasonCoach(row.season, row.team, _most_frequent(counts)))
    return attributed


SeasonMean = Callable[[str, int, str], float | None]


def season_means(read: TeamMetricLookup, weeks: Sequence[int]) -> SeasonMean:
    def mean(team: str, season: int, metric: str) -> float | None:
        return _mean([v for week in weeks if (v := read(team, season, week, metric)) is not None])

    return mean


def coach_observations(
    games: Sequence[TeamGame], season_mean: SeasonMean, seasons: Sequence[int], play_caller: PlayCallerLookup | None
) -> list[TeamWeekObservation]:
    """`coachObservations`: tenure, and an incoming play-caller's pace and pass rate elsewhere."""
    by_team_season = _attributed(games, coach_by_team_season(games), play_caller)
    coach_of = {f"{r.season}|{r.team}": r.coach for r in by_team_season}
    wanted = set(seasons)
    team_seasons = list(dict.fromkeys(f"{g.season}|{g.team}" for g in games if g.season in wanted))
    rows: list[TeamWeekObservation] = []
    for key in team_seasons:
        season_text, team = key.split("|", 1)
        season = int(season_text)
        week1 = next((g for g in games if g.season == season and g.team == team and g.week == 1), None)
        if week1 is None:
            continue
        called = play_caller(team, season, 1) if play_caller is not None else None
        coach = called if called is not None else week1.coach
        tenure = 0
        while coach_of.get(f"{season - tenure - 1}|{team}") == coach:
            tenure += 1
        elsewhere = [r for r in by_team_season if r.coach == coach and r.season < season and r.team != team]

        def prior(metric: str, elsewhere: list[_TeamSeasonCoach] = elsewhere) -> float | None:
            return _mean([v for r in elsewhere if (v := season_mean(r.team, r.season, metric)) is not None])

        pace = prior(PbpMetric.PACE_SECONDS_PER_PLAY)
        proe = prior(PbpMetric.PASS_RATE_OVER_EXPECTED)
        stamp = schedule_published_as_of(season)
        facts = [(CoachMetric.TENURE_SEASONS, float(tenure))]
        if pace is not None:
            facts.append((CoachMetric.PRIOR_PACE, pace))
        if proe is not None:
            facts.append((CoachMetric.PRIOR_PASS_RATE_OVER_EXPECTED, proe))
        for game in (g for g in games if g.season == season and g.team == team):
            for metric, value in facts:
                rows.append(TeamWeekObservation(season, game.week, team, ScheduleSource.SCHEDULE, metric, value, stamp))
    return rows


def ingest_coaches(conn: Connection, client: NflverseClient, seasons: Sequence[int]) -> int:
    """`ingestCoaches`: refuses an empty coaches table before fetching anything."""
    table = read_coach_rows(conn)
    if not table:
        raise ValueError("The coaches table is empty. Run `npm run coaches:ingest` before the coach observations.")
    play_callers = play_caller_lookup(table)
    rows = schedule_client(client).get_csv(SCHEDULE_RELEASE, SCHEDULE_FILE)
    history = range(min(seasons), max(seasons) + 1)
    games = map_schedule(rows, list(history))
    metrics = index_team_metrics(_history_observations(conn, history))
    weeks = list(range(1, LAST_POSSIBLE_WEEK + 1))
    return record_team_observations(
        conn, coach_observations(games, season_means(metrics, weeks), seasons, play_callers)
    )


# --- the opponent adjustment --------------------------------------------------------------------


@dataclass(frozen=True)
class DefenceWeek:
    season: int
    week: int
    defence: str
    offence: str
    pass_allowed: float | None
    rush_allowed: float | None
    as_of: datetime


def _shrunk_ratio(values: Sequence[float], league: float) -> float:
    if not values or league <= 0:
        return 1.0
    own = (js_sum(values) / len(values)) / league
    return (len(values) * own + _RATING_SHRINKAGE_GAMES) / (len(values) + _RATING_SHRINKAGE_GAMES)


def defence_ratings(weeks: Sequence[DefenceWeek]) -> dict[str, tuple[float, float]]:
    """`defenceRatings`: what each defence allowed against what its opponents usually gain, shrunk."""
    pass_values = [w.pass_allowed for w in weeks if w.pass_allowed is not None]
    rush_values = [w.rush_allowed for w in weeks if w.rush_allowed is not None]
    league_pass = 0.0 if not pass_values else js_sum(pass_values) / len(pass_values)
    league_rush = 0.0 if not rush_values else js_sum(rush_values) / len(rush_values)
    if league_pass <= 0 or league_rush <= 0:
        return {}
    by_offence: dict[str, list[DefenceWeek]] = {}
    for w in weeks:
        by_offence.setdefault(w.offence, []).append(w)
    strength = {
        offence: (
            _shrunk_ratio([g.pass_allowed for g in games if g.pass_allowed is not None], league_pass),
            _shrunk_ratio([g.rush_allowed for g in games if g.rush_allowed is not None], league_rush),
        )
        for offence, games in by_offence.items()
    }
    by_defence: dict[str, list[DefenceWeek]] = {}
    for w in weeks:
        by_defence.setdefault(w.defence, []).append(w)
    ratings: dict[str, tuple[float, float]] = {}
    for defence, games in by_defence.items():
        passes = [g.pass_allowed / strength.get(g.offence, (1.0, 1.0))[0] for g in games if g.pass_allowed is not None]
        rushes = [g.rush_allowed / strength.get(g.offence, (1.0, 1.0))[1] for g in games if g.rush_allowed is not None]
        ratings[defence] = (_shrunk_ratio(passes, league_pass), _shrunk_ratio(rushes, league_rush))
    return ratings


def opponent_defence_observations(
    games: Sequence[TeamGame], defence_weeks: Sequence[DefenceWeek], seasons: Sequence[int]
) -> list[TeamWeekObservation]:
    rows: list[TeamWeekObservation] = []
    for season in seasons:
        this_season = [w for w in defence_weeks if w.season == season]
        prior_season = [w for w in defence_weeks if w.season == season - 1]
        prior_ratings = defence_ratings(prior_season)
        prior_as_of = max((w.as_of for w in prior_season), default=None)
        for week in sorted({g.week for g in games if g.season == season}):
            informing = [w for w in this_season if w.week < week]
            ratings = prior_ratings if not informing else defence_ratings(informing)
            as_of = prior_as_of if not informing else max(w.as_of for w in informing)
            if as_of is None:
                continue
            for game in (g for g in games if g.season == season and g.week == week):
                rating = ratings.get(game.opponent, (1.0, 1.0))
                rows.append(
                    TeamWeekObservation(
                        season, week, game.team, CONTEXT_SOURCE, ContextMetric.OPPONENT_PASS_DEFENCE, rating[0], as_of
                    )
                )
                rows.append(
                    TeamWeekObservation(
                        season, week, game.team, CONTEXT_SOURCE, ContextMetric.OPPONENT_RUSH_DEFENCE, rating[1], as_of
                    )
                )
    return rows


def ingest_opponent_defence(conn: Connection, client: NflverseClient, seasons: Sequence[int]) -> int:
    """`ingestOpponentDefence`: the prior season too, so week 1 carries last season's ratings."""
    rows = schedule_client(client).get_csv(SCHEDULE_RELEASE, SCHEDULE_FILE)
    history = range(min(seasons) - 1, max(seasons) + 1)
    games = map_schedule(rows, list(history))
    metrics = index_team_metrics(_history_observations(conn, history))
    defence_weeks = [
        DefenceWeek(
            g.season, g.week, g.team, g.opponent,
            metrics(g.team, g.season, g.week, PbpMetric.PASS_YARDS_ALLOWED_PER_DROPBACK),
            metrics(g.team, g.season, g.week, PbpMetric.RUSH_YARDS_ALLOWED_PER_CARRY),
            g.kickoff_as_of,
        )
        for g in games
    ]  # fmt: skip
    return record_team_observations(conn, opponent_defence_observations(games, defence_weeks, seasons))
