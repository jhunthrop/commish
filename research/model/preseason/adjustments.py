"""THE PER-PLAYER CORRECTIONS A PRESEASON BOARD APPLIES TO LAYER 1 AND THE COMPOSED LINE.

Ported from `research-ts/src/projections/preseason/{career,depth,depth-read,offseason}.ts` and
`features/redistribution.ts`: the career-stage curve, the published week-one depth chart, and the
offseason's arrivals and departures redistributed over the returning roster.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from types import MappingProxyType
from typing import Final, Literal

from sqlalchemy import Connection

from research.model.domain import STAT_FIELDS, Position, StatLine
from research.model.jsmath import js_max, js_min
from research.model.reads.observations import ObservationQuery, observations_as_of
from research.model.weekly.opportunity import PredictedOpportunity, clamp_share

ExperienceBand = Literal["year1", "year2", "year3", "year4to6", "year7plus"]
EXPERIENCE_BANDS: Final[tuple[ExperienceBand, ...]] = ("year1", "year2", "year3", "year4to6", "year7plus")


def experience_band_for(season: int, entry_year: int | None) -> ExperienceBand | None:
    """`experienceBandFor`."""
    if entry_year is None:
        return None
    seasons = season - entry_year + 1
    if seasons < 1:
        return None
    if seasons <= 3:  # noqa: PLR2004 - the first three bands are one season each
        return EXPERIENCE_BANDS[seasons - 1]
    return "year4to6" if seasons <= 6 else "year7plus"  # noqa: PLR2004 - the band's own bound


@dataclass(frozen=True, slots=True)
class CareerPriors:
    by_experience: Mapping[Position, Mapping[ExperienceBand, float]]
    bound: float


def _bounded_multiplier(raw: float | None, bound: float) -> float:
    if raw is None or not (raw > 0) or raw == float("inf"):
        return 1.0
    return js_min(1 + bound, js_max(1 / (1 + bound), raw))


def career_multiplier(position: Position, band: ExperienceBand | None, priors: CareerPriors) -> float:
    """`careerMultiplier`."""
    if band is None:
        return 1.0
    cells = priors.by_experience.get(position)
    return _bounded_multiplier(None if cells is None else cells.get(band), priors.bound)


def apply_career_stage(
    line: StatLine, position: Position, band: ExperienceBand | None, priors: CareerPriors
) -> StatLine:
    """`applyCareerStage`: every counted stat times the band's bounded multiplier."""
    multiplier = career_multiplier(position, band, priors)
    if multiplier == 1:
        return line
    return replace(line, **{name: getattr(line, name) * multiplier for name in STAT_FIELDS})


NEUTRAL_CAREER_PRIORS: Final = CareerPriors(
    MappingProxyType(
        {
            position: MappingProxyType(dict.fromkeys(EXPERIENCE_BANDS, 1.0))
            for position in ("QB", "RB", "WR", "TE", "K", "DEF")
        }
    ),
    0.35,
)

# --- the depth chart ----------------------------------------------------------------------------

DEPTH_SOURCE: Final = "nflverse_depth_charts"
DEPTH_METRIC: Final = "depth_team"
DepthRank = Literal["first", "second", "third", "offChart"]
DEPTH_RANKS: Final[tuple[DepthRank, ...]] = ("first", "second", "third", "offChart")
DepthChart = Mapping[str, DepthRank]
_WEEK_ONE: Final = 1


def depth_rank_for(depth_team: float | None) -> DepthRank:
    """`depthRankFor`."""
    if depth_team is None:
        return "offChart"
    if depth_team <= 1:
        return "first"
    if depth_team == 2:  # noqa: PLR2004 - the second string
        return "second"
    return "third"


@dataclass(frozen=True, slots=True)
class DepthPriors:
    by_snap_share: Mapping[Position, Mapping[DepthRank, float]]
    bound: float


def depth_multiplier(position: Position, rank: DepthRank, priors: DepthPriors) -> float:
    """`depthMultiplier`."""
    cells = priors.by_snap_share.get(position)
    return _bounded_multiplier(None if cells is None else cells.get(rank), priors.bound)


def apply_depth_chart(
    opportunity: Mapping[str, PredictedOpportunity],
    chart: DepthChart,
    positions: Mapping[str, Position],
    priors: DepthPriors,
) -> dict[str, PredictedOpportunity]:
    """`applyDepthChart`: every share times the player's chart multiplier, clamped to [0, 1]."""
    out: dict[str, PredictedOpportunity] = {}
    for player_id, player in opportunity.items():
        position = positions.get(player_id)
        if position is None:
            out[player_id] = player
            continue
        multiplier = depth_multiplier(position, chart.get(player_id, "offChart"), priors)
        out[player_id] = replace(
            player,
            snap_share=clamp_share(player.snap_share * multiplier),
            target_share=clamp_share(player.target_share * multiplier),
            carry_share=clamp_share(player.carry_share * multiplier),
            pass_attempt_share=clamp_share(player.pass_attempt_share * multiplier),
        )
    return out


def depth_chart_as_of(conn: Connection, season: int, as_of: datetime) -> dict[str, DepthRank]:
    """`depthChartAsOf`: the week-one chart as it stood at the instant."""
    rows = observations_as_of(conn, ObservationQuery(season, _WEEK_ONE, as_of, DEPTH_SOURCE))
    return {row.player_id: depth_rank_for(row.value) for row in rows if row.metric == DEPTH_METRIC}


def depth_chart_listed_at(
    conn: Connection, season: int, as_of: datetime, player_ids: Sequence[str]
) -> dict[str, datetime]:
    """The half of `depthChartStatuses` that reads: when each player's latest listing was stamped.
    The status built from it lives with the roster statuses (`roster_status.py`)."""
    wanted = set(player_ids)
    rows = observations_as_of(conn, ObservationQuery(season, _WEEK_ONE, as_of, DEPTH_SOURCE))
    listed: dict[str, datetime] = {}
    for row in rows:
        if row.metric != DEPTH_METRIC or row.player_id not in wanted:
            continue
        held = listed.get(row.player_id)
        if held is None or row.as_of > held:
            listed[row.player_id] = row.as_of
    return listed


# --- the offseason ------------------------------------------------------------------------------

_POSITION_AFFINITY: Final[Mapping[Position, Mapping[Position, float]]] = MappingProxyType(
    {
        "WR": MappingProxyType({"WR": 1, "TE": 0.5, "RB": 0.2, "QB": 0, "K": 0, "DEF": 0}),
        "TE": MappingProxyType({"WR": 0.6, "TE": 1, "RB": 0.2, "QB": 0, "K": 0, "DEF": 0}),
        "RB": MappingProxyType({"WR": 0.15, "TE": 0.15, "RB": 1, "QB": 0, "K": 0, "DEF": 0}),
        "QB": MappingProxyType(dict.fromkeys(("WR", "TE", "RB", "QB", "K", "DEF"), 0)),
        "K": MappingProxyType(dict.fromkeys(("WR", "TE", "RB", "QB", "K", "DEF"), 0)),
        "DEF": MappingProxyType(dict.fromkeys(("WR", "TE", "RB", "QB", "K", "DEF"), 0)),
    }
)
MAX_SHARE_MOVE: Final = 0.12


@dataclass(frozen=True, slots=True)
class RosterPlayer:
    player_id: str
    position: Position
    snap_share: float
    uplift_when_absent: float | None


@dataclass(frozen=True, slots=True)
class ShareMove:
    player_id: str
    position: Position
    target_share: float
    carry_share: float


@dataclass(frozen=True, slots=True)
class ShareDelta:
    target_share: float
    carry_share: float


def absorption_weights(roster: Sequence[RosterPlayer], departing: Position) -> dict[str, float]:
    """`absorptionWeights`."""
    measured = [player for player in roster if player.uplift_when_absent is not None and player.uplift_when_absent > 0]
    if measured:
        source = [(player.player_id, float(player.uplift_when_absent or 0)) for player in measured]
    else:
        source = [
            (player.player_id, _POSITION_AFFINITY[departing][player.position] * player.snap_share) for player in roster
        ]
    total = 0.0
    for _, weight in source:
        total += weight
    if total <= 0:
        return {}
    return {player_id: weight / total for player_id, weight in source if weight > 0}


def _clamp_move(value: float) -> float:
    return js_min(MAX_SHARE_MOVE, js_max(-MAX_SHARE_MOVE, value))


def redistribute_shares(
    roster: Sequence[RosterPlayer],
    departures: Sequence[ShareMove],
    arrivals: Sequence[ShareMove],
    absorption_rate: float,
) -> dict[str, ShareDelta]:
    """`redistributeShares`."""
    deltas: dict[str, list[float]] = {player.player_id: [0.0, 0.0] for player in roster}

    def apply(move: ShareMove, direction: float) -> None:
        for player_id, weight in absorption_weights(roster, move.position).items():
            delta = deltas.get(player_id)
            if delta is None:
                continue
            delta[0] += direction * absorption_rate * move.target_share * weight
            delta[1] += direction * absorption_rate * move.carry_share * weight

    for departure in departures:
        apply(departure, 1.0)
    for arrival in arrivals:
        apply(arrival, -1.0)
    return {player_id: ShareDelta(_clamp_move(delta[0]), _clamp_move(delta[1])) for player_id, delta in deltas.items()}


@dataclass(frozen=True, slots=True)
class OffseasonMove:
    player_id: str
    position: Position
    source_team: str | None
    destination_team: str | None
    target_share: float
    carry_share: float


def _moves_by_team(moves: Sequence[OffseasonMove]) -> dict[str, tuple[list[ShareMove], list[ShareMove]]]:
    by_team: dict[str, tuple[list[ShareMove], list[ShareMove]]] = {}
    for move in moves:
        if move.source_team == move.destination_team:
            continue
        share = ShareMove(move.player_id, move.position, move.target_share, move.carry_share)
        if share.target_share <= 0 and share.carry_share <= 0:
            continue
        if move.source_team is not None:
            by_team.setdefault(move.source_team, ([], []))[0].append(share)
        if move.destination_team is not None:
            by_team.setdefault(move.destination_team, ([], []))[1].append(share)
    return by_team


def offseason_deltas(
    moves: Sequence[OffseasonMove], rosters: Mapping[str, Sequence[RosterPlayer]], absorption_rate: float
) -> dict[str, ShareDelta]:
    """`offseasonDeltas`: the redistribution, team by team in first-touched order."""
    deltas: dict[str, ShareDelta] = {}
    for team, (departures, arrivals) in _moves_by_team(moves).items():
        roster = rosters.get(team)
        if not roster:
            continue
        deltas.update(redistribute_shares(roster, departures, arrivals, absorption_rate))
    return deltas
