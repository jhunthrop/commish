"""THE STORE'S COMMAND LINE.

    uv run python -m research.model.weekly4.features history --database <scratch> --out <dir> \
        [--first 2016] [--last 2024] [--depth-chart week|prior]
    uv run python -m research.model.weekly4.features live --database <scratch> --out <dir> \
        --season 2026 --week 7 --after 2026-10-16T22:00:00Z [--depth-chart week|prior]

Both run only on a local scratch copy on 5433 (a `lane68_` or `lane70_` database), in one read-only
transaction. `history` builds the team-game and play rows of 2016 to 2024 (weeks 1 to 17) and the
player rows of 2021 to 2024 (weeks 4 to 17, 2020 read as the season before) under round 2's
`guard_queries`, which refuses any statement naming 2025 or 2026, and reads every outcome through the
one outcome reader (2016 to 2024). `live` builds a week's rows for the games still to kick off after
`--after`, from the live sources, with no outcome reader at all. The depth chart rule is the
coordinator's recorded verdict of the stamp check (section 5): `week` on a pass, `prior` on a fail.
Each season's files are written beside `report.json`, which holds the coverage and the digests.
"""

import argparse
import json
import logging
import sys
import time
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path
from typing import Any, Final

from sqlalchemy import text

from research.cli import log_line
from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.logging_setup import configure_logging
from research.model.reads.preseason import all_positions
from research.model.ros.scratch import check_scratch_url
from research.model.weekly.round.judge import table_digests
from research.model.weekly2.guard import guard_queries
from research.model.weekly4.features.columns import PLAY_SCHEMA, PLAYER_SCHEMA, TEAM_SCHEMA
from research.model.weekly4.features.coverage import season_report
from research.model.weekly4.features.outcomes import LAST_SERVED, OutcomeReader
from research.model.weekly4.features.players import DepthRule
from research.model.weekly4.features.season import SeasonBuild, SeasonSpec, build_season
from research.model.weekly4.features.store import PLAY_KEY, PLAYER_KEY, TEAM_KEY, write_rows

SCRATCH_PREFIXES: Final = ("lane68_", "lane70_")
FIRST_TEAM_SEASON: Final = 2016
FIRST_PLAYER_SEASON: Final = 2021  # 2.6: the player-level fit 2021 to 2023, 2020 the season before
TEAM_WEEKS: Final = tuple(range(1, 18))  # 2.5: regular-season weeks 1 to 17
PLAYER_WEEKS: Final = tuple(range(4, 18))  # 2.6: weeks 4 to 17 (the judgment's 6 to 17 inside)
CLOSED: Final = frozenset({LAST_SERVED + 1, LAST_SERVED + 2})  # 2025 and the pristine 2026


def history_specs(first: int, last: int, rule: DepthRule) -> list[SeasonSpec]:
    if first < FIRST_TEAM_SEASON or last > LAST_SERVED:
        raise ValueError(f"the history build covers {FIRST_TEAM_SEASON} to {LAST_SERVED}")
    return [
        SeasonSpec(s, PLAYER_WEEKS if s >= FIRST_PLAYER_SEASON else (), TEAM_WEEKS, rule)
        for s in range(first, last + 1)
    ]


def write_season(build: SeasonBuild, out: Path) -> dict[str, str]:
    season = build.spec.season
    tag = "live" if build.spec.live_after is not None else "history"
    digests: dict[str, str] = {}
    for kind, rows, schema, key in (
        ("players", build.player_rows, PLAYER_SCHEMA, PLAYER_KEY),
        ("teams", build.team_rows, TEAM_SCHEMA, TEAM_KEY),
        ("plays", build.play_rows, PLAY_SCHEMA, PLAY_KEY),
    ):
        if rows:
            name = f"{tag}-{season}-{kind}.parquet"
            digests[name] = write_rows(rows, schema, key, out / name)
    return digests


def _run(url: str, out: Path, specs: Sequence[SeasonSpec], live: bool) -> dict[str, Any]:
    check_scratch_url(url, SCRATCH_PREFIXES)
    started = time.monotonic()
    engine = make_engine(sqlalchemy_url(url))
    seasons: list[dict[str, Any]] = []
    try:
        with engine.connect() as conn:
            conn.execute(text("set transaction read only"))
            if not live:
                guard_queries(conn, CLOSED)
            before = table_digests(conn)
            positions = {pid: str(p) for pid, p in all_positions(conn).items()}
            reader: OutcomeReader | None = None if live else OutcomeReader()
            for spec in specs:
                build, reader = build_season(conn, spec, positions, reader)
                report = season_report(build, conn, write_season(build, out))
                seasons.append(report)
                log_line(f"{spec.season}: {report['rows']} in {report['seconds']} s")
            after = table_digests(conn)
    finally:
        engine.dispose()
    return {
        "command": "live" if live else "history",
        "outcome_seasons_read": [] if reader is None else sorted(set(reader.served)),
        "isolated_tables": {"before": before, "after": after, "unchanged": before == after},
        "seasons": seasons,
        "seconds": round(time.monotonic() - started, 1),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.model.weekly4.features")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("history", "live"):
        command = sub.add_parser(name)
        command.add_argument("--database", required=True)
        command.add_argument("--out", type=Path, required=True)
        command.add_argument("--depth-chart", choices=("week", "prior"), required=True)
    history = sub.choices["history"]
    history.add_argument("--first", type=int, default=FIRST_TEAM_SEASON)
    history.add_argument("--last", type=int, default=LAST_SERVED)
    live = sub.choices["live"]
    live.add_argument("--season", type=int, required=True)
    live.add_argument("--week", type=int, required=True)
    live.add_argument("--after", type=datetime.fromisoformat, required=True)
    args = parser.parse_args(argv)
    configure_logging(logging.WARNING)
    if args.command == "history":
        specs = history_specs(args.first, args.last, args.depth_chart)
    else:
        specs = [SeasonSpec(args.season, (args.week,), (args.week,), args.depth_chart, args.after)]
    report = _run(args.database, args.out, specs, args.command == "live")
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / f"report-{args.command}.json").write_text(json.dumps(report, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
