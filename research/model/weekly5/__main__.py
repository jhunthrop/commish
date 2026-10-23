"""`python -m research.model.weekly5`: the round's check, its judgment and the results template.

uv run python -m research.model.weekly5 check --database <lane70_ URL> --features <store dir>
uv run python -m research.model.weekly5 judgment --database <lane70_ URL> --features <store dir>
uv run python -m research.model.weekly5 template [--replace]
"""

import argparse
import json
import logging
import sys
from collections.abc import Sequence
from pathlib import Path

from research.logging_setup import configure_logging
from research.model.weekly5 import template
from research.model.weekly5.environment import DatabaseEnvironment
from research.model.weekly5.round import CHECK_RECORD, JUDGMENT_RECORD, execute, setup_for


def _record(path: Path) -> dict[str, object] | None:
    if not path.exists():
        return None
    found: dict[str, object] = json.loads(path.read_text())
    return found


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.model.weekly5")
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="fit 2021-2022 and 2016-2022, check 2023 weeks 6-17 once; nothing ships")
    judgment = sub.add_parser("judgment", help="fit 2021-2023 and 2016-2023, judge 2024 weeks 6-17 once")
    for command in (check, judgment):
        command.add_argument("--database", required=True)
        command.add_argument("--features", type=Path, required=True)
    written = sub.add_parser("template", help="write the results record's template from the run records")
    written.add_argument("--replace", action="store_true")
    args = parser.parse_args(argv)
    configure_logging(logging.WARNING)
    if args.command == "template":
        template.write(template.RESULTS, _record(CHECK_RECORD), _record(JUDGMENT_RECORD), args.replace)
        return 0
    return execute(setup_for(args.command, DatabaseEnvironment()), args.database, args.features)


if __name__ == "__main__":
    sys.exit(main())
