"""WHAT THE SITE SHOWS, AS A TABLE: the board rows of the run `runs/latest.json` names (revision 0006).

The nightly writes its boards to R2 and `publish` moves `latest`; the API never reads the bucket (no
file-sourced data at runtime), so `publish` also keeps this table equal to the published run's
boards (`research.nightly.published_board`): one transaction deletes the season's rows and inserts
the run's. From the first model week (week 6) those rows rank the rest of the season (`order_basis`), with points and no
range; before it they are the preseason board.

`player_id` is the provider id the product names players by (`provider_players.id`), the id the
run's board rows carry; not a foreign key, so the provider's rollover never waits on this table.
`format` names the API's stored boards (`ppr`, `half`, `std`) and `superflex` (the PPR points
valued for a second quarterback), each at twelve teams. `rank`, `position_rank` and
`points_over_replacement` are the run's own, at twelve teams under the format's roster shape.
"""

from typing import Final

from sqlalchemy import CheckConstraint, Column, DateTime, Double, Index, Integer, Table, Text

from research.db.schema._base import METADATA, one_of

PUBLISHED_FORMATS: Final = ("ppr", "half", "std", "superflex")
ORDER_BASES: Final = ("preseason", "rest_of_season")

PUBLISHED_BOARDS: Final = Table(
    "published_boards",
    METADATA,
    Column("season", Integer, primary_key=True),
    Column("format", Text, primary_key=True),
    Column("player_id", Text, primary_key=True),
    Column("run_id", Text, nullable=False),
    Column("rank", Integer, nullable=False),
    Column("position_rank", Integer, nullable=False),
    # NULL when the run serves no points for him; the range is NULL in season (no interval is served).
    Column("points", Double(53)),
    Column("points_over_replacement", Double(53)),
    Column("floor_points", Double(53)),
    Column("median_points", Double(53)),
    Column("ceiling_points", Double(53)),
    Column("order_basis", Text, nullable=False),
    # In season the run's refresh; before it the stored board generation the run printed.
    Column("refreshed", DateTime(True), nullable=False),
    Column("published_at", DateTime(True), nullable=False),
    # The run's rosFromWeek in season (revision 0007): the weeks a figure covers run from it to week 17;
    # NULL for a preseason row.
    Column("from_week", Integer),
    one_of("format", PUBLISHED_FORMATS, "published_boards_format_ck"),
    one_of("order_basis", ORDER_BASES, "published_boards_order_basis_ck"),
    CheckConstraint("rank >= 1 AND position_rank >= 1", name="published_boards_rank_ck"),
    CheckConstraint("from_week BETWEEN 1 AND 18", name="published_boards_from_week_ck"),
    Index("published_boards_run_idx", "run_id"),
)
