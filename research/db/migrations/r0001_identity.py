"""Revision 0001, the identity tables: players, provider_players, player_crosswalk, props_player_map."""

import sqlalchemy as sa
from alembic import op


def create() -> None:
    _players()
    _provider_players()
    _player_crosswalk()
    _props_player_map()


def _players() -> None:
    op.create_table(
        "players",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.Text(), nullable=False),
        sa.Column("latest_team", sa.Text(), nullable=True),
        sa.Column("rookie_season", sa.Integer(), nullable=True),
        sa.Column("last_season", sa.Integer(), nullable=True),
        sa.Column("pfr_id", sa.Text(), nullable=True),
        sa.Column("espn_id", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="research",
    )
    op.create_index("players_espn_id_idx", "players", ["espn_id"], unique=True, schema="research")
    op.create_index("players_pfr_id_idx", "players", ["pfr_id"], unique=True, schema="research")


def _provider_players() -> None:
    op.create_table(
        "provider_players",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.Text(), nullable=False),
        sa.Column("team", sa.Text(), nullable=False),
        sa.Column("adp", sa.REAL(), nullable=True),
        sa.Column("pos_adp", sa.Text(), nullable=True),
        sa.Column("headshot_url", sa.Text(), nullable=True),
        sa.CheckConstraint("position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')", name="provider_players_position_ck"),
        sa.PrimaryKeyConstraint("id"),
        schema="research",
    )
    op.create_index("provider_players_position_idx", "provider_players", ["position"], unique=False, schema="research")


def _player_crosswalk() -> None:
    op.create_table(
        "player_crosswalk",
        sa.Column("provider_player_id", sa.Text(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=True),
        sa.Column("method", sa.Text(), nullable=True),
        sa.Column("unmatched_reason", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(player_id IS NOT NULL AND method IS NOT NULL AND unmatched_reason IS NULL) OR (player_id IS NULL AND method IS NULL AND unmatched_reason IS NOT NULL)",
            name="player_crosswalk_matched_ck",
        ),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="player_crosswalk_player_fk", ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["provider_player_id"],
            ["research.provider_players.id"],
            name="player_crosswalk_provider_player_fk",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("provider_player_id"),
        schema="research",
    )
    op.create_index("player_crosswalk_player_idx", "player_crosswalk", ["player_id"], unique=True, schema="research")


def _props_player_map() -> None:
    op.create_table(
        "props_player_map",
        sa.Column("prop_name", sa.Text(), nullable=False),
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="props_player_map_player_fk", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("prop_name", "season"),
        schema="research",
    )
