"""EACH PLAYER'S SEASON SO FAR: the season line and the game log, as `players/<id>.json` carries it
under `season` (`web/src/lib/run/season.ts`, whose parse the schema gate runs).

The rules (the same as the web's worked example, `web/scripts/standin-season.ts`, but with the
feed's own final flag where the stand-in estimated one):

- A club's game is final once nflverse has posted its result (`team_week_observations`,
  `game_result`, written by the weekly pass). A club's game is in the records once it is final and
  the store holds that club's lines that week (`player_week_teams`). `through` is the last week
  whose games are all in, counting from week 1 without a gap.
- A week is played when he has a stat line, or offensive snaps with no stats row (the weekly
  release carries only players who recorded a stat, so that is a game with no touches). With
  neither, the week is inactive once his club's game is in the records and upcoming before. A bye
  is a week his club does not play.
- The player-week feed lands in two ingests: the stat line (the scoring stats and completions) and
  the usage line (carries, targets, pass attempts and the team totals). Within a played week, a
  stat with no row is zero only when that week has his row from the same ingest and the store holds
  that metric for the week; otherwise it is null. A total is null when any played week's is null.
- Points are `compute_fantasy_points` in the block's format (the first run format that ranks him),
  kept to two decimals; points a game round half up to one decimal from the cents.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.domain import (
    HALF_PPR_SCORING,
    PPR_SCORING,
    STANDARD_SCORING,
    Position,
    ScoringRules,
    StatLine,
    compute_fantasy_points,
)
from research.model.jsmath import js_round
from research.nightly.config import RunFormat
from research.nightly.reads.schedule import Game
from research.pipeline.nflverse.participation import NflverseSource, ParticipationMetric
from research.pipeline.nflverse.team_codes import product_team_code

Json = dict[str, Any]
STAT_FIELDS: Final = (
    "pass_attempts", "completions", "passing_yards", "passing_touchdowns", "interceptions", "carries",
    "rushing_yards", "rushing_touchdowns", "targets", "receptions", "receiving_yards", "receiving_touchdowns",
    "fumbles_lost", "field_goals_made", "extra_points_made", "sacks", "defensive_interceptions",
    "defensive_touchdowns",
)  # fmt: skip
USAGE_METRICS: Final = frozenset(
    {"carries", "targets", "pass_attempts", "team_carries", "team_targets", "team_pass_attempts"}
)
POINTS_FIELDS: Final = (
    "passing_yards", "passing_touchdowns", "interceptions", "rushing_yards", "rushing_touchdowns", "receiving_yards",
    "receiving_touchdowns", "receptions", "fumbles_lost", "field_goals_made", "extra_points_made", "sacks",
    "defensive_interceptions", "defensive_touchdowns",
)  # fmt: skip
SCORING: Final[Mapping[str, ScoringRules]] = {"ppr": PPR_SCORING, "half": HALF_PPR_SCORING, "std": STANDARD_SCORING}
_SNAPS: Final = ParticipationMetric.OFFENSIVE_SNAPS
_TEAM_SNAPS: Final = ParticipationMetric.TEAM_OFFENSIVE_SNAPS
_CENTS: Final = 100
Metrics = dict[str, float]


@dataclass(frozen=True, slots=True)
class SeasonStore:
    lines: Mapping[str, Mapping[int, Metrics]]  # provider id, week, the stat source's metrics
    snaps: Mapping[str, Mapping[int, Metrics]]
    teams: Mapping[str, Mapping[int, str]]  # provider id, week, his club (product code)
    carried: Mapping[int, frozenset[str]]  # week, the stat metrics the store holds
    in_records: frozenset[tuple[str, int]]  # (club, week) final and with lines


def read_season_store(conn: Connection, season: int, ids: Sequence[str]) -> SeasonStore:
    rows = conn.execute(
        text(
            "select distinct on (o.player_id, o.week, o.source, o.metric) c.provider_player_id as id, o.week, o.source, "
            "o.metric, o.value from research.player_week_observations o "
            "join research.player_crosswalk c on c.player_id = o.player_id "
            "where o.season = :s and o.source in (:stats, :snaps) and c.provider_player_id = any(:ids) "
            "order by o.player_id, o.week, o.source, o.metric, o.as_of desc"
        ),
        {"s": season, "stats": NflverseSource.PLAYER_WEEK, "snaps": NflverseSource.SNAP_COUNTS, "ids": list(ids)},
    )
    lines: dict[str, dict[int, Metrics]] = {}
    snaps: dict[str, dict[int, Metrics]] = {}
    for row in rows:
        into = lines if row.source == NflverseSource.PLAYER_WEEK else snaps
        into.setdefault(row.id, {}).setdefault(int(row.week), {})[row.metric] = float(row.value)
    teams: dict[str, dict[int, str]] = {}
    for row in conn.execute(
        text(
            "select distinct on (t.player_id, t.week) c.provider_player_id as id, t.week, t.team "
            "from research.player_week_teams t join research.player_crosswalk c on c.player_id = t.player_id "
            "where t.season = :s and c.provider_player_id = any(:ids) order by t.player_id, t.week, t.as_of desc"
        ),
        {"s": season, "ids": list(ids)},
    ):
        teams.setdefault(row.id, {})[int(row.week)] = product_team_code(row.team)
    carried: dict[int, set[str]] = {}
    for row in conn.execute(
        text("select distinct week, metric from research.player_week_observations where season = :s and source = :src"),
        {"s": season, "src": NflverseSource.PLAYER_WEEK},
    ):
        carried.setdefault(int(row.week), set()).add(row.metric)
    lined = {
        (product_team_code(r.team), int(r.week))
        for r in conn.execute(
            text("select distinct week, team from research.player_week_teams where season = :s"), {"s": season}
        )
    }
    final = {
        (product_team_code(r.team), int(r.week))
        for r in conn.execute(
            text(
                "select distinct week, team from research.team_week_observations where season = :s and metric = 'game_result'"
            ),
            {"s": season},
        )
    }
    return SeasonStore(lines, snaps, teams, {w: frozenset(m) for w, m in carried.items()}, frozenset(lined & final))


def through_of(games: Mapping[str, Sequence[Game]], weeks: int, store: SeasonStore) -> int:
    """The last week whose games are all in the records, from week 1 without a gap."""
    through = 0
    for week in range(1, weeks + 1):
        playing = [club for club, slate in games.items() if any(g.week == week for g in slate)]
        if not all((club, week) in store.in_records for club in playing):
            break
        through = week
    return through


def _has_ingest(line: Metrics, usage: bool) -> bool:
    return any((metric in USAGE_METRICS) == usage for metric in line)


def _snap_share(snaps: Metrics | None) -> float | None:
    mine = None if snaps is None else snaps.get(_SNAPS)
    team = None if snaps is None else snaps.get(_TEAM_SNAPS)
    return None if mine is None or team is None or team == 0 else mine / team


def _empty() -> Json:
    return {**dict.fromkeys(STAT_FIELDS), "snapShare": None, "points": None}


@dataclass(frozen=True, slots=True)
class Scorer:
    rules: ScoringRules
    position: Position

    def points(self, counts: Mapping[str, float | None]) -> float:
        line = StatLine("", 0).with_values(**{field: counts[field] or 0.0 for field in POINTS_FIELDS})
        return compute_fantasy_points(line, self.position, self.rules)


def _played(line: Metrics, snaps: Metrics | None, carried: frozenset[str], scorer: Scorer) -> Json:
    no_touches = not _has_ingest(line, usage=False)

    def value(field: str) -> float | None:
        if field in line:
            return line[field]
        same_ingest = no_touches or _has_ingest(line, usage=field in USAGE_METRICS)
        return 0.0 if same_ingest and field in carried else None

    counts = {field: value(field) for field in STAT_FIELDS}
    return {**counts, "snapShare": _snap_share(snaps), "points": scorer.points(counts)}


def _totals(played: Sequence[Json], snaps: Sequence[Metrics | None]) -> Json:
    if not played:
        return _empty()
    sums: Json = {
        field: None if any(row[field] is None for row in played) else sum(row[field] for row in played)
        for field in STAT_FIELDS
    }
    snapped = all(_snap_share(week) is not None for week in snaps)
    mine = sum((week or {}).get(_SNAPS, 0.0) for week in snaps)
    team = sum((week or {}).get(_TEAM_SNAPS, 0.0) for week in snaps)
    cents = sum(int(js_round(row["points"] * _CENTS)) for row in played)
    return {**sums, "snapShare": mine / team if snapped and team else None, "points": cents / _CENTS}


def points_per_game(points: Sequence[float]) -> float | None:
    """`pointsPerGameOf`: the cents' mean, rounded half up to one decimal."""
    if not points:
        return None
    cents = sum(int(js_round(p * _CENTS)) for p in points)
    return js_round(cents / (len(points) * 10)) / 10


@dataclass(frozen=True, slots=True)
class SeasonContext:
    season: int
    weeks: int
    through: int
    games: Mapping[str, Sequence[Game]]
    byes: Mapping[str, int | None]
    store: SeasonStore


def season_block(player_id: str, team: str, run_format: RunFormat, position: Position, context: SeasonContext) -> Json:
    scorer = Scorer(SCORING[run_format.scoring], position)
    store = context.store
    lines, snaps, teams = store.lines.get(player_id, {}), store.snaps.get(player_id, {}), store.teams.get(player_id, {})
    log: list[Json] = []
    for week in range(1, context.weeks + 1):
        club = teams.get(week, team)
        game = next((g for g in context.games.get(club, ()) if g.week == week), None)
        found = lines.get(week, {})
        snapped = (snaps.get(week) or {}).get(_SNAPS, 0.0) > 0
        line = found if _has_ingest(found, usage=False) or snapped else None
        if game is None:
            if context.byes.get(club) != week or line is not None:
                raise ValueError(f"{player_id} has no {club} game in week {week}, and it is not a clean bye")
            log.append({**_empty(), "week": week, "opponent": None, "home": None, "status": "bye"})
            continue
        where = {"week": week, "opponent": game.opponent, "home": game.home}
        if line is not None:
            carried = store.carried.get(week, frozenset())
            log.append({**_played(line, snaps.get(week), carried, scorer), **where, "status": "played"})
        else:
            status = "inactive" if (club, week) in store.in_records else "upcoming"
            log.append({**_empty(), **where, "status": status})
    played = [row for row in log if row["status"] == "played"]
    return {
        "season": context.season,
        "format": run_format.id,
        "weeks": context.weeks,
        "through": context.through,
        "games": len(played),
        "pointsPerGame": points_per_game([row["points"] for row in played]),
        "totals": _totals(played, [snaps.get(row["week"]) for row in played]),
        "log": log,
    }
