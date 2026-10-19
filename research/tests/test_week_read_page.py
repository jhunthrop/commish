"""Lane 72 on the player page: the board week's read served with its caption, its stamps, the status it
was written against and its call; withheld behind "A new read is being written since his status changed"
when his status moved since (the review's H3); none for a facts row (L3) or once his board-week game has
kicked off (H1)."""

from datetime import UTC, date, datetime

from research.capsules.week.caption import PROJECTION_MOVED_CAPTION
from research.capsules.week.sheet import PublishedProjection
from research.capsules.week.store import StoredWeekRead
from research.nightly.assemble import served_projections
from research.nightly.build.pages import UNREAD, week_read_json

_WRITTEN = datetime(2026, 10, 17, 2, 0, tzinfo=UTC)


def _read(source: str = "llm", status: str | None = "questionable") -> StoredWeekRead:
    return StoredWeekRead(
        "00-0038542", 2026, 6, source, "Bijan Robinson is Questionable on Friday's report.", "m/x", _WRITTEN,
        _WRITTEN, {}, 15.2, status, "status", "start", date(2026, 10, 16), 1,
    )  # fmt: skip


def test_a_standing_read_is_served_with_its_caption_status_and_call() -> None:
    served = week_read_json(_read(), "questionable", kicked_off=False, as_of=_WRITTEN)
    assert served == {
        "week": 6,
        "body": "Bijan Robinson is Questionable on Friday's report.",
        "caption": "Written Fri 9:00 pm Central, for week 6",
        "status": "questionable",
        "call": "start",
        "writtenAt": "2026-10-17T02:00:00.000Z",
        "factsAt": "2026-10-17T02:00:00.000Z",
        "projection": 15.2,
        "movedCaption": PROJECTION_MOVED_CAPTION,
    }


def test_a_read_whose_projection_the_card_no_longer_prints_is_withheld() -> None:
    """Lane 66v (the sweep's X5): Josh Allen's read quoted 26.6 while his card printed 26.4."""
    moved = week_read_json(_read(), "questionable", kicked_off=False, as_of=_WRITTEN, projection=15.0)
    assert moved is not None
    assert moved["body"] is None and moved["call"] is None
    assert moved["caption"] == PROJECTION_MOVED_CAPTION
    same = week_read_json(_read(), "questionable", kicked_off=False, as_of=_WRITTEN, projection=15.24)
    assert same is not None and same["body"] is not None
    # A run that read no projection for the week does not judge it.
    unread = week_read_json(_read(), "questionable", kicked_off=False, as_of=_WRITTEN, projection=UNREAD)
    assert unread is not None and unread["body"] is not None


def test_a_read_written_against_another_status_is_withheld_behind_its_caption() -> None:
    served = week_read_json(_read(), "out", kicked_off=False, as_of=_WRITTEN)
    assert served is not None
    assert served["body"] is None and served["call"] is None
    # Friday 9:00 pm Central: the next hourly pass is Friday 11:00 pm Eastern.
    assert (
        served["caption"]
        == "His status changed since this read was written. A new read is due by Fri 10:00 pm Central."
    )
    assert served["status"] == "questionable"


def test_a_facts_row_or_a_kicked_off_game_serves_no_read() -> None:
    assert week_read_json(_read(source="facts"), "questionable", kicked_off=False, as_of=_WRITTEN) is None
    assert week_read_json(_read(), "questionable", kicked_off=True, as_of=_WRITTEN) is None
    assert week_read_json(None, None, kicked_off=False, as_of=_WRITTEN) is None


def test_the_run_serves_each_players_projection_for_the_board_week_as_the_card_prints_it() -> None:
    read = {
        ("00-0038542", 6): PublishedProjection(15.2, _WRITTEN, None, None),
        ("00-0038542", 7): PublishedProjection(9.0, _WRITTEN, None, None),
    }
    assert served_projections(read, 6) == {"00-0038542": 15.2}
    # No snapshot for the week: the run does not judge the reads by it.
    assert served_projections(read, 8) is None
