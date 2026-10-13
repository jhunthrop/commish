"""THE PARITY HARNESS.

    uv run python -m research.parity ingest <case>|all   run the TypeScript and Python ingests, diff the rows
    uv run python -m research.parity schema              the migrations against the declared schema, and the legacy map
    uv run python -m research.parity record <set>|all    re-record a fixture set from the live provider
    uv run python -m research.parity list                every case and fixture set

`ingest` and `schema` need PARITY_DATABASE_URL (a Postgres where the harness may create its own
`parity_*` scratch databases, and drops every one of them, leftovers included) and, for the
TypeScript side, the repository's node_modules. Each case runs in passes (`runner.py`): into empty
databases, again on top, and from an earlier recording to today's where one exists. Exit status is
non-zero on any difference, on a declared table empty on both sides, on the two sides asking for
different recordings, and on different exit statuses from the operator scripts.
"""

import argparse
import logging
import os
import sys
from collections.abc import Sequence
from pathlib import Path

from research.parity.cases import ALL_CASES, CASES_BY_NAME, all_recordings
from research.parity.record import record_case
from research.parity.report import report
from research.parity.runner import close_harness, open_harness, run_case
from research.parity.schema_gate import against_live, run_schema_gate
from research.pipeline.http import LiveFetcher


def _print(line: str = "") -> None:
    sys.stdout.write(line + "\n")


def _ingest(names: Sequence[str]) -> int:
    cases = ALL_CASES if names == ["all"] else tuple(CASES_BY_NAME[name] for name in names)
    harness = open_harness()
    try:
        results = [run_case(harness, case) for case in cases]
    finally:
        close_harness(harness)
    report(results)
    return 0 if all(r.matches for r in results) else 1


def _schema(against: str | None) -> int:
    if against is not None:
        only_live, only_migrated = against_live(against)
        for line in sorted(only_live):
            _print(f"  only the live database: {line}")
        for line in sorted(only_migrated):
            _print(f"  only the migration: {line}")
        _print("schema against the live database: " + ("match" if not (only_live or only_migrated) else "DIFFERENT"))
        if only_live or only_migrated:
            return 1
    result = run_schema_gate()
    _print(f"schema: {result.facts} catalog facts in the migrated research schema")
    for line in result.metadata_differences:
        _print(f"  migration against the declared schema: {line}")
    for line in result.catalog_differences:
        _print(f"  catalog, migration against declaration: {line}")
    for line in result.legacy_map_problems:
        _print(f"  legacy map: {line}")
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
    schema = sub.add_parser("schema", help="the migrations against the declared schema, and the legacy map")
    schema.add_argument("--against", help="also compare a live database's research schema (read only) to the migration")
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
