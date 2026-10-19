"""The one "final held" rule as a view: `club_week_finals`.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-19

Lane 80: a club-week is final once the store holds its weekly result, the hourly capture's game status
saying final, or a line with his club that week, from the first instant any was held. The hourly
status pass, the run's game states and the API's week facts all read this view, so the rule is
written once (`research/db/schema/club_week_finals.sql`, which the declaration and the API's test
build from; this revision keeps its own frozen copy).
"""

from collections.abc import Sequence
from typing import Final

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA: Final = "research"

# The view as it was at this revision, frozen here (re-review finding 3): a later edit of
# research/db/schema/club_week_finals.sql changes the declaration, not this, so the schema gate fails
# until a new revision replaces the view.
_VIEW: Final = """
create view research.club_week_finals as
select season, week, team, min(as_of) as held_at
from (
  select season, week, team, as_of from research.team_week_observations
  where (source = 'nflverse_kickoff' and metric = 'game_result')
     or (source = 'tank01_game_status' and metric = 'game_status' and value = 2)
  union all
  select season, week, team, as_of from research.player_week_teams
) held
group by season, week, team
"""


def upgrade() -> None:
    op.execute(_VIEW)


def downgrade() -> None:
    op.execute(f"drop view {_SCHEMA}.club_week_finals")
