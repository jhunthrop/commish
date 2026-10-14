"""`python -m research.transfer`: what a job reads from the store, per step and per statement.

    TRANSFER_DATABASE_URL=postgres://commish:commish@localhost:5432/commish \\
        uv run python -m research.transfer nightly [--skip ingest,headshots] [--json OUT]

Runs one scenario (`transfer.scenarios`) on an engine whose connections pass through a counting
relay, with the meter (`db.meter`) on every statement. Prints the per-step table and the top
statements by bytes, and the relay's wire total beside the meter's sum. The URL must name a
loopback host: a measurement is never run against a hosted store (the 2026-09-07 and 2026-10-14
transfer incidents), and RESEARCH_DATABASE_URL is deliberately not read.
"""

import argparse
import json
import sys
from collections.abc import Sequence
from dataclasses import asdict
from urllib.parse import urlsplit, urlunsplit

from research.db.engine import make_engine
from research.db.meter import TransferMeter
from research.db.url import database_url_from_env
from research.transfer.proxy import LOOPBACK, CountingRelay
from research.transfer.report import render
from research.transfer.scenarios import SCENARIOS

URL_VARIABLE = "TRANSFER_DATABASE_URL"


def _through(url: str, relay_port: int) -> str:
    parts = urlsplit(url)
    userinfo = parts.netloc.rsplit("@", 1)[0] + "@" if "@" in parts.netloc else ""
    return urlunsplit((parts.scheme, f"{userinfo}127.0.0.1:{relay_port}", parts.path, parts.query, parts.fragment))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research.transfer", description=(__doc__ or "").splitlines()[0])
    parser.add_argument("scenario", choices=sorted(SCENARIOS))
    parser.add_argument("--skip", default="", help="the job's own --skip, where it has one")
    parser.add_argument("--json", default=None, help="write every statement's read to this file")
    parser.add_argument("--top", type=int, default=10)
    args = parser.parse_args(argv)
    url = database_url_from_env(URL_VARIABLE)
    host = urlsplit(url).hostname or ""
    if host not in LOOPBACK:
        raise SystemExit(f"transfer: {URL_VARIABLE} must name a loopback host; refusing {host!r}")
    relay = CountingRelay(host, urlsplit(url).port or 5432)
    scenario = SCENARIOS[args.scenario]
    meter = TransferMeter(scenario.steps)
    engine = make_engine(_through(url, relay.port))
    meter.attach(engine)
    try:
        summary = scenario.run(engine, frozenset(s for s in args.skip.split(",") if s))
    finally:
        engine.dispose()
        relay.close()
    sys.stdout.write(render(args.scenario, summary, meter.reads, relay.totals(), args.top))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as out:
            json.dump(
                {"summary": summary, "wire": asdict(relay.totals()), "reads": [asdict(r) for r in meter.reads]}, out
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
