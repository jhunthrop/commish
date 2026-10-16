"""WHAT ONE INSTANT SEES, FOR THE GAME TERMS: every club-game kicking off at t_g + 1 ms, read through
the recording wrapper (round 4 preregistration, section 5).

At t_g: the play rows of earlier weeks stamped at or before t_g (`plays`), the club rows of earlier
weeks (`box`), the charted rows admitted at their Wednesday pass (`charted`), week W's closing
figures at the kickoff (`figures`; live: `live_figures` and `forecast` at t_g), week W's recorded
weather by name (`weather`), and week W's schedule rows (`schedule`). Each read is refused if it
selects a pair outside its kind's list or returns a row its kind does not admit.
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType

from sqlalchemy import Connection

from research.model.weekly3.allowance import TeamRows
from research.model.weekly3.instant import Schedule
from research.model.weekly3.ledger import ONE_MS, Stamp
from research.model.weekly4.features import reads
from research.model.weekly4.features.admitted import GAME_WEATHER, PLAYS, admit_observations, admit_read
from research.model.weekly4.features.game import (
    Figures,
    Weather,
    live_figures,
    live_weather,
    replay_figures,
    replay_weather,
    venue,
)
from research.model.weekly4.features.matchup import Pressured, club_tempo, defence_pressure, league_pace
from research.model.weekly4.features.plays import PLAY_COLUMNS, Play, Tallies, merge
from research.model.weekly4.features.reads import WeatherRow, as_of_rows
from research.model.weekly4.features.rows import ClubGame
from research.pipeline.nflverse.pfr_advstats import PFR_SOURCE
from research.pipeline.observations import PlayerWeekObservation, TeamWeekObservation

PLAY_PAIRS = tuple((PLAYS, column) for column in PLAY_COLUMNS)
WEATHER_PAIRS = tuple((GAME_WEATHER, column) for column in reads.WEATHER_SELECTED)
PRESSURED_METRIC = "times_pressured"


@dataclass(frozen=True, slots=True)
class SeasonInputs:
    """The season's rows read once, bounded to the build's weeks and its last instant."""

    season: int
    schedule: Schedule
    plays: Sequence[Play]
    game_tallies: Mapping[str, Tallies]  # game_id -> its plays' tallies
    charted: Sequence[PlayerWeekObservation]  # restamped at their Wednesday pass
    stadiums: Mapping[str, reads.Stadium]
    live: bool


@dataclass(frozen=True, slots=True)
class WeekInputs:
    """Week W's own rows: the recorded weather per club, the schedule rows per club."""

    weather: Mapping[str, WeatherRow]
    schedule: Mapping[str, Mapping[str, float]]
    schedule_rows: Sequence[TeamWeekObservation]


@dataclass(frozen=True, slots=True)
class InstantView:
    week: int
    moment: datetime
    clubs: tuple[str, ...]  # the clubs whose game kicks off at this instant
    tallies: Tallies
    team_rows: TeamRows
    charted: Sequence[PlayerWeekObservation]
    games: Mapping[str, ClubGame]
    weather: Mapping[str, Weather]  # game_id -> the game's weather terms
    stamps: tuple[Stamp, ...]


def read_week(conn: Connection, season: int, week: int) -> WeekInputs:
    by_club: dict[str, WeatherRow] = {}
    for row in reads.weather(conn, season, week):
        by_club[row.home_team] = by_club[row.away_team] = row
    rows = reads.team_rows(conn, "schedule", season, week, week, reads.SCHEDULE_UNTIL)
    found: dict[str, dict[str, float]] = defaultdict(dict)
    for r in rows:
        found[r.team][r.metric] = r.value
    return WeekInputs(MappingProxyType(by_club), MappingProxyType(dict(found)), tuple(rows))


def _pressured(rows: Sequence[PlayerWeekObservation]) -> Pressured:
    found: dict[int, dict[str, float]] = defaultdict(dict)
    for row in rows:
        if row.source == PFR_SOURCE and row.metric == PRESSURED_METRIC:
            found[row.week][row.player_id] = row.value
    return found


def _figures(
    conn: Connection, s: SeasonInputs, week: int, moment: datetime
) -> tuple[list[TeamWeekObservation], list[Stamp]]:
    if s.live:
        figures = reads.team_rows(conn, "live_figures", s.season, week, week, moment)
        forecast = reads.team_rows(conn, "forecast", s.season, week, week, moment)
        stamps = [
            admit_observations("live_figures", figures, s.season, week, moment),
            admit_observations("forecast", forecast, s.season, week, moment),
        ]
        return [*figures, *forecast], stamps
    figures = reads.team_rows(conn, "figures", s.season, week, week, moment + ONE_MS)
    return figures, [admit_observations("figures", figures, s.season, week, moment)]


def _club_game(  # noqa: PLR0913, PLR0917 - one club-game's every read, named
    s: SeasonInputs,
    w: WeekInputs,
    view_rows: Sequence[TeamWeekObservation],
    club: str,
    week: int,
    moment: datetime,
    tallies: Tallies,
    team_rows: TeamRows,
    pressured: Pressured,
) -> tuple[ClubGame, str]:
    opponent = s.schedule.opponent(week, club)
    home = s.schedule.home(week, club)
    if opponent is None or home is None:
        raise ValueError(f"{s.season} week {week} {club}: no pairing or home-field row")
    row = w.weather.get(club)
    sched = w.schedule.get(club, {})
    if s.live:
        figures: Figures = live_figures(view_rows, club, opponent, moment)
        stadium = None if row is None or row.stadium_id is None else s.stadiums.get(row.stadium_id)
        weather: Weather = live_weather(stadium, view_rows, club)
    else:
        figures = replay_figures(view_rows, club, opponent)
        weather = replay_weather(row, sched.get("indoors"))
    league = league_pace(team_rows)
    game = ClubGame(
        s.season,
        week,
        "" if row is None else row.game_id,
        club,
        opponent,
        moment,
        figures,
        weather,
        venue(sched, home),
        club_tempo(club, week, s.schedule, team_rows, league),
        club_tempo(opponent, week, s.schedule, team_rows, league),
        defence_pressure(opponent, week, s.schedule, tallies, pressured),
    )
    return game, game.game_id


def read_instant(conn: Connection, s: SeasonInputs, w: WeekInputs, week: int, moment: datetime) -> InstantView:
    season = s.season
    clubs = tuple(sorted(c for (wk, c) in s.schedule.kickoffs if wk == week and s.schedule.instant(wk, c) == moment))
    plays = as_of_rows(s.plays, 1, week - 1, moment)
    tallies = merge(s.game_tallies[g] for g in sorted({p.game_id for p in plays}))
    club_obs = reads.team_rows(conn, "box", season, 1, week - 1, moment) if week > 1 else []
    charted = as_of_rows(s.charted, 1, week - 1, moment)
    view_rows, stamps = _figures(conn, s, week, moment)
    weather_rows = sorted(
        {w.weather[c].game_id: w.weather[c] for c in clubs if c in w.weather}.values(), key=lambda r: r.game_id
    )
    stamps += [
        admit_read("plays", PLAY_PAIRS, plays, season, week, moment),
        admit_observations("box", club_obs, season, week, moment),
        admit_observations("charted", charted, season, week, moment),
        admit_read("weather", WEATHER_PAIRS, weather_rows, season, week, moment),
        admit_observations("schedule", [r for r in w.schedule_rows if r.team in clubs], season, week, moment),
    ]
    team_rows: dict[tuple[str, int], dict[str, float]] = defaultdict(dict)
    for r in club_obs:
        team_rows[(r.team, r.week)][r.metric] = r.value
    frozen = MappingProxyType({k: MappingProxyType(v) for k, v in team_rows.items()})
    pressured = _pressured(charted)
    games: dict[str, ClubGame] = {}
    weather: dict[str, Weather] = {}
    for club in clubs:
        game, game_id = _club_game(s, w, view_rows, club, week, moment, tallies, frozen, pressured)
        games[club] = game
        weather[game_id] = game.weather
    return InstantView(
        week,
        moment,
        clubs,
        tallies,
        frozen,
        tuple(charted),
        MappingProxyType(games),
        MappingProxyType(weather),
        tuple(stamps),
    )
