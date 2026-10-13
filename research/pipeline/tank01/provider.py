"""THE STATS PROVIDER (`src/stats/tank01/tank01-stats-provider.ts`): the roster, the fixtures, the box
scores and the ADP feed, behind one object with the TypeScript's request costs.

The roster is two requests (the player list and the teams feed, which mints the 32 defenses),
memoized for the provider's life. A box score is narrowed to listed players, and for the current
season also to the two clubs that played (a player traded after the game is listed under his new
club and is dropped, exactly as the TypeScript drops him).
"""

from dataclasses import dataclass, field

from research.pipeline.tank01.client import DEFAULT_SEASON, Paths, Tank01Client
from research.pipeline.tank01.mapping import (
    ADP_TYPE,
    SEASON_TYPE,
    WEEKS_FIRST,
    WEEKS_LAST,
    AdpEntry,
    GameSummary,
    Player,
    StatLine,
    map_adp_list,
    map_box_score_to_stat_lines,
    map_games,
    map_player_list,
    map_teams_to_defense_players,
)

LIST_PLAYERS_REQUEST_COST = 2
LIST_ADP_REQUEST_COST = 1


@dataclass
class Tank01Provider:
    client: Tank01Client
    season: int = DEFAULT_SEASON
    last_week_of_season: int = WEEKS_LAST
    _players: list[Player] | None = field(default=None, init=False, repr=False)

    def list_players(self) -> list[Player]:
        if self._players is None:
            player_body = self.client.get(Paths.PLAYER_LIST)
            team_body = self.client.get(Paths.TEAMS)
            self._players = [*map_player_list(player_body), *map_teams_to_defense_players(team_body)]
        return self._players

    def list_games(self, week: int) -> list[GameSummary]:
        if week < WEEKS_FIRST or week > WEEKS_LAST:
            return []
        body = self.client.get(
            Paths.GAMES_FOR_WEEK, {"week": str(week), "season": str(self.season), "seasonType": SEASON_TYPE}
        )
        return map_games(body, week)

    @property
    def historical(self) -> bool:
        return self.season < DEFAULT_SEASON

    def get_game_stat_lines(self, game: GameSummary) -> list[StatLine]:
        players = self.list_players()
        listed = frozenset(player.id for player in players)
        box = self.client.get(Paths.BOX_SCORE, {"gameID": game.game_id})
        lines = map_box_score_to_stat_lines(box, game.week, listed)
        if self.historical:
            return lines
        teams = {game.home_nfl_team, game.away_nfl_team}
        in_game = {player.id for player in players if player.nfl_team in teams}
        return [line for line in lines if line.player_id in in_game]

    def get_weekly_stat_lines(self, week: int) -> list[StatLine]:
        lines: list[StatLine] = []
        for game in self.list_games(week):
            lines.extend(self.get_game_stat_lines(game))
        return lines

    def list_adp(self) -> list[AdpEntry]:
        listed = frozenset(player.id for player in self.list_players())
        body = self.client.get(Paths.ADP, {"adpType": ADP_TYPE})
        return map_adp_list(body, listed)
