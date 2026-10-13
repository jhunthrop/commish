"""THE PARITY REPORT: one line per table per pass, every difference spelled out, two totals.

THE TOTALS. `rows compared, per case` adds every table of every pass of every case, which counts a
shared prerequisite (the 25,000-person universe several cases land first) once per case. The
deduplicated total counts each ingest-under-test table per pass, and each prerequisite table
(`TableSpec.setup`) once across the whole run, at its largest size: the evidence without the
repetition.
"""

import sys
from collections.abc import Sequence

from research.parity.runner import CaseResult, PassResult


def _print(line: str = "") -> None:
    sys.stdout.write(line + "\n")


def _pass_lines(result: CaseResult, run: PassResult) -> None:
    for diff in run.diffs:
        verdict = "EMPTY" if diff.empty else ("match" if diff.matches else "DIFFERENT")
        role = "setup" if diff.setup else "test"
        _print(
            f"{result.case.name:<28} {run.name:<6} {diff.table:<28} {role:<5} {diff.ts_rows:>8} {diff.py_rows:>8} "
            f"{len(diff.only_ts):>7} {len(diff.only_py):>7} {len(diff.differing):>6}  {verdict}"
        )
    if not run.same_requests:
        _print(
            f"{result.case.name:<28} {run.name:<6} requests differ: ts={sorted(run.ts.requested)} py={sorted(run.py.requested)}"
        )
    if not run.same_statuses:
        _print(f"{result.case.name:<28} {run.name:<6} exit statuses differ: ts={run.ts.statuses} py={run.py.statuses}")


def _details(results: Sequence[CaseResult]) -> None:
    for result in results:
        for run in result.passes:
            for diff in run.diffs:
                lines = [
                    *diff.duplicate_keys,
                    *(f"only ts: {k}" for k in diff.only_ts),
                    *(f"only py: {k}" for k in diff.only_py),
                    *diff.differing,
                ]
                for line in lines:
                    _print(f"  {result.case.name} {run.name} {diff.table}: {line}")


def deduplicated_rows(results: Sequence[CaseResult]) -> int:
    under_test = sum(d.rows for r in results for p in r.passes for d in p.diffs if not d.setup)
    setup: dict[str, int] = {}
    for r in results:
        for p in r.passes:
            for d in p.diffs:
                if d.setup:
                    setup[d.table] = max(setup.get(d.table, 0), d.rows)
    return under_test + sum(setup.values())


def report(results: Sequence[CaseResult]) -> None:
    header = (
        f"{'case':<28} {'pass':<6} {'table':<28} {'role':<5} {'ts rows':>8} {'py rows':>8} "
        f"{'only ts':>7} {'only py':>7} {'differ':>6}  result"
    )
    _print(header)
    _print("-" * len(header))
    for result in results:
        for run in result.passes:
            _pass_lines(result, run)
    _details(results)
    matching = sum(1 for r in results if r.matches)
    passes = sum(len(r.passes) for r in results)
    differences = sum(
        len(d.only_ts) + len(d.only_py) + len(d.differing) + len(d.duplicate_keys)
        for r in results
        for p in r.passes
        for d in p.diffs
    )
    _print()
    _print(
        f"parity: {len(results)} ingest case(s) in {passes} passes, {matching} matching; "
        f"{sum(r.rows_compared for r in results)} rows compared per case, "
        f"{deduplicated_rows(results)} deduplicated; {differences} differences"
    )
