"""WHO A PLAYER IS: the one universe every research row keys on, and the provider ids mapped onto it.

`players` is the nflverse universe (gsis ids, plus the 32 synthetic team defenses): every
`player_id` anywhere in the research schema means a row here. The Tank01 roster keeps its own
ids in `provider_players`, because that is how the provider names people, and
`player_crosswalk` is the only place the two meet.
"""

from typing import Final

from sqlalchemy import CheckConstraint, Column, DateTime, Double, ForeignKeyConstraint, Index, Integer, Table, Text

from research.db.schema._base import METADATA, POSITIONS, RESEARCH_SCHEMA, one_of, recorded_at

PLAYERS: Final = Table(
    "players",
    METADATA,
    Column("id", Text, primary_key=True),
    Column("name", Text, nullable=False),
    Column("position", Text, nullable=False),
    Column("latest_team", Text),
    Column("rookie_season", Integer),
    Column("last_season", Integer),
    Column("pfr_id", Text),
    Column("espn_id", Text),
    # The fantasy hosts' own ids (revision 0005), from the fantasy id map (`pipeline host-ids`):
    # how a host's draft or league names a player, joined on the id, never on a name.
    Column("sleeper_id", Text),
    Column("yahoo_id", Text),
    Column("mfl_id", Text),
    Index("players_pfr_id_idx", "pfr_id", unique=True),
    Index("players_espn_id_idx", "espn_id", unique=True),
    Index("players_sleeper_id_idx", "sleeper_id", unique=True),
    Index("players_yahoo_id_idx", "yahoo_id", unique=True),
    Index("players_mfl_id_idx", "mfl_id", unique=True),
)

PROVIDER_PLAYERS: Final = Table(
    "provider_players",
    METADATA,
    Column("id", Text, primary_key=True),
    Column("name", Text, nullable=False),
    Column("position", Text, nullable=False),
    # NULL for a free agent: the daily list names him with no club (revision 0018, Lane 123).
    Column("team", Text),
    Column("adp", Double(53)),
    Column("pos_adp", Text),
    Column("headshot_url", Text),
    one_of("position", POSITIONS, "provider_players_position_ck"),
    Index("provider_players_position_idx", "position"),
)

PLAYER_CROSSWALK: Final = Table(
    "player_crosswalk",
    METADATA,
    Column("provider_player_id", Text, primary_key=True),
    Column("player_id", Text),
    Column("method", Text),
    Column("unmatched_reason", Text),
    Column("resolved_at", DateTime(True), nullable=False),
    CheckConstraint(
        "(player_id IS NOT NULL AND method IS NOT NULL AND unmatched_reason IS NULL)"
        " OR (player_id IS NULL AND method IS NULL AND unmatched_reason IS NOT NULL)",
        name="player_crosswalk_matched_ck",
    ),
    ForeignKeyConstraint(
        ["provider_player_id"],
        [f"{RESEARCH_SCHEMA}.provider_players.id"],
        ondelete="CASCADE",
        name="player_crosswalk_provider_player_fk",
    ),
    ForeignKeyConstraint(
        ["player_id"], [f"{RESEARCH_SCHEMA}.players.id"], ondelete="RESTRICT", name="player_crosswalk_player_fk"
    ),
    Index("player_crosswalk_player_idx", "player_id", unique=True),
)

PROPS_PLAYER_MAP: Final = Table(
    "props_player_map",
    METADATA,
    Column("prop_name", Text, primary_key=True),
    Column("season", Integer, primary_key=True),
    Column("player_id", Text, nullable=False),
    Column("method", Text, nullable=False),
    recorded_at("created_at"),
    ForeignKeyConstraint(
        ["player_id"], [f"{RESEARCH_SCHEMA}.players.id"], ondelete="RESTRICT", name="props_player_map_player_fk"
    ),
)
