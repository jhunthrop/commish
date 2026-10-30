"""Lane 72 on the player page: the board week's read served with its caption, its stamps, the status it
was written against and its call; under a caption that says his status changed and when the new read is due
when his status moved since (the review's H3), its body and call still served (Lane 275: "we should always
show a read"); none for a facts row (L3) or once his board-week game has kicked off (H1)."""

from dataclasses import replace
from datetime import UTC, date, datetime
from typing import cast

from research.capsules.week.caption import PROJECTION_MOVED_CAPTION
from research.capsules.week.rollover import ReadsDue
from research.capsules.week.store import StoredWeekRead
from research.capsules.week.write import WEEK_WRITER_VERSION
from research.nightly.build.page_club import ClubCall
from research.nightly.build.pages import (
    Identity,
    PageInputs,
    ReadClock,
    ServedWeek,
    _promised,
    _week_read,
    reads_due_json,
    week_read_json,
)
from research.nightly.build.player_season import SeasonContext, SeasonStore
from research.nightly.reads.schedule import Game

_WRITTEN = datetime(2026, 10, 17, 2, 0, tzinfo=UTC)


def _read(source: str = "llm", status: str | None = "questionable") -> StoredWeekRead:
    return StoredWeekRead(
        "00-0038542", 2026, 6, source, "Bijan Robinson is Questionable on Friday's report.", "m/x", _WRITTEN,
        _WRITTEN, {}, 15.2, status, "status", "start", date(2026, 10, 16), 1, WEEK_WRITER_VERSION,
    )  # fmt: skip


def test_a_standing_read_is_served_with_its_caption_status_and_call() -> None:
    served = week_read_json(_read(), "questionable", kicked_off=False, clock=ReadClock(_WRITTEN))
    assert served == {
        "week": 6,
        "body": "Bijan Robinson is Questionable on Friday's report.",
        "caption": "Written Fri Oct 16, 9:00 pm CT, for week 6",
        "status": "questionable",
        "call": "start",
        "writtenAt": "2026-10-17T02:00:00.000Z",
        "factsAt": "2026-10-17T02:00:00.000Z",
        "projection": 15.2,
        "movedCaption": PROJECTION_MOVED_CAPTION,
    }


def test_a_read_written_against_another_status_is_served_under_the_status_caption() -> None:
    """Lane 275 (the founder, 2026-10-28: "we should always show a read"): the stored body and call stay, and
    the caption says his status changed and when the new read is due."""
    served = week_read_json(_read(), "out", kicked_off=False, clock=ReadClock(_WRITTEN))
    assert served is not None
    assert served["body"] == "Bijan Robinson is Questionable on Friday's report." and served["call"] == "start"
    # Friday 9:00 pm Central: the next hourly pass is Friday 11:00 pm Eastern.
    assert (
        served["caption"]
        == "His status changed since this read was written. A new read is due by Fri Oct 16, 10:00 pm CT."
    )
    assert served["status"] == "questionable"


def test_a_read_whose_status_rewrites_are_spent_today_names_the_next_days_pass() -> None:
    """Lane 275 fix round 2 (review H2): three rewrites fell since the read was written on its Central day, so
    no hourly pass asks again today; the caption keeps honest and names the next day's first pass."""
    spent = replace(_read(), attempts=4)
    served = week_read_json(spent, "out", kicked_off=False, clock=ReadClock(_WRITTEN))
    assert served is not None and served["body"] is not None
    assert served["caption"].endswith("A new read is due by Sat Oct 17, 12:30 am CT.")


def test_a_standing_reads_caption_names_its_write_alone_whenever_the_run_is_built() -> None:
    """Lane 222 (B186): the run is built once a night, so a status read stamp baked into the caption was
    thirteen hours old at the Sunday 1 pm games. The caption names the write; the web names the status read
    its own build took and the next one (`web/src/lib/player/read-byline.ts`)."""
    later = datetime(2026, 10, 17, 7, 20, tzinfo=UTC)
    served = week_read_json(_read(), "questionable", kicked_off=False, clock=ReadClock(later))
    assert served is not None and served["body"] is not None
    assert served["caption"] == "Written Fri Oct 16, 9:00 pm CT, for week 6"


def test_a_facts_row_or_a_kicked_off_game_serves_no_read() -> None:
    assert week_read_json(_read(source="facts"), "questionable", kicked_off=False, clock=ReadClock(_WRITTEN)) is None
    assert week_read_json(_read(), "questionable", kicked_off=True, clock=ReadClock(_WRITTEN)) is None
    assert week_read_json(None, None, kicked_off=False, clock=ReadClock(_WRITTEN)) is None


def test_until_the_roll_over_a_page_with_no_read_names_the_week_and_the_night_its_reads_are_written() -> None:
    """Lane 256: the page's words in place of "not written yet" come from the run's week and night; a page
    serving a read, or a run after the roll-over, carries none."""
    due = ReadsDue(8, datetime(2026, 10, 28, 5, 30, tzinfo=UTC))
    assert reads_due_json(None, due) == {"week": 8, "night": "Tuesday", "at": "2026-10-28T05:30:00.000Z"}
    assert reads_due_json({"week": 8}, due) is None
    assert reads_due_json(None, None) is None


def _inputs(due: ReadsDue, clubs: dict[str, str | None], games: dict[str, list[Game]], at: datetime) -> PageInputs:
    calls = {pid: ClubCall(club, None, None, moved=False) for pid, club in clubs.items()}
    season = SeasonContext(2026, 18, 7, games, {}, cast("SeasonStore", None), {}, calls)
    return PageInputs({}, {}, {}, {}, season, ServedWeek({}, {}, at, due), {})


def _who(player_id: str) -> Identity:
    return Identity(player_id, player_id, player_id, "WR", "LAR", None)


def test_the_promise_is_only_for_a_page_the_pass_will_write() -> None:
    """The review's L4: a free agent, a page with no season, and a club whose week 8 game has kicked off are
    never written by the roll-over, so their pages promise no night."""
    tuesday = datetime(2026, 10, 27, 5, 50, tzinfo=UTC)
    due = ReadsDue(8, datetime(2026, 10, 28, 5, 30, tzinfo=UTC))
    games = {
        "LAR": [Game(8, "ARI", False, datetime(2026, 10, 30, 0, 15, tzinfo=UTC))],
        "SEA": [Game(8, "HOU", False, datetime(2026, 10, 27, 5, 0, tzinfo=UTC))],
    }
    inputs = _inputs(due, {"ram": "LAR", "free": None, "hawk": "SEA"}, games, tuesday)
    assert _promised(_who("ram"), True, inputs) == due
    assert _promised(_who("ram"), False, inputs) is None
    assert _promised(_who("free"), True, inputs) is None
    assert _promised(_who("hawk"), True, inputs) is None


def test_a_released_player_has_no_read_for_a_club_that_let_him_go() -> None:
    """Lane 301 (B298): a stored read about a club he no longer plays for is not a read of his week; a
    free agent's page serves none, a club player's page serves his."""
    at = datetime(2026, 10, 29, 12, 0, tzinfo=UTC)
    games = {"LAR": [Game(6, "ARI", False, datetime(2026, 11, 5, 1, 15, tzinfo=UTC))]}
    stored = {"u1": replace(_read(), week=6)}
    inputs = replace(
        _inputs(ReadsDue(6, at), {}, games, at),
        week=ServedWeek(stored, {"ram": "questionable", "free": "questionable"}, at),
    )
    assert _week_read(_who("ram"), "u1", inputs) is not None
    free = replace(_who("free"), team="FA")
    assert _week_read(free, "u1", inputs) is None
