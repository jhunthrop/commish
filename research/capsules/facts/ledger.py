"""THE NUMBER AND NAME LEDGERS: every number and proper noun a capsule may print.

Ported from `research-ts/src/capsules/facts.ts` (`buildNumberLedger`, `buildNameLedger`),
`derived-numbers.ts` and `facts/ledger.ts`, walking the sheet's own fields in one fixed order. A
fraction contributes its raw value and its percent; a difference or a total the reader would work
out from two printed figures is on the ledger too, so a capsule may state it.
"""

import math
import re
from collections.abc import Iterable
from typing import Final, Protocol

from research.capsules.facts.depth_model import Depth
from research.capsules.facts.model import (
    Availability,
    BooksNumbers,
    EvidenceItem,
    Identity,
    InjuryStatus,
    InjuryUnknown,
    LastSeasonStory,
    LawEvidence,
    Market,
    NewsItem,
    Projection,
    RankedStat,
    RookieEvidence,
    SeasonSummary,
    ShareEvidence,
    Trend,
    TrendMetric,
    Usage,
)
from research.capsules.facts.team_names import team_name_forms
from research.model.jsmath import js_round
from research.pipeline.jscompat import js_number, js_trim

_PERCENT: Final = 100
_GAMES_IN_A_SEASON: Final = 17
_NUMBER: Final = re.compile(r"[0-9]+(?:\.[0-9]+)?")
_WHITESPACE: Final = re.compile(r"\s+")


class FactsContent(Protocol):
    """The sheet's content fields, everything the ledgers and the hash read."""

    @property
    def identity(self) -> Identity: ...
    @property
    def product_season(self) -> int: ...
    @property
    def evidence(self) -> tuple[EvidenceItem, ...]: ...
    @property
    def market(self) -> Market: ...
    @property
    def projection(self) -> Projection: ...
    @property
    def availability(self) -> Availability | None: ...
    @property
    def season(self) -> SeasonSummary | None: ...
    @property
    def bye_week(self) -> int | None: ...
    @property
    def injury(self) -> InjuryStatus: ...
    @property
    def news(self) -> tuple[NewsItem, ...]: ...
    @property
    def last_season_story(self) -> LastSeasonStory | None: ...
    @property
    def books_numbers(self) -> BooksNumbers: ...
    @property
    def usage(self) -> Usage | None: ...
    @property
    def trend(self) -> Trend | None: ...
    @property
    def depth(self) -> Depth: ...


def _present(*values: float | None) -> list[float]:
    return [value for value in values if value is not None]


def _ranked(rank: RankedStat | None) -> list[float]:
    return [] if rank is None else [rank.value, rank.position_rank, rank.qualifier_count]


def _evidence_numbers(evidence: Iterable[EvidenceItem]) -> list[float]:
    numbers: list[float] = []
    for item in evidence:
        if isinstance(item, LawEvidence):
            numbers += [item.net_effect_points, item.law_count]
        elif isinstance(item, ShareEvidence):
            t, c = item.target_share_change, item.carry_share_change
            numbers += [t, t * _PERCENT, c, c * _PERCENT]
        elif isinstance(item, RookieEvidence) and item.overall_pick is not None:
            numbers.append(item.overall_pick)
    return numbers


def _trend_numbers(metric: TrendMetric | None, is_share: bool) -> list[float]:
    if metric is None:
        return []
    m = metric
    numbers = [m.prior_season, m.recent_season, m.prior_value, m.recent_value, m.delta]
    if is_share:
        numbers += [m.prior_value * _PERCENT, m.recent_value * _PERCENT, m.delta * _PERCENT]
    return numbers


def _share(value: float | None) -> list[float]:
    return [] if value is None else [value, value * _PERCENT]


def _color_numbers(facts: FactsContent) -> list[float]:
    numbers: list[float] = []
    story = facts.last_season_story
    if story is not None:
        numbers += [story.season, *_ranked(story.points_rank), story.points_per_game, story.games_played]
        numbers += [story.best_week.week, story.best_week.points, story.weeks_above_median]
        numbers += [*_ranked(story.receiving_yards_rank), *_ranked(story.touches_rank)]
    numbers += [line.median_line for line in facts.books_numbers.props_lines]
    numbers += _present(facts.books_numbers.team_vegas_win_total)
    usage = facts.usage
    if usage is not None:
        numbers += [usage.season, *_share(usage.snap_share), *_ranked(usage.snap_share_rank)]
        numbers += [*_share(usage.target_share), *_ranked(usage.target_share_rank)]
        numbers += [*_share(usage.red_zone_share), *_ranked(usage.red_zone_share_rank)]
    if facts.trend is not None:
        t = facts.trend
        numbers += [*_trend_numbers(t.points_per_game, False), *_trend_numbers(t.yards_per_opportunity, False)]
        numbers += _trend_numbers(t.target_share, True)
    return numbers


def _points_differences(facts: FactsContent) -> list[float]:
    p, m, story, season = facts.projection, facts.market, facts.last_season_story, facts.season
    against = [
        p.floor_points,
        p.ceiling_points,
        *_present(m.replacement_level, m.market_anchor_points),
        *([] if story is None else [story.points_rank.value]),
        *([] if season is None else [season.totals.fantasy_points]),
    ]
    numbers: list[float] = []
    for figure in against:
        numbers += [p.projected_points - figure, figure - p.projected_points]
    return [*numbers, p.typical_high - p.typical_low, p.ceiling_points - p.floor_points]


def _derived_numbers(facts: FactsContent) -> list[float]:
    p, availability, season, story = facts.projection, facts.availability, facts.season, facts.last_season_story
    numbers = _points_differences(facts)
    if season is not None and availability is not None:
        numbers.append(season.points_per_game * availability.expected_games)
    if story is not None:
        numbers.append(story.points_per_game * story.games_played)
    numbers.append(p.projected_points / _GAMES_IN_A_SEASON)
    if availability is not None and availability.expected_games > 0:
        numbers += [p.projected_points / availability.expected_games, _GAMES_IN_A_SEASON - availability.expected_games]
    effects = [item.net_effect_points for item in facts.evidence if isinstance(item, LawEvidence)]
    if len(effects) > 1:
        total = 0.0
        for effect in effects:
            total += effect
        numbers.append(total)
    if season is not None:
        t = season.totals
        numbers += [t.rushing_yards + t.receiving_yards, t.rushing_yards + t.receiving_yards + t.passing_yards]
        if t.carries is not None:
            numbers.append(t.carries + t.receptions)
    return numbers


def _printed_text_numbers(facts: FactsContent) -> list[float]:
    numbers: list[float] = []
    if not isinstance(facts.injury, InjuryUnknown):
        numbers += [js_number(part) for part in facts.injury.as_of[:10].split("-")]
    for story in facts.news:
        text = f"{story.title} {'' if story.published_at is None else story.published_at[:10]}"
        numbers += [js_number(raw) for raw in _NUMBER.findall(text)]
    return [value for value in numbers if math.isfinite(value)]


def number_ledger(facts: FactsContent, depth_numbers: list[float]) -> list[float]:
    """`buildNumberLedger`, the sheet's own fields in its declared order."""
    m, p, a, season = facts.market, facts.projection, facts.availability, facts.season
    numbers: list[float] = [facts.product_season, *_present(m.board_rank)]
    numbers += _present(m.adp, m.position_rank, m.replacement_level, m.players_left_in_tier, m.drop_to_next_tier)
    numbers += _present(m.market_anchor_points, m.market_anchor_delta)
    numbers += [p.projected_points, p.floor_points, p.median_points, p.ceiling_points, p.typical_low, p.typical_high]
    if a is not None:
        numbers += [a.expected_games, a.floor_games, a.ceiling_games]
    numbers += _evidence_numbers(facts.evidence)
    if season is not None:
        t = season.totals
        numbers += [season.season, season.games_played, season.points_per_game, *_present(t.carries), t.rushing_yards]
        numbers += [*_present(t.targets), t.receptions, t.receiving_yards, t.passing_yards, t.touchdowns]
        numbers.append(t.fantasy_points)
    numbers += _present(facts.bye_week)
    numbers += _color_numbers(facts)
    numbers += depth_numbers
    return [*numbers, *_derived_numbers(facts), *_printed_text_numbers(facts)]


class _Names:
    """`buildNameLedger`'s Set: a name, its words of more than one letter, every team spelling."""

    def __init__(self) -> None:
        self.names: dict[str, None] = {}

    def add(self, name: str) -> None:
        trimmed = js_trim(name)
        if trimmed == "":
            return
        self.names.setdefault(trimmed, None)
        for word in _WHITESPACE.split(trimmed):
            if len(word) > 1:
                self.names.setdefault(word, None)

    def add_team(self, code: str) -> None:
        for form in team_name_forms(code):
            self.add(form)


def name_ledger(facts: FactsContent, depth_names: list[str], depth_team_codes: list[str]) -> list[str]:
    names = _Names()
    names.add(facts.identity.name)
    names.add_team(facts.identity.team)
    names.add(facts.identity.position)
    for item in facts.evidence:
        if item.kind == "changed_team":
            names.add_team(item.from_)
            names.add_team(item.to)
        if item.kind == "new_play_caller":
            names.add_team(item.team)
    ranks: list[RankedStat | None] = []
    if facts.last_season_story is not None:
        s = facts.last_season_story
        ranks += [s.points_rank, s.touches_rank, s.receiving_yards_rank]
    if facts.usage is not None:
        ranks += [facts.usage.snap_share_rank, facts.usage.target_share_rank, facts.usage.red_zone_share_rank]
    for rank in ranks:
        if rank is not None and rank.named_neighbor is not None:
            names.add(rank.named_neighbor)
    for name in depth_names:
        names.add(name)
    for code in depth_team_codes:
        names.add_team(code)
    return list(names.names)


def share_numbers(fraction: float) -> list[float]:
    """A share's three printable forms: the fraction, the percent, the whole percent."""
    return [fraction, fraction * _PERCENT, js_round(fraction * _PERCENT)]
