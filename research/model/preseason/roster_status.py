"""WHO IS ACTUALLY ON A ROSTER: the resolved current status every board gates on.

Ported from `research-ts/src/projections/preseason/{roster-status,roster-status-read,current-status}.ts`
and the reading half of `depth-read.ts`'s `depthChartStatuses`. The provider's captures win, then
the week-one nflverse roster, then the depth chart.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.instants import js_iso, ms_instant
from research.model.preseason.adjustments import depth_chart_listed_at

_CAPPED: Final = frozenset(("injured_reserve", "pup", "nfi", "suspended", "exempt"))
_EXCLUDED: Final = frozenset(("practice_squad", "off_active_roster", "no_roster", "retired"))
_NUMBERED_EXEMPTION: Final = re.compile(r"^E\d{2}$")
_RESERVE_DETAIL_CODES: Final = {
    "R01": ("injured_reserve", None),
    "R48": ("injured_reserve", "designated_to_return"),
    "R04": ("pup", None),
    "R05": ("nfi", None),
    "R06": ("nfi", None),
    "R27": ("nfi", None),
    "R40": ("suspended", "suspended_term"),
    "R30": ("suspended", "suspended_indefinite"),
    "R33": ("suspended", "suspended_club"),
}
_SIMPLE_CODES: Final = {
    "ACT": "active",
    "INA": "active",
    "PUP": "pup",
    "NON": "nfi",
    "EXE": "exempt",
    "DEV": "practice_squad",
    "CUT": "no_roster",
    "RET": "retired",
}
SWEEP_CLUB_COUNT: Final = 32
SWEEP_MINIMUM_CLUB_SIZE: Final = {"cutdown": 45, "in_season": 40}
_SWEEP_FEED: Final = "tank01_injuries"
_PLAYER_LIST_FEED: Final = "tank01_player_list"
_DESIGNATION_RULES: Final = (
    (re.compile(r"injured reserve", re.IGNORECASE), "injured_reserve"),
    (re.compile(r"physically unable|\bPUP\b", re.IGNORECASE), "pup"),
    (re.compile(r"non-?football|\bNFI\b", re.IGNORECASE), "nfi"),
    (re.compile(r"suspen", re.IGNORECASE), "suspended"),
    (re.compile(r"exempt", re.IGNORECASE), "exempt"),
)
_DESIGNATED_TO_RETURN: Final = re.compile(r"designated (?:to|for) return", re.IGNORECASE)
_OUT: Final = re.compile(r"^out$", re.IGNORECASE)
_UNAVAILABLE_WORDS: Final = frozenset(("out", "injured reserve"))


@dataclass(frozen=True, slots=True)
class CurrentRosterStatus:
    kind: str
    source: str
    observed_at: datetime
    team: str | None
    detail: str | None


def is_capped_roster_status(kind: str) -> bool:
    return kind in _CAPPED


def is_excluded_roster_status(kind: str) -> bool:
    return kind in _EXCLUDED


def roster_status_from_nflverse_row(code: str, status_detail: str) -> tuple[str, str | None] | None:
    """`rosterStatusFromNflverseRow`: (kind, detail), or None for a code with no meaning here."""
    normalised = code.strip().upper()
    detail = status_detail.strip().upper()
    if _NUMBERED_EXEMPTION.search(normalised):
        return "exempt", None
    if normalised == "RES":
        return _RESERVE_DETAIL_CODES.get(detail, ("injured_reserve", None))
    if normalised == "SUS":
        named = _RESERVE_DETAIL_CODES.get(detail)
        return "suspended", named[1] if named is not None and named[0] == "suspended" else None
    kind = _SIMPLE_CODES.get(normalised)
    return None if kind is None else (kind, None)


@dataclass(frozen=True, slots=True)
class Tank01Listing:
    team: str | None
    is_free_agent: bool
    designation: str | None


@dataclass(frozen=True, slots=True)
class RosterSweep:
    members_by_espn_id: Mapping[str, tuple[str, str | None]]
    club_count: int
    smallest_club: int | None
    captured_at: datetime
    complete: bool


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() != "" else None


def _espn_id(player: dict[str, Any]) -> str | None:
    return _text(player.get("espnID")) or _text(player.get("playerID"))


def read_active_roster_sweep(payload: Any) -> tuple[dict[str, tuple[str, str | None]], int, int | None]:
    """`readActiveRosterSweep`: (members by ESPN id, clubs, smallest club)."""
    members: dict[str, tuple[str, str | None]] = {}
    clubs = 0
    smallest: int | None = None
    if not isinstance(payload, list):
        return members, clubs, smallest
    for raw_team in payload:
        club = _record(raw_team)
        team = _text(club.get("team"))
        roster = club.get("roster")
        if team is None or not isinstance(roster, list):
            continue
        clubs += 1
        named = 0
        for raw_player in roster:
            player = _record(raw_player)
            espn_id = _espn_id(player)
            if espn_id is None:
                continue
            members[espn_id] = (team, _text(_record(player.get("injury")).get("designation")))
            named += 1
        smallest = named if smallest is None else min(smallest, named)
    return members, clubs, smallest


def read_player_listings(payload: Any) -> dict[str, Tank01Listing]:
    """`readPlayerListings`."""
    out: dict[str, Tank01Listing] = {}
    if not isinstance(payload, list):
        return out
    for raw_player in payload:
        player = _record(raw_player)
        espn_id = _espn_id(player)
        if espn_id is None:
            continue
        free_agent = _text(player.get("isFreeAgent"))
        out[espn_id] = Tank01Listing(
            _text(player.get("team")),
            free_agent is not None and free_agent.lower() == "true",
            _text(_record(player.get("injury")).get("designation")),
        )
    return out


def _reserve_kind(designation: str | None) -> str | None:
    if designation is None:
        return None
    return next((kind for pattern, kind in _DESIGNATION_RULES if pattern.search(designation)), None)


def _reserve_detail(designation: str | None) -> str | None:
    return "designated_to_return" if designation is not None and _DESIGNATED_TO_RETURN.search(designation) else None


def _active_detail(designation: str | None) -> str | None:
    return "out" if designation is not None and _OUT.search(designation.strip()) else None


def current_status_from_tank01(
    espn_id: str, sweep: RosterSweep | None, listing: Tank01Listing | None, list_at: datetime | None
) -> CurrentRosterStatus | None:
    """`currentStatusFromTank01`."""
    listed = listing is not None and list_at is not None
    reserve_kind = _reserve_kind(listing.designation) if listed and listing is not None else None
    member = None if sweep is None else sweep.members_by_espn_id.get(espn_id)
    list_wins = listed and list_at is not None and (sweep is None or list_at >= sweep.captured_at)
    if reserve_kind is not None and list_wins and listing is not None and list_at is not None:
        return CurrentRosterStatus(
            reserve_kind, "tank01_player_list", list_at, listing.team, _reserve_detail(listing.designation)
        )
    if sweep is not None and member is not None:
        designation = listing.designation if list_wins and listing is not None else member[1]
        return CurrentRosterStatus(
            "active", "tank01_roster_sweep", sweep.captured_at, member[0], _active_detail(designation)
        )
    if not listed or listing is None or list_at is None:
        return None
    if reserve_kind is not None:
        return CurrentRosterStatus(
            reserve_kind, "tank01_player_list", list_at, listing.team, _reserve_detail(listing.designation)
        )
    if listing.is_free_agent:
        return CurrentRosterStatus("no_roster", "tank01_player_list", list_at, None, None)
    if listing.team is not None and sweep is not None and sweep.complete:
        return CurrentRosterStatus("off_active_roster", "tank01_player_list", list_at, listing.team, None)
    return None


def roster_status_reason(status: CurrentRosterStatus) -> dict[str, Any]:
    """`rosterStatusReason`, as the board stores it."""
    return {
        "code": "roster_status",
        "status": status.kind,
        "source": status.source,
        "observedAt": js_iso(status.observed_at),
        "team": status.team,
    }


def _newest_capture(conn: Connection, source: str, as_of: datetime) -> tuple[datetime, Any] | None:
    row = conn.execute(
        text(
            "select captured_at, payload from research.capture_snapshots where source = :source and captured_at <= :as_of "
            "order by captured_at desc, id desc limit 1"
        ),
        {"source": source, "as_of": as_of},
    ).first()
    return None if row is None else (ms_instant(row.captured_at), row.payload)


def tank01_ids_for(conn: Connection, player_ids: Sequence[str]) -> dict[str, list[str]]:
    """`tank01IdsFor`: the ESPN id first, then every provider id the crosswalk maps to him."""
    out: dict[str, list[str]] = {}
    for row in conn.execute(
        text("select id, espn_id from research.players where id = any(:ids)"), {"ids": list(player_ids)}
    ):
        if row.espn_id is not None:
            out[row.id] = [row.espn_id]
    crosswalk = conn.execute(
        text("select player_id, provider_player_id from research.player_crosswalk where player_id = any(:ids)"),
        {"ids": list(player_ids)},
    )
    for row in crosswalk:
        held = out.get(row.player_id, [])
        if row.provider_player_id not in held:
            out[row.player_id] = [*held, row.provider_player_id]
    return out


@dataclass(frozen=True, slots=True)
class HarvestReads:
    sweep: RosterSweep | None
    listings: Mapping[str, Tank01Listing]
    list_at: datetime | None


def harvest_reads(conn: Connection, as_of: datetime, phase: str) -> HarvestReads:
    """`harvestReads`: the newest sweep and player list at the instant."""
    sweep_capture = _newest_capture(conn, _SWEEP_FEED, as_of)
    list_capture = _newest_capture(conn, _PLAYER_LIST_FEED, as_of)
    sweep = None
    if sweep_capture is not None:
        members, clubs, smallest = read_active_roster_sweep(sweep_capture[1])
        complete = clubs == SWEEP_CLUB_COUNT and smallest is not None and smallest >= SWEEP_MINIMUM_CLUB_SIZE[phase]
        sweep = RosterSweep(members, clubs, smallest, sweep_capture[0], complete)
    listings = {} if list_capture is None else read_player_listings(list_capture[1])
    return HarvestReads(sweep, listings, None if list_capture is None else list_capture[0])


def _week_one_statuses(
    conn: Connection, season: int, player_ids: Sequence[str], stamped_at: datetime
) -> dict[str, CurrentRosterStatus]:
    out: dict[str, CurrentRosterStatus] = {}
    rows = conn.execute(
        text(
            "select player_id, team, status, status_detail from research.nflverse_roster_weeks "
            "where season = :season and week = 1 and player_id = any(:ids)"
        ),
        {"season": season, "ids": list(player_ids)},
    )
    for row in rows:
        read = roster_status_from_nflverse_row(row.status, row.status_detail)
        if read is not None:
            out[row.player_id] = CurrentRosterStatus(read[0], "nflverse_roster_week_1", stamped_at, row.team, read[1])
    return out


def _week_one_ruled_out(conn: Connection, season: int, as_of: datetime, player_ids: Sequence[str]) -> set[str]:
    rows = conn.execute(
        text(
            "select player_id, report_status from research.nflverse_injuries where season = :season and week = 1 "
            "and player_id = any(:ids) and date_modified is not null and date_modified <= :as_of"
        ),
        {"season": season, "ids": list(player_ids), "as_of": as_of},
    )
    return {row.player_id for row in rows if row.report_status.strip().lower() in _UNAVAILABLE_WORDS}


@dataclass(frozen=True, slots=True)
class CurrentStatusRead:
    statuses: dict[str, CurrentRosterStatus]
    sweep: RosterSweep | None


def current_statuses_as_of(
    conn: Connection, season: int, as_of: datetime, player_ids: Sequence[str], week_one_stamped_at: datetime, phase: str
) -> CurrentStatusRead:
    """`currentStatusesAsOf`."""
    if not player_ids:
        return CurrentStatusRead({}, None)
    tank01 = tank01_ids_for(conn, player_ids)
    harvest = harvest_reads(conn, as_of, phase)
    week_one = _week_one_statuses(conn, season, player_ids, week_one_stamped_at)
    listed_at = depth_chart_listed_at(conn, season, as_of, player_ids)
    ruled_out = _week_one_ruled_out(conn, season, as_of, player_ids)
    statuses: dict[str, CurrentRosterStatus] = {}
    for player_id in player_ids:
        status: CurrentRosterStatus | None = None
        for espn_id in tank01.get(player_id, []):
            status = current_status_from_tank01(espn_id, harvest.sweep, harvest.listings.get(espn_id), harvest.list_at)
            if status is not None:
                break
        if status is None:
            status = week_one.get(player_id)
        if status is None and player_id in listed_at:
            status = CurrentRosterStatus("active", "depth_chart", listed_at[player_id], None, None)
        if status is None:
            continue
        if player_id in ruled_out and status.kind == "active" and status.detail is None:
            status = replace(status, detail="out")
        statuses[player_id] = status
    return CurrentStatusRead(statuses, harvest.sweep)
