"""The run's status-changed caption against the clients' one source for its words (Lane 274 review M1).

The web and both apps read shared/words/player-status-held.json to know the run's caption, to read its due
time and to drop that clause once his game is under way. A rewording in `caption.py` that this does not
match would make every client fall back to its own words without a sound, so it fails here first.
"""

import json
from datetime import UTC, datetime
from pathlib import Path

from research.capsules.week.caption import status_changed_caption
from research.capsules.week.sheet import central_stamp

# The parts of a stamp the clients read back: weekday, month, day, clock, half, zone.
_STAMP_PARTS = 6
_WORDS = Path(__file__).resolve().parents[2] / "shared" / "words" / "player-status-held.json"


def test_the_run_caption_is_the_shared_lead_and_due_clause_with_a_central_stamp() -> None:
    words = json.loads(_WORDS.read_text())
    as_of = datetime(2026, 10, 17, 2, 0, tzinfo=UTC)
    for capped in (False, True):
        caption = status_changed_caption(as_of, capped=capped)
        prefix = f"{words['changedLead']} {words['dueBy']} "
        assert caption.startswith(prefix), caption
        assert caption.endswith("."), caption
        stamp = caption.removeprefix(prefix).removesuffix(".")
        # The stamp is the one the clients read back: "Fri Oct 16, 10:00 pm CT".
        assert len(stamp.split(" ")) == _STAMP_PARTS, stamp
        assert stamp.endswith(central_stamp(as_of).split(" ")[-1]), stamp
