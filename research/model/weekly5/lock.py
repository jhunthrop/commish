"""THE LOCK'S ONE EDIT: the founder's two answers, then the lock's commit, written into `decisions.py`.

    uv run python -m research.model.weekly5.lock --spreadsheets both --margin 0.030
    uv run python -m research.model.weekly5.lock --lock <the lock commit>

The first form records the two decisions (run before the lock's commit, which carries the file); the
second records the lock's sha once the commit exists. Each rewrites exactly its own assignment lines and
nothing else; a value outside the choices, a margin that is not a positive number, or a sha that is not
hexadecimal is refused.
"""

import argparse
import re
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Final

from research.errors import ConfigurationError
from research.model.weekly5.decisions import SPREADSHEET_CHOICES

DECISIONS: Final = Path(__file__).resolve().parent / "decisions.py"
_SHA: Final = re.compile(r"^[0-9a-f]{7,40}$")
_LINES: Final = {
    "spreadsheets": re.compile(r"^SPREADSHEETS: Final\[Spreadsheets\] = .*$", re.MULTILINE),
    "margin": re.compile(r"^FORM_MARGIN: Final\[float\] = .*$", re.MULTILINE),
    "lock": re.compile(r"^LOCK: Final\[str \| None\] = .*$", re.MULTILINE),
}


def _assignment(name: str, value: str) -> str:
    if name == "spreadsheets":
        if value not in SPREADSHEET_CHOICES:
            raise ConfigurationError(f"decision (a) is one of {SPREADSHEET_CHOICES}, not {value!r}")
        return f'SPREADSHEETS: Final[Spreadsheets] = "{value}"'
    if name == "margin":
        try:
            margin = float(value)
        except ValueError as error:
            raise ConfigurationError(f"decision (b) is a number, not {value!r}") from error
        if not 0.0 < margin < 1.0:
            raise ConfigurationError(f"decision (b) is a positive rho margin below 1, not {margin}")
        return f"FORM_MARGIN: Final[float] = {margin!r}"
    if not _SHA.match(value):
        raise ConfigurationError(f"the lock is a commit sha, not {value!r}")
    return f'LOCK: Final[str | None] = "{value}"'


def rewrite(text: str, values: dict[str, str]) -> str:
    """`text` with each named assignment replaced, every other line as it was."""
    found = text
    for name, value in values.items():
        pattern = _LINES[name]
        if len(pattern.findall(found)) != 1:
            raise ConfigurationError(f"decisions.py holds no single {name} assignment")
        found = pattern.sub(_assignment(name, value), found)
    return found


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m research.model.weekly5.lock")
    parser.add_argument("--spreadsheets", choices=SPREADSHEET_CHOICES)
    parser.add_argument("--margin")
    parser.add_argument("--lock")
    args = parser.parse_args(argv)
    values = {k: v for k, v in (("spreadsheets", args.spreadsheets), ("margin", args.margin), ("lock", args.lock)) if v}
    if not values:
        parser.error("name a decision or the lock")
    DECISIONS.write_text(rewrite(DECISIONS.read_text(), values))
    return 0


if __name__ == "__main__":
    sys.exit(main())
