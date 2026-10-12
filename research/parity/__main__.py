"""THE PARITY HARNESS.

    uv run python -m research.parity ingest <case>|all   run the TypeScript and Python ingests, diff the rows
    uv run python -m research.parity schema              the alembic baseline against drizzle's catalog
    uv run python -m research.parity record <set>|all    re-record a fixture set from the live provider
    uv run python -m research.parity list                every case and fixture set

`ingest` and `schema` need PARITY_DATABASE_URL (a Postgres where the harness may create its own
`parity_*` scratch databases) and, for the TypeScript side, the repository's node_modules. Exit
status is non-zero on any difference, on a case that compared no rows, and on a case whose two
sides did not ask for exactly the same recordings.
"""

import argparse
import logging
import os
import sys
from collections.abc import Sequence
from pathlib import Path

from research.parity.cases import ALL_CASES, CASES_BY_NAME, all_recordings
from research.parity.record import record_case
from research.parity.runner import CaseResult, run_case
from research.parity.schema_gate import against_live, run_schema_gate
from research.pipeline.http import LiveFetcher


def _print(line: str = "") -> None:
    sys.stdout.write(line + "\n")


def _report(results: Sequence[CaseResult]) -> None:
    header = (
        f"{'case':<28} {'table':<28} {'ts rows':>8} {'py rows':>8} {'only ts':>8} {'only py':>8} {'differ':>7}  result"
    )
    _print(header)
    _print("-" * len(header))
    for result in results:
        for diff in result.diffs:
            verdict = "match" if diff.matches else "DIFFERENT"
            _print(
                f"{result.case.name:<28} {diff.table:<28} {diff.ts_rows:>8} {diff.py_rows:>8} "
                f"{len(diff.only_ts):>8} {len(diff.only_py):>8} {len(diff.differing):>7}  {verdict}"
            )
        if sorted(result.ts_requests) != sorted(result.py_requests):
            _print(
                f"{result.case.name:<28} requests differ: ts={sorted(result.ts_requests)} py={sorted(result.py_requests)}"
            )
        if result.rows_compared == 0:
            _print(f"{result.case.name:<28} compared no rows: a vacuous case is a failure")
    for result in results:
        for diff in result.diffs:
            for line in [
                *diff.duplicate_keys,
                *(f"only ts: {k}" for k in diff.only_ts),
                *(f"only py: {k}" for k in diff.only_py),
                *diff.differing,
            ]:
                _print(f"  {result.case.name} {diff.table}: {line}")
    matching = sum(1 for r in results if r.matches)
    _print()
    _print(
        f"parity: {len(results)} ingest case(s), {matching} matching, {sum(r.rows_compared for r in results)} rows compared"
    )


def _ingest(names: Sequence[str]) -> int:
    cases = ALL_CASES if names == ["all"] else tuple(CASES_BY_NAME[name] for name in names)
    results = [run_case(case) for case in cases]
    _report(results)
    return 0 if all(r.matches for r in results) else 1


def _schema(against: str | None) -> int:
    if against is not None:
        only_live, only_baseline = against_live(against)
        for line in sorted(only_live):
            _print(f"  only the live database: {line}")
        for line in sorted(only_baseline):
            _print(f"  only the baseline: {line}")
        _print("schema against the live database: " + ("match" if not (only_live or only_baseline) else "DIFFERENT"))
        if only_live or only_baseline:
            return 1
    result = run_schema_gate()
    _print(f"schema: {result.facts_compared} catalog facts compared, baseline and head")
    for line in sorted(result.baseline_only_drizzle):
        _print(f"  only drizzle: {line}")
    for line in sorted(result.baseline_only_alembic):
        _print(f"  only alembic: {line}")
    for line in sorted(result.head_unexpected):
        _print(f"  head unexpected: {line}")
    _print("schema: match" if result.passed else "schema: DIFFERENT")
    return 0 if result.passed else 1


def _load_env_file(path: str | None) -> None:
    """Secrets a recording needs (a provider key), read from a dotenv file into this process only.
    Nothing read here is printed or written anywhere."""
    if path is None:
        return
    for line in Path(path).read_text().splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _record(names: Sequence[str], env_file: str | None) -> int:
    _load_env_file(env_file)
    recordings = all_recordings()
    chosen = list(recordings) if names == ["all"] else list(names)
    fetcher = LiveFetcher()
    try:
        for name in chosen:
            recording = recordings[name]
            path = record_case(recording.fixture_set, recording.specs(fetcher), fetcher, recording.note)
            _print(f"recorded {name} -> {path}")
    finally:
        fetcher.close()
    return 0


def _list() -> int:
    for case in ALL_CASES:
        _print(f"{case.name:<32} {case.summary}")
    _print()
    for name in sorted(all_recordings()):
        _print(f"fixture set {name}")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research.parity", description=__doc__.splitlines()[1] if __doc__ else None)
    sub = parser.add_subparsers(dest="command", required=True)
    ingest = sub.add_parser("ingest", help="run both ingests on the recorded input and diff the rows")
    ingest.add_argument("names", nargs="+", help="case names, or all")
    schema = sub.add_parser("schema", help="the alembic baseline against drizzle's catalog")
    schema.add_argument("--against", help="also compare a live database (read only, e.g. the dev copy) to the baseline")
    record = sub.add_parser("record", help="re-record fixture sets from the live provider")
    record.add_argument("names", nargs="+", help="fixture set names, or all")
    record.add_argument("--env-file", help="a dotenv file holding the provider keys a recording needs")
    sub.add_parser("list", help="every case and fixture set")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    if args.command == "ingest":
        return _ingest(args.names)
    if args.command == "schema":
        return _schema(args.against)
    if args.command == "record":
        return _record(args.names, args.env_file)
    return _list()


if __name__ == "__main__":
    sys.exit(main())
