# Yahoo fixtures

Constructed, not recorded. No member's Yahoo grant was available to Lane 21 (the
OAuth flow needs a person to approve it on Yahoo's page), so these files follow
the Fantasy Sports API's documented XML (developer.yahoo.com/fantasysports/guide:
the users, games, league, settings, standings, scoreboard, transactions and
roster resources) with made-up leagues, teams and player ids. Element names and
nesting are Yahoo's; the values are ours.

- `yahoo-my-leagues.xml`: `users;use_login=1/games;game_keys=nfl/leagues`
- `yahoo-my-teams.xml`: `users;use_login=1/games;game_keys=nfl/teams`
- `yahoo-games-2026.xml`: `games;game_codes=nfl;seasons=2026`
- `yahoo-league-head.xml`: `league/{key};out=settings,standings,scoreboard,transactions`
- `yahoo-league-head-predraft.xml`: the same head as a league before its draft
  (Lane 53, constructed): `draft_status` predraft, `current_week` and the
  scoreboard's weeks 1, and `draft_time` a week after the drafted league's
- `yahoo-league-rosters.xml`: `league/{key}/teams;out=roster`
- `yahoo-league-waivers.xml`: `league/{key}/players;status=W;out=ownership;start=0;count=25`
- `yahoo-token.json`: the token endpoint's answer, with fixture tokens
- `yahoo-pending-trades.xml`: `league/{key}/transactions;team_key={team};type=pending_trade`
  (Lane 279, constructed): the guide's pending-trade sample (Transaction
  resource, `257.l.193.pt.1`) inside the league transactions collection, four
  rows: one proposed to team 1, one team 1 proposed, one accepted (waiting on
  the league) and one whose player moves to a third team

Replace each with a recorded answer once a member connects, and keep the tests'
expectations: the parsers must read a recorded answer the same way.
