"""THE GAME-DAY STATUS WINDOWS' LAST PASSES (Lane 263): when a budget stop in a status pass is a warning.

`infra/research-schedule.sh` fires the status pass every quarter hour in a window per game day. A pass whose
hourly dollars stopped reads while the window has passes left finishes them at the next; a stop at the window's
last pass leaves them unread until the hourly cadence. The last fire of each Eastern weekday is stated here once,
and `tests/test_game_day_status.py` holds it to the schedule script.
"""

from datetime import datetime, time
from typing import Final
from zoneinfo import ZoneInfo

_EASTERN: Final = ZoneInfo("America/New_York")
# isoweekday -> the last status fire of that day's window (Eastern): Monday, Thursday, Sunday.
LAST_STATUS_PASS: Final = {1: time(20, 15), 4: time(20, 15), 7: time(20, 45)}


def is_last_status_pass(at: datetime) -> bool:
    """Whether `at` is the last status fire of its Eastern day's window, or later in that day."""
    local = at.astimezone(_EASTERN)
    last = LAST_STATUS_PASS.get(local.isoweekday())
    return last is not None and (local.hour, local.minute) >= (last.hour, last.minute)
