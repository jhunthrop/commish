"""A freeze keeps the week's published projection beside each row (Lane 66j, revision 0013): his PPR
points on the snapshot read at the freeze, None where it lists no row for him."""

from datetime import UTC, datetime
from types import SimpleNamespace

from research.db.schema.boards import REGISTER_FREEZE_ROWS
from research.model.register import freeze

_AT = datetime(2026, 10, 22, 12, 0, tzinfo=UTC)
_POINTS = 14.25


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


def test_a_freeze_row_carries_his_published_points_or_none() -> None:
    published = {"listed": _POINTS}
    listed = freeze._freeze_row(2026, 7, _AT, _entry("listed"), {}, {}, {}, published)
    absent = freeze._freeze_row(2026, 7, _AT, _entry("absent"), {}, {}, {}, published)
    assert listed["published_points"] == _POINTS
    assert absent["published_points"] is None


def test_the_schema_and_the_insert_name_the_column() -> None:
    assert "published_points" in REGISTER_FREEZE_ROWS.c
    assert REGISTER_FREEZE_ROWS.c.published_points.nullable
