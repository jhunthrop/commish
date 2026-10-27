"""`python -m research.explore.scheme_elasticity <command>`: Lane 245's probe.

- `download --scratch URL`: participation and FTN for 2022 and 2023 into the lane's scratch tables.
- `coverage --scratch URL --dev URL`: each scheme column's populated share per season (no outcome).
- `run --scratch URL --dev URL --out PATH`: the comparison of the plan document (reads outcomes).
"""

import argparse
import json
import logging
import sys
from collections.abc import Sequence
from pathlib import Path

from research.explore.scheme_elasticity import db
from research.explore.scheme_elasticity.coverage import coverage
from research.explore.scheme_elasticity.fetch import FTN_TABLE, PARTICIPATION_TABLE, capped_client, download
from research.explore.scheme_elasticity.seasons import PROBE_SEASONS
from research.logging_setup import configure_logging
from research.pipeline.http import LiveFetcher

LOG = logging.getLogger("lane245")


def _download(scratch: str) -> int:
    fetcher = LiveFetcher()
    try:
        participation, ftn = download(capped_client(fetcher))
    finally:
        fetcher.close()
    engine = db.scratch_engine(scratch)
    db.write_frame(engine, participation, PARTICIPATION_TABLE)
    db.write_frame(engine, ftn, FTN_TABLE)
    LOG.warning("participation %d rows, ftn %d rows", len(participation), len(ftn))
    return 0


def _coverage(scratch: str, dev: str, out: Path) -> int:
    engine = db.scratch_engine(scratch)
    participation = db.read_frame(engine, PARTICIPATION_TABLE, PROBE_SEASONS)
    ftn = db.read_frame(engine, FTN_TABLE, PROBE_SEASONS)
    with db.dev_reader(dev) as conn:
        plays = db.plays(conn, PROBE_SEASONS)
    found = coverage(plays, participation, ftn)
    out.write_text(json.dumps(found.to_dict("records"), indent=1))
    LOG.warning("%s", found.to_string(index=False))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.explore.scheme_elasticity")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("download", "coverage", "run"):
        command = sub.add_parser(name)
        command.add_argument("--scratch", required=True)
        if name != "download":
            command.add_argument("--dev", required=True)
            command.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    configure_logging(logging.WARNING)
    if args.command == "download":
        return _download(args.scratch)
    if args.command == "coverage":
        return _coverage(args.scratch, args.dev, args.out)
    from research.explore.scheme_elasticity.run import run  # noqa: PLC0415 - the outcome reads load last

    return run(args.scratch, args.dev, args.out)


if __name__ == "__main__":
    sys.exit(main())
