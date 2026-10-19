-- THE ONE "FINAL HELD" RULE (Lane 80): a club-week is final once the store holds the weekly result
-- (nflverse_kickoff's game_result), the hourly capture's game status saying final
-- (tank01_game_status's game_status = 2), or a line with his club that week (player_week_teams), from
-- the first instant any of them was held. Team codes as the store keeps them. The research migration
-- (0014), the declaration (research.db.schema.views) and the API's week facts test all build it from
-- this file, {schema} replaced; a reader takes either club's row as the game's final.
create view {schema}.club_week_finals as
select season, week, team, min(as_of) as held_at
from (
  select season, week, team, as_of from {schema}.team_week_observations
  where (source = 'nflverse_kickoff' and metric = 'game_result')
     or (source = 'tank01_game_status' and metric = 'game_status' and value = 2)
  union all
  select season, week, team, as_of from {schema}.player_week_teams
) held
group by season, week, team
