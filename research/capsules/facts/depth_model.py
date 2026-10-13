"""THE DEPTH FACTS, as types (`research-ts/src/capsules/facts/types.ts`).

Every verified fact the store holds that an expert would cite and the sheet's other sections do not
carry: why a prior season ended, the games missed, who calls the plays, age and pedigree, the depth
chart, how the role moved, who else eats, the scoring-range usage, the offence, the schedule, the
market's movement, the bad weeks and the career arc. Every field is nullable or a list, and every
absence is an absence. Fields are declared in the oracle's construction order (see `model.py`).
"""

from dataclasses import dataclass
from typing import Final, Literal

from research.capsules.facts.model import RankedStat, WeekPoints


@dataclass(frozen=True, slots=True)
class SeasonEnding:
    season: int
    last_played_week: int
    first_missed_week: int
    source: Literal["report", "status"]
    report_status: str | None
    roster_status: str | None
    primary_injury: str | None


@dataclass(frozen=True, slots=True)
class GamesMissed:
    season: int
    team_games: int
    games_played: int
    first_played_week: int | None
    unavailable_weeks: tuple[int, ...] | None
    suspended_weeks: tuple[int, ...] | None
    healthy_did_not_play: int | None


@dataclass(frozen=True, slots=True)
class InjuryDesignation:
    designation: str
    description: str | None
    first_seen_at: str
    last_seen_at: str
    capture_count: int


@dataclass(frozen=True, slots=True)
class Coaching:
    season: int
    head_coach: str | None
    head_coach_is_new: bool | None
    play_caller: str | None
    play_caller_role: Literal["HC", "OC"] | None
    play_caller_is_new: bool | None


@dataclass(frozen=True, slots=True)
class Pedigree:
    age_on_opening_day: float | None
    college: str | None
    seasons_played: int | None
    draft_year: int | None
    draft_round: int | None
    draft_pick: int | None
    draft_club: str | None
    undrafted: bool | None


@dataclass(frozen=True, slots=True)
class DepthChartNeighbor:
    name: str
    slot: float


@dataclass(frozen=True, slots=True)
class DepthChart:
    season: int
    as_of: str
    slot: float
    around_him: tuple[DepthChartNeighbor, ...]


@dataclass(frozen=True, slots=True)
class SplitShare:
    early: float
    late: float


@dataclass(frozen=True, slots=True)
class RoleTrend:
    season: int
    early_weeks: tuple[int, ...]
    late_weeks: tuple[int, ...]
    snap_share: SplitShare | None
    target_share: SplitShare | None


@dataclass(frozen=True, slots=True)
class TargetLeader:
    name: str
    share: float


@dataclass(frozen=True, slots=True)
class TargetCompetition:
    season: int
    team: str
    leaders: tuple[TargetLeader, ...]
    combined_share: float


@dataclass(frozen=True, slots=True)
class ScoringUsage:
    season: int
    red_zone_touches: RankedStat | None
    inside_ten_touches: RankedStat | None
    target_depth: RankedStat | None


@dataclass(frozen=True, slots=True)
class TeamContext:
    prior_season: int
    pace_seconds_per_play: float | None
    pass_rate: float | None
    wins: float | None
    week_one_implied_total: float | None
    week_one_spread: float | None


@dataclass(frozen=True, slots=True)
class Fixture:
    week: int
    opponent: str
    home: bool


@dataclass(frozen=True, slots=True)
class Schedule:
    week_one_opponent: Fixture | None
    home_games: int
    road_games: int
    indoor_games: int | None
    playoff_weeks: tuple[Fixture, ...]


@dataclass(frozen=True, slots=True)
class MarketMovement:
    latest_adp: float
    latest_at: str
    earlier_adp: float
    earlier_at: str
    picks: float


@dataclass(frozen=True, slots=True)
class Volatility:
    season: int
    weeks_played: int
    weeks_above_threshold: int
    threshold: float
    worst_week: WeekPoints


@dataclass(frozen=True, slots=True)
class PriorSeason:
    season: int
    points: float
    games_played: int
    position_rank: int
    qualifier_count: int


@dataclass(frozen=True, slots=True)
class Depth:
    season_endings: tuple[SeasonEnding, ...]
    games_missed: tuple[GamesMissed, ...]
    injury_history: tuple[InjuryDesignation, ...]
    coaching: Coaching | None
    pedigree: Pedigree | None
    depth_chart: DepthChart | None
    role_trend: RoleTrend | None
    target_competition: TargetCompetition | None
    scoring_usage: ScoringUsage | None
    team_context: TeamContext | None
    schedule: Schedule | None
    market_movement: MarketMovement | None
    volatility: Volatility | None
    prior_seasons: tuple[PriorSeason, ...]


# The honest "nothing was found": every list empty, every object None.
EMPTY_DEPTH: Final = Depth((), (), (), None, None, None, None, None, None, None, None, None, None, ())
