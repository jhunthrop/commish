"""The schema gate's reading of the web reader's exit (Lane 76).

A reader that could not run fails the gate loudly: its exit code and the first lines of its stderr are
the reason, never "returned nothing" alone, and a reader that printed nothing never passes.
"""

from research.nightly.schema_gate import reader_outcome

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
