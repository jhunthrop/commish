"""The compared research tables. Each is keyed by its primary key, read off the schema itself; the
two append-only archives, whose primary key is an identity draw, are keyed by the columns that name
one capture instead, and say so. The TypeScript side of each is read out of the legacy tables
through `research.db.legacy`."""

from sqlalchemy import Table

from research.db import schema
from research.parity.diff import TableSpec


def keyed(table: Table) -> TableSpec:
    """A table compared on its own primary key."""
    if any(column.identity is not None for column in table.primary_key.columns):
        raise ValueError(f"{table.name}'s primary key is an identity draw; name the columns that identify a row")
    return TableSpec(table.name, tuple(column.name for column in table.primary_key.columns))


PLAYERS = keyed(schema.PLAYERS)
PLAYER_WEEK_OBSERVATIONS = keyed(schema.PLAYER_WEEK_OBSERVATIONS)
TEAM_WEEK_OBSERVATIONS = keyed(schema.TEAM_WEEK_OBSERVATIONS)
PLAYER_WEEK_TEAMS = keyed(schema.PLAYER_WEEK_TEAMS)
NFLVERSE_INJURIES = keyed(schema.NFLVERSE_INJURIES)
NFLVERSE_ROSTER_WEEKS = keyed(schema.NFLVERSE_ROSTER_WEEKS)
NFLVERSE_KICKING_WEEKS = keyed(schema.NFLVERSE_KICKING_WEEKS)
NFLVERSE_TEAM_DEFENSE_WEEKS = keyed(schema.NFLVERSE_TEAM_DEFENSE_WEEKS)
NFL_DRAFT_PICKS = keyed(schema.NFL_DRAFT_PICKS)
PRESEASON_ROSTERS = keyed(schema.PRESEASON_ROSTERS)
PRESEASON_RANKINGS = keyed(schema.PRESEASON_RANKINGS)
PLAYER_CROSSWALK = keyed(schema.PLAYER_CROSSWALK)
ADP_SNAPSHOTS = keyed(schema.ADP_SNAPSHOTS)
PROPS_PLAYER_MAP = keyed(schema.PROPS_PLAYER_MAP)
COACHES = keyed(schema.COACHES)
PROVIDER_PLAYERS = keyed(schema.PROVIDER_PLAYERS)
PROVIDER_GAMES = keyed(schema.PROVIDER_GAMES)
PROVIDER_STAT_LINES = keyed(schema.PROVIDER_STAT_LINES)
PROVIDER_WEEKS = keyed(schema.PROVIDER_WEEKS)

# Identity-keyed archives: one capture is a feed at an instant.
CAPTURE_SNAPSHOTS = TableSpec(schema.CAPTURE_SNAPSHOTS.name, ("source", "captured_at"))
# A plain insert that may legitimately hold identical rows (an event's props fetched twice), so the
# rows under one key compare as multisets.
PLAYER_PROP_OBSERVATIONS = TableSpec(
    schema.PLAYER_PROP_OBSERVATIONS.name,
    ("event_id", "bookmaker", "market", "player_name", "point", "fetched_at"),
    unique=False,
)
