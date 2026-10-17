"""THE SERVED PATH'S COMMAND LINE (section 4), built and wired to no screen.

    uv run python -m research.model.weekly4.serve refit --database <lane70_ scratch> --features <dir> \
        --record <the judgment's JSON> --version N [--publish <url>]
    uv run python -m research.model.weekly4.serve freeze --database <url> --season 2026 --week 8 \
        --version N --run-seed <job_runs id> [--after <instant>] [--depth-chart week|prior] [--counted]

`refit` runs only after a pass: it refuses unless the judgment's record says every line passed. It
reads 2021 to 2024 (and 2016 to 2024 for the play and team models) on the scratch copy with 2025 and
2026 closed, refits at the judged cells with no selection, and publishes the pinned version to
`--publish` (the scratch copy when none is named; never dev's 5432). `freeze` reads the pinned version,
computes the live week for the games kicking off after `--after` (now when none), and writes their
register rows; a row is counted only with `--counted`, which a run passes only for the pinned served
version after a pass (3.3); every other freeze is a shadow.
"""

import argparse
import hashlib
import json
import logging
import sys
from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Final

import pandas as pd
from sqlalchemy import text

from research.cli import log_line
from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.errors import ConfigurationError
from research.logging_setup import configure_logging
from research.model.priors import load_model_artifacts
from research.model.reads.preseason import all_positions
from research.model.ros.scratch import check_scratch_url, target_engine
from research.model.weekly2.guard import guard_queries
from research.model.weekly3.outcomes import judgment_reader
from research.model.weekly3.season import read_season
from research.model.weekly4.features.__main__ import aware_instant
from research.model.weekly4.files import load_store
from research.model.weekly4.live import freeze_rows, live_data, live_week, rate_board, record, season_lines
from research.model.weekly4.margins import MarginReader, margins
from research.model.weekly4.round import JUDGMENT_PREFIXES
from research.model.weekly4.round_three import fit_season_reads, lines_of, rates, run_round_three
from research.model.weekly4.served import (
    SERVED,
    judged_cells,
    load_served,
    payload_of,
    publish_served,
    served_fit,
    served_of,
)
from research.model.weekly4.system import Extras, dispersion_seasons

CLOSED: Final = frozenset({2025, 2026})


def _refit(url: str, features: Path, record_path: Path, version: int, publish: str | None) -> int:
    check_scratch_url(url, JUDGMENT_PREFIXES)
    record_bytes = record_path.read_bytes()
    judged = json.loads(record_bytes)
    if judged.get("command") != "judge" or judged.get("passed") is not True:
        raise ConfigurationError("the served refit runs only after a judgment whose every line passed (section 4)")
    t = SERVED
    store = load_store(features, range(2016, 2025), t.player_fit_seasons)
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.connect() as conn:
            conn.execute(text("set transaction read only"))
            guard_queries(conn, CLOSED)
            artifacts = load_model_artifacts(conn)
            positions = all_positions(conn)
            three = run_round_three(conn, t.round_three, artifacts, positions, "served-refit")
            reads, _ = fit_season_reads(conn, t.round_three, three.fit, artifacts, positions, t.fit_weeks)
            # 2024, the judged season, read again at weeks 4 to 17 for its fit rows' rate m.
            judged_weeks = replace(t.round_three, weeks=t.fit_weeks)
            last, _ = read_season(
                conn,
                t.round_three.judgment_season,
                judged_weeks,
                three.fit.rate.priors,
                artifacts,
                positions,
                judgment_reader(t.round_three),
            )
            reader = MarginReader(frozenset(dispersion_seasons(t)))
            allowed = []
            for season in dispersion_seasons(t):
                found, reader = reader.season(conn, season)
                allowed.append(found)
    finally:
        engine.dispose()
    pairing = store.teams[["season", "week", "club", "opponent"]]
    extras = Extras(
        rates([*reads, last], t.population),
        pd.concat([lines_of(r) for r in [*reads, last]], ignore_index=True),
        margins(pd.concat(allowed, ignore_index=True), pairing),
    )
    cells = judged_cells(judged)
    fitted = served_fit(store, extras, cells)
    payload = payload_of(served_of(fitted), cells, hashlib.sha256(record_bytes).hexdigest())
    target = target_engine(publish or url)
    try:
        with target.begin() as conn:
            digest = publish_served(conn, payload, version, datetime.now(UTC))
    finally:
        target.dispose()
    log_line(f"served version {version} published, digest {digest}")
    return 0


def _freeze(  # noqa: PLR0913, PLR0917 - the freeze's every input, named
    url: str, season: int, week: int, version: int, run_seed: int, after: datetime, depth_rule: str, counted: bool
) -> int:
    engine = target_engine(url)
    try:
        with engine.begin() as conn:
            served, digest = load_served(conn, version)
            artifacts = load_model_artifacts(conn)
            positions = all_positions(conn)
            rated = rate_board(conn, season, week, artifacts, positions)
            data = live_data(
                conn, served, season, week, after, positions, rated, "week" if depth_rule == "week" else "prior"
            )
            lines = season_lines(conn, season, week, rated.board.moment, positions)
            live = live_week(conn, served, data, rated, lines, positions, run_seed)
            frozen_at = datetime.now(UTC)
            written = record(conn, freeze_rows(live, frozen_at, digest, counted))
    finally:
        engine.dispose()
    log_line(
        f"{season} week {week}: {written} rows frozen at {frozen_at.isoformat()} by {digest[:12]}{'' if counted else ' (shadow)'}"
    )
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.model.weekly4.serve")
    sub = parser.add_subparsers(dest="command", required=True)
    refit = sub.add_parser("refit", help="the served refit after a pass, pinned by its digest")
    refit.add_argument("--database", required=True)
    refit.add_argument("--features", type=Path, required=True)
    refit.add_argument("--record", type=Path, required=True)
    refit.add_argument("--version", type=int, required=True)
    refit.add_argument("--publish")
    freeze = sub.add_parser("freeze", help="the live week's numbers frozen before each game's kickoff")
    freeze.add_argument("--database", required=True)
    freeze.add_argument("--season", type=int, required=True)
    freeze.add_argument("--week", type=int, required=True)
    freeze.add_argument("--version", type=int, required=True)
    freeze.add_argument("--run-seed", type=int, required=True)
    freeze.add_argument("--after", type=aware_instant)
    freeze.add_argument("--depth-chart", choices=("week", "prior"), default="week")
    freeze.add_argument("--counted", action="store_true")
    args = parser.parse_args(argv)
    configure_logging(logging.WARNING)
    if args.command == "refit":
        return _refit(args.database, args.features, args.record, args.version, args.publish)
    after = args.after or datetime.now(UTC)
    return _freeze(
        args.database, args.season, args.week, args.version, args.run_seed, after, args.depth_chart, args.counted
    )


if __name__ == "__main__":
    sys.exit(main())
