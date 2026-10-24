# ruff: noqa: PLR2004 - the synthetic seasons' counts
"""Lane 168, the runners end to end on synthetic seasons (brief ruling 2): `check` then `judgment` run on a
scratch database and a store of synthetic seasons (2015 to 2021: the check judges 2020, the judgment 2021),
never on a 2023 or later outcome; each claims its own exclusive file and a second run of each is refused by
its claim; the judgment is refused before the check, and by the stop rule; a run is refused with no lock, on a
dirty tree, without the lock in its history, or on a database the round's scratch guard does not admit. The
database-bound steps of the real runs (round 3's reproduction, R4 6.3's counts) are the synthetic
environment's; the run's own read-only transaction, closed-season guard, table digests, store files and
digests, claims and records are the real ones."""

import json
import os
from collections.abc import Iterator, Mapping
from dataclasses import replace
from pathlib import Path
from typing import Any, Final

import pytest
from sqlalchemy import Connection

from research.errors import ConfigurationError
from research.model.weekly2.gates import GateLine
from research.model.weekly5.gates import GATE_LINES, RoundFive
from research.model.weekly5.reads import FitReads, JudgedReads
from research.model.weekly5.round import Command, RefusedError, Setup, execute, table_digests
from research.parity import databases
from research.tests import weekly5_synthetic as synthetic

_DATABASE: Final = "parity_test_lane168_weekly5"
_EMPTY_RECORD: Final[dict[str, Any]] = {
    "features": {"digests": {}},
    "fitted": {"play_model_cells": {}, "team_model_cells": {}, "share_cells": {}, "share_fold_losses": {}},
}


class SyntheticEnvironment:
    """Round 3's reads and the counts on synthetic seasons; the table digests on the scratch database."""

    def __init__(self, built: synthetic.Built, record: Mapping[str, Any] = _EMPTY_RECORD) -> None:
        self.built = built
        self.record = record
        self.calls: list[str] = []

    def preconditions(self, conn: Connection, t: RoundFive) -> tuple[list[str], dict[str, Any]]:
        self.calls.append("preconditions")
        return [], {"synthetic": True, "judged": t.judgment_season}

    def round_three(self, conn: Connection, t: RoundFive) -> object:
        self.calls.append("round_three")
        return "reproduced"

    def judged(self, conn: Connection, t: RoundFive, reproduced: object) -> tuple[JudgedReads, object]:
        self.calls.append("judged")
        s, j = self.built.sources, t.judgment_season
        g5 = GateLine("G5", "isolation", True, "per-game clause: synthetic reads, every row before its instant")
        reads = JudgedReads(
            tuple(self.built.population[j]),
            (g5,),
            s.rates[s.rates["season"] == j],
            s.lines[s.lines["season"] == j],
            s.forms[s.forms["season"] == j],
            (j,),
            t.player_fit_seasons,
        )
        return reads, reproduced

    def fit_reads(self, conn: Connection, t: RoundFive, fit: object) -> FitReads:
        self.calls.append("fit_reads")
        s = self.built.sources

        def mine(frame: Any) -> Any:
            return frame[frame["season"].isin(t.player_fit_seasons)]

        return FitReads(
            mine(s.rates), mine(s.lines), mine(s.forms), mine(s.fumbles), t.player_fit_seasons, (True, "synthetic")
        )

    def digests(self, conn: Connection) -> dict[str, str]:
        return table_digests(conn)

    def round_four_record(self) -> Mapping[str, Any]:
        return self.record


@pytest.fixture(scope="module")
def scratch(tmp_path_factory: pytest.TempPathFactory) -> Iterator[tuple[str, Path, synthetic.Built]]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    store = tmp_path_factory.mktemp("store")
    try:
        yield url, store, synthetic.build(store)
    finally:
        databases.drop(_DATABASE)


def _setup(command: Command, built: synthetic.Built, docs: Path, **changes: Any) -> Setup:
    t = synthetic.T if command == "check" else synthetic.T_JUDGED
    claim = docs / f"{command}-taken.json"
    record = docs / f"{command}.json"
    base = Setup(
        command,
        t,
        SyntheticEnvironment(built),
        claim,
        record,
        check_record=docs / "check.json",
        lock="abc1234",
        prefixes=("parity_",),
        grids=synthetic.TINY,
        absent=lambda commits: [],
        status=lambda: [],
        head=lambda: "0" * 40,
        version=lambda: "research@synthetic",
    )
    return replace(base, **changes)


def test_check_then_judgment_end_to_end_each_once(scratch: tuple[str, Path, synthetic.Built], tmp_path: Path) -> None:
    url, store, built = scratch
    with pytest.raises(RefusedError, match="no development check record"):
        execute(_setup("judgment", built, tmp_path), url, store)
    check = _setup("check", built, tmp_path)
    assert execute(check, url, store) == 0
    record = json.loads(check.record.read_text())
    assert check.claim.exists()
    assert set(record["candidates"]) == {"components", "rival"}
    assert all(len(c["gates"]) == GATE_LINES for c in record["candidates"].values())
    assert record["choice"]["chosen"] in ("components", "rival") and record["stopped"] is False
    assert record["gates"] == record["candidates"][record["chosen"]]["gates"]
    g5 = next(g for g in record["gates"] if g["gate"] == "G5")
    assert g5["passed"], g5["detail"]
    assert record["outcome_seasons_read"]["judged"] == [2020]
    assert max(record["outcome_seasons_read"]["players"]) == 2019
    assert record["preconditions"]["guard_five_rows_whose_rival_form_differs_from_g2"] == 0
    assert record["digests"]["before"] == record["digests"]["after"]
    with pytest.raises(RefusedError, match="taken once"):
        execute(check, url, store)
    judgment = _setup("judgment", built, tmp_path)
    found = execute(judgment, url, store)
    judged = json.loads(judgment.record.read_text())
    assert found == (0 if judged["passed"] else 1)
    assert judged["chosen"] == record["choice"]["chosen"] and list(judged["candidates"]) == [judged["chosen"]]
    assert len(judged["gates"]) == GATE_LINES and judged["provisional"] and judged["exposure"]
    assert judged["outcome_seasons_read"]["judged"] == [2021]
    assert judged["decision"].startswith("DECISION: ")
    with pytest.raises(RefusedError, match="taken once"):
        execute(judgment, url, store)


def test_the_claim_alone_refuses_a_second_run(scratch: tuple[str, Path, synthetic.Built], tmp_path: Path) -> None:
    url, store, built = scratch
    check = _setup("check", built, tmp_path)
    check.claim.write_text("{}")  # a first run that died after its claim
    with pytest.raises(RefusedError, match="taken once"):
        execute(check, url, store)


def _check_record(docs: Path, passed: bool, chosen: str = "components") -> None:
    gates = [
        {"gate": "G2", "subject": "pooled vs recent form", "passed": passed, "detail": ""},
        {"gate": "G6", "subject": "pooled vs the spreadsheets", "passed": True, "detail": ""},
    ]
    record = {"command": "check", "choice": {"chosen": chosen}, "gates": gates, "stopped": not passed}
    (docs / "check.json").write_text(json.dumps(record))


def test_the_stop_rule_refuses_the_judgment(scratch: tuple[str, Path, synthetic.Built], tmp_path: Path) -> None:
    url, store, built = scratch
    _check_record(tmp_path, passed=False)
    with pytest.raises(RefusedError, match="stop rule"):
        execute(_setup("judgment", built, tmp_path), url, store)
    _check_record(tmp_path, passed=True, chosen="neither")
    with pytest.raises(RefusedError, match="no candidate choice"):
        execute(_setup("judgment", built, tmp_path), url, store)


@pytest.mark.parametrize(
    ("changes", "match"),
    [
        ({"lock": None}, "no lock"),
        ({"status": lambda: [" M research/model/weekly5/gates.py"]}, "not clean"),
        ({"absent": lambda commits: [commits[0]]}, "not in this tree's history"),
    ],
)
def test_a_run_is_refused_before_the_lock_on_a_dirty_tree_or_off_the_locks_history(
    scratch: tuple[str, Path, synthetic.Built], tmp_path: Path, changes: dict[str, Any], match: str
) -> None:
    url, store, built = scratch
    with pytest.raises(RefusedError, match=match):
        execute(_setup("check", built, tmp_path, **changes), url, store)
    assert not (tmp_path / "check-taken.json").exists()


def test_the_scratch_guard_admits_only_its_prefix(scratch: tuple[str, Path, synthetic.Built], tmp_path: Path) -> None:
    url, store, built = scratch
    with pytest.raises(ConfigurationError, match="not a scratch copy"):
        execute(_setup("check", built, tmp_path, prefixes=("lane70_",)), url, store)


def test_round_fours_unreproduced_components_refuse_before_the_claim(
    scratch: tuple[str, Path, synthetic.Built], tmp_path: Path
) -> None:
    url, store, built = scratch
    record = {
        **_EMPTY_RECORD,
        "fitted": {**_EMPTY_RECORD["fitted"], "team_model_cells": {"plays": {"2019": {"max_leaf_nodes": 99}}}},
    }
    setup = _setup("check", built, tmp_path, environment=SyntheticEnvironment(built, record))
    with pytest.raises(RefusedError, match="not reproduced"):
        execute(setup, url, store)
    assert not setup.claim.exists()
    moved = {**_EMPTY_RECORD, "features": {"digests": {"history-2016-plays.parquet": "0" * 64}}}
    setup = _setup("check", built, tmp_path, environment=SyntheticEnvironment(built, moved))
    with pytest.raises(RefusedError, match="differ from round 4"):
        execute(setup, url, store)


@pytest.mark.parametrize("kind", ["players", "teams", "plays"])
def test_a_moved_judged_season_file_refuses_before_the_claim(
    scratch: tuple[str, Path, synthetic.Built], tmp_path: Path, kind: str
) -> None:
    """H1: the check hashes its judged season's files before the claim and compares them with round 4's record."""
    url, store, built = scratch
    name = f"history-{synthetic.T.judgment_season}-{kind}.parquet"
    moved = {**_EMPTY_RECORD, "features": {"digests": {name: "0" * 64}}}
    setup = _setup("check", built, tmp_path, environment=SyntheticEnvironment(built, moved))
    with pytest.raises(RefusedError, match=name):
        execute(setup, url, store)
    assert not setup.claim.exists()
