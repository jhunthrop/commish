with latest as (
  select max(as_of) as as_of from preseason_projections where season = 2026 and source = 'commish_board_v9_ppr_12'
), proj as (
  select c.player_id, p.projected_points, p.value_over_replacement
  from preseason_projections p
  join latest l on p.as_of = l.as_of
  join player_crosswalk c on c.nfl_player_id = p.player_id
  where p.season = 2026 and p.source = 'commish_board_v9_ppr_12'
)
select json_build_object(
  'source', 'dev database players (adp ascending, unranked last, ties by id) and preseason_projections 2026 commish_board_v9_ppr_12',
  'players', json_agg(json_build_object(
    'playerId', pl.id, 'position', pl.position, 'nflTeam', pl.nfl_team,
    'points', proj.projected_points, 'value', proj.value_over_replacement
  ) order by pl.adp asc nulls last, pl.id collate "C")
)
from players pl left join proj on proj.player_id = pl.id;
