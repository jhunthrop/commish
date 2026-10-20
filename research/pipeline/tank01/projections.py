"""TANK01'S WEEKLY PROJECTION, CAPTURED PER KICKOFF SLOT AND PARSED PER PLAYER (`tank01_projection_rows`).

The weekly round 4's prospective benchmark (preregistration §2.9, §3.3): the projection a paid
provider published for the week, read as it stood before each kickoff slot. The capture archive held
one snapshot (2026-09-09, week 1), because the projections feed was a daily feed of the full capture
pass and never of the hourly harvest. The harvest now captures it in each slot's window
(`kickoff_slots`), and every stored snapshot not yet parsed is parsed into one row per player. Nothing
is fetched for a past week: the one earlier snapshot is parsed as stored.

The payload is parsed strictly: a player entry without a position, a club or the three formats'
points is a changed feed, refused; a stat group the provider leaves out (a kicker's passing) is NULL.
Kickers are player entries (position "PK"). Team defenses are their own map with one figure for every
format, and become rows too (Lane 66d): position "DEF", the club as the team, the id `DEF-<club>`, the
one figure in all three points columns, every stat NULL. A snapshot parsed before defenses were kept
gains its defense rows on the next parse. Never an input to a fit. The site shows the points as the
week's published projection and never names the provider (Lane 66d).
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.db.schema import CAPTURE_SNAPSHOTS, TANK01_PROJECTION_ROWS
from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_is_finite, js_number
from research.pipeline.kickoff_slots import Slot, due_slot, kickoff_slots
from research.pipeline.kickoffs import stored_kickoffs
from research.pipeline.observations import insert_ignoring_conflicts

PROJECTIONS_SOURCE: Final = "tank01_projections"
_POINTS: Final = (("ppr_points", "PPR"), ("half_points", "halfPPR"), ("standard_points", "standard"))
_STATS: Final = (
    ("pass_yards", "Passing", "passYds"),
    ("pass_touchdowns", "Passing", "passTD"),
    ("interceptions", "Passing", "int"),
    ("carries", "Rushing", "carries"),
    ("rush_yards", "Rushing", "rushYds"),
    ("rush_touchdowns", "Rushing", "rushTD"),
    ("targets", "Receiving", "targets"),
    ("receptions", "Receiving", "receptions"),
    ("receiving_yards", "Receiving", "recYds"),
    ("receiving_touchdowns", "Receiving", "recTD"),
)


def _number(raw: object, where: str) -> float:
    value = js_number(raw) if isinstance(raw, str) else float("nan")
    if not js_is_finite(value):
        raise SchemaDriftError(f"{PROJECTIONS_SOURCE}: {where} is {raw!r}, not a number; the feed changed.")
    return value


def _optional(raw: object, where: str) -> float | None:
    return None if raw is None or raw == "" else _number(raw, where)


def _object(raw: object, where: str) -> Mapping[str, object]:
    if not isinstance(raw, dict):
        raise SchemaDriftError(f"{PROJECTIONS_SOURCE}: {where} is not an object; the feed changed.")
    return raw


def _text(raw: object, where: str) -> str:
    if not isinstance(raw, str) or raw == "":
        raise SchemaDriftError(f"{PROJECTIONS_SOURCE}: {where} is missing; the feed changed.")
    return raw


def _player_row(player_id: str, raw: object, snapshot: int, captured_at: datetime) -> dict[str, object]:
    where = f"playerProjections.{player_id}"
    entry = _object(raw, where)
    points = _object(entry.get("fantasyPointsDefault"), f"{where}.fantasyPointsDefault")
    row: dict[str, object] = {
        "snapshot_id": snapshot,
        "provider_player_id": _text(entry.get("playerID"), f"{where}.playerID"),
        "captured_at": captured_at,
        "position": _text(entry.get("pos"), f"{where}.pos"),
        "team": _text(entry.get("team"), f"{where}.team"),
    }
    for column, key in _POINTS:
        row[column] = _number(points.get(key), f"{where}.fantasyPointsDefault.{key}")
    for column, group, key in _STATS:
        stats = entry.get(group)
        row[column] = (
            None if stats is None else _optional(_object(stats, f"{where}.{group}").get(key), f"{where}.{group}.{key}")
        )
    row["fumbles_lost"] = _optional(entry.get("fumblesLost"), f"{where}.fumblesLost")
    return row


DEFENSE_POSITION: Final = "DEF"
_STAT_COLUMNS: Final = (*(column for column, _, _ in _STATS), "fumbles_lost")


def defense_player_id(club: str) -> str:
    """A team defense's id in the rows: the provider gives a defense no player id."""
    return f"{DEFENSE_POSITION}-{club}"


def _defense_row(team_id: str, raw: object, snapshot: int, captured_at: datetime) -> dict[str, object]:
    where = f"teamDefenseProjections.{team_id}"
    entry = _object(raw, where)
    club = _text(entry.get("teamAbv"), f"{where}.teamAbv")
    points = _number(entry.get("fantasyPointsDefault"), f"{where}.fantasyPointsDefault")
    return {
        "snapshot_id": snapshot,
        "provider_player_id": defense_player_id(club),
        "captured_at": captured_at,
        "position": DEFENSE_POSITION,
        "team": club,
        **{column: points for column, _ in _POINTS},
        **dict.fromkeys(_STAT_COLUMNS),
    }


def parse_projection_snapshot(payload: object, snapshot: int, captured_at: datetime) -> list[dict[str, object]]:
    """One snapshot's rows: every player, kickers among them, then every team defense. A payload
    without the defense map has no defense rows."""
    root = _object(payload, "payload")
    season = int(_number(root.get("season"), "season"))
    week = int(_number(root.get("week"), "week"))
    players = _object(root.get("playerProjections"), "playerProjections")
    rows = [_player_row(pid, raw, snapshot, captured_at) for pid, raw in players.items()]
    raw_defenses = root.get("teamDefenseProjections")
    defenses = {} if raw_defenses is None else _object(raw_defenses, "teamDefenseProjections")
    rows += [_defense_row(tid, raw, snapshot, captured_at) for tid, raw in defenses.items()]
    return [{**row, "season": season, "week": week} for row in rows]


# A snapshot with no rows, or one whose payload has defenses its rows lack (parsed before defenses were
# kept): parsing it again inserts only the rows it lacks.
_UNPARSED: Final = text(
    f"select s.id, s.captured_at, s.payload from {CAPTURE_SNAPSHOTS.fullname} s "
    "where s.source = :source and (not exists "
    f"(select 1 from {TANK01_PROJECTION_ROWS.fullname} r where r.snapshot_id = s.id) "
    "or (jsonb_typeof(s.payload -> 'teamDefenseProjections') = 'object' "
    "and s.payload -> 'teamDefenseProjections' <> '{}'::jsonb and not exists "
    f"(select 1 from {TANK01_PROJECTION_ROWS.fullname} r where r.snapshot_id = s.id "
    "and r.position = :defense))) order by s.id"
)


@dataclass(frozen=True, slots=True)
class ParseReport:
    snapshots: int
    rows: int
    # Each refused snapshot's id and why: left unparsed, its line failed, the rest still parsed.
    refused: tuple[str, ...] = ()

    def line(self) -> str:
        head = f"projections-parse: {self.snapshots} snapshots, {self.rows} player rows"
        return head if not self.refused else f"{head}; FAILED, refused {'; '.join(self.refused)}"


def parse_stored_projections(conn: Connection) -> ParseReport:
    """Every stored projections snapshot with no rows yet, each in its own savepoint: a refused one is
    named and left unparsed, and never undoes another."""
    snapshots = rows = 0
    refused: list[str] = []
    for stored in conn.execute(_UNPARSED, {"source": PROJECTIONS_SOURCE, "defense": DEFENSE_POSITION}).all():
        try:
            with conn.begin_nested():
                parsed = parse_projection_snapshot(stored.payload, int(stored.id), stored.captured_at)
                rows += insert_ignoring_conflicts(conn, TANK01_PROJECTION_ROWS, parsed)
            snapshots += 1
        except SchemaDriftError as error:
            refused.append(f"snapshot {stored.id}: {error}")
    return ParseReport(snapshots, rows, tuple(refused))


_CAPTURED_SINCE: Final = text(
    f"select exists (select 1 from {CAPTURE_SNAPSHOTS.fullname} where source = :source and captured_at >= :since)"
)


def projection_slot_due(conn: Connection, season: int, now: datetime) -> Slot | None:
    """The kickoff slot whose window holds `now`, unless a projections snapshot already stands in it."""
    slot = due_slot(kickoff_slots(stored_kickoffs(conn, season)), now)
    if slot is None:
        return None
    captured = conn.execute(_CAPTURED_SINCE, {"source": PROJECTIONS_SOURCE, "since": slot.opens}).scalar_one()
    return None if captured else slot
