# Yahoo probe shapes (Lane 130)

Constructed, not recorded. They follow the Fantasy Sports API's documented XML
(sports.yahoo.com/developer/docs: the league scoreboard with
`team_projected_points`, the player `percent_owned` and `stats;type=week`
resources) and, for `player_ranks`, the shape public clients of the API read
(`player_rank` with `rank_type` `OR` and `S`, `rank_value`, `rank_season`);
`ranks` is not in Yahoo's documentation. Leagues, teams, members and values are
made up.

- `scoreboard.xml`: `league/{league_key}/scoreboard`
- `players-ranks.xml`: `league/{league_key}/players;out=ranks,percent_owned;start=0;count=25`
- `players-stats-week.xml`: `league/{league_key}/players;player_keys={player_keys}/stats;type=week;week={week}`

`recorded.json` is the probe's record once an operator has run it against
production (`api yahoo-probe`, the Lane 130 report has the command): the shapes
only, field names, one example row with member data blanked and the coverage
values seen. The answers themselves are never kept here.
