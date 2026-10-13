"""THE DEPTH PASS'S READS: each store read once for the whole board, never once per player.

Ported from `research-ts/src/capsules/facts/{depth-reads,harvest-captures}.ts` against the research
schema. Where the oracle's own read carries no ORDER BY, the consumer is order-insensitive (a map
keyed by week, a list sorted before use) or the key is unique, and the docstring says which.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.capsules.facts.depth_absence import CapturedDesignation, InjuryCapture
from research.capsules.facts.depth_context import AdpCapture, PedigreeRow, ScheduledGame, TeamMetricRow
from research.capsules.facts.depth_role import PlayerWeekShare, ScoringTally, TeamPlayerTargets
from research.capsules.facts.model import WeekPoints
from research.model.decide.slots import id_key
from research.model.domain import PPR_SCORING, Position, compute_fantasy_points, round_points
from research.model.instants import ms_instant
from research.model.preseason.availability_history import WeeklyInjuryReport, WeeklyRosterStatus
from research.model.reads.observations import (
    LAST_POSSIBLE_WEEK,
    ObservationQuery,
    WeekRange,
    Weeks,
    observations_as_of,
    stat_lines_for_live_surface,
)
from research.model.reads.teams import player_teams_as_of, team_observations_as_of
from research.pipeline.nflverse.participation import NflverseSource, ParticipationMetric
from research.pipeline.nflverse.pbp import PBP_PLAYER_SOURCE, PbpPlayerMetric
from research.pipeline.nflverse.team_eras import final_week_of
from research.pipeline.preseason.rosters import DEPTH_METRIC, DEPTH_SOURCE

DESIGNATION_SOURCES: Final = ("tank01_injuries_by_date", "tank01_injuries")
ROSTER_SWEEP_SOURCE: Final = "tank01_injuries"
ADP_HISTORY_SOURCE: Final = "ffc_adp_ppr_12"
_SCORING_FIELDS: Final = {
    PbpPlayerMetric.RED_ZONE_CARRIES: "red_zone_carries",
    PbpPlayerMetric.RED_ZONE_TARGETS: "red_zone_targets",
    PbpPlayerMetric.INSIDE_TEN_CARRIES: "inside_ten_carries",
    PbpPlayerMetric.INSIDE_TEN_TARGETS: "inside_ten_targets",
    PbpPlayerMetric.AIR_YARDS: "air_yards",
    PbpPlayerMetric.AIR_YARD_TARGETS: "air_yard_targets",
}


def season_key(player_id: str, season: int) -> str:
    return f"{player_id}|{season}"


def names_for(conn: Connection, ids: Sequence[str]) -> dict[str, str]:
    """`namesFor`: display names from the universe, by id."""
    if not ids:
        return {}
    rows = conn.execute(text("select id, name from research.players where id = any(:ids)"), {"ids": list(ids)})
    return {row.id: row.name for row in rows}


def injury_reports_for(
    conn: Connection, ids: Sequence[str], seasons: Sequence[int]
) -> dict[str, list[WeeklyInjuryReport]]:
    """`injuryReportsFor`, keyed `player|season`; one row per week (the key), so order is moot."""
    out: dict[str, list[WeeklyInjuryReport]] = {}
    if not ids or not seasons:
        return out
    rows = conn.execute(
        text(
            "select season, week, player_id, report_status, primary_injury from research.nflverse_injuries "
            "where player_id = any(:ids) and season = any(:seasons)"
        ),
        {"ids": list(ids), "seasons": list(seasons)},
    )
    for r in rows:
        out.setdefault(season_key(r.player_id, r.season), []).append(
            WeeklyInjuryReport(r.week, r.report_status, r.primary_injury)
        )
    return out


def roster_statuses_for(
    conn: Connection, ids: Sequence[str], seasons: Sequence[int]
) -> dict[str, list[WeeklyRosterStatus]]:
    """`rosterStatusesFor`, keyed `player|season`; one row per week (the key)."""
    out: dict[str, list[WeeklyRosterStatus]] = {}
    if not ids or not seasons:
        return out
    rows = conn.execute(
        text(
            "select season, week, player_id, status, status_detail from research.nflverse_roster_weeks "
            "where player_id = any(:ids) and season = any(:seasons)"
        ),
        {"ids": list(ids), "seasons": list(seasons)},
    )
    for r in rows:
        out.setdefault(season_key(r.player_id, r.season), []).append(
            WeeklyRosterStatus(r.week, r.status, r.status_detail)
        )
    return out


def week_scores_for(
    conn: Connection, season: int, positions: Mapping[str, Position], as_of: datetime
) -> dict[str, list[WeekPoints]]:
    """`weekScoresFor`: each player's PPR points by played week, in the store's line order."""
    out: dict[str, list[WeekPoints]] = {}
    if not positions:
        return out
    query = ObservationQuery(season, WeekRange(1, final_week_of(season)), as_of, None, tuple(positions))
    for row in stat_lines_for_live_surface(conn, query):
        position = positions.get(row.line.player_id)
        if position is not None:
            points = round_points(compute_fantasy_points(row.line, position, PPR_SCORING))
            out.setdefault(row.line.player_id, []).append(WeekPoints(row.line.week, points))
    return out


def _designations(source: str, payload: Any) -> dict[str, CapturedDesignation]:
    """`parseInjuryCapture`: the roster sweep's nested injury, or the by-date list's designation."""
    out: dict[str, CapturedDesignation] = {}
    if source == ROSTER_SWEEP_SOURCE:
        for team in payload if isinstance(payload, list) else []:
            roster = team.get("roster") if isinstance(team, dict) else None
            for player in roster if isinstance(roster, list) else []:
                entry: dict[str, Any] = player if isinstance(player, dict) else {}
                raw_injury = entry.get("injury")
                injury: dict[str, Any] = raw_injury if isinstance(raw_injury, dict) else {}
                player_id, designation = _text(entry.get("playerID")), _text(injury.get("designation"))
                if player_id is not None and designation is not None:
                    out[player_id] = CapturedDesignation(designation, _text(injury.get("description")))
        return out
    listed = payload.get("injList") if isinstance(payload, dict) else None
    for raw in listed if isinstance(listed, list) else []:
        entry = raw if isinstance(raw, dict) else {}
        player_id, designation = _text(entry.get("playerID")), _text(entry.get("designation"))
        if player_id is not None and designation is not None:
            out[player_id] = CapturedDesignation(designation, None)
    return out


def _text(value: object) -> str | None:
    """`asText`: a non-blank string, trimmed."""
    return value.strip() if isinstance(value, str) and value.strip() != "" else None


def injury_captures_for(conn: Connection, since: datetime, limit: int) -> list[InjuryCapture]:
    """`injuryCapturesFor`: the newest `limit` designation captures since `since`, oldest first."""
    rows = conn.execute(
        text(
            "select source, payload, captured_at from research.capture_snapshots where source = any(:sources) "
            "and captured_at >= :since order by captured_at desc limit :limit"
        ),
        {"sources": list(DESIGNATION_SOURCES), "since": since, "limit": limit},
    )
    return [InjuryCapture(ms_instant(r.captured_at), _designations(r.source, r.payload)) for r in reversed(list(rows))]


def latest_roster_colleges(conn: Connection) -> dict[str, str | None]:
    """`latestRosterBios`: the newest roster sweep's `school`, by the feed's player id.

    Keyed by the feed's id, and looked up by the universe id as the oracle looks it up, so the
    college (and the injury history, from the designation captures above) is always empty. Kept
    for the facts hash; the fix is ticketed in README.md, "Owed when the oracle retires"."""
    row = conn.execute(
        text(
            "select payload from research.capture_snapshots where source = :source order by captured_at desc, id asc limit 1"
        ),
        {"source": ROSTER_SWEEP_SOURCE},
    ).first()
    out: dict[str, str | None] = {}
    for team in row.payload if row is not None and isinstance(row.payload, list) else []:
        roster = team.get("roster") if isinstance(team, dict) else None
        for player in roster if isinstance(roster, list) else []:
            entry = player if isinstance(player, dict) else {}
            player_id = _text(entry.get("playerID"))
            if player_id is not None:
                out[player_id] = _text(entry.get("school"))
    return out


def pedigree_rows_for(conn: Connection, ids: Sequence[str], season: int) -> dict[str, PedigreeRow]:
    """`pedigreeRowsFor`: the newest roster biography this season or later, the universe's rookie
    season, and the draft pick (a player is picked once, so the pick map's order is moot)."""
    if not ids:
        return {}
    params = {"ids": list(ids), "season": season}
    biographies: dict[str, Any] = {}
    for r in conn.execute(
        text(
            "select player_id, birth_date, draft_year, draft_pick, draft_club from research.preseason_rosters "
            "where player_id = any(:ids) and season >= :season order by as_of desc"
        ),
        params,
    ):
        biographies.setdefault(r.player_id, r)
    rookie = {
        r.id: r.rookie_season
        for r in conn.execute(text("select id, rookie_season from research.players where id = any(:ids)"), params)
    }
    picks = {
        r.player_id: r
        for r in conn.execute(
            text("select player_id, round, pick, season from research.nfl_draft_picks where player_id = any(:ids)"),
            params,
        )
    }
    out: dict[str, PedigreeRow] = {}
    for player_id in ids:
        bio, pick = biographies.get(player_id), picks.get(player_id)
        out[player_id] = PedigreeRow(
            None if bio is None else bio.birth_date,
            _first(None if bio is None else bio.draft_year, None if pick is None else pick.season),
            _first(None if bio is None else bio.draft_pick, None if pick is None else pick.pick),
            None if bio is None else bio.draft_club,
            rookie.get(player_id),
            None if pick is None else pick.round,
        )
    return out


def _first[T](*values: T | None) -> T | None:
    """`a ?? b`."""
    return next((value for value in values if value is not None), None)


@dataclass(frozen=True, slots=True)
class DepthSlot:
    slot: float
    as_of: datetime


def depth_slots_for(conn: Connection, season: int, as_of: datetime) -> dict[str, DepthSlot]:
    """`depthSlotsFor`: week one's depth-chart slot per player."""
    rows = observations_as_of(conn, ObservationQuery(season, 1, as_of, DEPTH_SOURCE))
    return {row.player_id: DepthSlot(row.value, row.as_of) for row in rows if row.metric == DEPTH_METRIC}


def _share(metrics: Mapping[str, float], part: str, whole: str) -> float | None:
    numerator, denominator = metrics.get(part), metrics.get(whole)
    return None if numerator is None or denominator is None or denominator <= 0 else numerator / denominator


def weekly_shares_for(
    conn: Connection, season: int, ids: Sequence[str], as_of: datetime
) -> dict[str, list[PlayerWeekShare]]:
    """`weeklySharesFor`: each week's snap and target share for each subject."""
    out: dict[str, list[PlayerWeekShare]] = {}
    if not ids:
        return out
    window = WeekRange(1, LAST_POSSIBLE_WEEK)
    snaps = observations_as_of(conn, ObservationQuery(season, window, as_of, NflverseSource.SNAP_COUNTS, tuple(ids)))
    usage = observations_as_of(conn, ObservationQuery(season, window, as_of, NflverseSource.PLAYER_WEEK, tuple(ids)))
    by_week: dict[tuple[str, int], dict[str, float]] = {}
    for row in [*snaps, *usage]:
        by_week.setdefault((row.player_id, row.week), {})[row.metric] = row.value
    for (player_id, week), metrics in by_week.items():
        snap = _share(metrics, ParticipationMetric.OFFENSIVE_SNAPS, ParticipationMetric.TEAM_OFFENSIVE_SNAPS)
        target = _share(metrics, ParticipationMetric.TARGETS, ParticipationMetric.TEAM_TARGETS)
        if snap is not None or target is not None:
            out.setdefault(player_id, []).append(PlayerWeekShare(week, snap, target))
    return out


def season_targets_for(
    conn: Connection, season: int, ids: Sequence[str], as_of: datetime
) -> tuple[dict[str, TeamPlayerTargets], dict[str, str]]:
    """`seasonTargetsFor`: season targets and team targets per player, and each player's main team
    (the one he spent the most weeks on, ties by code)."""
    if not ids:
        return {}, {}
    window = WeekRange(1, LAST_POSSIBLE_WEEK)
    rows = observations_as_of(conn, ObservationQuery(season, window, as_of, NflverseSource.PLAYER_WEEK, tuple(ids)))
    totals: dict[str, list[float]] = {}
    for row in rows:
        if row.metric in (ParticipationMetric.TARGETS, ParticipationMetric.TEAM_TARGETS):
            entry = totals.setdefault(row.player_id, [0.0, 0.0])
            entry[0 if row.metric == ParticipationMetric.TARGETS else 1] += row.value
    weeks_by_team: dict[str, dict[str, int]] = {}
    for team_row in player_teams_as_of(conn, season, window, as_of):
        counts = weeks_by_team.setdefault(team_row.player_id, {})
        counts[team_row.team] = counts.get(team_row.team, 0) + 1
    team_of = {
        player_id: sorted(counts.items(), key=lambda kv: (-kv[1], id_key(kv[0])))[0][0]
        for player_id, counts in weeks_by_team.items()
    }
    targets = {player_id: TeamPlayerTargets(player_id, t[0], t[1]) for player_id, t in totals.items()}
    return targets, team_of


def scoring_tallies_for(conn: Connection, season: int, ids: Sequence[str], as_of: datetime) -> dict[str, ScoringTally]:
    """`scoringTalliesFor`: red-zone, inside-ten and air-yard counts from the play-by-play."""
    if not ids:
        return {}
    window = WeekRange(1, LAST_POSSIBLE_WEEK)
    rows = observations_as_of(conn, ObservationQuery(season, window, as_of, PBP_PLAYER_SOURCE, tuple(ids)))
    sums: dict[str, dict[str, float]] = {}
    for row in rows:
        field = _SCORING_FIELDS.get(row.metric)
        if field is not None:
            tally = sums.setdefault(row.player_id, dict.fromkeys(_SCORING_FIELDS.values(), 0.0))
            tally[field] += row.value
    return {player_id: ScoringTally(**tally) for player_id, tally in sums.items()}


def team_metric_rows_for(
    conn: Connection, season: int, week: Weeks, as_of: datetime, source: str | None = None
) -> dict[str, list[TeamMetricRow]]:
    """`teamMetricRowsFor`: every team observation in the window, by team, in the store's order."""
    out: dict[str, list[TeamMetricRow]] = {}
    for row in team_observations_as_of(conn, season, week, as_of, source):
        out.setdefault(row.team, []).append(TeamMetricRow(row.week, row.metric, row.value))
    return out


def scheduled_games_for(conn: Connection, season: int) -> list[ScheduledGame]:
    """`scheduledGamesFor`: the provider's fixtures for the product season (sorted by week before use)."""
    rows = conn.execute(
        text("select week, home_team, away_team from research.provider_games where season = :season"),
        {"season": season},
    )
    return [ScheduledGame(r.week, r.home_team, r.away_team) for r in rows]


def adp_history_for(conn: Connection, ids: Sequence[str], since: datetime) -> dict[str, list[AdpCapture]]:
    """`adpHistoryFor`: each subject's PPR ADP captures since `since` (sorted by time before use)."""
    out: dict[str, list[AdpCapture]] = {}
    if not ids:
        return out
    rows = conn.execute(
        text(
            "select player_id, adp, captured_at from research.adp_snapshots where player_id = any(:ids) "
            "and source = :source and captured_at >= :since"
        ),
        {"ids": list(ids), "source": ADP_HISTORY_SOURCE, "since": since},
    )
    for r in rows:
        out.setdefault(r.player_id, []).append(AdpCapture(r.adp, ms_instant(r.captured_at)))
    return out
