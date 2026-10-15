"""Weekly round 2's load-bearing pieces the review found untested: the weekly number withholds Out
and Doubtful and flags Questionable, with its stamps; the filings read at the moment; the rate
refit's refusal; the judgment's one claim; the opponent-ratings step's verdicts; and a list-valued
season parameter caught on a live connection."""

import json
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from types import MappingProxyType, SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy import Connection, Engine, bindparam, create_engine, text

from research.errors import ConfigurationError
from research.inseason import season_week
from research.inseason.season_week import OPPONENT_RATINGS, STEPS, SeasonWeekContext, run_season_week
from research.inseason.step_result import StepResult
from research.model.priors import ModelArtifacts
from research.model.reads.observations import ObservationQuery
from research.model.register.freeze import IMPLEMENTATION
from research.model.weekly2 import designation, judge
from research.model.weekly2.board import WeekBoard, WeekPlayer, week_number
from research.model.weekly2.designation import WeekStatus, filed_statuses
from research.model.weekly2.factor import Elasticity
from research.model.weekly2.gates import ROUND_TWO
from research.model.weekly2.guard import ClosedSeasonError, closed_seasons, guard_queries
from research.model.weekly2.round import JUDGMENT_CLAIM, claim_judgment, thresholds_for
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.injury_reports import INJURY_SOURCE, InjuryMetric
from research.pipeline.observations import PlayerWeekObservation

_MOMENT = datetime(2024, 10, 10, 0, 14, 59, 999000, tzinfo=UTC)
_FORMATS = ("ppr", "half", "std")
_ELASTICITY = MappingProxyType(dict.fromkeys(("QB", "RB", "WR", "TE"), Elasticity(1.0, 0.0)))


def _player(status: WeekStatus) -> WeekPlayer:
    rate = MappingProxyType({"ppr": 10.0, "half": 9.0, "std": 8.0})
    return WeekPlayer("p1", "WR", "KC", rate, None, 5, 50.0, 1.1, 0.9, status)


def _board() -> WeekBoard:
    return WeekBoard(2024, 6, _MOMENT, (), MappingProxyType({}), MappingProxyType({}))


@pytest.mark.parametrize(
    ("status", "numbered", "flagged"),
    [("clear", True, False), ("questionable", True, True), ("withheld", False, False)],
)
def test_the_weekly_number_withholds_out_and_doubtful_and_flags_questionable(
    status: WeekStatus, numbered: bool, flagged: bool
) -> None:
    found = week_number(_board(), _player(status), _ELASTICITY, "commish_weekly_v2", "research@abc12345")
    assert (found.number is not None) is numbered
    assert found.questionable is flagged
    assert found.factor == pytest.approx(1.1)
    if found.number is not None:
        assert dict(found.number) == pytest.approx({"ppr": 11.0, "half": 9.9, "std": 8.8})
    assert (found.model_name, found.model_version, found.implementation) == (
        "commish_weekly_v2",
        "research@abc12345",
        IMPLEMENTATION,
    )
    assert IMPLEMENTATION == "python"


def test_the_filings_are_read_for_the_week_at_the_moment_and_only_the_report_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[ObservationQuery] = []

    def read(conn: Connection, query: ObservationQuery) -> list[PlayerWeekObservation]:
        del conn
        seen.append(query)
        return [
            PlayerWeekObservation(2024, 6, "a", INJURY_SOURCE, InjuryMetric.REPORT_STATUS, 3.0, _MOMENT),
            PlayerWeekObservation(2024, 6, "b", INJURY_SOURCE, InjuryMetric.REPORT_STATUS, 1.0, _MOMENT),
            PlayerWeekObservation(2024, 6, "c", INJURY_SOURCE, InjuryMetric.PRACTICE_STATUS, 3.0, _MOMENT),
            PlayerWeekObservation(2024, 6, "d", INJURY_SOURCE, InjuryMetric.REPORT_STATUS, 2.0, _MOMENT),
        ]

    monkeypatch.setattr(designation, "observations_as_of", read)
    found = filed_statuses(cast(Connection, None), 2024, 6, _MOMENT)
    assert found == {"a": "withheld", "b": "questionable", "d": "withheld"}  # practice status is not read
    assert seen == [ObservationQuery(2024, 6, _MOMENT, INJURY_SOURCE)]


def _stub_rate(monkeypatch: pytest.MonkeyPatch, payload: Mapping[str, Any]) -> None:
    monkeypatch.setattr(judge, "fit_rate", lambda *args: SimpleNamespace(priors="fitted"))
    monkeypatch.setattr(judge, "priors_payload", lambda priors: dict(payload))


def test_the_rate_refit_is_refused_unless_equal_to_its_record(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    record = tmp_path / "record.json"
    record.write_text(json.dumps({"priors": {"shrinkage": {"QB|ppr": {"k": 4.0, "alpha": 0.5}}}}))
    artifacts = cast(ModelArtifacts, None)
    _stub_rate(monkeypatch, {"shrinkage": {"QB|ppr": {"k": 4.0, "alpha": 0.5}}})
    assert cast(object, judge.rate_priors(cast(Connection, None), ROUND_TWO, artifacts, record).priors) == "fitted"
    _stub_rate(monkeypatch, {"shrinkage": {"QB|ppr": {"k": 5.0, "alpha": 0.5}}})
    with pytest.raises(ConfigurationError, match="shrinkage"):
        judge.rate_priors(cast(Connection, None), ROUND_TWO, artifacts, record)
    with pytest.raises(ConfigurationError, match="not in this tree"):
        judge.rate_priors(cast(Connection, None), ROUND_TWO, artifacts, tmp_path / "missing.json")


def test_the_judgment_is_claimed_once_in_its_fixed_place_whatever_the_output(tmp_path: Path) -> None:
    claim = tmp_path / "taken.json"
    claim_judgment(tmp_path / "anywhere.json", "research@abc12345", claim)
    assert json.loads(claim.read_text())["output"] == str(tmp_path / "anywhere.json")
    with pytest.raises(ConfigurationError, match="once"):
        claim_judgment(tmp_path / "elsewhere.json", "research@abc12345", claim)


def test_a_claim_alone_refuses_the_judgment() -> None:
    with pytest.raises(ConfigurationError, match=JUDGMENT_CLAIM.name):
        thresholds_for("judge", committed=lambda: True, exists=lambda path: path == JUDGMENT_CLAIM)


class _Conn:
    def commit(self) -> None:
        return None


class _FakeEngine:
    @contextmanager
    def connect(self) -> Iterator[Connection]:
        yield cast(Connection, _Conn())


def _run_step(monkeypatch: pytest.MonkeyPatch, ingest: Any) -> StepResult:
    monkeypatch.setattr(season_week, "ingest_opponent_defence_to_date", ingest)
    context = SeasonWeekContext(
        cast(Engine, _FakeEngine()),
        cast(Fetcher, None),
        datetime(2026, 10, 14, tzinfo=UTC),
        2026,
        {},
        frozenset(STEPS) - {OPPONENT_RATINGS},
    )
    results = {r.step: r for r in run_season_week(context)}
    return results[OPPONENT_RATINGS]


def test_the_opponent_ratings_step_is_ok_when_it_writes(monkeypatch: pytest.MonkeyPatch) -> None:
    found = _run_step(monkeypatch, lambda conn, client, season: 3)
    assert (found.status, found.summary) == ("ok", "3 new opponent-rating rows for 2026")


def test_the_opponent_ratings_step_is_skipped_when_nothing_is_new(monkeypatch: pytest.MonkeyPatch) -> None:
    found = _run_step(monkeypatch, lambda conn, client, season: 0)
    assert (found.status, found.summary) == ("skipped", "nothing new, 0 new opponent-rating rows for 2026")


def test_a_failing_opponent_ratings_step_fails_alone(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(conn: Connection, client: object, season: int) -> int:
        raise RuntimeError("schedule unreadable")

    found = _run_step(monkeypatch, broken)
    assert (found.status, found.summary) == ("failed", "schedule unreadable")


def test_a_list_of_seasons_naming_a_closed_one_is_refused_on_a_live_connection() -> None:
    statement = text("select 1 where 2023 in :seasons").bindparams(bindparam("seasons", expanding=True))
    with create_engine("sqlite://").connect() as conn:
        guard_queries(conn, closed_seasons(ROUND_TWO))
        assert conn.execute(statement, {"seasons": [2023, 2024]}).scalar() == 1
        with pytest.raises(ClosedSeasonError):
            conn.execute(statement, {"seasons": [2023, 2025]})
