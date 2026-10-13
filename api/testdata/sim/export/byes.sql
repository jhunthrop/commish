with teams as (
  select home_nfl_team as team from nfl_games union select away_nfl_team from nfl_games
), weeks as (select distinct week from nfl_games where week between 1 and 18),
played as (
  select home_nfl_team as team, week from nfl_games union select away_nfl_team, week from nfl_games
), byes as (
  select t.team, min(w.week) as week from teams t cross join weeks w
  where not exists (select 1 from played p where p.team = t.team and p.week = w.week)
  group by t.team
)
select json_object_agg(team, week order by team) from byes;
