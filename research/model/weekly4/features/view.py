"""WHAT ONE INSTANT SEES, FOR THE GAME TERMS: every club-game kicking off at t_g + 1 ms, read through
the recording wrapper (round 4 preregistration, section 5).

At t_g: the play rows of earlier weeks stamped at or before t_g (`plays`), the club rows of earlier
weeks (`box`), the charted rows (each row's newest version stored at or before t_g, admitted at its
Wednesday pass: `charted`), week W's closing figures at the kickoff (`figures`; live: `live_figures`
and `forecast` at t_g), week W's recorded weather by name (`weather`), and week W's schedule
knowledge (`schedule`: the schedule rows, the game's surface, the stadium row). Each read is refused
if it selects a pair outside its kind's list or returns a row its kind does not admit.
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
from research.model.weekly4.features.admitted import (
    GAME_SURFACE_COLUMNS,
    GAME_WEATHER,
    GAMES,
    PLAYS,
    PRESSURED_METRIC,
    STADIUM_COLUMNS,
    STADIUMS,
    admit_observations,
    admit_read,
)
from research.model.weekly4.features.charted import charted_at
from research.model.weekly4.features.game import (
    Figures,
    Weather,
    live_figures,
    live_weather,
    replay_figures,
    replay_weather,
    venue,
)
from research.model.weekly4.features.matchup import (
    Pressured,
    club_tempo,
    defence_pressure,
    league_pace,
    pass_rate_allowed,
)
from research.model.weekly4.features.plays import PLAY_COLUMNS, Play, Tallies, merge
from research.model.weekly4.features.reads import GameSurface, Stadium, WeatherRow, as_of_rows
from research.model.weekly4.features.rows import ClubGame
from research.pipeline.nflverse.pfr_advstats import PFR_SOURCE
from research.pipeline.observations import PlayerWeekObservation, TeamWeekObservation

PLAY_PAIRS = tuple((PLAYS, column) for column in PLAY_COLUMNS)
WEATHER_PAIRS = tuple((GAME_WEATHER, column) for column in reads.WEATHER_SELECTED)
SURFACE_PAIRS = tuple((GAMES, column) for column in GAME_SURFACE_COLUMNS)
STADIUM_PAIRS = tuple((STADIUMS, column) for column in STADIUM_COLUMNS)


@dataclass(frozen=True, slots=True)
class SeasonInputs:
    """The season's rows read once, bounded to the build's weeks and its last instant."""

    season: int
    schedule: Schedule
    plays: Sequence[Play]
    game_tallies: Mapping[str, Tallies]  # game_id -> its plays' tallies
    charted: Sequence[PlayerWeekObservation]  # every stored version, at its stored stamp
    passes: Mapping[int, datetime]  # each week's Wednesday pass (item 8)
    stadiums: Mapping[str, Stadium]
    live: bool


@dataclass(frozen=True, slots=True)
class WeekInputs:
    """Week W's own rows: the recorded weather and the schedule rows per club, the games' surfaces."""

    weather: Mapping[str, WeatherRow]
    schedule: Mapping[str, Mapping[str, float]]
    schedule_rows: Sequence[TeamWeekObservation]
    surfaces: Mapping[str, GameSurface]  # game_id -> its recorded surface


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


@dataclass(frozen=True, slots=True)
class _VenueCell:
    """A stadium row as the schedule read of week W carries it (admitted by name, item 4)."""

    season: int
    week: int
    as_of: datetime


def read_week(conn: Connection, season: int, week: int) -> WeekInputs:
    by_club: dict[str, WeatherRow] = {}
    for row in reads.weather(conn, season, week):
        by_club[row.home_team] = by_club[row.away_team] = row
    rows = reads.team_rows(conn, "schedule", season, week, week, reads.SCHEDULE_UNTIL)
    found: dict[str, dict[str, float]] = defaultdict(dict)
    for r in rows:
        found[r.team][r.metric] = r.value
    surfaces = reads.game_surfaces(conn, season, week)
    return WeekInputs(MappingProxyType(by_club), MappingProxyType(dict(found)), tuple(rows), MappingProxyType(surfaces))


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


def _game_opponent(row: WeatherRow | None, club: str) -> str | None:
    """A game still to be played has no pairing row (the pairing is built from its play-by-play);
    its opponent is the other club of its schedule row (`game_weather`, week W's, admitted)."""
    if row is None:
        return None
    return row.away_team if row.home_team == club else row.home_team


@dataclass(frozen=True, slots=True)
class _At:
    """One instant's reads, shared by its club-games."""

    s: SeasonInputs
    w: WeekInputs
    week: int
    moment: datetime
    view_rows: Sequence[TeamWeekObservation]
    tallies: Tallies
    team_rows: TeamRows
    pressured: Pressured


def _stadium(at: _At, row: WeatherRow | None) -> Stadium | None:
    return None if row is None or row.stadium_id is None else at.s.stadiums.get(row.stadium_id)


def _club_game(at: _At, club: str) -> ClubGame:
    s, week = at.s, at.week
    row = at.w.weather.get(club)
    opponent = s.schedule.opponent(week, club) or _game_opponent(row, club)
    home = s.schedule.home(week, club)
    if opponent is None or home is None:
        raise ValueError(f"{s.season} week {week} {club}: no pairing or home-field row")
    sched = at.w.schedule.get(club, {})
    stadium = _stadium(at, row)
    if s.live:
        figures: Figures = live_figures(at.view_rows, club, opponent, at.moment)
        weather: Weather = live_weather(stadium, at.view_rows, club)
    else:
        figures = replay_figures(at.view_rows, club, opponent)
        weather = replay_weather(row, sched.get("indoors"))
    surface = None if row is None or row.game_id not in at.w.surfaces else at.w.surfaces[row.game_id].surface
    league = league_pace(at.team_rows)
    return ClubGame(
        s.season,
        week,
        "" if row is None else row.game_id,
        club,
        opponent,
        at.moment,
        figures,
        weather,
        venue(sched, home, surface, stadium),
        club_tempo(club, week, s.schedule, at.team_rows, league),
        club_tempo(opponent, week, s.schedule, at.team_rows, league),
        defence_pressure(opponent, week, s.schedule, at.tallies, at.pressured),
        pass_rate_allowed(opponent, week, s.schedule, at.team_rows),
    )


def _schedule_stamps(s: SeasonInputs, w: WeekInputs, clubs: Sequence[str], week: int, moment: datetime) -> list[Stamp]:
    """The schedule knowledge the instant's games read: their schedule rows, surfaces and stadiums."""
    games = {w.weather[c].game_id: w.weather[c] for c in clubs if c in w.weather}
    surfaces = [w.surfaces[g] for g in sorted(games) if g in w.surfaces]
    venues = sorted({r.stadium_id for r in games.values() if r.stadium_id is not None and r.stadium_id in s.stadiums})
    cells = [_VenueCell(s.season, week, s.stadiums[v].read_at) for v in venues]
    return [
        admit_observations("schedule", [r for r in w.schedule_rows if r.team in clubs], s.season, week, moment),
        admit_read("schedule", SURFACE_PAIRS, surfaces, s.season, week, moment),
        admit_read("schedule", STADIUM_PAIRS, cells, s.season, week, moment),
    ]


def read_instant(conn: Connection, s: SeasonInputs, w: WeekInputs, week: int, moment: datetime) -> InstantView:
    season = s.season
    clubs = tuple(sorted(c for (wk, c) in s.schedule.kickoffs if wk == week and s.schedule.instant(wk, c) == moment))
    plays = as_of_rows(s.plays, 1, week - 1, moment)
    tallies = merge(s.game_tallies[g] for g in sorted({p.game_id for p in plays}))
    club_obs = reads.team_rows(conn, "box", season, 1, week - 1, moment) if week > 1 else []
    charted = charted_at(s.charted, s.passes, week, moment)
    view_rows, stamps = _figures(conn, s, week, moment)
    weather_rows = sorted(
        {w.weather[c].game_id: w.weather[c] for c in clubs if c in w.weather}.values(), key=lambda r: r.game_id
    )
    stamps += [
        admit_read("plays", PLAY_PAIRS, plays, season, week, moment),
        admit_observations("box", club_obs, season, week, moment),
        admit_observations("charted", charted, season, week, moment),
        admit_read("weather", WEATHER_PAIRS, weather_rows, season, week, moment),
        *_schedule_stamps(s, w, clubs, week, moment),
    ]
    team_rows: dict[tuple[str, int], dict[str, float]] = defaultdict(dict)
    for r in club_obs:
        team_rows[(r.team, r.week)][r.metric] = r.value
    frozen = MappingProxyType({k: MappingProxyType(v) for k, v in team_rows.items()})
    at = _At(s, w, week, moment, view_rows, tallies, frozen, _pressured(charted))
    games = {club: _club_game(at, club) for club in clubs}
    weather = {g.game_id: g.weather for g in games.values()}
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
