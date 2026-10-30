"""WHICH INJURY REPORT A STATUS IS ON, named by the day the clubs issued it (Lane 96, B16).

The capture is the provider's injury list, which the clubs' reports feed; the list names no report of its
own, so the read names the one report each week settles a game's status on: the game status report,
issued by 4 pm Eastern two days before the kickoff's Eastern day (Friday for a Sunday game, Saturday for a
Monday game, Thursday for a Saturday game), and the day before a Thursday game (Wednesday). A status seen
after that report names it ("Friday's report", "Friday's report, updated Saturday" once the list changed
a day after it); one seen before it names the list by its read and the report still to come, so a read
never cites a report that did not exist, or a change it did not carry, when it was written.
"""

from datetime import date, datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from research.capsules.week.sheet import Status, WeekGame, WeekSheet, central_day_and_time

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


def report_words(status: Status, written_at: datetime, game: WeekGame | None) -> str:
    """The report his status is on, for the game in front of him (Lane 96 and its review M3, L2, L3):
    "Friday's report" once that game's status report is out; "Friday's report, updated Saturday" when the
    list last changed on a later Eastern day than the report's (a Saturday downgrade is not Friday's);
    before the report the list by its read and the report to come, "the injury list as of Saturday
    11:00 pm Central, before week 7's game status report on Friday"; "the latest report" with no read.
    No season in the words: a read that quotes them has named it already."""
    seen_at = status.seen_at(written_at)
    if seen_at is None:
        return "the latest report"
    listed = f"the injury list as of {central_day_and_time(seen_at)} Central"
    if game is None:
        return listed
    issued = status_report_issued(game.kickoff)
    day = issued.strftime("%A")
    if seen_at < issued:
        return f"{listed}, before week {game.week}'s game status report on {day}"
    changed = status.captured_at
    if changed is not None and changed > issued and changed.astimezone(EASTERN).date() > issued.date():
        return f"{day}'s report, updated {changed.astimezone(EASTERN).strftime('%A')}"
    return f"{day}'s report"


def this_weeks_game(sheet: WeekSheet) -> WeekGame | None:
    """His game this week, the one this week's game status report is issued for; None on a bye or with none."""
    game = sheet.game
    return None if game is None or sheet.bye or game.week != sheet.week else game


def report_day(sheet: WeekSheet) -> str | None:
    """The day this week's game status report is issued ("Friday"), None with no game this week."""
    game = this_weeks_game(sheet)
    return None if game is None else status_report_issued(game.kickoff).strftime("%A")


def report_out(sheet: WeekSheet) -> bool:
    """Whether this week's game status report was out when his status was read, as `report_words` dates it: what a
    read may cite the report for."""
    game, seen_at = this_weeks_game(sheet), sheet.status.seen_at(sheet.written_at)
    return game is not None and seen_at is not None and seen_at >= status_report_issued(game.kickoff)


def report_issued(sheet: WeekSheet) -> bool:
    """Whether this week's game status report was out by the write (the review's M2): the clock's, never the list's."""
    game = this_weeks_game(sheet)
    return game is not None and sheet.written_at >= status_report_issued(game.kickoff)


def report_day_line(sheet: WeekSheet) -> str | None:
    """The game status report's day as a fact of the sheet (Lane 303, B307), true at the write (review M2): still to
    come; out, with his status read after it (so citable); or out, with his status read before it or never read (so
    neither still to come nor his status's source)."""
    game, day = this_weeks_game(sheet), report_day(sheet)
    if game is None or day is None:
        return None
    clock = central_day_and_time(status_report_issued(game.kickoff)).split(" ", 1)[1]
    # The day is the kickoff's, so the line carries the schedule's read as every line carries its own.
    read = "" if game.scheduled_at is None else f" (as of {central_day_and_time(game.scheduled_at)} Central)"
    if report_out(sheet):
        return f"Game status report: this week's came out {day} by {clock} Central, {day}'s report{read}."
    if report_issued(sheet):
        return (
            f"Game status report: this week's came out {day} by {clock} Central{read}; his status above was not "
            "read after it, so never say what it says or that it is still to come."
        )
    return (
        f"Game status report: this week's comes out {day} by {clock} Central, after this read{read}. A read may say "
        f'it is still to come ("before {day}\'s report"), never what it says.'
    )
