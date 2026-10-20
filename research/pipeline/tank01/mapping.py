"""TANK01 RESPONSES TO DOMAIN ROWS (`src/stats/tank01/map.ts`).

Tank01 returns every value as a JSON string. A stat that is absent or unparsable reads 0 (one NaN
would turn a team's weekly total into NaN), but an ADP that is unparsable or non-positive drops
the entry (a silent 0 would sort a parsing bug to the top of every board). The kicker arrives as
`PK` and is the domain's `K`. A team defense is minted as `DST-<abbreviation>` from the teams
feed, the box score's DST block and the ADP list alike, so the three always agree.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Final, Literal

from research.pipeline.jscompat import js_is_finite, js_number_of, js_object_keys, js_trim
from research.pipeline.nflverse.team_codes import DEFENSE_PLAYER_ID_PREFIX

GameStatus = Literal["scheduled", "in_progress", "final"]

SCORED_POSITIONS: Final = ("QB", "RB", "WR", "TE", "K")
_FINAL_STATUS_PREFIXES = ("completed", "final")
_SCHEDULED_STATUSES = ("scheduled", "not started", "pre-game")
_STATUS_BY_CODE: Final[dict[str, GameStatus]] = {"0": "scheduled", "1": "in_progress", "2": "final"}
WEEKS_FIRST: Final = 1
WEEKS_LAST: Final = 18
SEASON_TYPE: Final = "reg"
ADP_TYPE: Final = "PPR"


@dataclass(frozen=True)
class Player:
    id: str
    name: str
    position: str
    nfl_team: str
    headshot_url: str | None
    adp: float | None = None


@dataclass(frozen=True)
class AdpEntry:
    player_id: str
    adp: float
    pos_adp: str | None = None


@dataclass(frozen=True)
class GameSummary:
    game_id: str
    week: int
    status: GameStatus
    home_nfl_team: str
    away_nfl_team: str
    game_date: str
    kickoff_et: str


# `provider_stat_lines` column for each StatLine field this mapper fills, in the domain's order.
STAT_LINE_COLUMNS: Final = (
    "passing_yards", "passing_touchdowns", "interceptions", "rushing_yards", "rushing_touchdowns",
    "receiving_yards", "receiving_touchdowns", "receptions", "fumbles_lost", "field_goals_made",
    "extra_points_made", "sacks", "defensive_interceptions", "defensive_touchdowns",
)  # fmt: skip


@dataclass(frozen=True)
class StatLine:
    """One player's week. `values` holds every column the source said anything about."""

    player_id: str
    week: int
    values: Mapping[str, float] = field(default_factory=dict)


def num(value: object) -> float:
    """`num`: anything that is not a finite number reads 0."""
    parsed = js_number_of(value)
    return parsed if js_is_finite(parsed) else 0.0


def text(value: object) -> str:
    """`str`: a trimmed string, or "" for anything that is not a string."""
    return js_trim(value) if isinstance(value, str) else ""


def _record(value: object) -> Mapping[str, object]:
    return value if isinstance(value, dict) else {}


def group(entry: object, name: str) -> Mapping[str, object]:
    found = _record(entry).get(name)
    return found if isinstance(found, dict) else {}


def map_player_list(body: object) -> list[Player]:
    if not isinstance(body, list):
        return []
    players: list[Player] = []
    for raw in body:
        record = _record(raw)
        player_id = text(record.get("playerID"))
        name = text(record.get("longName"))
        raw_position = text(record.get("pos"))
        position = "K" if raw_position == "PK" else raw_position
        nfl_team = text(record.get("team"))
        if player_id == "" or name == "" or nfl_team == "" or position not in SCORED_POSITIONS:
            continue
        headshot = text(record.get("espnHeadshot")) or None
        players.append(Player(player_id, name, position, nfl_team, headshot))
    return players


def map_teams_to_defense_players(body: object) -> list[Player]:
    if not isinstance(body, list):
        return []
    players: list[Player] = []
    for raw in body:
        record = _record(raw)
        abbreviation = text(record.get("teamAbv"))
        if abbreviation == "":
            continue
        name = " ".join(part for part in (text(record.get("teamCity")), text(record.get("teamName"))) if part != "")
        players.append(
            Player(f"{DEFENSE_PLAYER_ID_PREFIX}{abbreviation}", name or abbreviation, "DEF", abbreviation, None)
        )
    return players


def map_adp_list(body: object, listed_player_ids: frozenset[str]) -> list[AdpEntry]:
    raw_list = _record(body).get("adpList")
    if not isinstance(raw_list, list):
        return []
    entries: dict[str, AdpEntry] = {}
    for raw in raw_list:
        entry = _record(raw)
        direct = text(entry.get("playerID"))
        team = text(entry.get("teamAbv"))
        player_id = direct if direct != "" else (f"{DEFENSE_PLAYER_ID_PREFIX}{team}" if team != "" else "")
        if player_id == "" or player_id not in listed_player_ids:
            continue
        adp = js_number_of(entry["overallADP"]) if "overallADP" in entry else float("nan")
        if not js_is_finite(adp) or adp <= 0:
            continue
        pos_adp = text(entry.get("posADP"))
        if player_id not in entries:
            entries[player_id] = AdpEntry(player_id, adp, None if pos_adp == "" else pos_adp)
    return list(entries.values())


def _game_status(record: Mapping[str, object]) -> GameStatus:
    """The code Tank01 documents (0 scheduled, 1 in progress, 2 final) wins; the words are the fallback.

    Words match by prefix so an overtime final ("Final/OT") reads final.
    """
    by_code = _STATUS_BY_CODE.get(text(record.get("gameStatusCode")))
    if by_code is not None:
        return by_code
    value = text(record.get("gameStatus")).lower()
    if value.startswith(_FINAL_STATUS_PREFIXES):
        return "final"
    if value in _SCHEDULED_STATUSES:
        return "scheduled"
    return "in_progress"


def map_games(body: object, week: int) -> list[GameSummary]:
    if not isinstance(body, list):
        return []
    games: list[GameSummary] = []
    for raw in body:
        record = _record(raw)
        game_id = text(record.get("gameID"))
        home = text(record.get("home"))
        away = text(record.get("away"))
        if game_id == "" or home == "" or away == "":
            continue
        games.append(
            GameSummary(
                game_id=game_id,
                week=week,
                status=_game_status(record),
                home_nfl_team=home,
                away_nfl_team=away,
                game_date=text(record.get("gameDate")),
                kickoff_et=text(record.get("gameTime")),
            )
        )
    return games


def map_box_score_game(body: object, week: int) -> GameSummary | None:
    """`/getNFLBoxScore`'s own game (Lane 101): its id, clubs and status read as `map_games` reads a week's
    games, `gameStatusCode` first and the words by prefix. None for an answer that is not one game or
    carries no status at all (no code and no words), which the week's read would take as under way: the
    caller refuses it instead."""
    if not isinstance(body, dict):
        return None
    if text(body.get("gameStatusCode")) == "" and text(body.get("gameStatus")) == "":
        return None
    games = map_games([body], week)
    return games[0] if games else None


def _empty(player_id: str, week: int) -> dict[str, float]:
    return dict.fromkeys(STAT_LINE_COLUMNS, 0.0)


def _player_line(player_id: str, week: int, entry: object) -> StatLine:
    passing = group(entry, "Passing")
    rushing = group(entry, "Rushing")
    receiving = group(entry, "Receiving")
    defense = group(entry, "Defense")
    kicking = group(entry, "Kicking")
    snaps = group(entry, "snapCounts")
    values = _empty(player_id, week)
    values.update(
        {
            "passing_yards": num(passing.get("passYds")),
            "passing_touchdowns": num(passing.get("passTD")),
            "interceptions": num(passing.get("int")),
            "rushing_yards": num(rushing.get("rushYds")),
            "rushing_touchdowns": num(rushing.get("rushTD")),
            "receiving_yards": num(receiving.get("recYds")),
            "receiving_touchdowns": num(receiving.get("recTD")),
            "receptions": num(receiving.get("receptions")),
            # fumblesLost lives under Defense, even for offensive players.
            "fumbles_lost": num(defense.get("fumblesLost")),
            "field_goals_made": num(kicking.get("fgMade")),
            "extra_points_made": num(kicking.get("xpMade")),
            "sacks": num(defense.get("sacks")),
            "defensive_interceptions": num(defense.get("defensiveInterceptions")),
            "defensive_touchdowns": num(defense.get("defTD")),
            "targets": num(receiving.get("targets")),
            "carries": num(rushing.get("carries")),
            "pass_attempts": num(passing.get("passAttempts")),
            "pass_completions": num(passing.get("passCompletions")),
            "field_goals_attempted": num(kicking.get("fgAttempts")),
            "offensive_snaps": num(snaps.get("offSnap")),
            "offensive_snap_share": num(snaps.get("offSnapPct")),
            "two_point_conversions": num(passing.get("passingTwoPointConversion"))
            + num(rushing.get("rushingTwoPointConversion"))
            + num(receiving.get("receivingTwoPointConversion")),
            "field_goals_missed": num(kicking.get("fgMissed")),
            "extra_points_missed": num(kicking.get("xpMissed")),
            "kick_return_touchdowns": num(kicking.get("kickReturnTD")),
            "punt_return_touchdowns": num(group(entry, "Punting").get("puntReturnTD")),
        }
    )
    return StatLine(player_id, week, values)


def map_box_score_to_stat_lines(body: object, week: int, listed_player_ids: frozenset[str]) -> list[StatLine]:
    record = _record(body)
    lines: list[StatLine] = []
    player_stats = record.get("playerStats")
    if isinstance(player_stats, dict):
        for key in js_object_keys(player_stats):
            entry = player_stats[key]
            player_id = text(_record(entry).get("playerID")) or key
            if player_id == "" or player_id not in listed_player_ids:
                continue
            lines.append(_player_line(player_id, week, entry))
    dst = record.get("DST")
    sides = [dst[key] for key in js_object_keys(dst)] if isinstance(dst, dict) else []
    defenses: dict[str, StatLine] = {}
    for side in sides:
        entry = _record(side)
        abbreviation = text(entry.get("teamAbv"))
        defense_id = f"{DEFENSE_PLAYER_ID_PREFIX}{abbreviation}"
        if abbreviation == "" or defense_id not in listed_player_ids:
            continue
        values = _empty(defense_id, week)
        values.update(
            {
                "sacks": num(entry.get("sacks")),
                "defensive_interceptions": num(entry.get("defensiveInterceptions")),
                "defensive_touchdowns": num(entry.get("defTD")),
                "points_allowed": num(entry.get("ptsAllowed")),
                "yards_allowed": num(entry.get("ydsAllowed")),
                "defensive_fumbles_recovered": num(entry.get("fumblesRecovered")),
                "safeties": num(entry.get("safeties")),
            }
        )
        defenses[defense_id] = StatLine(defense_id, week, values)
    return [*lines, *defenses.values()]


def deduped_by_player_id(lines: Sequence[StatLine]) -> list[StatLine]:
    """`dedupedByPlayerId`: one line per player (the last wins), in player-id order."""
    by_id: dict[str, StatLine] = {}
    for line in lines:
        by_id[line.player_id] = line
    return sorted(by_id.values(), key=lambda line: line.player_id)


def with_week(line: StatLine, week: int) -> StatLine:
    return replace(line, week=week)
