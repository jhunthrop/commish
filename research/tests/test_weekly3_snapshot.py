# ruff: noqa: PLR2004 - the expected values are hand-computed numbers, each read beside its case
"""Weekly round 3's reads at an instant (preregistration section 3): the box-score reads bounded to
weeks before W at t_g, the filings of week W at t_g, every read through the recording wrapper, and
the season before read once with its exactness check."""

from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from sqlalchemy import Connection

from research.model.reads.observations import ObservationQuery, WeekRange
from research.model.weekly3 import snapshot
from research.model.weekly3.ledger import InputRuleError
from research.model.weekly3.snapshot import read_prior, read_snapshot
from research.model.weekly3.work import USAGE_METRICS
from research.pipeline.observations import PlayerWeekObservation, PlayerWeekTeam, TeamWeekObservation

_T = datetime(2023, 10, 22, 16, 59, 59, 999000, tzinfo=UTC)
_STAMP = _T - timedelta(days=4)


class _Reads:
    def __init__(self, stray: PlayerWeekObservation | None = None, later: int = 0) -> None:
        self.queries: list[ObservationQuery] = []
        self.spans: list[tuple[int, object, datetime]] = []
        self.stray = stray
        self.later = later

    def observations(self, conn: Connection, query: ObservationQuery) -> list[PlayerWeekObservation]:
        del conn
        self.queries.append(query)
        if query.source == "nflverse_injuries":
            return [PlayerWeekObservation(2023, 7, "out", query.source, "injury_report_status", 3.0, _STAMP)]
        rows = [
            PlayerWeekObservation(query.season, 6, "me", "nflverse_player_week", "targets", 6.0, _STAMP),
            PlayerWeekObservation(query.season, 6, "out", "nflverse_player_week", "targets", 9.0, _STAMP),
        ]
        return rows + ([self.stray] if self.stray else [])

    def edges(self, conn: Connection, season: int, week: object, as_of: datetime) -> list[PlayerWeekTeam]:
        del conn
        self.spans.append((season, week, as_of))
        return [PlayerWeekTeam(season, 6, "me", "KC", _STAMP), PlayerWeekTeam(season, 6, "out", "KC", _STAMP)]

    def team(
        self, conn: Connection, season: int, week: object, as_of: datetime, source: str
    ) -> list[TeamWeekObservation]:
        del conn, as_of
        assert source == "nflverse_pbp"
        return [
            TeamWeekObservation(season, 6, "KC", source, "pace_seconds_per_play", 27.5, _STAMP),
            TeamWeekObservation(season, 6, "KC", source, "neutral_plays", 40.0, _STAMP),
        ]


class _Count:
    def __init__(self, n: int) -> None:
        self.n = n

    def execute(self, statement: object, params: dict[str, Any]) -> "_Count":
        del statement, params
        return self

    def scalar_one(self) -> int:
        return self.n


def _patch(monkeypatch: pytest.MonkeyPatch, reads: _Reads) -> None:
    monkeypatch.setattr(snapshot, "observations_as_of", reads.observations)
    monkeypatch.setattr(snapshot, "player_teams_as_of", reads.edges)
    monkeypatch.setattr(snapshot, "team_observations_as_of", reads.team)


def test_the_snapshot_reads_weeks_before_w_at_the_instant_and_week_ws_filings(monkeypatch: pytest.MonkeyPatch) -> None:
    reads = _Reads()
    _patch(monkeypatch, reads)
    found = read_snapshot(cast(Connection, None), 2023, 7, _T)
    box, filings = reads.queries
    assert (box.season, box.week, box.as_of, box.metrics) == (2023, WeekRange(1, 6), _T, USAGE_METRICS)
    assert (filings.week, filings.as_of, filings.source) == (7, _T, "nflverse_injuries")
    assert reads.spans == [(2023, WeekRange(1, 6), _T)]
    assert found.clubs == {"me": "KC", "out": "KC"}
    assert found.statuses == {"out": "withheld"}
    assert found.team_rows[("KC", 6)] == {"pace_seconds_per_play": 27.5}
    assert [s.kind for s in found.stamps] == ["box", "filings"]
    assert found.stamps[0].rows == 5


def test_a_week_w_row_from_a_box_read_refuses_the_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    stray = PlayerWeekObservation(2023, 7, "me", "nflverse_player_week", "targets", 1.0, _STAMP)
    _patch(monkeypatch, _Reads(stray))
    with pytest.raises(InputRuleError):
        read_snapshot(cast(Connection, None), 2023, 7, _T)


def test_the_season_before_is_read_once_and_refused_if_it_moves_during_the_season(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reads = _Reads()
    _patch(monkeypatch, reads)
    found = read_prior(cast(Connection, _Count(0)), 2023, _T, _T + timedelta(days=70))
    assert reads.queries[0].season == 2022
    assert found.means["me"].targets == 6.0
    assert found.stamp.kind == "prior"
    with pytest.raises(InputRuleError, match="not exact"):
        read_prior(cast(Connection, _Count(3)), 2023, _T, _T + timedelta(days=70))
