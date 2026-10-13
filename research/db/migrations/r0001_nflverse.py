"""Revision 0001, the nflverse tables: coaches, nflverse_team_defense_weeks, nfl_draft_picks, nflverse_injuries, nflverse_kicking_weeks, nflverse_roster_weeks."""

import sqlalchemy as sa
from alembic import op


def create() -> None:
    _coaches()
    _nflverse_team_defense_weeks()
    _nfl_draft_picks()
    _nflverse_injuries()
    _nflverse_kicking_weeks()
    _nflverse_roster_weeks()


def _coaches() -> None:
    op.create_table(
        "coaches",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("team", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("start_week", sa.Integer(), nullable=False),
        sa.Column("end_week", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("head_coach", sa.Text(), nullable=True),
        sa.Column("head_coach_first_season", sa.Integer(), nullable=True),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("role IN ('HC', 'OC')", name="coaches_role_ck"),
        sa.CheckConstraint("source IN ('wikipedia', 'pfr', 'both')", name="coaches_source_ck"),
        sa.CheckConstraint(
            "(head_coach IS NULL) = (head_coach_first_season IS NULL)", name="coaches_head_coach_pair_ck"
        ),
        sa.CheckConstraint("start_week >= 1 AND start_week <= end_week", name="coaches_weeks_ck"),
        sa.PrimaryKeyConstraint("season", "team", "role", "start_week"),
        schema="research",
    )


def _nflverse_team_defense_weeks() -> None:
    op.create_table(
        "nflverse_team_defense_weeks",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("team", sa.Text(), nullable=False),
        sa.Column("opponent_team", sa.Text(), nullable=False),
        sa.Column("def_sacks", sa.Double(precision=53), nullable=False),
        sa.Column("def_interceptions", sa.Integer(), nullable=False),
        sa.Column("fumble_recovery_opp", sa.Integer(), nullable=False),
        sa.Column("def_tds", sa.Integer(), nullable=False),
        sa.Column("def_safeties", sa.Integer(), nullable=False),
        sa.Column("def_punt_blocks", sa.Integer(), nullable=False),
        sa.Column("def_pat_blocks", sa.Integer(), nullable=False),
        sa.Column("def_fg_blocks", sa.Integer(), nullable=False),
        sa.Column("special_teams_tds", sa.Integer(), nullable=False),
        sa.Column("passing_yards_allowed", sa.Integer(), nullable=False),
        sa.Column("rushing_yards_allowed", sa.Integer(), nullable=False),
        sa.Column("points_allowed", sa.Integer(), nullable=True),
        sa.Column("sack_yards_lost_allowed", sa.Integer(), nullable=True),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("season", "week", "team"),
        schema="research",
    )
    op.create_index(
        "nflverse_team_defense_weeks_team_idx",
        "nflverse_team_defense_weeks",
        ["team", "season", "week"],
        unique=False,
        schema="research",
    )


def _nfl_draft_picks() -> None:
    op.create_table(
        "nfl_draft_picks",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("pick", sa.Integer(), nullable=False),
        sa.Column("round", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("position", sa.Text(), nullable=False),
        sa.Column("team", sa.Text(), nullable=False),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="nfl_draft_picks_player_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("season", "pick"),
        schema="research",
    )
    op.create_index("nfl_draft_picks_player_idx", "nfl_draft_picks", ["player_id"], unique=False, schema="research")


def _nflverse_injuries() -> None:
    op.create_table(
        "nflverse_injuries",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("report_status", sa.Text(), nullable=False),
        sa.Column("primary_injury", sa.Text(), nullable=False),
        sa.Column("practice_status", sa.Text(), nullable=False),
        sa.Column("date_modified", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="nflverse_injuries_player_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("season", "week", "player_id"),
        schema="research",
    )
    op.create_index(
        "nflverse_injuries_player_idx",
        "nflverse_injuries",
        ["player_id", "season", "week"],
        unique=False,
        schema="research",
    )


def _nflverse_kicking_weeks() -> None:
    op.create_table(
        "nflverse_kicking_weeks",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("team", sa.Text(), nullable=False),
        sa.Column("fg_made", sa.Integer(), nullable=False),
        sa.Column("fg_att", sa.Integer(), nullable=False),
        sa.Column("fg_missed", sa.Integer(), nullable=False),
        sa.Column("fg_blocked", sa.Integer(), nullable=False),
        sa.Column("fg_made_0_19", sa.Integer(), nullable=False),
        sa.Column("fg_made_20_29", sa.Integer(), nullable=False),
        sa.Column("fg_made_30_39", sa.Integer(), nullable=False),
        sa.Column("fg_made_40_49", sa.Integer(), nullable=False),
        sa.Column("fg_made_50_59", sa.Integer(), nullable=False),
        sa.Column("fg_made_60", sa.Integer(), nullable=False),
        sa.Column("fg_missed_0_19", sa.Integer(), nullable=False),
        sa.Column("fg_missed_20_29", sa.Integer(), nullable=False),
        sa.Column("fg_missed_30_39", sa.Integer(), nullable=False),
        sa.Column("fg_missed_40_49", sa.Integer(), nullable=False),
        sa.Column("fg_missed_50_59", sa.Integer(), nullable=False),
        sa.Column("fg_missed_60", sa.Integer(), nullable=False),
        sa.Column("pat_made", sa.Integer(), nullable=False),
        sa.Column("pat_att", sa.Integer(), nullable=False),
        sa.Column("pat_missed", sa.Integer(), nullable=False),
        sa.Column("pat_blocked", sa.Integer(), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="nflverse_kicking_weeks_player_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("season", "week", "player_id"),
        schema="research",
    )
    op.create_index(
        "nflverse_kicking_weeks_player_idx",
        "nflverse_kicking_weeks",
        ["player_id", "season", "week"],
        unique=False,
        schema="research",
    )
    op.create_index(
        "nflverse_kicking_weeks_team_idx",
        "nflverse_kicking_weeks",
        ["team", "season", "week"],
        unique=False,
        schema="research",
    )


def _nflverse_roster_weeks() -> None:
    op.create_table(
        "nflverse_roster_weeks",
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("week", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Text(), nullable=False),
        sa.Column("team", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("status_detail", sa.Text(), nullable=False),
        sa.Column("position", sa.Text(), nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["player_id"], ["research.players.id"], name="nflverse_roster_weeks_player_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("season", "week", "player_id"),
        schema="research",
    )
    op.create_index(
        "nflverse_roster_weeks_player_idx",
        "nflverse_roster_weeks",
        ["player_id", "season", "week"],
        unique=False,
        schema="research",
    )
