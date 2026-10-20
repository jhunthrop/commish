"""WHICH INJURY REPORT A STATUS IS ON, named by the day the clubs issued it (Lane 96, B16).

The capture is the provider's injury list, which the clubs' reports feed; the list names no report of its
own, so the read names the one report each week settles a game's status on: the game status report,
issued by 4 pm Eastern two days before the kickoff's Eastern day (Friday for a Sunday game, Saturday for a
Monday game, Thursday for a Saturday game), and the day before a Thursday game (Wednesday). A status seen
after that report names it ("Friday's report"); one seen before it names the list by its read and the
report still to come, so a read never cites a report that did not exist when it was written.
"""

from datetime import date, datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from research.capsules.render_words import week_of
from research.capsules.week.sheet import WeekGame, central_day_and_time

EASTERN: Final = ZoneInfo("America/New_York")
# The game status report's deadline on its day, Eastern.
REPORT_DEADLINE: Final = time(16, 0)
# Days before the kickoff's Eastern day the report is issued: one for a Thursday game, two for any other.
THURSDAY: Final = 3
DAYS_BEFORE: Final = 2
DAYS_BEFORE_THURSDAY: Final = 1


def status_report_day(kickoff: datetime) -> date:
    """The day the game status report for a game kicking off at `kickoff` is issued, Eastern."""
    day = kickoff.astimezone(EASTERN).date()
    return day - timedelta(days=DAYS_BEFORE_THURSDAY if day.weekday() == THURSDAY else DAYS_BEFORE)


def status_report_issued(kickoff: datetime) -> datetime:
    """The instant that report is due: 4 pm Eastern on its day."""
    return datetime.combine(status_report_day(kickoff), REPORT_DEADLINE, EASTERN)


def report_words(seen_at: datetime | None, game: WeekGame | None, season: int) -> str:
    """The report a status seen at `seen_at` is on, for the game in front of him: "Friday's report" once
    that game's status report is out, else the list by its read and the report to come; "the latest
    report" with no read at all."""
    if seen_at is None:
        return "the latest report"
    listed = f"the injury list read {central_day_and_time(seen_at)} Central"
    if game is None:
        return listed
    issued = status_report_issued(game.kickoff)
    day = issued.strftime("%A")
    if seen_at >= issued:
        return f"{day}'s report"
    return f"{listed}, before {day}'s game status report for {week_of(game.week, season)}"
