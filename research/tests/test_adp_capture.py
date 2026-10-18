"""One rule for a capture whose rows cross-walk to one provider id (Lane 66o review M2): the board and the
room keep the lower ADP, the earlier row in ADP order, as the api's read does (`min(adp)` in
api/internal/boards/market.go). A row the crosswalk cannot place is counted once, and a second row for
a placed player is not counted as unplaced. A hand-built fixture, no store."""

from research.nightly.reads.adp import CaptureRow, place_capture


def test_a_provider_id_two_rows_reach_keeps_the_lower_adp() -> None:
    rows = [
        CaptureRow("u-rb", 4.2, "rb"),
        CaptureRow("u-wr", 5.0, "wr"),
        CaptureRow("u-rb-old", 7.7, "rb"),
        CaptureRow("u-none", 9.0, None),
    ]
    placed, unplaced = place_capture(rows)
    assert placed == {"rb": 4.2, "wr": 5.0}
    assert unplaced == 1


def test_the_order_rows_arrive_in_does_not_change_the_rule() -> None:
    rows = [CaptureRow("u-rb-old", 7.7, "rb"), CaptureRow("u-rb", 4.2, "rb")]
    placed, unplaced = place_capture(rows)
    assert placed == {"rb": 4.2}
    assert unplaced == 0
