# ruff: noqa: PLR2004 - the synthetic seasons' numbers
"""Lane 157, the runners end to end on synthetic seasons (brief ruling 3): the check and the judgment run
on a scratch database of synthetic seasons (2016 to 2021, the judged weeks 3 and 4 of 2021), never on a
2023 or 2024 outcome; each claims its own exclusive file; the judgment judges only what the stop rule
left; and the readers sit behind the closed-season refusal (B132 L4), the kick-plays read names only kick
plays (B132 L6) and the fill counts the corrections it drops (B132 L2)."""

import json
import os
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Final

import pytest
from sqlalchemy import Engine, select, text, update

from research.db.engine import make_engine
from research.db.schema import NFLVERSE_PBP_PLAYS
from research.db.url import sqlalchemy_url
from research.model.weekly2.gates import GateLine
from research.model.weekly2.guard import ClosedSeasonError, guard_queries
from research.model.weekly3.ledger import InputRuleError
from research.model.weekly4.features import kdef_weeks
from research.model.weekly4.features.charted import wednesday_pass_after
from research.model.weekly4.tuning import Cell
from research.model.weekly_kdef import gates
from research.model.weekly_kdef.gates import DEVELOPMENT_CHECK, POSITIONS
from research.model.weekly_kdef.reads import ClosedSeasonReadError, KdefReader, closed_after, season_outcomes
from research.model.weekly_kdef.round import RefusedError, Setup, execute
from research.parity import databases
from research.pipeline.nflverse import pbp_plays
from research.pipeline.nflverse.client import NflverseClient
from research.tests import kdef_synthetic
from research.tests.nflverse_fixtures import FixtureFetcher

_DATABASE: Final = "parity_test_lane157_kdef"
_SPEC: Final = kdef_synthetic.Synthetic(tuple(range(2016, 2022)), (1, 2, 3, 4), (3, 4), 2021)
_T: Final = replace(
    DEVELOPMENT_CHECK,
    fit_seasons=tuple(range(2016, 2021)),
    judgment_season=2021,
    weeks=(3, 4),
    draws=200,
    resamples=200,
    run_seed=2021,
)
_GRID: Final = (Cell(7, 0.0, 20, 5),)
_GOAL: Final = ("2022_03_CIN_NYJ", 657)


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> Iterator[tuple[str, Path]]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    store = tmp_path_factory.mktemp("store")
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.begin() as conn:
            kdef_synthetic.build(conn, store, _SPEC)
        yield url, store
    finally:
        engine.dispose()
        databases.drop(_DATABASE)


@pytest.fixture
def engine(built: tuple[str, Path]) -> Iterator[Engine]:
    found = make_engine(sqlalchemy_url(built[0]))
    try:
        yield found
    finally:
        found.dispose()


def _setup(claim: Path, record: Path | None, taken: tuple[Path, ...] = ()) -> Setup:
    return Setup(
        _T,
        claim,
        record,
        prefixes=("parity_",),
        grid=_GRID,
        absent=lambda: [],
        status=lambda: [],
        head=lambda: "synthetic",
        taken=taken,
    )


def test_the_check_and_the_judgment_run_end_to_end_once_each(built: tuple[str, Path], tmp_path: Path) -> None:
    url, store = built
    check_out = tmp_path / "check.json"
    check_claim = tmp_path / "check-taken.json"
    assert execute("check", url, store, check_out, _setup(check_claim, None)) == 0
    record = json.loads(check_out.read_text())
    assert set(record["gates"]) == set(POSITIONS)
    for position in POSITIONS:
        lines = record["gates"][position]
        assert len(lines) == gates.LINES_PER_POSITION
        assert [x["gate"] for x in lines] == [
            "KD1",
            "KD1",
            "KD2",
            "KD2",
            "KD3",
            "KD4",
            "KD4",
            "KD4",
            "KD5",
            "KD5",
            "KD5",
            "KD6",
        ]
        isolation = lines[-1]
        assert isolation["passed"], isolation["detail"]
    assert check_claim.exists()
    reported = record["reported"]
    assert reported["outcome_seasons_read"]["espn"] == [2021]
    assert max(reported["outcome_seasons_read"]["outcomes"]) == 2021
    assert set(reported["defaults"]) >= {"no_kicker_history", "lost_prior_week", "no_prior_unit_defense"}
    assert "espn_stamp_caveat" in reported and reported["published_projection"].startswith("the published")
    assert all(abs(gap) < 1e-6 for p in ("DEF", "K") if (gap := reported["why"][p]["largest_sum_gap"]) is not None)
    with pytest.raises(RefusedError, match="taken once"):
        execute("check", url, store, check_out, _setup(check_claim, None))
    judgment_claim = tmp_path / "judgment-taken.json"
    left = [p for p in POSITIONS if not gates.stopped([GateLine(**x) for x in record["gates"][p]])]
    if not left:
        with pytest.raises(RefusedError, match="stop rule"):
            execute("judgment", url, store, tmp_path / "judgment.json", _setup(judgment_claim, check_out))
        assert not judgment_claim.exists()
        return
    execute("judgment", url, store, tmp_path / "judgment.json", _setup(judgment_claim, check_out))
    judged = json.loads((tmp_path / "judgment.json").read_text())
    assert judged["positions"] == left
    assert judgment_claim.exists()


def test_a_judgment_with_both_positions_stopped_is_refused_before_any_claim(
    built: tuple[str, Path], tmp_path: Path
) -> None:
    url, store = built
    failing = [{"gate": "KD1", "subject": "pooled vs recent form", "passed": False, "detail": ""}]
    record = tmp_path / "check.json"
    record.write_text(json.dumps({"gates": dict.fromkeys(POSITIONS, failing)}))
    claim = tmp_path / "judgment-taken.json"
    with pytest.raises(RefusedError, match="stop rule"):
        execute("judgment", url, store, tmp_path / "out.json", _setup(claim, record))
    assert not claim.exists()


def test_the_readers_refuse_the_closed_seasons_before_and_beneath_them(engine: Engine) -> None:
    reader = KdefReader(closed_after(2024))
    with engine.connect() as conn:
        for season in (2025, 2026):
            with pytest.raises(ClosedSeasonReadError):
                season_outcomes(conn, reader, season)
        guard_queries(conn, closed_after(2024))
        passes = {w: datetime(2025, 9, 10, tzinfo=UTC) + timedelta(days=7 * w) for w in range(1, 18)}
        moment = datetime(2025, 10, 1, tzinfo=UTC)
        with pytest.raises(ClosedSeasonError):  # the bound `:season` itself is refused by the connection
            kdef_weeks.kicking_weeks_at(conn, 2025, 4, moment, passes)
        with pytest.raises(ClosedSeasonError):
            kdef_weeks.kicks_at(conn, 2026, 4, moment)
        with pytest.raises(ClosedSeasonError):
            kdef_weeks.prior_kicks_at(conn, 2026, moment)  # the season before 2026 is 2025, closed


def test_the_kick_plays_read_names_only_kick_plays(engine: Engine) -> None:
    moment = kdef_synthetic.kickoff(2018, 4, 0) - timedelta(milliseconds=1)
    with engine.connect() as conn:
        rows, stamp = kdef_weeks.kicks_at(conn, 2018, 4, moment)
    kinds = {r.values["play_type"] for r in rows}
    assert rows and stamp.kind == "kicks"
    assert "run" not in kinds  # a run with its block and safety flags at 0 is no kick play
    assert kinds <= {"field_goal", "extra_point", "pass"}  # a pass only as a two-point try
    assert all(r.values["play_type"] != "pass" or r.values["two_point_conv_result"] is not None for r in rows)


def test_the_season_before_is_read_once_as_a_prior_read(engine: Engine) -> None:
    passes = {w: wednesday_pass_after(kdef_synthetic.kickoff(2017, w, 1)) for w in _SPEC.weeks}
    first = kdef_synthetic.kickoff(2018, 1, 0) - timedelta(milliseconds=1)
    with engine.connect() as conn:
        rows, stamp = kdef_weeks.prior_week_table_at(conn, kdef_weeks.KICKING_READ, 2018, first, passes)
        kicks, kick_stamp = kdef_weeks.prior_kicks_at(conn, 2018, first)
    assert rows and {r.season for r in rows} == {2017} and stamp.kind == "prior"
    assert kicks and {r.season for r in kicks} == {2017} and kick_stamp.kind == "prior"


def test_the_fill_counts_the_corrections_it_drops(built: tuple[str, Path]) -> None:
    url, _ = built
    found = make_engine(sqlalchemy_url(url))
    try:
        with found.begin() as conn:
            client = NflverseClient(FixtureFetcher())
            first = pbp_plays.ingest_pbp_plays(conn, client, 2022)
            play = NFLVERSE_PBP_PLAYS.c
            conn.execute(
                update(NFLVERSE_PBP_PLAYS)
                .where(play.game_id == _GOAL[0], play.play_id == _GOAL[1])
                .values(kick_distance=49)
            )
            again = pbp_plays.ingest_pbp_plays(conn, client, 2022)
            kept = conn.execute(
                select(play.kick_distance).where(play.game_id == _GOAL[0], play.play_id == _GOAL[1])
            ).scalar_one()
            conn.execute(text("delete from research.nflverse_pbp_plays where season = 2022"))
    finally:
        found.dispose()
    assert first.corrections_dropped == 0
    assert again.corrections_dropped == 1 and again.written == 0 and kept == 49
    assert "1 stored kick values the file now states differently" in again.summary()


def test_a_season_before_read_with_a_row_stamped_after_its_instant_is_refused(engine: Engine) -> None:
    passes = {w: wednesday_pass_after(kdef_synthetic.kickoff(2017, w, 1)) for w in _SPEC.weeks}
    early = kdef_synthetic.kickoff(2017, 3, 0)  # inside the season before: its later weeks are not yet read
    with engine.connect() as conn:
        with pytest.raises(InputRuleError, match="stamped after"):
            kdef_weeks.prior_week_table_at(conn, kdef_weeks.DEFENSE_READ, 2018, early, passes)
        with pytest.raises(InputRuleError, match="stamped after"):
            kdef_weeks.prior_kicks_at(conn, 2018, early)
