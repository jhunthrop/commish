# ruff: noqa: PLR2004 - the expected values are hand-computed from the fixture's plays
"""The feature store's read wiring on a migrated database (lane 68 review M5; round 4
preregistration, section 5): through `build_season`, `read_instant` and `read_players`, no week-W
row, no row stamped after t_g and no week-W outcome pair reaches a feature; the season before is
refused when a play of it is stamped during the season; and the live build reads no outcome."""

import math
import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Connection, Engine, insert

from research.db.engine import make_engine
from research.db.schema import (
    GAME_WEATHER,
    NFLVERSE_DEPTH_CHART_WEEKS,
    NFLVERSE_GAMES,
    NFLVERSE_PBP_PLAYS,
    NFLVERSE_TEAM_DEFENSE_WEEKS,
    PLAYER_WEEK_TEAMS,
    PLAYERS,
    STADIUMS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.db.schema.nflverse import DEFENSE_COUNT_COLUMNS
from research.db.url import sqlalchemy_url
from research.model.weekly3.ledger import InputRuleError, violation
from research.model.weekly4.features import __main__ as command
from research.model.weekly4.features.columns import TEAM_OUTCOME_COLUMNS
from research.model.weekly4.features.outcomes import OutcomeReader
from research.model.weekly4.features.season import SeasonSpec, build_season, season_inputs, season_schedule
from research.model.weekly4.features.view import read_instant, read_week
from research.parity import databases

_DATABASE = "parity_test_weekly4_wiring"
_KICKOFFS = {1: datetime(2023, 9, 10, 17, tzinfo=UTC), 2: datetime(2023, 9, 17, 17, tzinfo=UTC)}
_KICKOFFS[3] = datetime(2023, 9, 24, 17, tzinfo=UTC)
_POISON = 999.0  # every outcome-shaped value placed where a read must never reach
_POSITIONS = {"kc_wr": "WR", "kc_te": "TE", "kc_qb": "QB", "den_wr": "WR"}


def _game_id(week: int) -> str:
    return f"2023_{week:02d}_DEN_KC"


def _teams(week: int) -> list[dict[str, Any]]:
    at = _KICKOFFS[week]
    rows: list[dict[str, Any]] = []
    for club, home, implied, spread in (("KC", 1.0, 26.0, 4.0), ("DEN", 0.0, 22.0, -4.0)):
        rows += [
            {"source": "nflverse_kickoff", "metric": "kickoff_instant", "value": at.timestamp(), "as_of": at},
            {"source": "nflverse_kickoff", "metric": "implied_team_total", "value": implied, "as_of": at},
            {"source": "nflverse_kickoff", "metric": "point_spread", "value": spread, "as_of": at},
            # Outcomes of week W stamped before t_g: only a read by source alone could see them.
            {"source": "nflverse_kickoff", "metric": "game_result", "value": _POISON, "as_of": at - timedelta(days=1)},
            {
                "source": "nflverse_kickoff",
                "metric": "points_allowed",
                "value": _POISON,
                "as_of": at - timedelta(days=1),
            },
            {"source": "nflverse_schedule", "metric": "home_field", "value": home, "as_of": at - timedelta(days=90)},
            {"source": "nflverse_schedule", "metric": "rest_days", "value": 7.0, "as_of": at - timedelta(days=90)},
            {"source": "nflverse_schedule", "metric": "division_game", "value": 1.0, "as_of": at - timedelta(days=90)},
            {"source": "nflverse_schedule", "metric": "indoors", "value": 0.0, "as_of": at - timedelta(days=90)},
            {
                "source": "nflverse_pbp",
                "metric": "pace_seconds_per_play",
                "value": 28.0,
                "as_of": at + timedelta(hours=30),
            },
            {
                "source": "nflverse_pbp",
                "metric": "pass_rate_over_expected",
                "value": 3.0,
                "as_of": at + timedelta(hours=30),
            },
        ]
        for row in rows[-11:]:
            row.update(season=2023, week=week, team=club)
    return rows


def _play(week: int, play_id: int, receiver: str, air: float, season: int = 2023, **extra: Any) -> dict[str, Any]:
    kickoff = _KICKOFFS[week] if season == 2023 else _KICKOFFS[week] - timedelta(days=364)
    return {
        "game_id": _game_id(week) if season == 2023 else f"{season}_{week:02d}_DEN_KC",
        "play_id": play_id,
        "season": season,
        "week": week,
        "game_date": kickoff.date(),
        "as_of": kickoff + timedelta(hours=31),
        "home_team": "KC",
        "away_team": "DEN",
        "posteam": "KC",
        "defteam": "DEN",
        "qtr": 1,
        "down": 1,
        "ydstogo": 10,
        "yardline_100": 30,
        "play_type": "pass",
        "qb_dropback": True,
        "qb_scramble": False,
        "sack": False,
        "two_point_attempt": False,
        "passer_player_id": "kc_qb",
        "receiver_player_id": receiver,
        "air_yards": air,
        "yards_gained": 9.0,
        "complete_pass": True,
        "pass_location": "left",
        "pass_touchdown": False,
        **extra,
    }


def _seed(conn: Connection) -> None:
    conn.execute(insert(PLAYERS), [{"id": pid, "name": pid, "position": pos} for pid, pos in _POSITIONS.items()])
    conn.execute(insert(TEAM_WEEK_OBSERVATIONS), [r for w in _KICKOFFS for r in _teams(w)])
    zeros = dict.fromkeys(DEFENSE_COUNT_COLUMNS, 0)
    conn.execute(
        insert(NFLVERSE_TEAM_DEFENSE_WEEKS),
        [
            {"season": 2023, "week": w, "team": a, "opponent_team": b, "def_sacks": 0.0, **zeros}
            for w in (1, 2)
            for a, b in (("KC", "DEN"), ("DEN", "KC"))
        ],
    )
    conn.execute(
        insert(STADIUMS),
        {
            "stadium_id": "KAN00", "name": "Arrowhead", "clubs": ["KC"], "aliases": [], "latitude": 39.0,
            "longitude": -94.5, "roof_type": "outdoors", "surface": "grass", "country": "US", "region": "MO",
            "time_zone": "America/Chicago", "international": False, "wikidata_id": "Q1",
            "read_at": datetime(2026, 10, 16, tzinfo=UTC),
        },
    )  # fmt: skip
    for week, at in _KICKOFFS.items():
        conn.execute(
            insert(GAME_WEATHER),
            {
                "game_id": _game_id(week), "season": 2023, "week": week, "home_team": "KC", "away_team": "DEN",
                "stadium_id": "KAN00", "kickoff_at": at, "roof": "outdoors", "temperature_f": 61.0,
                "temperature_source": "nflverse_games", "wind_mph": 8.0, "wind_source": "nflverse_games",
                "precipitation": 0, "precipitation_source": "pbp_weather_text", "as_of": at + timedelta(hours=24),
            },
        )  # fmt: skip
        conn.execute(
            insert(NFLVERSE_GAMES),
            {
                "game_id": _game_id(week), "season": 2023, "game_type": "REG", "week": week, "gameday": at.date(),
                "home_team": "KC", "away_team": "DEN", "location": "Home", "home_score": int(_POISON),
                "surface": None if week == 3 else "grass", "stadium_id": "KAN00", "stadium": "Arrowhead",
                "read_at": datetime(2026, 10, 16, tzinfo=UTC),
            },
        )  # fmt: skip
    plays = [
        _play(1, 1, "kc_wr", 12.0),
        _play(1, 2, "kc_te", 4.0),
        _play(2, 1, "kc_wr", 25.0),
        _play(2, 2, "kc_wr", -2.0),
        _play(2, 3, "kc_te", 6.0),
        # Week 3's own plays: an outcome, never an input of week 3.
        *(_play(3, i, "kc_wr", _POISON, pass_touchdown=True) for i in range(1, 6)),
        _play(1, 1, "kc_wr", 10.0, season=2022),
        _play(1, 2, "kc_te", 10.0, season=2022),
    ]
    conn.execute(insert(NFLVERSE_PBP_PLAYS), plays)
    edges = [
        {"season": 2023, "week": w, "player_id": p, "team": "KC", "as_of": _KICKOFFS[w] + timedelta(hours=31)}
        for w in (1, 2)
        for p in ("kc_wr", "kc_te", "kc_qb")
    ]
    edges += [
        {"season": 2022, "week": 1, "player_id": p, "team": "KC", "as_of": _KICKOFFS[1] - timedelta(days=360)}
        for p in ("kc_wr", "kc_te")
    ]
    conn.execute(insert(PLAYER_WEEK_TEAMS), edges)
    conn.execute(
        insert(NFLVERSE_DEPTH_CHART_WEEKS),
        [
            {"season": 2023, "week": 3, "team": "KC", "slot": "WR", "depth_order": 1, "player_id": "kc_wr",
             "as_of": _KICKOFFS[3] - timedelta(days=4), "position": "WR"},
            {"season": 2023, "week": 3, "team": "KC", "slot": "TE", "depth_order": 1, "player_id": "kc_te",
             "as_of": _KICKOFFS[3] + timedelta(hours=1), "position": "TE"},  # after t_g: unread
        ],
    )  # fmt: skip


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    with built.begin() as conn:
        _seed(conn)
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


_SPEC = SeasonSpec(2023, (3,), (1, 2, 3), "week")


def _values(rows: Any) -> list[object]:
    return [v for row in rows for v in row.values()]


def test_no_week_w_row_or_later_stamp_reaches_an_instant(engine: Engine) -> None:
    with engine.connect() as conn:
        build, reader = build_season(conn, _SPEC, _POSITIONS, OutcomeReader())
    assert reader is not None and reader.served == (2023,)
    assert [b for b in (violation(s) for s in build.stamps) if b] == []
    player_rows = [r for r in build.player_rows if r["club"] == "KC"]
    wr = next(r for r in player_rows if r["player_id"] == "kc_wr")
    assert wr["share_season_targets"] == pytest.approx(3 / 5)  # weeks 1 and 2 only
    assert wr["air_yards_per_target"] == pytest.approx((12 + 25 - 2) / 3)
    assert wr["depth_rank"] == 1.0
    te = next(r for r in player_rows if r["player_id"] == "kc_te")
    assert math.isnan(float(str(te["depth_rank"])))  # his chart row is stamped after t_g
    assert _POISON not in _values(build.player_rows)
    team3 = next(r for r in build.team_rows if r["club"] == "KC" and r["week"] == 3)
    assert team3["team_targets"] == 5.0 and team3["receiving_touchdowns"] == 5.0  # the outcome, as a target
    assert team3["implied_points"] == 26.0 and team3["surface"] == "grass"
    assert team3["default_surface"] == 1  # week 3's game row has no surface: the stadium's
    outcomes = {name for name, _ in TEAM_OUTCOME_COLUMNS}
    assert _POISON not in [v for r in build.team_rows for k, v in r.items() if k not in outcomes]


def test_read_instant_sees_only_earlier_weeks_plays(engine: Engine) -> None:
    with engine.connect() as conn:
        schedule, _ = season_schedule(conn, 2023)
        build, _ = build_season(conn, SeasonSpec(2023, (), (3,), "week"), _POSITIONS, None)
        s = season_inputs(conn, SeasonSpec(2023, (), (3,), "week"), schedule, _POSITIONS, _KICKOFFS[3], [3])
        view = read_instant(conn, s, read_week(conn, 2023, 3), 3, _KICKOFFS[3] - timedelta(milliseconds=1))
    assert {w for _, w in view.tallies.players} == {1, 2}
    assert {k for s in view.stamps for k in [s.kind]} >= {"plays", "box", "figures", "weather", "schedule", "charted"}
    assert build.play_rows == ()


def test_the_season_before_is_refused_when_a_play_of_it_is_stamped_during_the_season(engine: Engine) -> None:
    late = _play(2, 9, "kc_wr", 1.0, season=2022)
    late["as_of"] = _KICKOFFS[3] - timedelta(days=2)
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            conn.execute(insert(NFLVERSE_PBP_PLAYS), late)
            with pytest.raises(InputRuleError, match="plays of 2022"):
                build_season(conn, SeasonSpec(2023, (2, 3), (2, 3), "week"), _POSITIONS, None)
        finally:
            transaction.rollback()


def test_the_live_build_holds_no_outcome_reader(
    engine: Engine, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    class Refused:
        def __init__(self) -> None:
            raise AssertionError("the live build constructed an outcome reader")

    monkeypatch.setattr(command, "OutcomeReader", Refused)
    monkeypatch.setattr(command, "check_scratch_url", lambda url, prefixes: None)
    url = str(engine.url.render_as_string(hide_password=False)).replace("postgresql+psycopg", "postgres")
    spec = SeasonSpec(2023, (3,), (3,), "week", _KICKOFFS[3] - timedelta(days=1))
    report = command.run(url, tmp_path, [spec], live=True)
    assert report["outcome_seasons_read"] == []
    season = report["seasons"][0]
    assert season["rows"]["play"] == 0 and season["rows"]["team"] == 2
    assert season["default_shares"]["team"]["no_game_figure"] == 1.0  # no live figure in the fixture
