"""THE PLAYER CAPSULE'S FACT SHEET, as types: every number and name a capsule may cite.

Ported from `research-ts/src/capsules/facts.ts` and `facts/types.ts`. Each dataclass declares its
fields in the order the oracle CONSTRUCTS the object (not the order its interface lists them),
because `factsHash` is a SHA-256 of `JSON.stringify` of the sheet, and JSON keeps construction
order: `LastSeasonStory` carries `touches_rank` last because the oracle spreads the story and then
adds it. `to_js` turns any of them into the oracle's JSON value, camelCase keys in that order.
"""

from collections.abc import Mapping
from dataclasses import dataclass, fields, is_dataclass
from types import MappingProxyType
from typing import Any, Final, Literal

from research.model.domain import Position, snake_to_camel

# Field names Python cannot spell: `from` is a keyword.
_JS_NAMES: Final = MappingProxyType({"from_": "from"})


def to_js(value: object) -> Any:
    """The oracle's JSON value for a fact: dataclasses as objects, tuples as arrays."""
    if is_dataclass(value) and not isinstance(value, type):
        return {_JS_NAMES.get(f.name, snake_to_camel(f.name)): to_js(getattr(value, f.name)) for f in fields(value)}
    if isinstance(value, tuple | list):
        return [to_js(item) for item in value]
    if isinstance(value, Mapping):
        return {key: to_js(item) for key, item in value.items()}
    return value


# --- ranked stats and trends (`rank.ts`, `trend.ts`) -------------------------------------------


@dataclass(frozen=True, slots=True)
class RankedStat:
    value: float
    position_rank: int
    qualifier_count: int
    named_neighbor: str | None


@dataclass(frozen=True, slots=True)
class TrendMetric:
    prior_season: int
    prior_value: float
    recent_season: int
    recent_value: float
    delta: float
    material: bool


# --- the evidence (`facts.ts` `PlayerFactsEvidenceItem`) --------------------------------------


@dataclass(frozen=True, slots=True)
class LawEvidence:
    kind: Literal["law"]
    group_key: str
    headline: str
    net_effect_points: float
    law_count: int


@dataclass(frozen=True, slots=True)
class ShareEvidence:
    kind: Literal["offseason_share_gained", "offseason_share_lost"]
    group_key: str
    target_share_change: float
    carry_share_change: float


@dataclass(frozen=True, slots=True)
class ChangedTeamEvidence:
    kind: Literal["changed_team"]
    group_key: str
    from_: str
    to: str


@dataclass(frozen=True, slots=True)
class NewPlayCallerEvidence:
    kind: Literal["new_play_caller"]
    group_key: str
    team: str


@dataclass(frozen=True, slots=True)
class RookieEvidence:
    kind: Literal["rookie"]
    group_key: str
    overall_pick: int | None


@dataclass(frozen=True, slots=True)
class MarketUnlistedEvidence:
    kind: Literal["market_unlisted"]
    group_key: str


EvidenceItem = (
    LawEvidence | ShareEvidence | ChangedTeamEvidence | NewPlayCallerEvidence | RookieEvidence | MarketUnlistedEvidence
)


# --- the sheet's own sections ------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Identity:
    id: str
    name: str
    position: Position
    team: str


@dataclass(frozen=True, slots=True)
class Availability:
    expected_games: float
    floor_games: float
    ceiling_games: float


@dataclass(frozen=True, slots=True)
class Market:
    adp: float | None
    position_adp: str | None
    # The page's overall rank, None for a player the run's board lacks (review R4).
    board_rank: int | None
    position_rank: int | None
    replacement_level: float | None
    players_left_in_tier: int | None
    drop_to_next_tier: float | None
    market_anchor_points: float | None
    market_anchor_delta: float | None


@dataclass(frozen=True, slots=True)
class Projection:
    projected_points: float
    floor_points: float
    median_points: float
    ceiling_points: float
    typical_low: float
    typical_high: float


@dataclass(frozen=True, slots=True)
class SeasonTotals:
    """His totals over the weeks he played, as the page's season block sums them: None where a
    played week's line does not carry the stat."""

    carries: float | None
    rushing_yards: float | None
    targets: float | None
    receptions: float | None
    receiving_yards: float | None
    passing_yards: float | None
    touchdowns: float | None
    fantasy_points: float | None


@dataclass(frozen=True, slots=True)
class SeasonWeek:
    """One week of this season that is behind him: played (with its PPR points), inactive (his
    club's game is in the records and he has no line), or his club's bye."""

    week: int
    status: Literal["played", "inactive", "bye"]
    points: float | None


@dataclass(frozen=True, slots=True)
class SeasonSoFar:
    """THIS SEASON SO FAR, the page's own season block (`nightly.build.player_season`): present
    only once the season's first kickoff has passed, which is what puts the writer in the
    in-season voice. `through` is the last week whose games are all in the records; `weeks` are the
    weeks behind him; `injury_from_week` is the first week his club played on or after the day his
    current injury status began."""

    season: int
    through: int
    games_played: int
    points_per_game: float | None
    totals: SeasonTotals
    weeks: tuple[SeasonWeek, ...]
    injury_from_week: int | None

    @property
    def missed_weeks(self) -> tuple[int, ...]:
        return tuple(w.week for w in self.weeks if w.status == "inactive")


@dataclass(frozen=True, slots=True)
class WeekPoints:
    """`{ week, points }`: a best week, a worst week, a week score."""

    week: int
    points: float


@dataclass(frozen=True, slots=True)
class LastSeasonStory:
    season: int
    points_rank: RankedStat
    points_per_game: float
    games_played: int
    best_week: WeekPoints
    weeks_above_median: int
    receiving_yards_rank: RankedStat
    touches_rank: RankedStat | None


@dataclass(frozen=True, slots=True)
class PropsLine:
    market: str
    median_line: float


@dataclass(frozen=True, slots=True)
class BooksNumbers:
    props_lines: tuple[PropsLine, ...]
    team_vegas_win_total: float | None


@dataclass(frozen=True, slots=True)
class Usage:
    season: int
    snap_share: float | None
    snap_share_rank: RankedStat | None
    target_share: float | None
    target_share_rank: RankedStat | None
    red_zone_share: float | None
    red_zone_share_rank: RankedStat | None


@dataclass(frozen=True, slots=True)
class Trend:
    points_per_game: TrendMetric | None
    yards_per_opportunity: TrendMetric | None
    target_share: TrendMetric | None


@dataclass(frozen=True, slots=True)
class InjuryDesignated:
    state: Literal["designated"]
    designation: str
    # The Eastern day the status began: the first capture of the unbroken run of captures showing him
    # with this designation (`reference.injury_snapshot`). Never a capture's own day or time, so a
    # night that sees the same status hashes the same sheet.
    since: str


@dataclass(frozen=True, slots=True)
class InjuryClean:
    state: Literal["clean"]
    # The Eastern day his clean run began: the first capture after his last designation, or the first
    # capture on file.
    since: str


@dataclass(frozen=True, slots=True)
class InjuryUnknown:
    state: Literal["unknown"]


InjuryStatus = InjuryDesignated | InjuryClean | InjuryUnknown


@dataclass(frozen=True, slots=True)
class NewsItem:
    title: str
    link: str
    published_at: str | None


# --- this season's usage and play (`facts.season_usage`) ---------------------------------------


@dataclass(frozen=True, slots=True)
class SeasonFigure:
    """One figure of this season with its basis: `value` is the rate or average, `count` and `out_of`
    what it was taken from (9 of 29, 3 drops on 41 targets), `weeks` the weeks it was taken over,
    `floor` the sample every ranked peer cleared, `rank` his place among them (None where the figure
    is not ranked)."""

    key: str
    value: float
    count: float | None
    out_of: float
    weeks: tuple[int, ...]
    floor: float
    rank: RankedStat | None


@dataclass(frozen=True, slots=True)
class SeasonUsage:
    """This season's usage and play from the play-by-play and the charted feeds, weeks `first_week`
    to `last_week`: only the figures whose sample cleared its floor, never a zero for a missing one."""

    season: int
    first_week: int
    last_week: int
    # The weeks he has any of these facts in: a figure taken over fewer names its own.
    weeks: tuple[int, ...]
    figures: tuple[SeasonFigure, ...]
