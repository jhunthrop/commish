"""The compared tables, each with its natural key (the columns of its unique fact index)."""

from research.parity.diff import TableSpec

NFL_PLAYERS = TableSpec("nfl_players", ("id",))
PLAYER_WEEK_OBSERVATIONS = TableSpec(
    "player_week_observations", ("season", "week", "player_id", "source", "metric", "as_of")
)
TEAM_WEEK_OBSERVATIONS = TableSpec("team_week_observations", ("season", "week", "team", "source", "metric", "as_of"))
PLAYER_WEEK_TEAMS = TableSpec("player_week_teams", ("season", "week", "player_id", "team", "as_of"))
NFLVERSE_INJURIES = TableSpec("nflverse_injuries", ("season", "week", "player_id"))
NFLVERSE_ROSTER_WEEKS = TableSpec("nflverse_roster_weeks", ("season", "week", "player_id"))
NFLVERSE_KICKING_WEEKS = TableSpec("nflverse_kicking_weeks", ("season", "week", "player_id"))
NFLVERSE_TEAM_DEFENSE_WEEKS = TableSpec("nflverse_team_defense_weeks", ("season", "week", "team"))
NFL_DRAFT_PICKS = TableSpec("nfl_draft_picks", ("season", "pick"))
PRESEASON_ROSTERS = TableSpec("preseason_rosters", ("season", "player_id", "as_of"))
PRESEASON_RANKINGS = TableSpec("preseason_rankings", ("season", "source", "player_id", "as_of"))
PLAYER_CROSSWALK = TableSpec("player_crosswalk", ("player_id",))
CAPTURE_SNAPSHOTS = TableSpec("capture_snapshots", ("source", "captured_at"))
ADP_SNAPSHOTS = TableSpec("adp_snapshots", ("player_id", "source", "captured_at"))
PLAYER_PROP_OBSERVATIONS = TableSpec(
    "player_prop_observations", ("event_id", "bookmaker", "market", "player_name", "fetched_at")
)
PROPS_PLAYER_MAP = TableSpec("props_player_map", ("prop_name", "season"))
COACHES = TableSpec("coaches", ("season", "team", "role", "start_week"))
PLAYERS = TableSpec("players", ("id",))
NFL_GAMES = TableSpec("nfl_games", ("game_id",))
PLAYER_STAT_LINES = TableSpec("player_stat_lines", ("player_id", "week"))
STAT_WEEKS = TableSpec("stat_weeks", ("week",))
