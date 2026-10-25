"""The schema gate's reading of the web reader's exit (Lane 76).

A reader that could not run fails the gate loudly: its exit code and the first lines of its stderr are
the reason, never "returned nothing" alone, and a reader that printed nothing never passes.
"""

import json

import pytest

from research.nightly.schema_gate import reach_of, reader_outcome

# What node printed on main d8b72a19 when the image lacked `src/lib/format` (research.yml run 39216069123).
_MISSING_MODULE = """node:internal/modules/esm/resolve:274
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/web-contract/src/lib/format/figure-words.ts' \
imported from /app/web-contract/src/lib/run/rest-words.ts
    at finalizeResolution (node:internal/modules/esm/resolve:274:11)
    at moduleResolve (node:internal/modules/esm/resolve:864:10)
    at solve (file:///app/research/nightly/contract/run-contract.ts:42:12) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///app/web-contract/src/lib/format/figure-words.ts'
}

Node.js v24.11.0
"""
# A reason fits on one log line however long the stack under it.
_REASON_CEILING = 1000
_SUMMARY = "run r: 0 refusals; 3 formats (9 board rows), 3 of 3 player pages parsed, adp, record"


def test_a_reader_that_crashed_names_its_exit_and_its_error() -> None:
    reasons, summary = reader_outcome(1, "", _MISSING_MODULE)
    assert len(reasons) == 1
    reason = reasons[0]
    assert reason.startswith("schema_unchecked:exit 1: ")
    assert (
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/web-contract/src/lib/format/figure-words.ts'" in reason
    )
    assert "node:internal/modules/esm/resolve:274" in reason
    assert "\n" not in reason
    assert "returned nothing" not in summary
    assert "exit 1" in summary


def test_the_reason_keeps_the_head_of_a_long_stderr() -> None:
    noise = "\n".join(f"    at frame{index} (file:///x.ts:{index}:1)" for index in range(500))
    reasons, _ = reader_outcome(2, "", f"TypeError: boom\n{noise}")
    assert reasons[0].startswith("schema_unchecked:exit 2: TypeError: boom")
    assert len(reasons[0]) < _REASON_CEILING


def test_a_reader_that_printed_nothing_never_passes() -> None:
    reasons, summary = reader_outcome(0, "", "")
    assert reasons == ["schema_unchecked:exit 0: the web's reader printed no summary and no stderr"]
    assert "exit 0" in summary


def test_a_crash_with_no_stderr_still_names_the_exit() -> None:
    reasons, _ = reader_outcome(137, "", "")
    assert reasons == ["schema_unchecked:exit 137: the web's reader printed no summary and no stderr"]


def test_refusals_are_the_reasons_and_the_summary_is_the_readers() -> None:
    stdout = f"schema:boards/ppr.json:rows.0.rank: expected number\n{_SUMMARY.replace('0 refusals', '1 refusals')}\n"
    reasons, summary = reader_outcome(1, stdout, "")
    assert reasons == ["schema:boards/ppr.json:rows.0.rank: expected number"]
    assert summary.startswith("run r: 1 refusals")


def test_a_clean_run_passes_with_the_readers_summary() -> None:
    reasons, summary = reader_outcome(0, f"{_SUMMARY}\n", "")
    assert reasons == []
    assert summary == _SUMMARY


# LANE 205: the reader prints the run's season reach on one line of its own before the summary.
_REACH = {"format": "ppr-12", "scoring": "PPR", "through": "through week 5", "complete": 5, "partial": None}
_PARTIAL = {
    **_REACH,
    "through": "through week 5 and week 6's Thursday game",
    "partial": {"week": 6, "days": ["Thursday"]},
}


def _reach_line(reach: object) -> str:
    return f"reach:{json.dumps(reach)}"


def test_the_reach_line_is_neither_a_refusal_nor_the_summary() -> None:
    reasons, summary = reader_outcome(0, f"{_reach_line(_REACH)}\n{_SUMMARY}\n", "")
    assert reasons == []
    assert summary == _SUMMARY


@pytest.mark.parametrize(
    "reach",
    [
        _REACH,
        _PARTIAL,
        {**_REACH, "through": "", "complete": 0},
        {**_PARTIAL, "through": "through week 5 and part of week 6", "partial": {"week": 6, "days": []}},
    ],
)
def test_the_reach_line_is_read_as_the_reader_counted_it(reach: dict[str, object]) -> None:
    assert reach_of(f"{_reach_line(reach)}\n{_SUMMARY}\n") == reach


def test_a_reader_that_printed_no_reach_has_none() -> None:
    assert reach_of(f"{_SUMMARY}\n") is None


@pytest.mark.parametrize(
    "stdout",
    [
        "reach:{not json\n",
        f"{_reach_line({**_REACH, 'games': 1})}\n",
        f"{_reach_line({k: v for k, v in _REACH.items() if k != 'partial'})}\n",
        f"{_reach_line([_REACH])}\n",
        f"{_reach_line(_REACH)}\n{_reach_line(_PARTIAL)}\n",
        # Review M1: the members' types and the nested partial, as the web's reachSchema reads them.
        f"{_reach_line({'format': 1, 'scoring': '', 'through': '', 'complete': -1, 'partial': {'x': 1}})}\n",
        f"{_reach_line({**_REACH, 'format': ''})}\n",
        f"{_reach_line({**_REACH, 'scoring': 3})}\n",
        f"{_reach_line({**_REACH, 'through': None})}\n",
        f"{_reach_line({**_REACH, 'complete': -1})}\n",
        f"{_reach_line({**_REACH, 'complete': 5.5})}\n",
        f"{_reach_line({**_REACH, 'complete': True})}\n",
        f"{_reach_line({**_PARTIAL, 'partial': {'x': 1}})}\n",
        f"{_reach_line({**_PARTIAL, 'partial': {'week': 0, 'days': []}})}\n",
        f"{_reach_line({**_PARTIAL, 'partial': {'week': 6, 'days': ['']}})}\n",
        f"{_reach_line({**_PARTIAL, 'partial': {'week': 6, 'days': 'Thursday'}})}\n",
    ],
)
def test_a_reach_line_that_is_not_one_reach_is_never_taken(stdout: str) -> None:
    with pytest.raises(ValueError, match=r"reach|Expecting"):
        reach_of(stdout)
