"""The schema gate holds a refused page back, not the run (Lane 136).

Two mornings running one page's reader rule refused all 627 pages and the site served a stale run. The
gate (`nightly/held_pages.py`) now holds up to ten pages, or 2% of them if fewer, each shown from the
newest passed run's copy or as its board figures alone, and fails the run past that or on any refusal
that is not one page's. The reader here is a stand-in that answers each pass as told and records what the
run held when it was asked, so the rules are tested without node; `test_season_contract.py` runs the same
gate through the web's real reader.
"""

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

from research.nightly.config import EARLY_KEY
from research.nightly.held_pages import ALERT_PREFIX, alert_line, held_limit, hold_refused_pages
from research.nightly.publish import encode, run_key
from research.nightly.run_store import JSON_TYPE, LocalRunStore
from research.nightly.schema_gate import ReaderRead

_RUN = "2026-10-22T05"
_EARLIER = "2026-10-21T05"
_EARLIER_AT = "2026-10-21T05:41:00.000Z"
_WEB = Path("/web")
_SUMMARY = f"run {_RUN}: 0 refusals; 3 formats (1990 board rows), 627 of 627 player pages parsed"
_PAGES = 627

Json = dict[str, Any]


def _refusal(pid: str, where: str = "players") -> str:
    return f"schema:{where}/{pid}.json:players/{pid}.json says his week 4 line was for PHI."


class _Reader:
    """Answers each pass in turn and keeps the `held.json` each pass saw."""

    def __init__(self, passes: Sequence[Sequence[str]]) -> None:
        self.passes = list(passes)
        self.saw: list[Json | None] = []

    def __call__(self, root: Path, run_id: str, web_dir: Path) -> ReaderRead:
        assert (run_id, web_dir) == (_RUN, _WEB)
        held = root / "runs" / run_id / "held.json"
        self.saw.append(json.loads(held.read_text()) if held.is_file() else None)
        reasons = tuple(self.passes.pop(0))
        return ReaderRead(reasons, _SUMMARY.replace("0 refusals", f"{len(reasons)} refusals"))


def _store(root: Path, held: Json | None = None) -> LocalRunStore:
    """A bucket whose newest passed run is `_EARLIER`, with a page for 3914151 and 4430681."""
    store = LocalRunStore(root)
    store.put(EARLY_KEY, encode({"runId": _EARLIER}), JSON_TYPE)
    store.put(run_key(_EARLIER, "manifest.json"), encode({"runId": _EARLIER, "runAt": _EARLIER_AT}), JSON_TYPE)
    for pid in ("3914151", "4430681"):
        store.put(run_key(_EARLIER, f"players/{pid}.json"), encode({"id": pid, "run": _EARLIER}), JSON_TYPE)
    if held is not None:
        store.put(run_key(_EARLIER, "held.json"), encode(held), JSON_TYPE)
    return store


def _gate(tmp_path: Path, reader: _Reader, store: LocalRunStore, pages: int = _PAGES) -> Any:
    lines: list[str] = []
    gate = hold_refused_pages(tmp_path / "staging", _RUN, _WEB, store, pages, lines.append, reader)
    return gate, lines


@pytest.mark.parametrize(("pages", "limit"), [(627, 10), (500, 10), (400, 8), (50, 1), (49, 0), (4, 0)])
def test_the_line_is_ten_pages_or_two_percent_whichever_is_fewer(pages: int, limit: int) -> None:
    assert held_limit(pages) == limit


def test_a_run_the_reader_takes_whole_passes_and_holds_nothing(tmp_path: Path) -> None:
    reader = _Reader([[]])
    gate, _ = _gate(tmp_path, reader, _store(tmp_path / "bucket"))
    assert gate.record.passed
    assert gate.held == ()
    assert gate.files() == {}
    assert gate.record.summary == _SUMMARY
    assert reader.saw == [None]


def test_one_refused_page_is_held_from_the_earlier_run_and_the_run_publishes(tmp_path: Path) -> None:
    reader = _Reader([[_refusal("3914151")], []])
    gate, _ = _gate(tmp_path, reader, _store(tmp_path / "bucket"))
    assert gate.record.passed, gate.record.reasons
    assert gate.record.reasons == ()
    copy = {"runId": _EARLIER, "runAt": _EARLIER_AT}
    held = {"pages": [{"id": "3914151", "refusal": _refusal("3914151").split(".json:", 1)[1], "copy": copy}]}
    # The second pass read the run as the build will: with its held page and the earlier copy beside it.
    assert reader.saw == [None, held]
    assert gate.files() == {"held.json": held, "held/3914151.json": {"id": "3914151", "run": _EARLIER}}
    staged = tmp_path / "staging" / "runs" / _RUN
    assert json.loads((staged / "held" / "3914151.json").read_text()) == {"id": "3914151", "run": _EARLIER}
    # The gate line names the page and its refusal.
    assert f"1 page held: players/3914151.json (shown from run {_EARLIER}): players/3914151.json says" in (
        gate.record.summary
    )


def test_the_alert_is_one_line_naming_every_held_page(tmp_path: Path) -> None:
    reader = _Reader([[_refusal("3914151"), _refusal("9999999")], []])
    gate, _ = _gate(tmp_path, reader, _store(tmp_path / "bucket"))
    line = alert_line(_RUN, gate.held)
    assert "\n" not in line
    assert line.startswith(f"{ALERT_PREFIX} run {_RUN} published with 2 held pages: ")
    assert f"players/3914151.json (shown from run {_EARLIER})" in line
    # No earlier page of his: his page is the board's figures alone.
    assert "players/9999999.json (the board's figures alone)" in line
    assert [page["copy"] for page in gate.files()["held.json"]["pages"]][1] is None


def test_ten_refused_pages_of_627_are_held_and_eleven_fail_the_run(tmp_path: Path) -> None:
    line = held_limit(_PAGES)
    ten = [_refusal(str(4000000 + n)) for n in range(line)]
    held, _ = _gate(tmp_path / "ten", _Reader([ten, []]), _store(tmp_path / "bucket"))
    assert held.record.passed
    assert len(held.held) == line
    eleven = [*ten, _refusal("4000010")]
    reader = _Reader([eleven])
    failed, _ = _gate(tmp_path / "eleven", reader, _store(tmp_path / "bucket"))
    assert not failed.record.passed
    assert failed.held == ()
    assert failed.files() == {}
    assert len(failed.record.reasons) == line + 1
    assert "11 pages refused, more than the 10 a run of 627 pages may hold" in failed.record.summary
    # Past the line the run is never staged with held pages and read again.
    assert reader.saw == [None]


@pytest.mark.parametrize(
    "run_reason",
    [
        "schema:boards/ppr-12.json:boards/ppr-12.json says it is the standard-12 board.",
        "schema:record.json:runs/r/record.json does not match the run format",
        "schema:clubs.json:runs/r/clubs.json does not match the run format",
        "schema:schedule.json:runs/r/schedule.json does not match the run format",
        "schema:designations.json:designations.json marks 1, who is not in index.json.",
        "schema:players:runs/r/schedule.json could not be read",
        "schema_unchecked:node on the PATH",
    ],
)
def test_a_refusal_that_is_not_one_pages_fails_the_run_whatever_the_pages(tmp_path: Path, run_reason: str) -> None:
    reader = _Reader([[_refusal("3914151"), run_reason]])
    gate, _ = _gate(tmp_path, reader, _store(tmp_path / "bucket"))
    assert not gate.record.passed
    assert gate.held == ()
    assert run_reason in gate.record.reasons
    assert reader.saw == [None]


def test_a_page_held_last_night_too_keeps_its_first_copy_and_its_stamp(tmp_path: Path) -> None:
    first = {"runId": "2026-10-20T05", "runAt": "2026-10-20T05:40:00.000Z"}
    store = _store(tmp_path / "bucket", {"pages": [{"id": "4430681", "refusal": "r", "copy": first}]})
    store.put(run_key(_EARLIER, "held/4430681.json"), encode({"id": "4430681", "run": "2026-10-20T05"}), JSON_TYPE)
    gate, _ = _gate(tmp_path, _Reader([[_refusal("4430681")], []]), store)
    assert gate.record.passed
    assert gate.files()["held.json"]["pages"][0]["copy"] == first
    assert gate.files()["held/4430681.json"] == {"id": "4430681", "run": "2026-10-20T05"}


def test_a_page_held_last_night_with_no_copy_is_still_the_boards_figures(tmp_path: Path) -> None:
    store = _store(tmp_path / "bucket", {"pages": [{"id": "4430681", "refusal": "r", "copy": None}]})
    gate, _ = _gate(tmp_path, _Reader([[_refusal("4430681")], []]), store)
    assert gate.record.passed
    assert gate.files() == {"held.json": {"pages": [{**gate.held[0].json(), "copy": None}]}}


def test_a_copy_the_reader_refuses_is_dropped_and_the_page_is_the_boards_figures(tmp_path: Path) -> None:
    reader = _Reader([[_refusal("3914151")], [_refusal("3914151", "held")], []])
    gate, _ = _gate(tmp_path, reader, _store(tmp_path / "bucket"))
    assert gate.record.passed, gate.record.reasons
    assert reader.saw[2] is not None
    assert reader.saw[2]["pages"][0]["copy"] is None
    assert gate.files() == {"held.json": reader.saw[2]}
    assert not (tmp_path / "staging" / "runs" / _RUN / "held" / "3914151.json").exists()
    assert "players/3914151.json (the board's figures alone)" in gate.record.summary


def test_a_refusal_left_on_the_second_read_fails_the_run(tmp_path: Path) -> None:
    # Holding one page moved the one basis onto another (its shared week), so another page is refused.
    reader = _Reader([[_refusal("3914151")], [_refusal("4430681")]])
    gate, _ = _gate(tmp_path, reader, _store(tmp_path / "bucket"))
    assert not gate.record.passed
    assert gate.held == ()
    assert gate.record.reasons == (_refusal("4430681"),)


def test_no_earlier_run_means_no_copy(tmp_path: Path) -> None:
    gate, _ = _gate(tmp_path, _Reader([[_refusal("3914151")], []]), LocalRunStore(tmp_path / "empty"))
    assert gate.record.passed
    assert gate.held[0].copy is None


def test_an_earlier_run_that_does_not_read_costs_the_copies_never_the_night(tmp_path: Path) -> None:
    store = _store(tmp_path / "bucket")
    store.put(EARLY_KEY, b"not json", JSON_TYPE)
    gate, lines = _gate(tmp_path, _Reader([[_refusal("3914151")], []]), store)
    assert gate.record.passed
    assert gate.held[0].copy is None
    assert any(line.startswith("schema: no earlier copies of the held pages") for line in lines)
