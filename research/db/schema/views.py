"""THE RESEARCH SCHEMA'S VIEWS (revision 0014): `club_week_finals`, the one "final held" rule the
hourly status pass, the run's game states and the API's week facts all read (Lane 80).

The definition is `club_week_finals.sql`, shared with the migration and the API's test; the
declaration creates it after the tables, so `METADATA.create_all` builds what the migration does and
the schema gate compares the two views' definitions line for line."""

from pathlib import Path
from typing import Final

from sqlalchemy import DDL, Column, DateTime, Integer, MetaData, Table, Text, event

from research.db.schema._base import METADATA, RESEARCH_SCHEMA

CLUB_WEEK_FINALS_SQL: Final = Path(__file__).with_name("club_week_finals.sql")


def club_week_finals_ddl(schema: str = RESEARCH_SCHEMA) -> str:
    """The view's create statement for a schema."""
    return CLUB_WEEK_FINALS_SQL.read_text().replace("{schema}", schema)


# A view, read like a table: on its own metadata, so the declaration's tables never include it and
# `create_all` creates it only through the DDL below.
_VIEWS: Final = MetaData(schema=RESEARCH_SCHEMA)
CLUB_WEEK_FINALS: Final = Table(
    "club_week_finals",
    _VIEWS,
    Column("season", Integer),
    Column("week", Integer),
    Column("team", Text),
    Column("held_at", DateTime(True)),
)

# sqlalchemy declares DDL untyped.
event.listen(METADATA, "after_create", DDL(club_week_finals_ddl()))  # type: ignore[no-untyped-call]
