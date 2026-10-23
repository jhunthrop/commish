# ruff: noqa: PLR2004 - a synthetic season's rates, drawn from a fixed generator
"""Synthetic seasons for the weekly kicker and team-defense sub-round's tests (Lane 157): eight clubs, a
few weeks a season, every table the run reads (the kickoffs, the kicking and team-defense weeks, the kick
plays, the players and their ESPN ids, ESPN's archived projections) and round 4's store team files with
their build report. Nothing here is a real season's figure: the values are drawn from a fixed generator.
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Final

import numpy as np
from sqlalchemy import Connection, insert

from research.db.schema import (
    ESPN_KDEF_ARCHIVE_ROWS,
    NFLVERSE_DEPTH_CHART_WEEKS,
    NFLVERSE_KICKING_WEEKS,
    NFLVERSE_PBP_PLAYS,
    NFLVERSE_TEAM_DEFENSE_WEEKS,
    PLAYERS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.model.weekly3.instant import game_instant
from research.model.weekly4.features.columns import TEAM_SCHEMA
from research.model.weekly4.features.store import TEAM_KEY, write_rows
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource
from research.pipeline.nflverse.team_codes import team_defense_espn_id

CLUBS: Final = ("ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE")
BANDS: Final = ("0_19", "20_29", "30_39", "40_49", "50_59", "60")
BAND_DISTANCE: Final = (19, 25, 35, 45, 53, 61)
FIRST_SUNDAY: Final = {s: datetime(s, 9, 11, 17, 0, tzinfo=UTC) for s in range(2013, 2025)}
LATE: Final = timedelta(hours=3, minutes=25)
DROPBACKS: Final = 12  # a synthetic game's dropbacks, enough to read a passer's rate
CHART_LEAD: Final = timedelta(days=2)


@dataclass(frozen=True, slots=True)
class Synthetic:
    seasons: tuple[int, ...]
    weeks: tuple[int, ...]
    archive_weeks: tuple[int, ...]
    archive_season: int


def kicker(club: str) -> str:
    return f"00-00K{club}"


def passer(club: str) -> str:
    return f"00-00Q{club}"


def kicker_espn(club: str) -> str:
    return str(900_000 + CLUBS.index(club))


def _pairs(week: int) -> list[tuple[str, str]]:
    """Four games a week, the clubs rotated; the first club of each pair is at home."""
    order = list(CLUBS[:1]) + list(np.roll(np.array(CLUBS[1:]), week - 1))
    return [(order[i], order[-1 - i]) for i in range(len(order) // 2)]


def kickoff(season: int, week: int, slot: int) -> datetime:
    return FIRST_SUNDAY[season] + timedelta(days=7 * (week - 1)) + (LATE if slot else timedelta(0))


def _team_row(  # noqa: PLR0913, PLR0917 - a synthetic row's every coordinate
    season: int,
    week: int,
    club: str,
    opponent: str,
    home: float,
    moment: datetime,
    implied: float,
    rng: np.random.Generator,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        name: (0 if kind == "int" else (None if kind == "str" else float(rng.uniform(0.2, 0.8))))
        for name, kind in TEAM_SCHEMA
    }
    row |= {
        "season": season,
        "week": week,
        "game_id": f"{season}_{week:02d}_{club}_{opponent}",
        "club": club,
        "opponent": opponent,
        "instant": game_instant(moment).isoformat(),
        "home": home,
        "rest_days": 7.0,
        "division_game": 0.0,
        "implied_points": implied,
        "spread": float(rng.normal(0, 3)),
        "figure_source": "synthetic",
        "roof": "outdoors" if home else "dome",
        "indoor": 0.0 if home else 1.0,
        "temperature_f": float(rng.uniform(30, 85)),
        "wind_mph": float(rng.uniform(0, 20)),
        "precipitation": float(rng.uniform(0, 1) < 0.2),
        "precipitation_probability": None,
        "surface": "grass" if home else "fieldturf",
        "plays": float(rng.poisson(63)),
        "dropbacks": float(rng.poisson(38)),
        "sacks": float(rng.poisson(2.4)),
        "scrambles": float(rng.poisson(2)),
        "designed_rushes": float(rng.poisson(24)),
        "team_targets": float(rng.poisson(33)),
        "rushing_touchdowns": float(rng.poisson(0.9)),
        "receiving_touchdowns": float(rng.poisson(1.4)),
    }
    return row


def build(conn: Connection, store: Path, spec: Synthetic, seed: int = 7) -> None:
    """Every table the run reads, and the store's team files with their report."""
    rng = np.random.default_rng(seed)
    conn.execute(
        insert(PLAYERS).values(
            [{"id": kicker(c), "name": f"Kicker {c}", "position": "K", "espn_id": kicker_espn(c)} for c in CLUBS]
        )
    )
    team_rows: dict[int, list[dict[str, Any]]] = {s: [] for s in spec.seasons}
    kickoffs: list[dict[str, Any]] = []
    defense: list[dict[str, Any]] = []
    kicking: list[dict[str, Any]] = []
    plays: list[dict[str, Any]] = []
    archive: list[dict[str, Any]] = []
    depth: list[dict[str, Any]] = []
    for season in sorted({*spec.seasons, min(spec.seasons) - 1}):
        for week in spec.weeks:
            for slot, (home, away) in enumerate(_pairs(week)):
                moment = kickoff(season, week, slot % 2)
                for club, opponent, at_home in ((home, away, 1.0), (away, home, 0.0)):
                    kickoffs.append(
                        {
                            "season": season,
                            "week": week,
                            "team": club,
                            "source": ScheduleSource.KICKOFF,
                            "metric": ScheduleMetric.KICKOFF_INSTANT,
                            "as_of": moment,
                            "value": 1.0,
                        }
                    )
                    implied = float(rng.uniform(16, 29))
                    if season in spec.seasons:
                        team_rows[season].append(_team_row(season, week, club, opponent, at_home, moment, implied, rng))
                    game = _game(season, week, club, opponent, implied, moment, rng)
                    defense.append(game["defense"])
                    kicking.append(game["kicking"])
                    plays.extend(game["plays"])
                    depth.append(
                        {
                            "season": season,
                            "week": week,
                            "team": club,
                            "slot": "QB",
                            "depth_order": 1,
                            "player_id": passer(club),
                            "as_of": moment - CHART_LEAD,
                            "position": "QB",
                        }
                    )
                    if season == spec.archive_season and week in spec.archive_weeks:
                        archive.extend(_archive(season, week, club, implied, rng))
    columns = sorted({k for play in plays for k in play})
    filled = [{c: play.get(c) for c in columns} for play in plays]
    for table, rows in (
        (TEAM_WEEK_OBSERVATIONS, kickoffs),
        (NFLVERSE_TEAM_DEFENSE_WEEKS, defense),
        (NFLVERSE_KICKING_WEEKS, kicking),
        (NFLVERSE_PBP_PLAYS, filled),
        (ESPN_KDEF_ARCHIVE_ROWS, archive),
        (NFLVERSE_DEPTH_CHART_WEEKS, depth),
    ):
        conn.execute(insert(table), rows)
    _write_store(store, team_rows)


def _game(  # noqa: PLR0913, PLR0917 - a synthetic game's every coordinate
    season: int, week: int, club: str, opponent: str, implied: float, moment: datetime, rng: np.random.Generator
) -> dict[str, Any]:
    """Club's offense against opponent's defense: the opponent's defense week, the club's kicker's week,
    and the club's kick plays."""
    tds = int(rng.poisson(implied / 9.0))
    attempts = int(rng.poisson(1.8))
    bands = rng.choice(len(BANDS), size=attempts, p=(0.02, 0.28, 0.27, 0.25, 0.16, 0.02))
    made = rng.random(attempts) < np.array([0.98, 0.97, 0.93, 0.83, 0.68, 0.4])[bands]
    two = int(rng.random() < 0.08) if tds else 0
    xp_att = tds - two
    xp_made = int(rng.binomial(xp_att, 0.94))
    points = min(int(7 * tds + 3 * int(made.sum()) + rng.integers(0, 3)), 70)
    defense = {
        "season": season,
        "week": week,
        "team": opponent,
        "opponent_team": club,
        "def_sacks": float(rng.poisson(2.3)),
        "def_interceptions": int(rng.poisson(0.8)),
        "fumble_recovery_opp": int(rng.poisson(0.6)),
        "def_tds": int(rng.random() < 0.1),
        "def_safeties": int(rng.random() < 0.02),
        "def_punt_blocks": 0,
        "def_pat_blocks": 0,
        "def_fg_blocks": int(rng.random() < 0.03),
        "special_teams_tds": int(rng.random() < 0.04),
        "passing_yards_allowed": int(rng.normal(230, 50)),
        "rushing_yards_allowed": int(rng.normal(115, 35)),
        "points_allowed": points,
    }
    k = {"season": season, "week": week, "player_id": kicker(club), "team": club}
    for j, band in enumerate(BANDS):
        k[f"fg_made_{band}"] = int(((bands == j) & made).sum())
        k[f"fg_missed_{band}"] = int(((bands == j) & ~made).sum())
    k |= {
        "fg_made": int(made.sum()),
        "fg_att": attempts,
        "fg_missed": int((~made).sum()),
        "fg_blocked": 0,
        "pat_made": xp_made,
        "pat_att": xp_att,
        "pat_missed": xp_att - xp_made,
        "pat_blocked": 0,
    }
    game_id = f"{season}_{week:02d}_{club}_{opponent}"
    base = {
        "game_id": game_id,
        "season": season,
        "week": week,
        "game_date": moment.date(),
        "as_of": moment + timedelta(days=1),
        "home_team": club,
        "away_team": opponent,
        "qtr": 2,
        "posteam": club,
        "defteam": opponent,
        "kicker_player_id": kicker(club),
    }
    plays: list[dict[str, Any]] = []
    for i, (j, ok) in enumerate(zip(bands, made, strict=True)):
        plays.append(
            {
                **base,
                "play_id": 100 + i,
                "play_type": "field_goal",
                "kick_distance": BAND_DISTANCE[int(j)],
                "field_goal_result": "made" if ok else "missed",
            }
        )
    for i in range(xp_att):
        plays.append(
            {
                **base,
                "play_id": 200 + i,
                "play_type": "extra_point",
                "kick_distance": 33,
                "extra_point_result": "good" if i < xp_made else "failed",
            }
        )
    for i in range(two):
        plays.append(
            {
                **base,
                "play_id": 300 + i,
                "play_type": "pass",
                "two_point_conv_result": "failure",
                "kicker_player_id": None,
            }
        )
    plays.append(
        {**base, "play_id": 400, "play_type": "run", "punt_blocked": False, "safety": False, "kicker_player_id": None}
    )
    for i in range(DROPBACKS):
        plays.append(
            {
                **base,
                "play_id": 500 + i,
                "play_type": "pass",
                "qb_dropback": True,
                "passer_player_id": passer(club),
                "interception": bool(rng.random() < 0.03),
                "kicker_player_id": None,
            }
        )
    return {"defense": defense, "kicking": k, "plays": plays}


def _archive(season: int, week: int, club: str, implied: float, rng: np.random.Generator) -> list[dict[str, Any]]:
    at = datetime(2026, 10, 23, tzinfo=UTC)
    made = implied / 14.0
    k_stats = {
        "80": made * 0.55,
        "77": made * 0.3,
        "74": made * 0.15,
        "198": made * 0.15,
        "85": 0.2,
        "86": implied / 9.0,
        "88": 0.05,
    }
    total = 3 * k_stats["80"] + 4 * k_stats["77"] + 5 * k_stats["74"] - k_stats["85"] + k_stats["86"]
    d_total = float(rng.uniform(3, 9))
    return [
        {
            "season": season,
            "week": week,
            "espn_id": kicker_espn(club),
            "read_at": at,
            "position": "K",
            "applied_total": total,
            "stats": k_stats,
            "stamp": "archive_unstamped",
        },
        {
            "season": season,
            "week": week,
            "espn_id": team_defense_espn_id(club),
            "read_at": at,
            "position": "DEF",
            "applied_total": d_total,
            "stats": {},
            "stamp": "archive_unstamped",
        },
    ]


def _write_store(store: Path, rows: dict[int, list[dict[str, Any]]]) -> None:
    seasons = []
    for season, found in sorted(rows.items()):
        name = f"history-{season}-teams.parquet"
        digest = write_rows(found, TEAM_SCHEMA, TEAM_KEY, store / name)
        seasons.append({"season": season, "digests": {name: digest}, "depth_chart_rule": "week"})
    (store / "report-history.json").write_text(json.dumps({"seasons": seasons}))


def team_seasons(spec: Synthetic) -> Sequence[int]:
    return spec.seasons
