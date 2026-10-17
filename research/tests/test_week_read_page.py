"""Lane 72 on the player page: the board week's read served with its caption, its stamps, the status it
was written against and its call; withheld behind "A new read is being written since his status changed"
when his status moved since (the review's H3); none for a facts row (L3) or once his board-week game has
kicked off (H1)."""

from datetime import UTC, date, datetime

from research.capsules.week.store import StoredWeekRead
from research.nightly.build.pages import STATUS_CHANGED_CAPTION, week_read_json

_WRITTEN = datetime(2026, 10, 17, 2, 0, tzinfo=UTC)


def _read(source: str = "llm", status: str | None = "questionable") -> StoredWeekRead:
    return StoredWeekRead(
        "00-0038542", 2026, 6, source, "Bijan Robinson is Questionable on Friday's report.", "m/x", _WRITTEN,
        _WRITTEN, {}, 15.2, status, "status", "start", date(2026, 10, 16), 1,
    )  # fmt: skip


def test_a_standing_read_is_served_with_its_caption_status_and_call() -> None:
    served = week_read_json(_read(), "questionable", kicked_off=False)
    assert served == {
        "week": 6,
        "body": "Bijan Robinson is Questionable on Friday's report.",
        "caption": "Written Fri 9:00 pm Central, for week 6",
        "status": "questionable",
        "call": "start",
        "writtenAt": "2026-10-17T02:00:00.000Z",
        "factsAt": "2026-10-17T02:00:00.000Z",
    }


def test_a_read_written_against_another_status_is_withheld_behind_its_caption() -> None:
    served = week_read_json(_read(), "out", kicked_off=False)
    assert served is not None
    assert served["body"] is None and served["call"] is None
    assert served["caption"] == STATUS_CHANGED_CAPTION == "A new read is being written since his status changed"
    assert served["status"] == "questionable"


def test_a_facts_row_or_a_kicked_off_game_serves_no_read() -> None:
    assert week_read_json(_read(source="facts"), "questionable", kicked_off=False) is None
    assert week_read_json(_read(), "questionable", kicked_off=True) is None
    assert week_read_json(None, None, kicked_off=False) is None
