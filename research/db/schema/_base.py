"""The metadata every research table registers on, and the column shapes they share."""

from datetime import datetime
from typing import Final

from sqlalchemy import CheckConstraint, Column, DateTime, MetaData, text

RESEARCH_SCHEMA: Final = "research"
METADATA: Final = MetaData(schema=RESEARCH_SCHEMA)

POSITIONS: Final = ("QB", "RB", "WR", "TE", "K", "DEF")


def recorded_at(name: str = "ingested_at") -> "Column[datetime]":
    """A bookkeeping instant the database stamps; no writer sets it and no comparison reads it."""
    return Column(name, DateTime(True), nullable=False, server_default=text("now()"))


def one_of(column: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    """A closed vocabulary as a check constraint: the text the writers already send, and no enum
    type with a lifecycle of its own to migrate when a value is added."""
    listed = ", ".join(f"'{value}'" for value in values)
    return CheckConstraint(f"{column} IN ({listed})", name=name)
