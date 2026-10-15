"""THE ROUND'S PRECONDITIONS, checked before any fit (preregistration section 5).

Stamped injury filings and opponent ratings for every fit and judged week, and ADP for the seasons
the preregistration names. A missing one refuses the run and is named. (The preseason boards
building at their moments, and round 3's priors refit equal to their record, are checked by the run
itself as it builds them: `judge.rate_priors`.)
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from sqlalchemy import Connection, text

from research.model.weekly2.gates import Thresholds
from research.pipeline.nflverse.context import CONTEXT_SOURCE
from research.pipeline.nflverse.injury_reports import INJURY_SOURCE, InjuryMetric

WeekKey = tuple[int, int]


@dataclass(frozen=True, slots=True)
class StoreCounts:
    filings: Mapping[WeekKey, int]  # (season, week): stamped report-status filings
    ratings: Mapping[WeekKey, int]  # (season, week): opponent-rating rows
    adp: Mapping[int, int]  # season: ADP rows


def round_seasons(t: Thresholds) -> tuple[int, ...]:
    return (*t.fit_seasons, t.judgment_season)


def missing_preconditions(counts: StoreCounts, t: Thresholds) -> list[str]:
    """Each missing input, named; empty when the store holds them all."""
    keys = [(season, week) for season in round_seasons(t) for week in t.weeks]
    missing = [
        f"stamped injury filings ({InjuryMetric.REPORT_STATUS}) for {s} week {w}"
        for s, w in keys
        if counts.filings.get((s, w), 0) <= 0
    ]
    missing += [
        f"opponent ratings ({CONTEXT_SOURCE}) for {s} week {w}" for s, w in keys if counts.ratings.get((s, w), 0) <= 0
    ]
    missing += [f"ADP ({t.adp_source}) for {s}" for s in t.adp_seasons if counts.adp.get(s, 0) <= 0]
    return missing


_FILINGS: Final = text(
    "select season, week, count(*) as n from research.player_week_observations "
    "where source = :source and metric = :metric and season = any(:seasons) group by season, week"
)
_RATINGS: Final = text(
    "select season, week, count(*) as n from research.team_week_observations "
    "where source = :source and season = any(:seasons) group by season, week"
)
_ADP: Final = text(
    "select season, count(*) as n from research.preseason_rankings "
    "where source = :source and season = any(:seasons) group by season"
)


def read_counts(conn: Connection, t: Thresholds) -> StoreCounts:
    seasons = list(round_seasons(t))
    filings = conn.execute(
        _FILINGS, {"source": INJURY_SOURCE, "metric": InjuryMetric.REPORT_STATUS, "seasons": seasons}
    )
    ratings = conn.execute(_RATINGS, {"source": CONTEXT_SOURCE, "seasons": seasons})
    adp = conn.execute(_ADP, {"source": t.adp_source, "seasons": list(t.adp_seasons)})
    return StoreCounts(
        {(int(r.season), int(r.week)): int(r.n) for r in filings},
        {(int(r.season), int(r.week)): int(r.n) for r in ratings},
        {int(r.season): int(r.n) for r in adp},
    )
