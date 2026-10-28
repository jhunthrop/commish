"""TANK01'S WEEKLY PROJECTION, CAPTURED DAILY AND PER KICKOFF SLOT, PARSED PER PLAYER (`tank01_projection_rows`).

The weekly round 4's prospective benchmark (preregistration §2.9, §3.3): the projection a paid
provider published for the week, read as it stood before each kickoff slot. The capture archive held
one snapshot (2026-09-09, week 1), because the projections feed was a daily feed of the full capture
pass and never of the hourly harvest. The harvest captures it in each slot's window (`kickoff_slots`),
and every stored snapshot not yet parsed is parsed into one row per player. Nothing is fetched for a
past week: the one earlier snapshot is parsed as stored.

THE WEEK AHEAD, ONCE A DAY (Lane 97, B68). The provider publishes a week's projection early in the
week, but the slot windows read it only from two hours before the week's first game, so from Tuesday
to Thursday night no screen had a projection and the register's Thursday 14:00 ET freeze kept none.
From 06:00 Eastern on the day after the previous week's last kickoff (a Tuesday after a Monday game)
until the week's first kickoff, the first harvest pass at or after 06:00 Eastern each day reads the
week ahead once (`daily_capture_due`): Tuesday's, Wednesday's and Thursday's snapshots of a Thursday
week, each stamped with its `captured_at` (a read whose payload equals the newest stored one writes no
snapshot, and the earlier one stands). The week ahead is the first week with a game still to come, read
from the stored kickoffs and never the calendar; once its first game kicks off, the slots take over.
A week with no earlier week stored (week 1), or a long gap (the week before the Super Bowl), opens at
most `DAILY_SPAN_DAYS` before its first kickoff's day, so the offseason reads nothing.

The payload is parsed strictly: a player entry without a position, a club or the three formats'
points is a changed feed, refused; a stat group the provider leaves out (a kicker's passing) is NULL.
Kickers are player entries (position "PK"). Team defenses are their own map with one figure for every
format, and become rows too (Lane 66d): position "DEF", the club as the team, the id `DEF-<club>`, the
one figure in all three points columns, every stat NULL. A snapshot parsed before defenses were kept
gains its defense rows on the next parse. Never an input to a fit. The site shows the points as the
week's published projection and never names the provider (Lane 66d).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from http import HTTPStatus
from typing import Final, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, text

from research.db.schema import CAPTURE_CHECKS, CAPTURE_SNAPSHOTS, TANK01_PROJECTION_ROWS
from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_is_finite, js_number
from research.pipeline.kickoff_slots import Slot, due_slot, kickoff_slots
from research.pipeline.kickoffs import TeamKickoff, stored_kickoffs, week_bounds
from research.pipeline.observations import insert_ignoring_conflicts
from research.pipeline.tank01.client import Tank01Error

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
    "where s.source = :source and not (s.payload ->> 'week' is not null "
    "and coalesce(jsonb_typeof(s.payload -> 'playerProjections'), '') = 'object' and s.payload -> 'playerProjections' = '{}'::jsonb "
    "and coalesce(s.payload -> 'teamDefenseProjections', '{}'::jsonb) = '{}'::jsonb) and (not exists "
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
# Read since an instant: the feed was read since then (captured or unchanged, `capture_checks`) and the
# newest stored snapshot is the week's, so a read of another week never counts.
_READ_SINCE: Final = text(
    f"select exists (select 1 from {CAPTURE_CHECKS.fullname} where source = :source and checked_at >= :since) "
    f"and coalesce((select payload ->> 'week' from {CAPTURE_SNAPSHOTS.fullname} where source = :source "
    "order by captured_at desc, id desc limit 1) = :week, false)"
)


def _read_since(conn: Connection, week: int, since: datetime) -> bool:
    params = {"source": PROJECTIONS_SOURCE, "since": since, "week": str(week)}
    return bool(conn.execute(_READ_SINCE, params).scalar_one())


def projection_slot_due(conn: Connection, season: int, now: datetime) -> Slot | None:
    """The kickoff slot whose window holds `now`, unless its projection was already read in it."""
    return _slot_due(conn, stored_kickoffs(conn, season), now)


def _slot_due(conn: Connection, kickoffs: Sequence[TeamKickoff], now: datetime) -> Slot | None:
    """A snapshot captured in the window, or a read in it that matched the newest stored snapshot of the
    slot's week (unchanged since the morning's daily read), is the slot's read."""
    slot = due_slot(kickoff_slots(kickoffs), now)
    if slot is None:
        return None
    captured = conn.execute(_CAPTURED_SINCE, {"source": PROJECTIONS_SOURCE, "since": slot.opens}).scalar_one()
    return None if captured or _read_since(conn, slot.week, slot.opens) else slot


# The daily read of the week ahead: from 06:00 Eastern, so it stands before the register's Thursday
# 14:00 ET freeze, and at most six days before the week's first kickoff day.
DAILY_FROM: Final = time(6)
DAILY_SPAN_DAYS: Final = 6
_EASTERN: Final = ZoneInfo("America/New_York")


@dataclass(frozen=True, slots=True)
class DailyCapture:
    """The week ahead's read due today: its week, and today's 06:00 Eastern, since when a read counts."""

    week: int
    since: datetime


def _daily_open(day: date) -> datetime:
    return datetime.combine(day, DAILY_FROM, tzinfo=_EASTERN)


def daily_capture_due(kickoffs: Sequence[TeamKickoff], now: datetime) -> DailyCapture | None:
    """The week ahead, if its daily read is due at `now`: the first week with a game still to come,
    while none of its games has kicked off, from 06:00 Eastern on the day after the previous week's
    last kickoff (or `DAILY_SPAN_DAYS` before its first kickoff's day, the later), and from 06:00
    Eastern each day."""
    bounds = week_bounds(list(kickoffs))
    ahead = [week for week, (_first, last) in bounds.items() if last > now]
    if not ahead:
        return None
    week = min(ahead)
    if bounds[week][0] <= now:
        return None
    today = _daily_open(now.astimezone(_EASTERN).date())
    return DailyCapture(week, today) if now >= max(daily_opens(bounds, week), today) else None


def daily_opens(bounds: Mapping[int, tuple[datetime, datetime]], week: int) -> datetime:
    """When the week ahead's daily read first opens: 06:00 Eastern on the day after the previous week's last
    kickoff, or `DAILY_SPAN_DAYS` before its first kickoff's day, the later (the week reads' roll-over waits
    for it, `capsules.week.rollover`)."""
    opens_on = bounds[week][0].astimezone(_EASTERN).date() - timedelta(days=DAILY_SPAN_DAYS)
    earlier = [last for w, (_first, last) in bounds.items() if w < week]
    if earlier:
        opens_on = max(opens_on, max(earlier).astimezone(_EASTERN).date() + timedelta(days=1))
    return _daily_open(opens_on)


@dataclass(frozen=True, slots=True)
class ProjectionRead:
    """The week a harvest pass reads, and whether it is the week ahead's daily read (whose
    not-yet-published answer is no failure) rather than a slot's (where it is one)."""

    week: int
    ahead: bool


def projection_week_due(conn: Connection, season: int, now: datetime) -> ProjectionRead | None:
    """The week whose projection this harvest pass reads, if any: the kickoff slot's week in its window
    not yet read, else the week ahead once a day."""
    kickoffs = stored_kickoffs(conn, season)
    slot = _slot_due(conn, kickoffs, now)
    if slot is not None:
        return ProjectionRead(slot.week, ahead=False)
    daily = daily_capture_due(kickoffs, now)
    if daily is None or _read_since(conn, daily.week, daily.since):
        return None
    return ProjectionRead(daily.week, ahead=True)


ProjectionAnswer = Literal["unpublished", "empty"]


def projection_answer(answer: object) -> ProjectionAnswer | None:
    """What the provider's answer for a week says before any parse, or None for a payload to store and
    parse. "unpublished": a 404, an `error` envelope (a `Tank01Error`), or the week with its player map
    present and empty, the provider's way of saying it has not published the week yet. "empty": a body
    of nothing (`{}`, `[]`, `""`, null). A missing player map or any other shape is neither: it is
    stored and the strict parser refuses it, the feed's drift made loud."""
    if isinstance(answer, Tank01Error):
        published = not (answer.kind == "upstream" and answer.status in (HTTPStatus.NOT_FOUND, HTTPStatus.OK))
        return None if published else "unpublished"
    if answer is None or (isinstance(answer, str | list | dict) and len(answer) == 0):
        return "empty"
    if isinstance(answer, dict) and "week" in answer and "playerProjections" in answer:
        return "unpublished" if answer["playerProjections"] in ("", [], {}) else None
    return None
