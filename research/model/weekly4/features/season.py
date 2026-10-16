"""ONE SEASON OF THE STORE: every club-game's row, and every placed player's, at its own instant,
and the season's team-game and play outcomes through the outcome reader (round 4 preregistration,
sections 2, 5 and 6.3).

The season's play, charted and depth-chart rows are read once, bounded to the build's weeks and its
last instant, and each instant takes its view of them through the recording wrapper (`view.py`,
`players.py`). The season before is read once, at the season's first instant, refused unless no row
of it is stamped between that instant and the last (round 3's exactness rule, `weekly3.read_prior`,
extended to the play table). A live build reads the games still to kick off after its instant, with
the live sources, and builds no outcome.
"""

import time
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.model.reads.observations import LAST_POSSIBLE_WEEK, WeekRange
from research.model.reads.teams import player_teams_as_of
from research.model.weekly3.instant import Schedule, read_schedule
from research.model.weekly3.ledger import SEASON_WIDE, Game, InputRuleError, Stamp
from research.model.weekly3.snapshot import read_prior
from research.model.weekly3.work import player_games
from research.model.weekly4.features import reads
from research.model.weekly4.features.admitted import CLUB_EDGES, admit_read
from research.model.weekly4.features.charted import restamp, week_passes
from research.model.weekly4.features.game import Weather
from research.model.weekly4.features.outcomes import OutcomeReader, play_rows, team_outcomes
from research.model.weekly4.features.players import DepthRule, read_players
from research.model.weekly4.features.plays import Play, Tallies, tally
from research.model.weekly4.features.rows import Row, game_row
from research.model.weekly4.features.shares import GameShare, prior_shares
from research.model.weekly4.features.view import PLAY_PAIRS, SeasonInputs, read_instant, read_week

_PRIOR_PLAYS_BETWEEN: Final = text(
    "select count(*) from research.nflverse_pbp_plays where season = :prior_season and as_of > :after and as_of <= :until"
)


@dataclass(frozen=True, slots=True)
class SeasonSpec:
    season: int
    player_weeks: tuple[int, ...]
    team_weeks: tuple[int, ...]
    depth_rule: DepthRule = "week"
    live_after: datetime | None = None  # a live build: the games kicking off after this instant


@dataclass(frozen=True, slots=True)
class SeasonBuild:
    spec: SeasonSpec
    player_rows: tuple[Row, ...]
    team_rows: tuple[Row, ...]
    play_rows: tuple[Row, ...]
    stamps: tuple[Stamp, ...]
    team_games: tuple[Game, ...]
    player_games: tuple[Game, ...]
    counts: Mapping[str, int] = field(default_factory=dict)
    seconds: float = 0.0


def _game_tallies(plays: Sequence[Play], positions: Mapping[str, str]) -> dict[str, Tallies]:
    by_game: dict[str, list[Play]] = defaultdict(list)
    for play in plays:
        by_game[play.game_id].append(play)
    return {game_id: tally(found, positions) for game_id, found in by_game.items()}


def read_prior_shares(
    conn: Connection, season: int, first: datetime, last: datetime, positions: Mapping[str, str]
) -> tuple[dict[str, tuple[GameShare, ...]], tuple[Stamp, ...]]:
    """Each player's games of the season before with its plays, read once at `first`."""
    prior = season - 1
    rounds = read_prior(conn, season, first, last)  # round 3's read and its exactness check (edges, usage)
    later = int(conn.execute(_PRIOR_PLAYS_BETWEEN, {"prior_season": prior, "after": first, "until": last}).scalar_one())
    if later > 0:
        raise InputRuleError(
            f"{later} plays of {prior} are stamped during {season}'s weeks; one read of the season before is not exact"
        )
    plays = reads.plays(conn, prior, LAST_POSSIBLE_WEEK, first)
    edges = player_teams_as_of(conn, prior, WeekRange(1, LAST_POSSIBLE_WEEK), first)
    stamp = admit_read("prior", (*PLAY_PAIRS, (CLUB_EDGES, "team")), [*plays, *edges], season, SEASON_WIDE, first)
    games = player_games([], edges)
    return prior_shares(games, tally(plays, positions)), (rounds.stamp, stamp)


def _inputs(  # noqa: PLR0913, PLR0917 - the season's reads, named
    conn: Connection,
    spec: SeasonSpec,
    schedule: Schedule,
    positions: Mapping[str, str],
    last: datetime,
    weeks: Sequence[int],
) -> SeasonInputs:
    input_week = max(weeks) - 1
    plays = reads.plays(conn, spec.season, input_week, last)
    charted = restamp(reads.charted(conn, spec.season, input_week, last), week_passes(schedule))
    stadiums = reads.stadiums(conn) if spec.live_after is not None else {}
    return SeasonInputs(
        spec.season,
        schedule,
        tuple(plays),
        _game_tallies(plays, positions),
        tuple(charted),
        stadiums,
        spec.live_after is not None,
    )


def _moments(spec: SeasonSpec, weeks: Sequence[int], schedule: Schedule) -> dict[int, list[datetime]]:
    after = spec.live_after
    return {w: [m for m in schedule.moments(w) if after is None or m > after] for w in weeks}


def build_season(
    conn: Connection, spec: SeasonSpec, positions: Mapping[str, str], reader: OutcomeReader | None
) -> tuple[SeasonBuild, OutcomeReader | None]:
    """The season's rows; `reader` is None for a live build, which reads no outcome."""
    started = time.monotonic()
    weeks = sorted(set(spec.player_weeks) | set(spec.team_weeks))
    schedule = read_schedule(conn, spec.season)
    moments = _moments(spec, weeks, schedule)
    every = sorted(m for found in moments.values() for m in found)
    if not every:
        raise ValueError(f"{spec.season}: no game of weeks {weeks} kicks off after {spec.live_after}")
    s = _inputs(conn, spec, schedule, positions, every[-1], weeks)
    depth_rows: list[reads.DepthRow] = []
    prior: Mapping[str, tuple[GameShare, ...]] = {}
    stamps: list[Stamp] = []
    if spec.player_weeks:
        depth_rows = reads.depth_rows(conn, spec.season, max(weeks), every[-1])
        player_moments = sorted(m for w in spec.player_weeks for m in moments[w])
        prior, prior_stamps = read_prior_shares(conn, spec.season, player_moments[0], player_moments[-1], positions)
        stamps += prior_stamps
    team_rows: list[Row] = []
    player_rows: list[Row] = []
    team_games: list[Game] = []
    placed: list[Game] = []
    weather: dict[str, Weather] = {}
    counts: dict[str, int] = defaultdict(int)
    for week in weeks:
        w = read_week(conn, spec.season, week)
        for moment in moments[week]:
            view = read_instant(conn, s, w, week, moment)
            stamps += view.stamps
            weather.update(view.weather)
            if week in spec.team_weeks:
                team_rows += [game_row(view.games[c]) for c in view.clubs]
                team_games += [Game(spec.season, week, c, moment) for c in view.clubs]
            if week in spec.player_weeks:
                found = read_players(conn, s, view, depth_rows, spec.depth_rule, prior, positions)
                player_rows += found.rows
                stamps += found.stamps
                placed += [Game(spec.season, week, c, moment) for c in view.clubs]
                for name, value in found.counts.items():
                    counts[name] += value
    plays: list[Row] = []
    if reader is not None and spec.team_weeks:
        season_plays, reader = reader.plays(conn, spec.season)
        outcomes = team_outcomes(season_plays)
        team_rows = [{**row, **outcomes.get((str(row["club"]), int(str(row["week"]))), {})} for row in team_rows]
        kept = [p for p in season_plays if p.week in spec.team_weeks]
        plays = play_rows(kept, weather)
    build = SeasonBuild(
        spec,
        tuple(player_rows),
        tuple(team_rows),
        tuple(plays),
        tuple(stamps),
        tuple(team_games),
        tuple(placed),
        dict(counts),
        time.monotonic() - started,
    )
    return build, reader
