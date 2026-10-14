"""THE ROUND'S COMMAND LINE: the gap season's ingest into a scratch copy, the development check, and
the one judgment. Every command names its database explicitly (`--database`); none reads an
environment URL, and a Neon host is refused.

    uv run python -m research.model.weekly.round ingest-gap-season --database <scratch> --season 2025
    uv run python -m research.model.weekly.round dev-check --database <scratch> --out <file.json>
    uv run python -m research.model.weekly.round judge --database <scratch> --out <file.json>
"""

import argparse
import json
import sys
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any, Final
from urllib.parse import urlparse

from sqlalchemy import Engine, text

from research.cli import log_line
from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.errors import ConfigurationError
from research.model.arithmetic import ARM64_BOARDS, model_version
from research.model.artifacts import read_artifact
from research.model.weekly.model import weekly_priors_from, weekly_priors_payload
from research.model.weekly.round import gates
from research.model.weekly.round.judge import Judgment, RoundFit, fit_round, judge_round
from research.pipeline.http import LiveFetcher
from research.pipeline.nflverse import ingest
from research.pipeline.nflverse.client import NflverseClient


def _engine(url: str) -> Engine:
    host = urlparse(url).hostname or ""
    if "neon" in host:
        raise ConfigurationError("the weekly round runs on a local copy, never on Neon")
    return make_engine(sqlalchemy_url(url))


def _ingest_gap_season(url: str, season: int) -> int:
    engine = _engine(url)
    client = NflverseClient(LiveFetcher())
    with engine.begin() as conn:
        universe = ingest.ingest_player_universe(conn, client)
        stamps = ingest.schedule_week_as_of(client, [season])
        report = ingest.ingest_season(conn, client, universe, season, stamps.get(season))
    log_line(f"ingested {season}: {report}")
    engine.dispose()
    return 0


def _render(fitted: RoundFit, judged: Judgment) -> list[str]:
    priors = fitted.fit.priors
    lines = [
        f"fit: {fitted.seconds['fit']:.1f}s, read {fitted.seconds['read']:.1f}s, interval over "
        f"{fitted.interval_weeks} weeks {fitted.seconds['interval']:.1f}s",
        f"search: decay {priors.opportunity.recency_decay}, shrinkage {priors.opportunity.shrinkage}, "
        f"share RMSE {fitted.fit.share_rmse:.5f} over {fitted.fit.share_observations} shares",
        f"board: {judged.rows} rows over {len(judged.numbers['weeks'])} weeks, "
        f"{judged.numbers['scored_rows']} scored, {judged.seconds_per_week:.2f}s a week",
    ]
    lines += [f"{'PASS' if g.passed else 'FAIL'}  {g.gate} {g.subject:<22} {g.detail}" for g in judged.lines]
    lines.append(f"DECISION: {'all gates pass' if judged.passed else 'a gate failed; no weekly number ships'}")
    return lines


# The one judgment's record. Its existence closes the judgment: the preregistration says a second
# run against 2025 voids the record, so `judge` refuses unless told it is a marked rerun.
JUDGMENT_RECORD: Final = Path(__file__).resolve().parents[4] / "docs/research/2026-10-13-weekly-projection-results.json"


def _run(url: str, thresholds: gates.Thresholds, out: Path, rerun: bool = False) -> int:
    engine = _engine(url)
    with engine.connect() as conn:
        conn.execute(text("set transaction read only"))
        oracle = weekly_priors_from(read_artifact(conn, "model/weekly-priors").payload)
        fitted = fit_round(conn, thresholds, ARM64_BOARDS)
        judged = judge_round(conn, thresholds, fitted, oracle)
    engine.dispose()
    report = _render(fitted, judged)
    for line in report:
        log_line(line)
    payload: dict[str, Any] = {
        "model": "commish_weekly_v1",
        "model_version": model_version(),
        "arithmetic": ARM64_BOARDS.label,
        "thresholds": asdict(thresholds),
        "priors": {
            **weekly_priors_payload(fitted.fit.priors),
            "fitSeasons": list(thresholds.fit_seasons),
            "heldOutSeasons": list(thresholds.held_out_seasons),
        },
        "interval": fitted.interval.payload(),
        "fit_seconds": dict(fitted.seconds),
        "share_rmse": fitted.fit.share_rmse,
        "gates": [asdict(line) for line in judged.lines],
        "passed": judged.passed,
        "numbers": dict(judged.numbers),
        "seconds_per_week": judged.seconds_per_week,
        "report": report,
        "rerun": rerun,
    }
    out.write_text(json.dumps(payload, indent=1, default=str))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.model.weekly.round")
    sub = parser.add_subparsers(dest="command", required=True)
    gap = sub.add_parser("ingest-gap-season", help="the house's season ingest, into the named database")
    gap.add_argument("--database", required=True)
    gap.add_argument("--season", type=int, required=True)
    for name in ("dev-check", "judge"):
        run = sub.add_parser(name)
        run.add_argument("--database", required=True)
        run.add_argument("--out", type=Path, required=True)
        run.add_argument("--rerun", action="store_true", help="judge again, marked as a rerun that voids the record")
    args = parser.parse_args(argv)
    if args.command == "ingest-gap-season":
        return _ingest_gap_season(args.database, args.season)
    judging = args.command == "judge"
    if judging and JUDGMENT_RECORD.exists() and not args.rerun:
        raise ConfigurationError(f"the 2025 judgment was taken once ({JUDGMENT_RECORD.name}); a rerun voids it")
    thresholds = gates.PREREGISTERED if judging else gates.DEVELOPMENT_CHECK
    return _run(args.database, thresholds, args.out, rerun=args.rerun)


if __name__ == "__main__":
    sys.exit(main())
