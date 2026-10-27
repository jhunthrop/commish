"""THE PROBE'S READS FROM DEV (read only, season-guarded): stat lines, positions, ADP, clubs, the
game pairings and the implied points. Every season passes `admit_season` first.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final, cast

import pandas as pd
from sqlalchemy import Connection, text

from research.explore.scheme_elasticity.seasons import CLOSED_SEASONS, LAST_WEEK, admit_season
from research.model.domain import Position
from research.model.instants import FAR_FUTURE
from research.model.reads.observations import WeekRange
from research.model.reads.preseason import all_positions, preseason_rankings_as_of
from research.model.reads.teams import first_kickoff_for, player_teams_as_of
from research.model.weekly2.guard import WeekOutcomeReader
from research.model.weekly4.play_model import FORMAT_NAMES

ADP_SOURCE: Final = "ffc_adp_ppr_12"
SKILL: Final = ("QB", "RB", "WR", "TE")

_PAIRINGS: Final = text(
    """
    select season, week, home_team, away_team from research.nflverse_games
    where season = any(:seasons) and game_type = 'REG' and week <= 17
    """
)
_IMPLIED: Final = text(
    """
    select season, week, team as club, value as implied_points from research.team_week_observations
    where season = any(:seasons) and source = 'nflverse_kickoff' and metric = 'implied_team_total'
      and week <= 17
    """
)


@dataclass(frozen=True, slots=True)
class SeasonInputs:
    """One season: lines (week, player_id, club, position, each format), the pairings (week, club,
    opponent), the implied points (week, club, implied_points) and ADP ranks."""

    season: int
    lines: pd.DataFrame
    pairing: pd.DataFrame
    teams: pd.DataFrame
    adp: Mapping[str, float]


def skill_positions(conn: Connection) -> dict[str, str]:
    found: dict[str, Position] = all_positions(conn)
    return {pid: str(p) for pid, p in found.items() if p in SKILL}


def lines_of(conn: Connection, season: int, positions: Mapping[str, str]) -> pd.DataFrame:
    """Every lined player-week through week 17 in each format, with his week's club."""
    reader = WeekOutcomeReader(frozenset(CLOSED_SEASONS))
    typed = cast("dict[str, Position]", dict(positions))
    weeks, _ = reader.season(conn, admit_season(season), typed)
    clubs = {
        (t.week, t.player_id): t.team for t in player_teams_as_of(conn, season, WeekRange(1, LAST_WEEK), FAR_FUTURE)
    }
    rows = [
        {"week": week, "player_id": pid, "club": clubs.get((week, pid)), "position": positions[pid], **dict(points)}
        for week, by in weeks.items()
        for pid, points in by.items()
        if pid in positions
    ]
    return pd.DataFrame(rows, columns=["week", "player_id", "club", "position", *FORMAT_NAMES])


def pairings(conn: Connection, season: int) -> pd.DataFrame:
    games = pd.DataFrame(conn.execute(_PAIRINGS, {"seasons": [admit_season(season)]}).mappings().all())
    home = games.rename(columns={"home_team": "club", "away_team": "opponent"})
    away = games.rename(columns={"away_team": "club", "home_team": "opponent"})
    return pd.concat([home, away], ignore_index=True)[["week", "club", "opponent"]]


def implied(conn: Connection, season: int) -> pd.DataFrame:
    found = pd.DataFrame(conn.execute(_IMPLIED, {"seasons": [admit_season(season)]}).mappings().all())
    return found[["week", "club", "implied_points"]]


def adp_ranks(conn: Connection, season: int) -> dict[str, float]:
    kickoff = first_kickoff_for(conn, admit_season(season))
    moment = kickoff if kickoff is not None else FAR_FUTURE
    return {r.player_id: float(r.rank) for r in preseason_rankings_as_of(conn, season, ADP_SOURCE, moment)}


def season_inputs(conn: Connection, season: int, positions: Mapping[str, str]) -> SeasonInputs:
    pairing = pairings(conn, season)
    teams = pairing.merge(implied(conn, season), on=["week", "club"], how="left")
    return SeasonInputs(season, lines_of(conn, season, positions), pairing, teams, adp_ranks(conn, season))
