"""Lane 72, one status source (the re-review's F3) and the withheld read's caption (F5): the page's status
for a week read and the web's `designations.json` are read the same way from the same read
(`designations.read_statuses`, `status_word`), so the serve rule and the web's hide rule agree on every
player of a board; and the caption over a read his status moved past names when the hourly pass writes
the new one."""

from datetime import UTC, datetime

import pytest

from research.capsules.week.caption import next_hourly_pass, status_changed_caption
from research.nightly.designations import PlayerStatus, StatusRead, designations_file, status_word

_READ = StatusRead(
    datetime(2026, 10, 14, 2, 3, tzinfo=UTC),
    None,
    "tank01_injuries_by_date",
    {
        "4426515": PlayerStatus("questionable", False, None),
        "4430807": PlayerStatus("out", False, None),
        "4241478": PlayerStatus("injured_reserve", True, datetime(2026, 10, 1, tzinfo=UTC)),
        "unranked": PlayerStatus("doubtful", False, None),
    },
)
# A fixture board: listed players, a player the capture does not list, and one it lists who is unranked.
_BOARD = ("4426515", "4430807", "4241478", "4362628", "3116406")


def test_the_page_and_the_web_read_the_same_status_for_every_player_of_a_board() -> None:
    web = designations_file(_READ, _BOARD)["players"]
    for player_id in _BOARD:
        expected = web[player_id]["status"] if player_id in web else None
        assert status_word(_READ, player_id) == expected, player_id
    assert status_word(None, "4426515") is None


@pytest.mark.parametrize(
    ("after", "due"),
    [
        (datetime(2026, 10, 17, 2, 0, tzinfo=UTC), datetime(2026, 10, 17, 3, 0, tzinfo=UTC)),  # Fri 10 pm ET: 11 pm ET
        (datetime(2026, 10, 17, 6, 30, tzinfo=UTC), datetime(2026, 10, 17, 10, 0, tzinfo=UTC)),  # 2:30 am ET: 6 am ET
        (datetime(2026, 10, 17, 14, 0, tzinfo=UTC), datetime(2026, 10, 17, 15, 0, tzinfo=UTC)),  # on the hour: the next
        # 11:30 pm ET: the midnight pass (Lane 162; the harvest's 00:00 ET pass runs the writer too).
        (datetime(2026, 10, 18, 3, 30, tzinfo=UTC), datetime(2026, 10, 18, 4, 0, tzinfo=UTC)),
        (datetime(2026, 10, 18, 4, 30, tzinfo=UTC), datetime(2026, 10, 18, 6, 0, tzinfo=UTC)),  # 0:30 am ET: 2 am ET
    ],
)
def test_the_next_hourly_pass_follows_the_capture_schedule(after: datetime, due: datetime) -> None:
    assert next_hourly_pass(after) == due


def test_the_caption_names_when_the_new_read_is_due() -> None:
    caption = status_changed_caption(datetime(2026, 10, 17, 2, 0, tzinfo=UTC))
    assert caption == "His status changed since this read was written. A new read is due by Fri Oct 16, 10:00 pm CT."


def test_a_read_whose_status_rewrites_are_spent_names_the_next_days_first_pass() -> None:
    """Lane 275 fix round 2 (review H2): once three rewrites fell since the written read, the caption keeps
    honest and names the first pass of the next Central day, the nightly at 00:30 CDT."""
    caption = status_changed_caption(datetime(2026, 10, 18, 18, 30, tzinfo=UTC), capped=True)
    assert caption == "His status changed since this read was written. A new read is due by Mon Oct 19, 12:30 am CT."
