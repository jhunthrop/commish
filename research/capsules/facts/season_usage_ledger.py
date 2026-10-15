"""THIS SEASON'S USAGE ON THE LEDGERS: every number and name its figures print.

Each figure contributes its value, what it was taken from, its floor and its rank; a share or a rate
its percent forms too (`ledger.share_numbers`). The writer may print any of them, or an honest
rounding (`grounding.is_derived_from_ledger`); the neighbour a top-three rank names is on the name
ledger.
"""

from typing import Final

from research.capsules.facts.ledger import share_numbers
from research.capsules.facts.model import SeasonUsage
from research.capsules.facts.season_usage import Figure
from research.model.jsmath import js_round

PERCENT_FIGURES: Final = frozenset({
    Figure.RED_ZONE_SHARE,
    Figure.INSIDE_TEN_SHARE,
    Figure.AIR_YARDS_SHARE,
    Figure.DROPS,
    Figure.CONTESTED_CATCH_RATE,
    Figure.PRESSURE_RATE,
    Figure.BLITZ_RATE,
    Figure.INTERCEPTION_WORTHY,
})  # fmt: skip


def usage_numbers(usage: SeasonUsage | None) -> list[float]:
    if usage is None:
        return []
    numbers: list[float] = [usage.season, usage.first_week, usage.last_week, *usage.weeks]
    for figure in usage.figures:
        numbers += [len(figure.weeks), *figure.weeks]
        numbers += [figure.value, figure.out_of, js_round(figure.out_of), figure.floor]
        if figure.key in PERCENT_FIGURES:
            numbers += share_numbers(figure.value)
        if figure.count is not None:
            numbers += [figure.count, js_round(figure.count)]
        if figure.rank is not None:
            numbers += [figure.rank.position_rank, figure.rank.qualifier_count]
    return numbers


def usage_names(usage: SeasonUsage | None) -> list[str]:
    if usage is None:
        return []
    return [f.rank.named_neighbor for f in usage.figures if f.rank is not None and f.rank.named_neighbor is not None]
