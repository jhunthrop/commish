"""Lane 72 on the player page: the board week's read served with its caption, its stamps, the status it
was written against and its call; withheld behind "A new read is being written since his status changed"
when his status moved since (the review's H3); none for a facts row (L3) or once his board-week game has
kicked off (H1)."""

from datetime import UTC, date, datetime
from typing import cast

from research.capsules.week.caption import PROJECTION_MOVED_CAPTION
from research.capsules.week.rollover import ReadsDue
from research.capsules.week.sheet import PublishedProjection
from research.capsules.week.store import StoredWeekRead
from research.nightly.assemble import served_projections
from research.nightly.build.page_club import ClubCall
from research.nightly.build.pages import (
    UNREAD,
    Identity,
    PageInputs,
    ReadClock,
    ServedWeek,
    _promised,
    reads_due_json,
    week_read_json,
)
from research.nightly.build.player_season import SeasonContext, SeasonStore
from research.nightly.reads.schedule import Game

_WRITTEN = datetime(2026, 10, 17, 2, 0, tzinfo=UTC)


def _read(source: str = "llm", status: str | None = "questionable") -> StoredWeekRead:
    return StoredWeekRead(
        "00-0038542", 2026, 6, source, "Bijan Robinson is Questionable on Friday's report.", "m/x", _WRITTEN,
        _WRITTEN, {}, 15.2, status, "status", "start", date(2026, 10, 16), 1,
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


def test_a_read_whose_projection_moved_by_the_tiles_threshold_is_withheld() -> None:
    """Lane 66v (the sweep's X5), held to the Proj change tile's 0.5 (Lane 162, D04): the read quotes 15.2."""
    clock = ReadClock(_WRITTEN)
    for card in (14.7, 15.7, 14.6, None):
        moved = week_read_json(_read(), "questionable", kicked_off=False, clock=clock, projection=card)
        assert moved is not None, card
        assert moved["body"] is None and moved["call"] is None, card
        assert moved["caption"] == PROJECTION_MOVED_CAPTION, card
    # A move the tile calls "under 0.5" stands, as does the same figure at the card's tenth.
    for card in (15.24, 15.0, 15.6, 14.8):
        same = week_read_json(_read(), "questionable", kicked_off=False, clock=clock, projection=card)
        assert same is not None and same["body"] is not None, card
    # A run that read no projection for the week does not judge it.
    unread = week_read_json(_read(), "questionable", kicked_off=False, clock=ReadClock(_WRITTEN), projection=UNREAD)
    assert unread is not None and unread["body"] is not None


def test_a_read_written_against_another_status_is_withheld_behind_its_caption() -> None:
    served = week_read_json(_read(), "out", kicked_off=False, clock=ReadClock(_WRITTEN))
    assert served is not None
    assert served["body"] is None and served["call"] is None
    # Friday 9:00 pm Central: the next hourly pass is Friday 11:00 pm Eastern.
    assert (
        served["caption"]
        == "His status changed since this read was written. A new read is due by Fri Oct 16, 10:00 pm CT."
    )
    assert served["status"] == "questionable"


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


def test_the_run_serves_each_players_projection_for_the_board_week_as_the_card_prints_it() -> None:
    read = {
        ("00-0038542", 6): PublishedProjection(15.2, _WRITTEN, None, None),
        ("00-0038542", 7): PublishedProjection(9.0, _WRITTEN, None, None),
    }
    assert served_projections(read, 6) == {"00-0038542": 15.2}
    # No snapshot for the week: the run does not judge the reads by it.
    assert served_projections(read, 8) is None


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
    return PageInputs({}, {}, {}, {}, season, ServedWeek({}, {}, at, None, due), {})


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
