"""ESPN'S ARCHIVED WEEKLY KICKER AND D/ST PROJECTIONS, A BENCHMARK (`espn_kdef_archive_rows`, Lane 156).

The weekly kicker and team-defense sub-round grades its number against ESPN's own weekly projection for
the judged seasons (Amendment 7 item 9 of the round 4 preregistration; design §6.2, gates KD3 and KD4).
ESPN's public pool (`kona_player_info` on its league defaults, no sign-in, the read `projections.py`
makes for the live week) still answers an archived season's weeks: the pool filtered to the kicker and
D/ST slots lists each projected one-period split with its `appliedTotal` and its projected components by
ESPN's stat id (checked 2026-10-22: 2024 week 8, 67 kickers and 32 D/ST; 2023 week 5, 67 and 28).

WHAT IS KEPT. Every kicker and D/ST with a projected split for the week, its total, and the split's
`stats` as ESPN gives them (an archived split can carry no components: 2023 week 1's D/ST splits list a
total only, so the grader re-scores from the components where they map, else takes the total).
`components` names the stat ids the judged scoring reads.

THE STAMP CAVEAT. ESPN publishes no stamp for an archived split, and the archive may hold its last
version rather than the one standing at kickoff. Every row says so (`stamp` 'archive_unstamped'); it is
taken as ESPN's last pre-game version, which can only favour ESPN, and the verdict prints the caveat.

NEVER AN INPUT. Read once for the two judged seasons (`ARCHIVE_SEASONS`), so no other season is ever
asked for; append-only, keyed by the read's instant, a re-run at the same instant writes nothing.
"""

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Any, Final

from sqlalchemy import Connection, select

from research.db.schema import ESPN_KDEF_ARCHIVE_ROWS
from research.errors import SchemaDriftError
from research.pipeline.checkpoint import Checkpoint
from research.pipeline.espn.projections import ONE_PERIOD_SPLIT, PROJECTED_SOURCE, pool_headers, pool_url
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.team_codes import is_defense_id
from research.pipeline.observations import insert_ignoring_conflicts

# The judged sub-round's two seasons (Amendment 7 item 7): 2023 the development check, 2024 the judgment.
ARCHIVE_SEASONS: Final = (2023, 2024)
REGULAR_SEASON_WEEKS: Final = 18
ARCHIVE_STAMP: Final = "archive_unstamped"
STAMP_CAVEAT: Final = (
    "ESPN publishes no stamp for an archived projection; it is taken as ESPN's last pre-game version, "
    "which can only favour ESPN"
)
# ESPN's lineup slots and default positions for kickers and D/ST.
KICKER_SLOT: Final = 17
DEFENSE_SLOT: Final = 16
POSITION_OF_ESPN: Final[Mapping[int, str]] = MappingProxyType({5: "K", 16: "DEF"})

# ESPN stat id -> the component the judged scoring reads (checked 2026-10-22 on 2024 week 8: a kicker's
# made, attempted and missed field goals sum over the distance ids, and a D/ST's points-allowed and
# yards-allowed band probabilities each sum to one; ESPN's total re-scores from them to a hundredth).
# 74 and 76 (50 plus, made and missed) are the sums of 198 and 201 (50-59 and 60 plus, made) and of 200
# and 203 (missed): a grader reads one or the other, never adds the figure to its parts (B132;
# `model.weekly_kdef.scoring.espn_made_50_plus`).
KICKER_STATS: Final[Mapping[str, str]] = MappingProxyType(
    {
        "80": "fg_made_0_39",
        "82": "fg_missed_0_39",
        "77": "fg_made_40_49",
        "79": "fg_missed_40_49",
        "198": "fg_made_50_59",
        "200": "fg_missed_50_59",
        "201": "fg_made_60_plus",
        "203": "fg_missed_60_plus",
        "74": "fg_made_50_plus",
        "76": "fg_missed_50_plus",
        "83": "fg_made",
        "84": "fg_attempted",
        "85": "fg_missed",
        "86": "xp_made",
        "87": "xp_attempted",
        "88": "xp_missed",
    }
)
DEFENSE_STATS: Final[Mapping[str, str]] = MappingProxyType(
    {
        "99": "sacks",
        "95": "interceptions",
        "96": "fumble_recoveries",
        "97": "blocked_kicks",
        "98": "safeties",
        "94": "defensive_touchdowns",
        "93": "blocked_kick_return_touchdowns",
        "101": "kickoff_return_touchdowns",
        "102": "punt_return_touchdowns",
        "120": "points_allowed",
        "127": "yards_allowed",
        # The points-allowed bands: each the probability the D/ST allows a score in it.
        "89": "points_allowed_0",
        "90": "points_allowed_1_6",
        "91": "points_allowed_7_13",
        "92": "points_allowed_14_17",
        "121": "points_allowed_18_21",
        "122": "points_allowed_22_27",
        "123": "points_allowed_28_34",
        "124": "points_allowed_35_45",
        "125": "points_allowed_46_plus",
        # The yards-allowed bands, the same way.
        "128": "yards_allowed_0_99",
        "129": "yards_allowed_100_199",
        "130": "yards_allowed_200_299",
        "131": "yards_allowed_300_349",
        "132": "yards_allowed_350_399",
        "133": "yards_allowed_400_449",
        "134": "yards_allowed_450_499",
        "135": "yards_allowed_500_549",
        "136": "yards_allowed_550_plus",
    }
)
_STATS_BY_POSITION: Final[Mapping[str, Mapping[str, str]]] = MappingProxyType({"K": KICKER_STATS, "DEF": DEFENSE_STATS})


def archive_headers(week: int) -> dict[str, str]:
    """The live read's filter (`projections.pool_headers`) narrowed to the kicker and D/ST slots."""
    headers = pool_headers(week)
    wanted = json.loads(headers["X-Fantasy-Filter"])
    wanted["players"]["filterSlotIds"] = {"value": [KICKER_SLOT, DEFENSE_SLOT]}
    return {**headers, "X-Fantasy-Filter": json.dumps(wanted, separators=(",", ":"))}


@dataclass(frozen=True, slots=True)
class ArchivedProjection:
    espn_id: str
    position: str
    applied_total: float
    stats: Mapping[str, float]


def components(position: str, stats: Mapping[str, float]) -> dict[str, float]:
    """The projected components the judged scoring reads, by name. A stat id the split does not carry is
    absent, never zero: the grader takes ESPN's own total where a component it needs is missing."""
    names = _STATS_BY_POSITION[position]
    return {names[stat]: value for stat, value in stats.items() if stat in names}


def _number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _split_stats(split: Mapping[str, Any], espn_id: int) -> dict[str, float]:
    raw = split.get("stats", {})
    if not isinstance(raw, Mapping) or not all(isinstance(k, str) and _number(v) for k, v in raw.items()):
        raise SchemaDriftError(f"espn_kdef_archive: player {espn_id}'s projected split has malformed stats")
    return {stat: float(value) for stat, value in raw.items()}


def _projected_split(player: Mapping[str, Any], season: int, week: int) -> Mapping[str, Any] | None:
    stats = player.get("stats")
    for split in stats if isinstance(stats, list) else ():
        if (
            isinstance(split, Mapping)
            and split.get("seasonId") == season
            and split.get("scoringPeriodId") == week
            and split.get("statSourceId") == PROJECTED_SOURCE
            and split.get("statSplitTypeId") == ONE_PERIOD_SPLIT
            and _number(split.get("appliedTotal"))
        ):
            return split
    return None


def _player(entry: Any) -> tuple[int, Mapping[str, Any]]:
    player = entry.get("player") if isinstance(entry, Mapping) else None
    espn_id = player.get("id") if isinstance(player, Mapping) else None
    if not isinstance(espn_id, int) or isinstance(espn_id, bool) or not isinstance(player, Mapping):
        raise SchemaDriftError(f"espn_kdef_archive: a pool entry without a player id: {str(entry)[:120]}")
    return espn_id, player


def _archived(espn_id: int, position: str, split: Mapping[str, Any]) -> ArchivedProjection:
    if (position == "DEF") != is_defense_id(str(espn_id)):
        raise SchemaDriftError(f"espn_kdef_archive: {position} {espn_id} is not in ESPN's D/ST id space as expected")
    return ArchivedProjection(str(espn_id), position, float(split["appliedTotal"]), _split_stats(split, espn_id))


def parse_archive(payload: Any, season: int, week: int) -> list[ArchivedProjection]:
    """Each kicker's and D/ST's projected split for the week, in the pool's order. A payload without the
    player list, an entry without its id, malformed stats, or a D/ST id outside the 32 clubs' is a changed
    feed and refused; another position, or a player with no projected split, is left out."""
    players = payload.get("players") if isinstance(payload, Mapping) else None
    if not isinstance(players, list):
        raise SchemaDriftError("espn_kdef_archive: the player pool answered without a players list")
    out: list[ArchivedProjection] = []
    seen: set[int] = set()
    for entry in players:
        espn_id, player = _player(entry)
        default_position = player.get("defaultPositionId")
        position = POSITION_OF_ESPN.get(default_position) if isinstance(default_position, int) else None
        split = _projected_split(player, season, week)
        if position is None or split is None or espn_id in seen:
            continue
        seen.add(espn_id)
        out.append(_archived(espn_id, position, split))
    return out


def store(conn: Connection, season: int, week: int, at: datetime, projections: Sequence[ArchivedProjection]) -> int:
    rows: list[dict[str, object]] = [
        {
            "season": season,
            "week": week,
            "espn_id": p.espn_id,
            "read_at": at,
            "position": p.position,
            "applied_total": p.applied_total,
            "stats": dict(p.stats),
            "stamp": ARCHIVE_STAMP,
        }
        for p in projections
    ]
    return insert_ignoring_conflicts(conn, ESPN_KDEF_ARCHIVE_ROWS, rows) if rows else 0


@dataclass(frozen=True, slots=True)
class ArchiveWeek:
    season: int
    week: int
    kickers: int
    defenses: int
    written: int

    def line(self) -> str:
        return f"{self.season} week {self.week}: {self.kickers} kickers, {self.defenses} D/ST, {self.written} new rows"


def read_archive_week(conn: Connection, fetcher: Fetcher, season: int, week: int, now: datetime) -> ArchiveWeek:
    """One archived week, kept at `now`. A season outside `ARCHIVE_SEASONS` is refused before any request;
    a failed answer raises; a week listing no projection stores nothing."""
    if season not in ARCHIVE_SEASONS:
        raise ValueError(f"espn_kdef_archive reads only the judged seasons {ARCHIVE_SEASONS}; asked {season}")
    if not 1 <= week <= REGULAR_SEASON_WEEKS:
        raise ValueError(f"espn_kdef_archive: week must be 1..{REGULAR_SEASON_WEEKS}; got {week}")
    response = fetcher.get(pool_url(season, week), archive_headers(week))
    if not response.ok:
        raise RuntimeError(f"espn_kdef_archive: the player pool answered {response.status} for {season} week {week}")
    try:
        payload = json.loads(response.body)
    except ValueError as error:
        raise SchemaDriftError(f"espn_kdef_archive: the player pool answered no JSON: {error}") from error
    parsed = parse_archive(payload, season, week)
    written = store(conn, season, week, now, parsed)
    kickers = sum(1 for p in parsed if p.position == "K")
    return ArchiveWeek(season, week, kickers, len(parsed) - kickers, written)


def archived_weeks(conn: Connection) -> frozenset[tuple[int, int]]:
    """The season-weeks the archive already holds: each is read once, so a re-run skips them."""
    table = ESPN_KDEF_ARCHIVE_ROWS
    rows = conn.execute(select(table.c.season, table.c.week).distinct())
    return frozenset((int(season), int(week)) for season, week in rows)


def ingest_archive(conn: Connection, fetcher: Fetcher, now: datetime, checkpoint: Checkpoint) -> list[str]:
    """Every week of the judged seasons not yet held, one read each at `now`, durable after each week."""
    held = archived_weeks(conn)
    lines: list[str] = []
    for season in ARCHIVE_SEASONS:
        for week in range(1, REGULAR_SEASON_WEEKS + 1):
            if (season, week) in held:
                lines.append(f"{season} week {week}: held, not read again")
                continue
            lines.append(read_archive_week(conn, fetcher, season, week, now).line())
            checkpoint()
    return [*lines, f"stamp: {STAMP_CAVEAT}"]
