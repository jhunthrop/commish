"""THE ONE PLACE A CAPSULE'S FACTS ARE ASSEMBLED: pure, deterministic, and hashed.

Ported from `research-ts/src/capsules/facts.ts` (`buildPlayerFacts`) and `projections/preseason/
band-quartiles.ts`. `facts_hash` is SHA-256 of the content fields as `JSON.stringify` writes them
(`js_json_stringify`, construction order), the cache key the sweep compares with the stored row, so
two calls with the same inputs hash alike. The run's day rides on the sheet for the writer but is
never hashed; this season so far is, so a page is rewritten when a week lands, not every night.
"""

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any, Final

from research.capsules.facts.depth_ledger import depth_names, depth_numbers, depth_team_codes
from research.capsules.facts.depth_model import EMPTY_DEPTH, Depth
from research.capsules.facts.evidence import availability_from, evidence_from, market_from
from research.capsules.facts.ledger import name_ledger, number_ledger
from research.capsules.facts.market_adp import PageRanks
from research.capsules.facts.model import (
    Availability,
    BooksNumbers,
    EvidenceItem,
    Identity,
    InjuryStatus,
    LastSeasonStory,
    Market,
    NewsItem,
    Projection,
    SeasonSoFar,
    SeasonUsage,
    Trend,
    Usage,
    to_js,
)
from research.capsules.facts.season_usage_ledger import usage_names, usage_numbers
from research.model.domain import snake_to_camel
from research.model.laws.registry import Law
from research.pipeline.jscompat import js_json_stringify

_Z_90: Final = 1.2816
_Z_75: Final = 0.6745


def _quartiles(median: float, floor: float, ceiling: float) -> tuple[float, float]:
    """`quartilesFromSeasonBand`, falling back to the full band where it does not bracket the median."""
    if not (floor <= median <= ceiling):
        return floor, ceiling
    if ceiling == floor:
        return median, median
    sigma = (ceiling - floor) / (2 * _Z_90)
    return median - _Z_75 * sigma, median + _Z_75 * sigma


@dataclass(frozen=True, slots=True)
class FactsInput:
    """`PlayerFactsInput`: everything already read, nothing left to query."""

    identity: Identity
    product_season: int
    reasons: Sequence[Mapping[str, Any]]
    laws: Sequence[Law]
    adp: float | None
    position_adp: str | None
    board_rank: int
    projected_points: float
    floor_points: float
    median_points: float
    ceiling_points: float
    bye_week: int | None
    season: SeasonSoFar | None
    injury: InjuryStatus
    news: tuple[NewsItem, ...]
    last_season_story: LastSeasonStory | None
    books_numbers: BooksNumbers
    usage: Usage | None
    trend: Trend | None
    # The run's Eastern day, told to the writer and never hashed: a night that sees the same season
    # rewrites nothing (the season so far moves the hash when a week lands).
    run_day: str
    depth: Depth = EMPTY_DEPTH
    # The page's overall and position rank (`market_adp`), which replace the oracle's board rank and
    # the scarcity reason's position rank; None keeps the oracle's (the parity cases).
    page_ranks: PageRanks | None = None  # None only where a sheet is built without a run (none today)
    # This season's usage and play (`facts.season_usage`): None before any week's facts are stored.
    season_usage: SeasonUsage | None = None


@dataclass(frozen=True, slots=True)
class PlayerFacts:
    """`PlayerFacts`: the content fields, in the hash's order, then the ledgers and the hash."""

    identity: Identity
    product_season: int
    evidence: tuple[EvidenceItem, ...]
    market: Market
    projection: Projection
    availability: Availability | None
    # This season so far: None before the first kickoff, which is the preseason voice.
    season: SeasonSoFar | None
    bye_week: int | None
    injury: InjuryStatus
    news: tuple[NewsItem, ...]
    last_season_story: LastSeasonStory | None
    books_numbers: BooksNumbers
    usage: Usage | None
    trend: Trend | None
    depth: Depth
    # This season's usage and play from the play-by-play and the charted feeds, None until it has a figure.
    season_usage: SeasonUsage | None = None
    run_day: str = ""
    number_ledger: tuple[float, ...] = ()
    name_ledger: tuple[str, ...] = ()
    facts_hash: str = ""


_CONTENT_FIELDS: Final = (
    "identity",
    "product_season",
    "evidence",
    "market",
    "projection",
    "availability",
    "season",
    "bye_week",
    "injury",
    "news",
    "last_season_story",
    "books_numbers",
    "usage",
    "trend",
    "depth",
    "season_usage",
)


def content_json(facts: PlayerFacts) -> dict[str, Any]:
    """The content fields as the oracle's canonical object."""
    full = to_js(facts)
    return {key: full[key] for key in (snake_to_camel(name) for name in _CONTENT_FIELDS)}


def facts_hash(facts: PlayerFacts) -> str:
    """`computeFactsHash`."""
    return hashlib.sha256(js_json_stringify(content_json(facts)).encode("utf-8")).hexdigest()


def _market(given: FactsInput) -> Market:
    market = market_from(given.reasons, given.adp, given.position_adp, given.board_rank)
    page = given.page_ranks
    return market if page is None else replace(market, board_rank=page.overall, position_rank=page.position)


def build_player_facts(given: FactsInput) -> PlayerFacts:
    """`buildPlayerFacts`."""
    low, high = _quartiles(given.median_points, given.floor_points, given.ceiling_points)
    content = PlayerFacts(
        given.identity,
        given.product_season,
        evidence_from(given.reasons, given.laws),
        _market(given),
        Projection(given.projected_points, given.floor_points, given.median_points, given.ceiling_points, low, high),
        availability_from(given.reasons),
        given.season,
        given.bye_week,
        given.injury,
        given.news,
        given.last_season_story,
        given.books_numbers,
        given.usage,
        given.trend,
        given.depth,
        season_usage=given.season_usage,
        run_day=given.run_day,
    )
    depth = content.depth
    usage = content.season_usage
    numbers = tuple(number_ledger(content, [*depth_numbers(depth), *usage_numbers(usage)]))
    names = tuple(name_ledger(content, [*depth_names(depth), *usage_names(usage)], depth_team_codes(depth)))
    return replace(content, number_ledger=numbers, name_ledger=names, facts_hash=facts_hash(content))
