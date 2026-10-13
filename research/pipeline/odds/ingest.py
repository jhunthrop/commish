"""THE PROPS INGESTS: the live snapshot, the name resolution, and the historical backfill
(`src/projections/odds/{snapshot,player-map,backfill-plan}.ts`, `scripts/odds-props-backfill.ts`,
the props-preseason-snapshot job).

THE SNAPSHOT takes every event kicking off in the next fourteen days, earliest first, at most
twenty, and stores each one's two-sided lines under one fetched-at instant. THE RESOLUTION maps
every observed prop name to a universe player active that season, exact name first, a unique
first-initial-and-surname second, and never guesses between two. THE BACKFILL walks a season's
weeks, reading the historical archive eight hours before each week's first kickoff, skipping any
event already archived, and stops before it spends past its credit budget (`backfill.py`).
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final

from sqlalchemy import Connection, and_, select

from research.db.schema import PLAYER_PROP_OBSERVATIONS, PLAYERS, PROPS_PLAYER_MAP
from research.pipeline.crosswalk import comparable_name
from research.pipeline.http import Fetcher
from research.pipeline.jscompat import js_iso
from research.pipeline.observations import insert_ignoring_conflicts
from research.pipeline.odds.props import (
    ODDS_PARAMS,
    SPORT_KEY,
    CreditStatus,
    OddsEvent,
    get_json,
    odds_url,
    parse_event_odds_response,
    parse_odds_event,
    record_prop_observations,
)

LOG = logging.getLogger(__name__)
_WINDOW_DAYS = 14
_MAX_EVENTS_PER_RUN = 20
_SNAPSHOT_OFFSET_HOURS = 8
_WEEK_WINDOW_DAYS = 8


# --- the live snapshot ----------------------------------------------------------------------------


@dataclass(frozen=True)
class SnapshotSummary:
    total_events: int
    selected_events: int
    total_written: int
    total_skipped: int
    credits: CreditStatus


# A name needs a first and a last part to have a loose key.
_FIRST_AND_LAST: Final = 2
# January and February games belong to the season that kicked off the autumn before.
_LAST_MONTH_OF_PRIOR_SEASON: Final = 2


def select_upcoming_events(
    fetcher: Fetcher, api_key: str, now: datetime
) -> tuple[list[OddsEvent], list[OddsEvent], CreditStatus]:
    payload, credits = get_json(fetcher, odds_url(f"/sports/{SPORT_KEY}/events", api_key), "/events")
    if not isinstance(payload, list):
        raise ValueError("odds snapshot: /events response was not an array.")
    events = [parse_odds_event(raw, f"odds snapshot: /events[{i}]") for i, raw in enumerate(payload)]
    window_end = now + timedelta(days=_WINDOW_DAYS)
    upcoming = sorted((e for e in events if now <= e.commence_time <= window_end), key=lambda e: e.commence_time)
    return events, upcoming[:_MAX_EVENTS_PER_RUN], credits


def run_odds_snapshot(conn: Connection, fetcher: Fetcher, api_key: str, now: datetime) -> SnapshotSummary:
    """`runOddsSnapshot`: one fetched-at instant for every event of the run."""
    events, selected, credits = select_upcoming_events(fetcher, api_key, now)
    written = 0
    skipped = 0
    for event in selected:
        path = f"/sports/{SPORT_KEY}/events/{event.id}/odds"
        payload, credits = get_json(fetcher, odds_url(path, api_key, dict(ODDS_PARAMS)), f"/events/{event.id}/odds")
        parsed = parse_event_odds_response(payload, now)
        written += record_prop_observations(conn, parsed.observations)
        skipped += len(parsed.skipped)
    return SnapshotSummary(len(events), len(selected), written, skipped, credits)


# --- resolving prop names -------------------------------------------------------------------------


@dataclass(frozen=True)
class PropName:
    prop_name: str
    season: int


@dataclass(frozen=True)
class PlayerMapRow:
    prop_name: str
    season: int
    player_id: str
    method: str


def _loose_key(name: str) -> str | None:
    parts = comparable_name(name).split(" ")
    if len(parts) < _FIRST_AND_LAST:
        return None
    return f"{parts[0][:1]}|{parts[-1]}"


def season_of_kickoff(commence_time: datetime) -> int:
    """January and February belong to the season that started the previous autumn."""
    return commence_time.year - 1 if commence_time.month <= _LAST_MONTH_OF_PRIOR_SEASON else commence_time.year


def resolve_prop_names(
    prop_names: Sequence[PropName], candidates_by_season: dict[int, list[tuple[str, str]]]
) -> tuple[list[PlayerMapRow], list[tuple[PropName, str]]]:
    matched: list[PlayerMapRow] = []
    unmatched: list[tuple[PropName, str]] = []
    indexes: dict[int, tuple[dict[str, list[str]], dict[str, list[str]]]] = {}
    for entry in prop_names:
        if entry.season not in indexes:
            exact_index: dict[str, list[str]] = {}
            loose_index: dict[str, list[str]] = {}
            for player_id, name in candidates_by_season.get(entry.season, []):
                exact_index.setdefault(comparable_name(name), []).append(player_id)
                loose = _loose_key(name)
                if loose is not None:
                    loose_index.setdefault(loose, []).append(player_id)
            indexes[entry.season] = (exact_index, loose_index)
        exact_index, loose_index = indexes[entry.season]
        exact = exact_index.get(comparable_name(entry.prop_name), [])
        if len(exact) == 1:
            matched.append(PlayerMapRow(entry.prop_name, entry.season, exact[0], "exact"))
            continue
        if len(exact) > 1:
            unmatched.append((entry, "ambiguous"))
            continue
        loose_key = _loose_key(entry.prop_name)
        loose_ids = [] if loose_key is None else loose_index.get(loose_key, [])
        if len(loose_ids) == 1:
            matched.append(PlayerMapRow(entry.prop_name, entry.season, loose_ids[0], "loose"))
            continue
        unmatched.append((entry, "ambiguous" if len(loose_ids) > 1 else "not_found"))
    return matched, unmatched


def resolve_all_prop_names(conn: Connection) -> int:
    """`resolveAllPropNames`: every observed (name, season) archive-wide, idempotent."""
    seen: dict[str, PropName] = {}
    rows = conn.execute(select(PLAYER_PROP_OBSERVATIONS.c.player_name, PLAYER_PROP_OBSERVATIONS.c.commence_time))
    for name, commence in rows:
        season = season_of_kickoff(commence)
        seen.setdefault(f"{name}|{season}", PropName(name, season))
    observed = list(seen.values())
    candidates: dict[int, list[tuple[str, str]]] = {}
    for season in sorted({p.season for p in observed}):
        query = select(PLAYERS.c.id, PLAYERS.c.name).where(
            and_(PLAYERS.c.rookie_season <= season, PLAYERS.c.last_season >= season)
        )
        candidates[season] = [(r[0], r[1]) for r in conn.execute(query)]
    matched, _ = resolve_prop_names(observed, candidates)
    if not matched:
        return 0
    return insert_ignoring_conflicts(
        conn,
        PROPS_PLAYER_MAP,
        [{"prop_name": m.prop_name, "season": m.season, "player_id": m.player_id, "method": m.method} for m in matched],
    )


# --- the preseason job ----------------------------------------------------------------------------


@dataclass(frozen=True)
class KickoffGate:
    """When the job fired, for which season, and that season's first stored kickoff (None before
    the schedule is ingested)."""

    fired_at: datetime
    season: int
    first_kickoff: datetime | None


def run_props_preseason_snapshot(conn: Connection, fetcher: Fetcher, api_key: str, gate: KickoffGate) -> str:
    """The props-preseason-snapshot job: capture then resolve, both strictly before the first kickoff."""
    fired_at, season, first_kickoff = gate.fired_at, gate.season, gate.first_kickoff
    if first_kickoff is None:
        return f"{season} has no ingested schedule yet; skipping (no network call made)"
    if fired_at >= first_kickoff:
        return (
            f"{season} kicked off at {js_iso(first_kickoff)}; the pre-kickoff window is closed (no network call made)"
        )
    summary = run_odds_snapshot(conn, fetcher, api_key, fired_at)
    resolve_all_prop_names(conn)
    return f"fetched {summary.total_events} event(s), wrote {summary.total_written}"
