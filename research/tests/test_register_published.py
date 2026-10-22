"""A freeze keeps the week's yardsticks beside each row: the published projection (Lane 66j, revision
0013) and ESPN's own projection (Lane 114, revision 0017), his PPR points on the read at the freeze,
None where it lists no row for him."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from research.db.schema.boards import REGISTER_FREEZE_ROWS
from research.model.register import freeze

_AT = datetime(2026, 10, 22, 12, 0, tzinfo=UTC)
_POINTS = 14.25
_ESPN = 12.5


def _entry(player_id: str) -> SimpleNamespace:
    return SimpleNamespace(
        player_id=player_id,
        source=freeze.SERVED_SOURCE,
        as_of=_AT,
        projected_points=210.0,
        rank=3,
        value_rank=4,
        model_version="research@test",
    )


def test_a_freeze_row_carries_each_yardstick_or_none() -> None:
    read_at = _AT - timedelta(minutes=3)
    kept = freeze.Yardsticks({"listed": _POINTS}, {"listed": _ESPN}, read_at)
    listed = freeze._freeze_row(2026, 7, _AT, _entry("listed"), {}, {}, {}, kept)
    absent = freeze._freeze_row(2026, 7, _AT, _entry("absent"), {}, {}, {}, kept)
    assert (listed["published_points"], listed["espn_points"], listed["espn_read_at"]) == (_POINTS, _ESPN, read_at)
    # The read's instant rides only with a figure from it (Lane 146).
    assert (absent["published_points"], absent["espn_points"], absent["espn_read_at"]) == (None, None, None)


def test_the_schema_and_the_insert_name_the_columns() -> None:
    for column in ("published_points", "espn_points", "espn_read_at"):
        assert column in REGISTER_FREEZE_ROWS.c
        assert REGISTER_FREEZE_ROWS.c[column].nullable
    # Declared last (Lane 114, then Lane 146): a reader that predates the column is unchanged.
    assert list(REGISTER_FREEZE_ROWS.c.keys())[-2:] == ["espn_points", "espn_read_at"]
