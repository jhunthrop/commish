# ruff: noqa: PLR2004 - the expected values are hand-counted from the plays written beside them
"""Round 4's outcome reader and the rows it feeds (preregistration section 2.6 and G5): it serves
2016 to 2024 and refuses 2025 and the pristine 2026 before any read, the history build's guard closes
the same seasons, the live build holds no reader, and the team-game targets and play rows are counted
from week W's plays."""

from datetime import UTC, datetime
from typing import cast

import pytest
from sqlalchemy import Connection

from research.model.weekly4.features.__main__ import CLOSED, history_specs
from research.model.weekly4.features.game import Weather
from research.model.weekly4.features.outcomes import (
    OutcomeReader,
    OutcomeSeasonError,
    play_rows,
    team_outcomes,
)
from research.model.weekly4.features.plays import Play

_AT = datetime(2023, 10, 17, tzinfo=UTC)


def _play(**fields: object) -> Play:
    base: dict[str, object] = dict.fromkeys(Play.__dataclass_fields__)
    base.update(
        game_id="2023_06_KC_DEN",
        play_id=1,
        season=2023,
        week=6,
        as_of=_AT,
        posteam="KC",
        defteam="DEN",
        play_type="pass",
        qb_dropback=True,
        passer_player_id="qb",
        receiver_player_id="wr",
        complete_pass=True,
        yards_gained=12.0,
        air_yards=9.0,
    )
    base.update(fields)
    return Play(**base)  # type: ignore[arg-type]


@pytest.mark.parametrize("season", [2025, 2026, 2015])
def test_the_outcome_reader_refuses_every_season_outside_2016_to_2024_before_any_read(season: int) -> None:
    with pytest.raises(OutcomeSeasonError, match=str(season)):
        OutcomeReader().plays(cast(Connection, None), season)


def test_the_history_build_closes_2025_and_2026_and_never_reaches_past_2024() -> None:
    assert frozenset({2025, 2026}) == CLOSED
    with pytest.raises(ValueError, match="2016 to 2024"):
        history_specs(2016, 2025, "week")
    specs = history_specs(2016, 2024, "week")
    assert [s.season for s in specs if s.player_weeks] == [2021, 2022, 2023, 2024]
    assert all(s.live_after is None for s in specs)


def test_team_targets_count_week_ws_plays() -> None:
    plays = [
        _play(),
        _play(play_id=2, sack=True, receiver_player_id=None),
        _play(
            play_id=3,
            play_type="run",
            qb_dropback=False,
            rusher_player_id="rb",
            receiver_player_id=None,
            rush_touchdown=True,
        ),
        _play(play_id=4, play_type="run", qb_scramble=True, rusher_player_id="qb", receiver_player_id=None),
        _play(play_id=5, two_point_attempt=True),
    ]
    found = team_outcomes(plays)[("KC", 6)]
    assert found == {
        "plays": 4.0,
        "dropbacks": 3.0,
        "sacks": 1.0,
        "scrambles": 1.0,
        "designed_rushes": 1.0,
        "team_targets": 1.0,
        "rushing_touchdowns": 1.0,
        "receiving_touchdowns": 0.0,
    }


def test_a_target_is_a_target_row_and_a_dropback_row_with_its_games_weather() -> None:
    weather = {"2023_06_KC_DEN": Weather("outdoors", 0.0, 40.0, 15.0, 1.0, float("nan"), frozenset())}
    rows = play_rows([_play()], weather)
    assert [(r["kind"], r["player_id"]) for r in rows] == [("target", "wr"), ("dropback", "qb")]
    assert rows[0]["wind_mph"] == 15.0 and rows[0]["as_of"] == _AT.isoformat()
    assert rows[0]["yards_gained"] == 12.0 and rows[0]["complete_pass"] == 1.0
