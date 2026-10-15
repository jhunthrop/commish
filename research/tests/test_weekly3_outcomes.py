# ruff: noqa: PLR2004 - the expected values are the preregistration's numbers and hand-made cases
"""Weekly round 3's outcome reader, extended to usage (preregistration section 2, "Fitted in this
round", and G5): it refuses a closed season before any read, serves the work beside the line on
round 2's one ledger, and refuses 2025 and 2026 in the judgment and 2024 to 2026 in the check."""

from datetime import UTC, datetime
from types import MappingProxyType
from typing import cast

import pytest
from sqlalchemy import Connection

from research.model.reads.observations import ObservationQuery
from research.model.ros.outcomes import HeldOutReadError
from research.model.weekly2.guard import WeekOutcomeReader
from research.model.weekly3 import outcomes
from research.model.weekly3.gates import DEVELOPMENT_CHECK, ROUND_THREE
from research.model.weekly3.outcomes import LINE_WITHOUT_EDGE, GameOutcomeReader, fit_reader, judgment_reader
from research.model.weekly3.work import USAGE_METRICS, Work
from research.pipeline.observations import PlayerWeekObservation, PlayerWeekTeam

_STAMP = datetime(2023, 10, 10, tzinfo=UTC)
_NOWHERE = cast(Connection, None)


@pytest.mark.parametrize("season", [2025, 2026])
def test_the_judgment_reader_refuses_2025_and_2026_before_reading(season: int) -> None:
    with pytest.raises(HeldOutReadError):
        judgment_reader(ROUND_THREE).season(_NOWHERE, season, {})


@pytest.mark.parametrize("season", [2024, 2025, 2026])
def test_the_checks_readers_refuse_2024_on(season: int) -> None:
    for reader in (fit_reader(DEVELOPMENT_CHECK), judgment_reader(DEVELOPMENT_CHECK)):
        with pytest.raises(HeldOutReadError):
            reader.season(_NOWHERE, season, {})


def test_the_fit_reader_refuses_the_judgment_season() -> None:
    with pytest.raises(HeldOutReadError):
        fit_reader(ROUND_THREE).season(_NOWHERE, 2024, {})


def test_the_work_is_served_beside_the_line_on_one_ledger(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[ObservationQuery] = []

    def points(self: WeekOutcomeReader, conn: Connection, season: int, positions: object) -> object:
        del conn, positions
        lined = {6: MappingProxyType({"a": {"ppr": 12.0}, "b": {"ppr": 3.0}})}
        return MappingProxyType(lined), self.admit(season)

    def observations(conn: Connection, query: ObservationQuery) -> list[PlayerWeekObservation]:
        del conn
        seen.append(query)
        return [PlayerWeekObservation(2023, 6, "a", "nflverse_player_week", "targets", 9.0, _STAMP)]

    def edges(conn: Connection, season: int, week: object, as_of: datetime) -> list[PlayerWeekTeam]:
        del conn, week, as_of
        return [PlayerWeekTeam(season, 6, "a", "KC", _STAMP)]

    monkeypatch.setattr(WeekOutcomeReader, "season", points)
    monkeypatch.setattr(outcomes, "observations_as_of", observations)
    monkeypatch.setattr(outcomes, "player_teams_as_of", edges)
    found, reader = GameOutcomeReader(WeekOutcomeReader(frozenset())).season(_NOWHERE, 2023, {})
    assert reader.served == (2023,)
    assert found[6]["a"].work == Work(9.0, 0.0, 0.0, 0.0, 0.0)
    assert found[6]["a"].club == "KC"
    assert found[6]["b"].defaults == frozenset({LINE_WITHOUT_EDGE})
    assert seen[0].metrics == USAGE_METRICS
    assert seen[0].season == 2023
