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
  is a week his club does not play. A week's club is the one his line that week was for, else the page
  club (`page_club`, Lane 120); a mover's week with no line, up to his newest line, names no opponent
  and is inactive. A free agent's week with a line and no club edge names no opponent either, and says
  it was a game he played that the run cannot name (`unnamedGame`, Lane 138), so the page never reads
  it as a week he did not play.
- The player-week feed lands in two ingests: the stat line (the scoring stats and completions) and
  the usage line (carries, targets, pass attempts and the team totals). Within a played week, a
  stat with no row is zero only when that week has his row from the same ingest and the store holds
  that metric for the week; otherwise it is null. A total is null when any played week's is null.
- Points are `compute_fantasy_points` in the block's format (the first run format that ranks him),
  kept to two decimals; points a game round half up to one decimal from the cents.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
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
from research.nightly.build.page_club import ClubCall, call_for, club_calls, read_roster, seeded_clubs
from research.nightly.config import RunFormat
from research.nightly.reads import schedule as schedule_read
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
# The seasons before this one a page sums, newest first (Lane 66h), and the last week of a regular
# season: the feed's later weeks are the playoffs, which a fantasy season leaves out.
PRIOR_SEASONS: Final = 3
REGULAR_SEASON_WEEKS: Final = 18
Metrics = dict[str, float]


@dataclass(frozen=True, slots=True)
class SeasonStore:
    lines: Mapping[str, Mapping[int, Metrics]]  # provider id, week, the stat source's metrics
    snaps: Mapping[str, Mapping[int, Metrics]]
    teams: Mapping[str, Mapping[int, str]]  # provider id, week, his club (product code)
    carried: Mapping[int, frozenset[str]]  # week, the stat metrics the store holds
    in_records: frozenset[tuple[str, int]]  # (club, week) final and with lines


def read_season_store(conn: Connection, season: int, ids: Sequence[str], as_of: datetime) -> SeasonStore:
    """The store's season as known at `as_of`: every line, club and final result stamped at or before it."""
    rows = conn.execute(
        text(
            "select distinct on (o.player_id, o.week, o.source, o.metric) c.provider_player_id as id, o.week, o.source, "
            "o.metric, o.value from research.player_week_observations o "
            "join research.player_crosswalk c on c.player_id = o.player_id "
            "where o.season = :s and o.source in (:stats, :snaps) and c.provider_player_id = any(:ids) "
            "and o.as_of <= :as_of order by o.player_id, o.week, o.source, o.metric, o.as_of desc"
        ),
        {
            "s": season,
            "stats": NflverseSource.PLAYER_WEEK,
            "snaps": NflverseSource.SNAP_COUNTS,
            "ids": list(ids),
            "as_of": as_of,
        },
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
            "where t.season = :s and c.provider_player_id = any(:ids) and t.as_of <= :as_of "
            "order by t.player_id, t.week, t.as_of desc"
        ),
        {"s": season, "ids": list(ids), "as_of": as_of},
    ):
        teams.setdefault(row.id, {})[int(row.week)] = product_team_code(row.team)
    carried: dict[int, set[str]] = {}
    for row in conn.execute(
        text(
            "select distinct week, metric from research.player_week_observations "
            "where season = :s and source = :src and as_of <= :as_of"
        ),
        {"s": season, "src": NflverseSource.PLAYER_WEEK, "as_of": as_of},
    ):
        carried.setdefault(int(row.week), set()).add(row.metric)
    lined = {
        (product_team_code(r.team), int(r.week))
        for r in conn.execute(
            text("select distinct week, team from research.player_week_teams where season = :s and as_of <= :as_of"),
            {"s": season, "as_of": as_of},
        )
    }
    final = {
        (product_team_code(r.team), int(r.week))
        for r in conn.execute(
            text(
                "select distinct week, team from research.team_week_observations where season = :s "
                "and metric = 'game_result' and as_of <= :as_of"
            ),
            {"s": season, "as_of": as_of},
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
    # The seasons before, each one's store, for the page's earlier seasons (Lane 66h).
    prior: Mapping[int, SeasonStore]
    # Each player's club as the page names it, by provider id (Lane 120, `page_club`).
    clubs: Mapping[str, ClubCall] = field(default_factory=dict)


def season_context(
    conn: Connection, season: int, player_ids: Sequence[str], as_of: datetime, *, prior: bool = False
) -> SeasonContext:
    """The season so far for these players at `as_of`: the slate, the byes, the records' reach, the
    store's lines. The page and the capsule writer read it alike, so a capsule is told the season the
    page prints."""
    games = schedule_read.slates_by_club(conn, season)
    weeks = max(game.week for slate in games.values() for game in slate)
    store = read_season_store(conn, season, player_ids, as_of)
    byes = {club.abbr: club.bye for club in schedule_read.clubs_of(games)}
    clubs = club_calls(seeded_clubs(conn, player_ids), read_roster(conn, as_of), store.teams, games)
    # The seasons before are the page's alone (Lane 66h): the writers' passes never read them (rereview N5).
    before = (
        {year: read_season_store(conn, year, player_ids, as_of) for year in range(season - PRIOR_SEASONS, season)}
        if prior
        else {}
    )
    return SeasonContext(season, weeks, through_of(games, weeks, store), games, byes, store, before, clubs)


def season_block(player_id: str, run_format: RunFormat, position: Position, context: SeasonContext) -> Json:
    """His season in `run_format`: a week with his game line under the club it was for, a week without
    one under the page club (`page_club`), or naming no opponent where the run cannot say which club he
    was with."""
    scorer = Scorer(SCORING[run_format.scoring], position)
    store = context.store
    lines, snaps, teams = store.lines.get(player_id, {}), store.snaps.get(player_id, {}), store.teams.get(player_id, {})
    call = call_for(context.clubs, player_id)
    log: list[Json] = []
    for week in range(1, context.weeks + 1):
        found = lines.get(week, {})
        snapped = (snaps.get(week) or {}).get(_SNAPS, 0.0) > 0
        line = found if _has_ingest(found, usage=False) or snapped else None
        club = teams.get(week) or call.club_in(week, context.through)
        if club is None and line is not None:
            # Snaps with no club line are his page club's game, as before the rule.
            club = call.club
        if club is None:
            # No club the run can name: a mover's week up to his newest line, or a free agent's (Lane 123),
            # whose snaps with no club line name no game either; that week he played (Lane 138).
            unnamed = {"unnamedGame": True} if line is not None else {}
            log.append({**_empty(), "week": week, "opponent": None, "home": None, "status": "inactive", **unnamed})
            continue
        game = next((g for g in context.games.get(club, ()) if g.week == week), None)
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


def prior_seasons(player_id: str, run_format: RunFormat, position: Position, context: SeasonContext) -> list[Json]:
    """His earlier seasons, newest first, each summed as this season's block sums its weeks: the regular
    season's played weeks (a stat line, or snaps with no stats row), their points in the page format, the
    points a game and the totals. A season he did not play is left out."""
    scorer = Scorer(SCORING[run_format.scoring], position)
    out: list[Json] = []
    for year in sorted(context.prior, reverse=True):
        store = context.prior[year]
        lines, snaps = store.lines.get(player_id, {}), store.snaps.get(player_id, {})
        played: list[Json] = []
        weeks_snaps: list[Metrics | None] = []
        for week in sorted({*lines, *snaps}):
            if week > REGULAR_SEASON_WEEKS:
                continue
            found = lines.get(week, {})
            snapped = (snaps.get(week) or {}).get(_SNAPS, 0.0) > 0
            if not (_has_ingest(found, usage=False) or snapped):
                continue
            played.append(_played(found, snaps.get(week), store.carried.get(week, frozenset()), scorer))
            weeks_snaps.append(snaps.get(week))
        if not played:
            continue
        out.append(
            {
                "season": year,
                "games": len(played),
                "pointsPerGame": points_per_game([row["points"] for row in played]),
                "totals": _totals(played, weeks_snaps),
            }
        )
    return out
