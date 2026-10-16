"""The hourly odds capture asks for every game day left in the week (Lane 66a). It asked for the
capture's own UTC date, so a Tuesday read held no figure for Sunday, a Thursday night pass after
20:00 Eastern asked for Friday, and a day with no game failed with "no games on this date"."""

from datetime import UTC, date, datetime

from research.pipeline.tank01.capture import (
    CAPTURE_FEEDS,
    CaptureContext,
    cadence_allows,
    week_game_dates,
)
from research.pipeline.tank01.client import Paths

_WEEK_7 = [
    (7, date(2026, 10, 22)),
    (7, date(2026, 10, 25)),
    (7, date(2026, 10, 25)),
    (7, date(2026, 10, 26)),
    (8, date(2026, 10, 29)),
    (6, date(2026, 10, 19)),
]


def _odds_requests(context: CaptureContext) -> list[dict[str, str]]:
    (feed,) = [f for f in CAPTURE_FEEDS if f.source == "tank01_betting_odds"]
    return [request.query for request in feed.requests(context) if request.path == Paths.BETTING_ODDS]


def test_a_tuesday_asks_for_each_game_day_of_the_coming_week() -> None:
    tuesday = datetime(2026, 10, 20, 13, 0, tzinfo=UTC)
    assert week_game_dates(_WEEK_7, tuesday) == ("20261022", "20261025", "20261026")


def test_a_day_inside_the_week_asks_only_for_the_days_still_ahead_in_eastern_time() -> None:
    # Thursday 21:00 Eastern is Friday in UTC: Thursday's game is still today.
    thursday_night = datetime(2026, 10, 23, 1, 0, tzinfo=UTC)
    assert week_game_dates(_WEEK_7, thursday_night) == ("20261022", "20261025", "20261026")
    monday = datetime(2026, 10, 26, 14, 0, tzinfo=UTC)
    assert week_game_dates(_WEEK_7, monday) == ("20261026",)


def test_with_the_week_played_it_asks_for_the_next_and_with_no_schedule_for_nothing() -> None:
    assert week_game_dates(_WEEK_7, datetime(2026, 10, 27, 14, 0, tzinfo=UTC)) == ("20261029",)
    assert week_game_dates([], datetime(2026, 10, 27, 14, 0, tzinfo=UTC)) == ()


def test_the_odds_feed_takes_one_request_per_game_day_else_the_capture_day() -> None:
    week = CaptureContext(2026, 7, "20261020", (), ("20261022", "20261025", "20261026"))
    assert _odds_requests(week) == [{"gameDate": d} for d in ("20261022", "20261025", "20261026")]
    assert _odds_requests(CaptureContext(2026, 7, "20261012", ())) == [{"gameDate": "20261012"}]


def test_the_week_cadence_is_due_whenever_a_game_is_ahead_and_otherwise_on_game_days_only() -> None:
    tuesday = datetime(2026, 10, 20, 13, 0, tzinfo=UTC)
    with_games = CaptureContext(2026, 7, "20261020", (), ("20261022",))
    assert cadence_allows("game-week", tuesday, with_games)
    assert not cadence_allows("game-week", tuesday, CaptureContext(2026, 7, "20261020", ()))
    monday = datetime(2026, 10, 12, 6, 0, tzinfo=UTC)
    assert cadence_allows("game-week", monday, CaptureContext(2026, 6, "20261012", ()))
