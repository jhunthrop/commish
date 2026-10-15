"""THIS SEASON'S USAGE AND PLAY: what the play-by-play and the charted feeds say about him so far.

Every figure is a ratio of two sums over the same weeks (a share, a rate, or an average weighted by
the count it was taken over), so a season figure is never an average of weekly averages, and each
carries what it was taken from. A figure is on the sheet only when its sample clears the figure's
floor (`Rule.floor`, in the denominator's own unit): a two-route week never produces a rate. A player
the feeds hold nothing for has no figure, never a zero. Ranked figures are ranked among his
position's peers who cleared the same floor; figures whose better end is a matter of taste (a
pressure rate, a time to throw, drops) are stated, not ranked, and a figure that describes a role
rather than a quality (`Rule.neutral`, the depth of target) is ranked without "best".

The team shares are taken over the weeks he played (an offensive snap, or a carry or target in the
play-by-play), against his club's own totals in those weeks, his club that week being the one the
store places him on. A team share needs a real role of his own to appear at all (`Pool`), and a
negative share (air yards lost to screens) is left off.

A figure reaches the sheet only when every source it reads is cleared for the page
(`CapsuleConfig.sources_on_pages`, one licence gate per source): FTN's charting is off until the page
carries its credit and its share-alike term is ruled on; a ruling on any source is a config flip.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final, Literal

from research.capsules.facts.model import RankedStat, SeasonFigure, SeasonUsage
from research.capsules.facts.rank import RankableStat, rank_within_groups
from research.model.domain import Position
from research.pipeline.nflverse.ftn import FTN_SOURCE, FtnMetric
from research.pipeline.nflverse.ngs import NGS_SOURCE
from research.pipeline.nflverse.participation import NflverseSource, ParticipationMetric
from research.pipeline.nflverse.pbp import PBP_PLAYER_SOURCE, PbpPlayerMetric
from research.pipeline.nflverse.pbp_passers import PBP_PASSER_SOURCE, PasserMetric
from research.pipeline.nflverse.pfr_advstats import PFR_SOURCE

WeekMetrics = Mapping[str, float]


def metric_key(source: str, metric: str) -> str:
    """A stored fact's name in a week's metrics: its source and its metric."""
    return f"{source}:{metric}"


class Figure:
    RED_ZONE_SHARE: Final = "red_zone_share"
    INSIDE_TEN_SHARE: Final = "inside_ten_share"
    AIR_YARDS_SHARE: Final = "air_yards_share"
    TARGET_DEPTH: Final = "target_depth"
    DROPS: Final = "drops"
    CONTESTED_CATCH_RATE: Final = "contested_catch_rate"
    SEPARATION: Final = "separation"
    YAC_OVER_EXPECTED: Final = "yac_over_expected"
    RUSH_YARDS_OVER_EXPECTED: Final = "rush_yards_over_expected"
    YARDS_AFTER_CONTACT: Final = "yards_after_contact"
    PRESSURE_RATE: Final = "pressure_rate"
    TIME_TO_THROW: Final = "time_to_throw"
    COMPLETION_OVER_EXPECTED: Final = "completion_over_expected"
    BLITZ_RATE: Final = "blitz_rate"
    INTERCEPTION_WORTHY: Final = "interception_worthy"


@dataclass(frozen=True, slots=True)
class Week:
    """One week he has facts in: its number, his own facts and his club's totals that week."""

    week: int
    own: WeekMetrics
    team: WeekMetrics


Side = Literal["own", "team", "weighted"]


@dataclass(frozen=True, slots=True)
class Part:
    """One side of a figure, read from a week: the sum of `names` from his own facts or his club's,
    or (`weighted`) his own average `names[0]` times the count `names[1]` it was taken over."""

    side: Side
    names: tuple[str, ...]

    def read(self, week: Week) -> float | None:
        if self.side == "weighted":
            mean, count = week.own.get(self.names[0]), week.own.get(self.names[1])
            return None if mean is None or count is None else mean * count
        held = week.own if self.side == "own" else week.team
        values = [held.get(name) for name in self.names]
        return None if any(v is None for v in values) else sum(v for v in values if v is not None)


def _own(*names: str) -> Part:
    return Part("own", names)


def _team(*names: str) -> Part:
    return Part("team", names)


def _weighted(average: str, weight: str) -> Part:
    return Part("weighted", (average, weight))


@dataclass(frozen=True, slots=True)
class Pool:
    """Who a team share is ranked among: the peers whose own `part`, over the same weeks, reached
    `floor`. A club's total says nothing of a man's role, so a backup is never ranked on it."""

    part: Part
    floor: float


@dataclass(frozen=True, slots=True)
class Rule:
    """One figure: `numerator` over `denominator`, summed over the weeks both read, present once the
    denominator reaches `floor`; `count_is_numerator` when the numerator is itself a count worth
    printing (9 of 29), not a weighted sum; ranked among the peers who reached `floor`, or `pool`'s."""

    key: str
    positions: frozenset[Position]
    numerator: Part
    denominator: Part
    floor: float
    ranked: bool
    count_is_numerator: bool = True
    pool: Pool | None = None
    neutral: bool = False

    @property
    def sources(self) -> frozenset[str]:
        """Every store source the figure reads."""
        return frozenset(name.split(":", 1)[0] for part in _parts(self) for name in part.names)


_RECEIVERS: Final = frozenset[Position]({"WR", "TE"})
_PASS_CATCHERS: Final = frozenset[Position]({"RB", "WR", "TE"})
_RUNNERS: Final = frozenset[Position]({"RB"})
_PASSERS: Final = frozenset[Position]({"QB"})


def _pbp(metric: str) -> str:
    return metric_key(PBP_PLAYER_SOURCE, metric)


_RED_ZONE: Final = (_pbp(PbpPlayerMetric.RED_ZONE_CARRIES), _pbp(PbpPlayerMetric.RED_ZONE_TARGETS))
_INSIDE_TEN: Final = (_pbp(PbpPlayerMetric.INSIDE_TEN_CARRIES), _pbp(PbpPlayerMetric.INSIDE_TEN_TARGETS))
_AIR_YARDS: Final = _pbp(PbpPlayerMetric.AIR_YARDS)
_TARGETS: Final = metric_key(NflverseSource.PLAYER_WEEK, ParticipationMetric.TARGETS)
# A team share's rank pool: twenty carries and targets of his own, about two games of a regular role.
_ROLE: Final = Pool(_own(_pbp(PbpPlayerMetric.CARRIES), _pbp(PbpPlayerMetric.TARGETS)), 20)

# Floors, in each denominator's own unit: about a game and a half of a regular's volume, so a cameo
# never ranks and a starter clears it inside two weeks.
RULES: Final = (
    Rule(Figure.RED_ZONE_SHARE, _PASS_CATCHERS, _own(*_RED_ZONE), _team(*_RED_ZONE), 10, True, pool=_ROLE),
    Rule(Figure.INSIDE_TEN_SHARE, _PASS_CATCHERS, _own(*_INSIDE_TEN), _team(*_INSIDE_TEN), 5, True, pool=_ROLE),
    Rule(Figure.AIR_YARDS_SHARE, _RECEIVERS, _own(_AIR_YARDS), _team(_AIR_YARDS), 300, True, pool=_ROLE),
    Rule(
        Figure.TARGET_DEPTH, _RECEIVERS, _own(_AIR_YARDS), _own(_pbp(PbpPlayerMetric.AIR_YARD_TARGETS)), 15, True,
        count_is_numerator=False, neutral=True,
    ),
    Rule(Figure.DROPS, _PASS_CATCHERS, _own(metric_key(PFR_SOURCE, "receiving_drops")), _own(_TARGETS), 15, False),
    Rule(
        Figure.CONTESTED_CATCH_RATE, _RECEIVERS, _own(metric_key(FTN_SOURCE, FtnMetric.CONTESTED_CATCHES)),
        _own(metric_key(FTN_SOURCE, FtnMetric.CONTESTED_TARGETS)), 5, True,
    ),
    Rule(
        Figure.SEPARATION, _RECEIVERS,
        _weighted(metric_key(NGS_SOURCE, "rec_avg_separation"), metric_key(NGS_SOURCE, "rec_targets")),
        _own(metric_key(NGS_SOURCE, "rec_targets")), 15, True, count_is_numerator=False,
    ),
    Rule(
        Figure.YAC_OVER_EXPECTED, _PASS_CATCHERS,
        _weighted(metric_key(NGS_SOURCE, "rec_avg_yac_above_expectation"), metric_key(NGS_SOURCE, "rec_receptions")),
        _own(metric_key(NGS_SOURCE, "rec_receptions")), 10, True, count_is_numerator=False,
    ),
    Rule(
        Figure.RUSH_YARDS_OVER_EXPECTED, _RUNNERS, _own(metric_key(NGS_SOURCE, "rush_yards_over_expected")),
        _own(metric_key(NGS_SOURCE, "rush_attempts")), 25, True,
    ),
    Rule(
        Figure.YARDS_AFTER_CONTACT, _RUNNERS, _own(metric_key(PFR_SOURCE, "rushing_yards_after_contact")),
        _own(metric_key(PFR_SOURCE, "rushing_carries")), 25, True, count_is_numerator=False,
    ),
    Rule(
        Figure.PRESSURE_RATE, _PASSERS, _own(metric_key(PFR_SOURCE, "times_pressured")),
        _own(metric_key(PBP_PASSER_SOURCE, PasserMetric.DROPBACKS)), 50, False,
    ),
    Rule(
        Figure.TIME_TO_THROW, _PASSERS,
        _weighted(metric_key(NGS_SOURCE, "pass_avg_time_to_throw"), metric_key(NGS_SOURCE, "pass_attempts")),
        _own(metric_key(NGS_SOURCE, "pass_attempts")), 50, False, count_is_numerator=False,
    ),
    Rule(
        Figure.COMPLETION_OVER_EXPECTED, _PASSERS,
        _weighted(metric_key(NGS_SOURCE, "pass_completion_pct_above_expectation"), metric_key(NGS_SOURCE, "pass_attempts")),
        _own(metric_key(NGS_SOURCE, "pass_attempts")), 50, True, count_is_numerator=False,
    ),
    Rule(
        Figure.BLITZ_RATE, _PASSERS, _own(metric_key(FTN_SOURCE, FtnMetric.BLITZED_DROPBACKS)),
        _own(metric_key(FTN_SOURCE, FtnMetric.DROPBACKS)), 50, False,
    ),
    Rule(
        Figure.INTERCEPTION_WORTHY, _PASSERS, _own(metric_key(FTN_SOURCE, FtnMetric.INTERCEPTION_WORTHY_THROWS)),
        _own(metric_key(FTN_SOURCE, FtnMetric.PASS_ATTEMPTS)), 50, False,
    ),
)  # fmt: skip


def _parts(rule: "Rule") -> tuple[Part, ...]:
    return (rule.numerator, rule.denominator, *(() if rule.pool is None else (rule.pool.part,)))


NEUTRAL_FIGURES: Final = frozenset(rule.key for rule in RULES if rule.neutral)


def needed_metrics() -> frozenset[str]:
    """Every stored fact (`metric_key`) some figure reads."""
    return frozenset(name for rule in RULES for part in _parts(rule) for name in part.names)


# What a club's week is summed from, and what a played week with no touch counts as zero.
TEAM_SHARE_METRICS: Final = frozenset(
    name for rule in RULES for name in rule.numerator.names if rule.denominator.side == "team"
)
ZERO_WHEN_PLAYED: Final = frozenset(
    name
    for rule in RULES
    if rule.denominator.side == "team"
    for part in _parts(rule)
    if part.side == "own"
    for name in part.names
)


@dataclass(frozen=True, slots=True)
class _Sum:
    numerator: float
    denominator: float
    weeks: tuple[int, ...]


def _summed(rule: Rule, weeks: Sequence[Week]) -> _Sum | None:
    numerator = denominator = role = 0.0
    read: list[int] = []
    for week in weeks:
        top, bottom = rule.numerator.read(week), rule.denominator.read(week)
        if top is None or bottom is None:
            continue
        numerator, denominator = numerator + top, denominator + bottom
        role += 0.0 if rule.pool is None else (rule.pool.part.read(week) or 0.0)
        read.append(week.week)
    if not read or denominator < rule.floor or denominator <= 0:
        return None
    if rule.pool is not None and (role < rule.pool.floor or numerator < 0):
        return None
    return _Sum(numerator, denominator, tuple(read))


@dataclass(frozen=True, slots=True)
class SeasonInputs:
    """Everything the figures read: each subject's played weeks, the population's positions and names,
    and the span the reads covered."""

    season: int
    first_week: int
    last_week: int
    weeks: Mapping[str, Sequence[Week]]
    positions: Mapping[str, Position]
    names: Mapping[str, str]


def _ranks(rule: Rule, sums: Mapping[str, _Sum], inputs: SeasonInputs) -> dict[str, RankedStat]:
    groups: dict[Position, list[RankableStat]] = {}
    for player_id, total in sums.items():
        position = inputs.positions[player_id]
        name = inputs.names.get(player_id, player_id)
        groups.setdefault(position, []).append(RankableStat(player_id, name, total.numerator / total.denominator))
    return rank_within_groups(groups)


def season_usage_for(inputs: SeasonInputs, *, on_pages: frozenset[str]) -> dict[str, SeasonUsage]:
    """Every player's figures that cleared their floors and read only sources cleared for the page
    (`on_pages`), by universe id; a player with none is absent."""
    figures: dict[str, list[SeasonFigure]] = {}
    for rule in RULES:
        if not rule.sources <= on_pages:
            continue
        sums: dict[str, _Sum] = {}
        for player_id, weeks in inputs.weeks.items():
            position = inputs.positions.get(player_id)
            if position is not None and position in rule.positions:
                total = _summed(rule, weeks)
                if total is not None:
                    sums[player_id] = total
        ranks = _ranks(rule, sums, inputs) if rule.ranked else {}
        for player_id, total in sums.items():
            figures.setdefault(player_id, []).append(
                SeasonFigure(
                    rule.key,
                    total.numerator / total.denominator,
                    total.numerator if rule.count_is_numerator else None,
                    total.denominator,
                    total.weeks,
                    rule.floor if rule.pool is None else rule.pool.floor,
                    ranks.get(player_id),
                )
            )
    return {
        player_id: SeasonUsage(
            inputs.season,
            inputs.first_week,
            inputs.last_week,
            tuple(sorted({week.week for week in inputs.weeks[player_id]})),
            tuple(found),
        )
        for player_id, found in figures.items()
    }
