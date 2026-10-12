"""Baseline: the research schema exactly as drizzle left it.

Twenty-nine tables and the four enum types they use, equal to the drizzle journal head
`0089_draft_room_facts` for these tables (the parity harness's schema gate diffs a database built
by this revision against one built by drizzle, catalog against catalog). It changes nothing.

On a database drizzle already built (dev, production), do not run this: `alembic stamp
0001_baseline` records it as applied. On a fresh database, `alembic upgrade head` runs it.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-10-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0001_baseline'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


ENUMS = (
    postgresql.ENUM("QB", "RB", "WR", "TE", "K", "DEF", name="player_position"),
    postgresql.ENUM("scheduled", "in_progress", "final", name="week_status"),
    postgresql.ENUM("llm", "template", name="capsule_source"),
    postgresql.ENUM("replay", "live", name="board_moment_kind"),
)


def upgrade() -> None:
    for enum in ENUMS:
        enum.create(op.get_bind(), checkfirst=False)
    op.create_table('capture_snapshots',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('source', sa.Text(), nullable=False),
    sa.Column('captured_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('digest', sa.Text(), nullable=False),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.PrimaryKeyConstraint('id', name='capture_snapshots_pkey')
    )
    op.create_index('capture_snapshots_source_captured_idx', 'capture_snapshots', ['source', 'captured_at'], unique=False)
    op.create_table('coaches',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('team', sa.Text(), nullable=False),
    sa.Column('role', sa.Text(), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('start_week', sa.Integer(), nullable=False),
    sa.Column('end_week', sa.Integer(), nullable=False),
    sa.Column('source', sa.Text(), nullable=False),
    sa.Column('note', sa.Text(), nullable=False),
    sa.Column('head_coach', sa.Text(), nullable=True),
    sa.Column('head_coach_first_season', sa.Integer(), nullable=True),
    sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("role = ANY (ARRAY['HC'::text, 'OC'::text])", name='coaches_role_ck'),
    sa.CheckConstraint("source = ANY (ARRAY['wikipedia'::text, 'pfr'::text, 'both'::text])", name='coaches_source_ck'),
    sa.CheckConstraint('(head_coach IS NULL) = (head_coach_first_season IS NULL)', name='coaches_head_coach_pair_ck'),
    sa.CheckConstraint('start_week >= 1 AND start_week <= end_week', name='coaches_weeks_ck'),
    sa.PrimaryKeyConstraint('id', name='coaches_pkey')
    )
    op.create_index('coaches_tenure_idx', 'coaches', ['season', 'team', 'role', 'start_week'], unique=True)
    op.create_table('model_artifacts',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('fit_stamp', sa.DateTime(timezone=True), nullable=False),
    sa.Column('fitted_on', sa.Text(), nullable=False),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('version >= 1', name='model_artifacts_version_ck'),
    sa.PrimaryKeyConstraint('id', name='model_artifacts_pkey')
    )
    op.create_index('model_artifacts_name_version_idx', 'model_artifacts', ['name', 'version'], unique=True)
    op.create_table('nfl_games',
    sa.Column('game_id', sa.Text(), nullable=False),
    sa.Column('week', sa.Integer(), nullable=False),
    sa.Column('home_nfl_team', sa.Text(), nullable=False),
    sa.Column('away_nfl_team', sa.Text(), nullable=False),
    sa.Column('game_date', sa.Text(), server_default=sa.text("''::text"), nullable=False),
    sa.Column('kickoff_et', sa.Text(), server_default=sa.text("''::text"), nullable=False),
    sa.Column('status', sa.Text(), nullable=False),
    sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('game_id', name='nfl_games_pkey')
    )
    op.create_index('nfl_games_week_idx', 'nfl_games', ['week'], unique=False)
    op.create_table('nfl_players',
    sa.Column('id', sa.Text(), nullable=False),
    sa.Column('pfr_id', sa.Text(), nullable=True),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('position', sa.Text(), nullable=False),
    sa.Column('latest_team', sa.Text(), nullable=True),
    sa.Column('rookie_season', sa.Integer(), nullable=True),
    sa.Column('last_season', sa.Integer(), nullable=True),
    sa.Column('espn_id', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('id', name='nfl_players_pkey')
    )
    op.create_index('nfl_players_espn_id_idx', 'nfl_players', ['espn_id'], unique=True)
    op.create_index('nfl_players_pfr_id_idx', 'nfl_players', ['pfr_id'], unique=True)
    op.create_table('nflverse_team_defense_weeks',
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('week', sa.Integer(), nullable=False),
    sa.Column('team', sa.Text(), nullable=False),
    sa.Column('opponent_team', sa.Text(), nullable=False),
    sa.Column('def_sacks', sa.REAL(), nullable=False),
    sa.Column('def_interceptions', sa.Integer(), nullable=False),
    sa.Column('fumble_recovery_opp', sa.Integer(), nullable=False),
    sa.Column('def_tds', sa.Integer(), nullable=False),
    sa.Column('def_safeties', sa.Integer(), nullable=False),
    sa.Column('def_punt_blocks', sa.Integer(), nullable=False),
    sa.Column('def_pat_blocks', sa.Integer(), nullable=False),
    sa.Column('def_fg_blocks', sa.Integer(), nullable=False),
    sa.Column('special_teams_tds', sa.Integer(), nullable=False),
    sa.Column('passing_yards_allowed', sa.Integer(), nullable=False),
    sa.Column('rushing_yards_allowed', sa.Integer(), nullable=False),
    sa.Column('source', sa.Text(), server_default=sa.text("'nflverse_team_defense_weeks'::text"), nullable=False),
    sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('points_allowed', sa.Integer(), nullable=True),
    sa.Column('sack_yards_lost_allowed', sa.Integer(), nullable=True),
    sa.PrimaryKeyConstraint('season', 'week', 'team', name='nflverse_team_defense_weeks_season_week_team_pk')
    )
    op.create_index('nflverse_team_defense_weeks_team_season_idx', 'nflverse_team_defense_weeks', ['team', 'season', 'week'], unique=False)
    op.create_table('player_prop_observations',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('event_id', sa.Text(), nullable=False),
    sa.Column('commence_time', sa.DateTime(timezone=True), nullable=False),
    sa.Column('bookmaker', sa.Text(), nullable=False),
    sa.Column('market', sa.Text(), nullable=False),
    sa.Column('player_name', sa.Text(), nullable=False),
    sa.Column('point', sa.Double(precision=53), nullable=False),
    sa.Column('over_price', sa.Integer(), nullable=False),
    sa.Column('under_price', sa.Integer(), nullable=False),
    sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name='player_prop_observations_pkey')
    )
    op.create_index('player_prop_observations_event_market_idx', 'player_prop_observations', ['event_id', 'market'], unique=False)
    op.create_index('player_prop_observations_fetched_at_idx', 'player_prop_observations', ['fetched_at'], unique=False)
    op.create_table('players',
    sa.Column('id', sa.Text(), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('position', postgresql.ENUM('QB', 'RB', 'WR', 'TE', 'K', 'DEF', name='player_position', create_type=False), nullable=False),
    sa.Column('nfl_team', sa.Text(), nullable=False),
    sa.Column('adp', sa.REAL(), nullable=True),
    sa.Column('headshot_url', sa.Text(), nullable=True),
    sa.Column('pos_adp', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('id', name='players_pkey')
    )
    op.create_index('players_position_idx', 'players', ['position'], unique=False)
    op.create_table('stat_weeks',
    sa.Column('week', sa.Integer(), autoincrement=False, nullable=False),
    sa.Column('status', postgresql.ENUM('scheduled', 'in_progress', 'final', name='week_status', create_type=False), server_default=sa.text("'scheduled'::week_status"), nullable=False),
    sa.Column('version', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('games_total', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('games_final', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('week', name='stat_weeks_pkey')
    )
    op.create_table('team_week_observations',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('week', sa.Integer(), nullable=False),
    sa.Column('team', sa.Text(), nullable=False),
    sa.Column('source', sa.Text(), nullable=False),
    sa.Column('metric', sa.Text(), nullable=False),
    sa.Column('value', sa.Double(precision=53), nullable=False),
    sa.Column('as_of', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name='team_week_observations_pkey')
    )
    op.create_index('team_week_observations_as_of_idx', 'team_week_observations', ['season', 'week', 'as_of'], unique=False)
    op.create_index('team_week_observations_fact_idx', 'team_week_observations', ['season', 'week', 'team', 'source', 'metric', 'as_of'], unique=True)
    op.create_table('adp_snapshots',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('source', sa.Text(), nullable=False),
    sa.Column('format', sa.Text(), nullable=False),
    sa.Column('adp', sa.REAL(), nullable=False),
    sa.Column('captured_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='adp_snapshots_player_id_nfl_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name='adp_snapshots_pkey')
    )
    op.create_index('adp_snapshots_player_idx', 'adp_snapshots', ['player_id', 'captured_at'], unique=False)
    op.create_index('adp_snapshots_player_source_captured_idx', 'adp_snapshots', ['player_id', 'source', 'captured_at'], unique=True)
    op.create_table('nfl_draft_picks',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('round', sa.Integer(), nullable=False),
    sa.Column('pick', sa.Integer(), nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('position', sa.Text(), nullable=False),
    sa.Column('team', sa.Text(), nullable=False),
    sa.Column('as_of', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='nfl_draft_picks_player_id_nfl_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name='nfl_draft_picks_pkey')
    )
    op.create_index('nfl_draft_picks_fact_idx', 'nfl_draft_picks', ['season', 'pick'], unique=True)
    op.create_index('nfl_draft_picks_player_idx', 'nfl_draft_picks', ['player_id'], unique=False)
    op.create_table('nflverse_injuries',
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('week', sa.Integer(), nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('report_status', sa.Text(), nullable=False),
    sa.Column('primary_injury', sa.Text(), nullable=False),
    sa.Column('practice_status', sa.Text(), nullable=False),
    sa.Column('date_modified', sa.DateTime(timezone=True), nullable=True),
    sa.Column('source', sa.Text(), server_default=sa.text("'nflverse_injuries'::text"), nullable=False),
    sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='nflverse_injuries_player_id_nfl_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('season', 'week', 'player_id', name='nflverse_injuries_season_week_player_id_pk')
    )
    op.create_index('nflverse_injuries_player_season_idx', 'nflverse_injuries', ['player_id', 'season', 'week'], unique=False)
    op.create_table('nflverse_kicking_weeks',
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('week', sa.Integer(), nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('team', sa.Text(), nullable=False),
    sa.Column('fg_made', sa.Integer(), nullable=False),
    sa.Column('fg_att', sa.Integer(), nullable=False),
    sa.Column('fg_missed', sa.Integer(), nullable=False),
    sa.Column('fg_blocked', sa.Integer(), nullable=False),
    sa.Column('fg_made_0_19', sa.Integer(), nullable=False),
    sa.Column('fg_made_20_29', sa.Integer(), nullable=False),
    sa.Column('fg_made_30_39', sa.Integer(), nullable=False),
    sa.Column('fg_made_40_49', sa.Integer(), nullable=False),
    sa.Column('fg_made_50_59', sa.Integer(), nullable=False),
    sa.Column('fg_made_60', sa.Integer(), nullable=False),
    sa.Column('fg_missed_0_19', sa.Integer(), nullable=False),
    sa.Column('fg_missed_20_29', sa.Integer(), nullable=False),
    sa.Column('fg_missed_30_39', sa.Integer(), nullable=False),
    sa.Column('fg_missed_40_49', sa.Integer(), nullable=False),
    sa.Column('fg_missed_50_59', sa.Integer(), nullable=False),
    sa.Column('fg_missed_60', sa.Integer(), nullable=False),
    sa.Column('pat_made', sa.Integer(), nullable=False),
    sa.Column('pat_att', sa.Integer(), nullable=False),
    sa.Column('pat_missed', sa.Integer(), nullable=False),
    sa.Column('pat_blocked', sa.Integer(), nullable=False),
    sa.Column('source', sa.Text(), server_default=sa.text("'nflverse_kicking_weeks'::text"), nullable=False),
    sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='nflverse_kicking_weeks_player_id_nfl_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('season', 'week', 'player_id', name='nflverse_kicking_weeks_season_week_player_id_pk')
    )
    op.create_index('nflverse_kicking_weeks_player_season_idx', 'nflverse_kicking_weeks', ['player_id', 'season', 'week'], unique=False)
    op.create_index('nflverse_kicking_weeks_team_season_idx', 'nflverse_kicking_weeks', ['team', 'season', 'week'], unique=False)
    op.create_table('nflverse_roster_weeks',
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('week', sa.Integer(), nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('team', sa.Text(), nullable=False),
    sa.Column('status', sa.Text(), nullable=False),
    sa.Column('position', sa.Text(), nullable=False),
    sa.Column('source', sa.Text(), server_default=sa.text("'nflverse_roster_weeks'::text"), nullable=False),
    sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('status_detail', sa.Text(), server_default=sa.text("''::text"), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='nflverse_roster_weeks_player_id_nfl_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('season', 'week', 'player_id', name='nflverse_roster_weeks_season_week_player_id_pk')
    )
    op.create_index('nflverse_roster_weeks_player_season_idx', 'nflverse_roster_weeks', ['player_id', 'season', 'week'], unique=False)
    op.create_table('player_capsules',
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('facts_hash', sa.Text(), nullable=False),
    sa.Column('body_compact', sa.Text(), nullable=False),
    sa.Column('body_full', sa.Text(), nullable=False),
    sa.Column('source', postgresql.ENUM('llm', 'template', name='capsule_source', create_type=False), nullable=False),
    sa.Column('model', sa.Text(), nullable=True),
    sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('narrative', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['player_id'], ['players.id'], name='player_capsules_player_id_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('player_id', name='player_capsules_pkey')
    )
    op.create_table('player_crosswalk',
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('nfl_player_id', sa.Text(), nullable=True),
    sa.Column('method', sa.Text(), nullable=True),
    sa.Column('unmatched_reason', sa.Text(), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('nfl_player_id IS NOT NULL AND method IS NOT NULL AND unmatched_reason IS NULL OR nfl_player_id IS NULL AND method IS NULL AND unmatched_reason IS NOT NULL', name='player_crosswalk_matched_ck'),
    sa.ForeignKeyConstraint(['nfl_player_id'], ['nfl_players.id'], name='player_crosswalk_nfl_player_id_nfl_players_id_fk', ondelete='RESTRICT'),
    sa.ForeignKeyConstraint(['player_id'], ['players.id'], name='player_crosswalk_player_id_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('player_id', name='player_crosswalk_pkey')
    )
    op.create_index('player_crosswalk_nfl_player_idx', 'player_crosswalk', ['nfl_player_id'], unique=True)
    op.create_table('player_peek_documents',
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('scoring_hash', sa.Text(), nullable=False),
    sa.Column('document', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('basis', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('as_of', sa.DateTime(timezone=True), nullable=False),
    sa.Column('computed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('source', sa.Text(), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['players.id'], name='player_peek_documents_player_id_players_id_fk', ondelete='CASCADE')
    )
    op.create_index('player_peek_documents_document_idx', 'player_peek_documents', ['season', 'scoring_hash', 'player_id', 'as_of'], unique=True)
    op.create_table('player_peek_facts',
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('dossier', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('touches_rank', sa.Integer(), nullable=True),
    sa.Column('touches_qualifier_count', sa.Integer(), nullable=True),
    sa.Column('prior_seasons_held', postgresql.ARRAY(sa.Integer()), nullable=False),
    sa.Column('last_season_line', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('basis', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('as_of', sa.DateTime(timezone=True), nullable=False),
    sa.Column('computed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('source', sa.Text(), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['players.id'], name='player_peek_facts_player_id_players_id_fk', ondelete='CASCADE')
    )
    op.create_index('player_peek_facts_fact_idx', 'player_peek_facts', ['player_id', 'season', 'as_of'], unique=True)
    op.create_table('player_stat_lines',
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('week', sa.Integer(), nullable=False),
    sa.Column('passing_yards', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('passing_touchdowns', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('interceptions', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('rushing_yards', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('rushing_touchdowns', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('receiving_yards', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('receiving_touchdowns', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('receptions', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('fumbles_lost', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('field_goals_made', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('extra_points_made', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('sacks', sa.REAL(), server_default=sa.text('0'), nullable=False),
    sa.Column('defensive_interceptions', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('defensive_touchdowns', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('targets', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('carries', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('pass_attempts', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('pass_completions', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('field_goals_attempted', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('points_allowed', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('offensive_snaps', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('offensive_snap_share', sa.REAL(), server_default=sa.text('0'), nullable=False),
    sa.Column('two_point_conversions', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('field_goals_missed', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('extra_points_missed', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('kick_return_touchdowns', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('punt_return_touchdowns', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('yards_allowed', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('defensive_fumbles_recovered', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.Column('safeties', sa.Integer(), server_default=sa.text('0'), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['players.id'], name='player_stat_lines_player_id_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('player_id', 'week', name='player_stat_lines_player_id_week_pk')
    )
    op.create_index('player_stat_lines_week_idx', 'player_stat_lines', ['week'], unique=False)
    op.create_table('player_week_observations',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('week', sa.Integer(), nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('source', sa.Text(), nullable=False),
    sa.Column('metric', sa.Text(), nullable=False),
    sa.Column('value', sa.Double(precision=53), nullable=False),
    sa.Column('as_of', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='player_week_observations_player_id_nfl_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name='player_week_observations_pkey')
    )
    op.create_index('player_week_observations_as_of_idx', 'player_week_observations', ['season', 'week', 'as_of'], unique=False)
    op.create_index('player_week_observations_fact_idx', 'player_week_observations', ['season', 'week', 'player_id', 'source', 'metric', 'as_of'], unique=True)
    op.create_table('player_week_teams',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('week', sa.Integer(), nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('team', sa.Text(), nullable=False),
    sa.Column('as_of', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='player_week_teams_player_id_nfl_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name='player_week_teams_pkey')
    )
    op.create_index('player_week_teams_as_of_idx', 'player_week_teams', ['season', 'week', 'as_of'], unique=False)
    op.create_index('player_week_teams_fact_idx', 'player_week_teams', ['season', 'week', 'player_id', 'team', 'as_of'], unique=True)
    op.create_table('preseason_board_reasons',
    sa.Column('source', sa.Text(), nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('code', sa.Text(), nullable=False),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('detail', sa.Text(), server_default=sa.text("''::text"), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='preseason_board_reasons_player_id_nfl_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('source', 'season', 'player_id', 'code', 'detail', name='preseason_board_reasons_source_season_player_id_code_detail_pk')
    )
    op.create_table('preseason_projections',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('source', sa.Text(), nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('rank', sa.Integer(), nullable=False),
    sa.Column('position_rank', sa.Integer(), nullable=False),
    sa.Column('projected_points', sa.Double(precision=53), nullable=False),
    sa.Column('value_over_replacement', sa.Double(precision=53), nullable=False),
    sa.Column('value_rank', sa.Integer(), nullable=False),
    sa.Column('expected_games', sa.Double(precision=53), nullable=False),
    sa.Column('floor_points', sa.Double(precision=53), nullable=False),
    sa.Column('median_points', sa.Double(precision=53), nullable=False),
    sa.Column('ceiling_points', sa.Double(precision=53), nullable=False),
    sa.Column('tier', sa.Integer(), nullable=False),
    sa.Column('as_of', sa.DateTime(timezone=True), nullable=False),
    sa.Column('computed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('moment_kind', postgresql.ENUM('replay', 'live', name='board_moment_kind', create_type=False), server_default=sa.text("'replay'::board_moment_kind"), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='preseason_projections_player_id_nfl_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name='preseason_projections_pkey')
    )
    op.create_index('preseason_projections_as_of_idx', 'preseason_projections', ['season', 'source', 'as_of'], unique=False)
    op.create_index('preseason_projections_fact_idx', 'preseason_projections', ['season', 'source', 'player_id', 'as_of'], unique=True)
    op.create_table('preseason_rankings',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('source', sa.Text(), nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('rank', sa.Double(precision=53), nullable=False),
    sa.Column('as_of', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='preseason_rankings_player_id_nfl_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name='preseason_rankings_pkey')
    )
    op.create_index('preseason_rankings_as_of_idx', 'preseason_rankings', ['season', 'source', 'as_of'], unique=False)
    op.create_index('preseason_rankings_fact_idx', 'preseason_rankings', ['season', 'source', 'player_id', 'as_of'], unique=True)
    op.create_table('preseason_rosters',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('team', sa.Text(), nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('position', sa.Text(), nullable=False),
    sa.Column('status', sa.Text(), nullable=False),
    sa.Column('birth_date', sa.Text(), nullable=True),
    sa.Column('draft_year', sa.Integer(), nullable=True),
    sa.Column('draft_pick', sa.Integer(), nullable=True),
    sa.Column('draft_club', sa.Text(), nullable=True),
    sa.Column('as_of', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='preseason_rosters_player_id_nfl_players_id_fk', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name='preseason_rosters_pkey')
    )
    op.create_index('preseason_rosters_as_of_idx', 'preseason_rosters', ['season', 'as_of'], unique=False)
    op.create_index('preseason_rosters_fact_idx', 'preseason_rosters', ['season', 'player_id', 'as_of'], unique=True)
    op.create_table('props_player_map',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('prop_name', sa.Text(), nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('method', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='props_player_map_player_id_nfl_players_id_fk', ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name='props_player_map_pkey')
    )
    op.create_index('props_player_map_name_season_idx', 'props_player_map', ['prop_name', 'season'], unique=True)
    op.create_table('register_freeze_rows',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('week', sa.Integer(), nullable=False),
    sa.Column('frozen_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('board_source', sa.Text(), nullable=False),
    sa.Column('board_as_of', sa.DateTime(timezone=True), nullable=False),
    sa.Column('board_points', sa.Double(precision=53), nullable=False),
    sa.Column('board_rank', sa.Integer(), nullable=False),
    sa.Column('board_value_rank', sa.Integer(), nullable=False),
    sa.Column('adp_rank', sa.Double(precision=53), nullable=True),
    sa.Column('ecr_rank', sa.Double(precision=53), nullable=True),
    sa.Column('props_points', sa.Double(precision=53), nullable=True),
    sa.Column('props_markets', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='register_freeze_rows_player_id_nfl_players_id_fk', ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name='register_freeze_rows_pkey')
    )
    op.create_index('register_freeze_rows_fact_idx', 'register_freeze_rows', ['season', 'week', 'frozen_at', 'board_source', 'player_id'], unique=True)
    op.create_index('register_freeze_rows_week_idx', 'register_freeze_rows', ['season', 'week', 'frozen_at'], unique=False)
    op.create_table('register_grade_rows',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('season', sa.Integer(), nullable=False),
    sa.Column('week', sa.Integer(), nullable=False),
    sa.Column('frozen_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('graded_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('player_id', sa.Text(), nullable=False),
    sa.Column('actual_points', sa.Double(precision=53), nullable=False),
    sa.Column('actual_rank', sa.Integer(), nullable=False),
    sa.Column('board_rank', sa.Integer(), nullable=False),
    sa.Column('adp_rank', sa.Integer(), nullable=True),
    sa.Column('ecr_rank', sa.Integer(), nullable=True),
    sa.Column('props_rank', sa.Integer(), nullable=True),
    sa.Column('board_source', sa.Text(), nullable=False),
    sa.ForeignKeyConstraint(['player_id'], ['nfl_players.id'], name='register_grade_rows_player_id_nfl_players_id_fk', ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name='register_grade_rows_pkey')
    )
    op.create_index('register_grade_rows_fact_idx', 'register_grade_rows', ['season', 'week', 'frozen_at', 'graded_at', 'board_source', 'player_id'], unique=True)
    op.create_index('register_grade_rows_season_idx', 'register_grade_rows', ['season', 'week', 'graded_at'], unique=False)


def downgrade() -> None:
    op.drop_index('register_grade_rows_season_idx', table_name='register_grade_rows')
    op.drop_index('register_grade_rows_fact_idx', table_name='register_grade_rows')
    op.drop_table('register_grade_rows')
    op.drop_index('register_freeze_rows_week_idx', table_name='register_freeze_rows')
    op.drop_index('register_freeze_rows_fact_idx', table_name='register_freeze_rows')
    op.drop_table('register_freeze_rows')
    op.drop_index('props_player_map_name_season_idx', table_name='props_player_map')
    op.drop_table('props_player_map')
    op.drop_index('preseason_rosters_fact_idx', table_name='preseason_rosters')
    op.drop_index('preseason_rosters_as_of_idx', table_name='preseason_rosters')
    op.drop_table('preseason_rosters')
    op.drop_index('preseason_rankings_fact_idx', table_name='preseason_rankings')
    op.drop_index('preseason_rankings_as_of_idx', table_name='preseason_rankings')
    op.drop_table('preseason_rankings')
    op.drop_index('preseason_projections_fact_idx', table_name='preseason_projections')
    op.drop_index('preseason_projections_as_of_idx', table_name='preseason_projections')
    op.drop_table('preseason_projections')
    op.drop_table('preseason_board_reasons')
    op.drop_index('player_week_teams_fact_idx', table_name='player_week_teams')
    op.drop_index('player_week_teams_as_of_idx', table_name='player_week_teams')
    op.drop_table('player_week_teams')
    op.drop_index('player_week_observations_fact_idx', table_name='player_week_observations')
    op.drop_index('player_week_observations_as_of_idx', table_name='player_week_observations')
    op.drop_table('player_week_observations')
    op.drop_index('player_stat_lines_week_idx', table_name='player_stat_lines')
    op.drop_table('player_stat_lines')
    op.drop_index('player_peek_facts_fact_idx', table_name='player_peek_facts')
    op.drop_table('player_peek_facts')
    op.drop_index('player_peek_documents_document_idx', table_name='player_peek_documents')
    op.drop_table('player_peek_documents')
    op.drop_index('player_crosswalk_nfl_player_idx', table_name='player_crosswalk')
    op.drop_table('player_crosswalk')
    op.drop_table('player_capsules')
    op.drop_index('nflverse_roster_weeks_player_season_idx', table_name='nflverse_roster_weeks')
    op.drop_table('nflverse_roster_weeks')
    op.drop_index('nflverse_kicking_weeks_team_season_idx', table_name='nflverse_kicking_weeks')
    op.drop_index('nflverse_kicking_weeks_player_season_idx', table_name='nflverse_kicking_weeks')
    op.drop_table('nflverse_kicking_weeks')
    op.drop_index('nflverse_injuries_player_season_idx', table_name='nflverse_injuries')
    op.drop_table('nflverse_injuries')
    op.drop_index('nfl_draft_picks_player_idx', table_name='nfl_draft_picks')
    op.drop_index('nfl_draft_picks_fact_idx', table_name='nfl_draft_picks')
    op.drop_table('nfl_draft_picks')
    op.drop_index('adp_snapshots_player_source_captured_idx', table_name='adp_snapshots')
    op.drop_index('adp_snapshots_player_idx', table_name='adp_snapshots')
    op.drop_table('adp_snapshots')
    op.drop_index('team_week_observations_fact_idx', table_name='team_week_observations')
    op.drop_index('team_week_observations_as_of_idx', table_name='team_week_observations')
    op.drop_table('team_week_observations')
    op.drop_table('stat_weeks')
    op.drop_index('players_position_idx', table_name='players')
    op.drop_table('players')
    op.drop_index('player_prop_observations_fetched_at_idx', table_name='player_prop_observations')
    op.drop_index('player_prop_observations_event_market_idx', table_name='player_prop_observations')
    op.drop_table('player_prop_observations')
    op.drop_index('nflverse_team_defense_weeks_team_season_idx', table_name='nflverse_team_defense_weeks')
    op.drop_table('nflverse_team_defense_weeks')
    op.drop_index('nfl_players_pfr_id_idx', table_name='nfl_players')
    op.drop_index('nfl_players_espn_id_idx', table_name='nfl_players')
    op.drop_table('nfl_players')
    op.drop_index('nfl_games_week_idx', table_name='nfl_games')
    op.drop_table('nfl_games')
    op.drop_index('model_artifacts_name_version_idx', table_name='model_artifacts')
    op.drop_table('model_artifacts')
    op.drop_index('coaches_tenure_idx', table_name='coaches')
    op.drop_table('coaches')
    op.drop_index('capture_snapshots_source_captured_idx', table_name='capture_snapshots')
    op.drop_table('capture_snapshots')
    for enum in reversed(ENUMS):
        enum.drop(op.get_bind(), checkfirst=False)
