"""THE SITE'S ONE BANNED LIST, read by the writer: the words and marks the site never prints.

The site's copy guard (`web/src/lib/format/copy-guard.ts`) and the writer read one file,
`web/src/lib/format/banned-words.json` (the sweep of 2026-10-20, C7 and Y6: "15 total touchdowns" and
"holding this line" passed the writer and tripped the site). The writer refuses every word on it, so
prose that passes the writer passes the site. The file is the web contract's (`research.web_contract`):
the research image's web-contract stage copies `src/lib/format` whole.

Each word is a pattern fragment matched whole and in any case, keyed to the word a reader sees; the
betting line spares the field's own lines (the goal line, the offensive and defensive line, the O-line
and D-line, the line of scrimmage), each spared word one lookaround, as the site builds it.
"""

import json
import os
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Final, cast

from research.web_contract import contract_dir

LIST_PATH: Final = Path("src/lib/format/banned-words.json")
_WORD_GROUPS: Final = ("bettingOnly", "bettingShared", "trading", "platform")


def list_file(environ: Mapping[str, str] = os.environ) -> Path:
    """The one list's file in the web contract."""
    return contract_dir(dict(environ)) / LIST_PATH


def _line(line: Mapping[str, object]) -> str:
    after = "".join(f"(?<!{spared}[ -])" for spared in cast(Sequence[str], line["sparedAfter"]))
    side = "".join(rf"(?<!\b{spared}-)" for spared in cast(Sequence[str], line["sparedSide"]))
    before = "".join(f"(?! {spared})" for spared in cast(Sequence[str], line["sparedBefore"]))
    return f"{after}{side}{line['word']}{before}"


def site_list(path: Path) -> tuple[re.Pattern[str], tuple[str, ...]]:
    """The list at `path` as one pattern (its words whole, any case, or a mark) and the words it shows
    a writer, each as a reader sees it."""
    raw = cast(dict[str, object], json.loads(path.read_text(encoding="utf-8")))
    groups = [cast(dict[str, str], raw[group]) for group in _WORD_GROUPS]
    line = cast(dict[str, object], raw["line"])
    marks = cast(list[str], raw["marks"])
    fragments = [_line(line), *(fragment for group in groups for fragment in group)]
    words = rf"\b(?:{'|'.join(fragments)})\b"
    pattern = re.compile(f"{words}|[{''.join(re.escape(mark) for mark in marks)}]", re.IGNORECASE)
    shown = (*(word for group in groups for word in group.values()), str(line["shown"]))
    return pattern, tuple(dict.fromkeys(shown))


SITE_PATTERN, SITE_SHOWN = site_list(list_file())
