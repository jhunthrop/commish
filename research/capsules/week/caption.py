"""THE READ'S CAPTION ON THE PAGE (Lane 66h): when it was written, in Central time, and the week it is for.

"Written Fri 9:00 pm Central, for week 6". The page prints it under the read, so a reader knows its age
and its week without a date (copy rule: things are placed by week, never by a month).
"""

from datetime import datetime

from research.capsules.week.sheet import central_day_and_time


def written_caption(written_at: datetime, week: int) -> str:
    """The caption for a read written at `written_at` for `week`."""
    return f"Written {central_day_and_time(written_at, short=True)} Central, for week {week}"
