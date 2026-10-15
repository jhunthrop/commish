"""THE ROUND'S PRECONDITIONS, checked by both commands before any fit (preregistration section 6).

Every input of section 2's table present for each season from the first fit season's prior season
through the judgment season; a `kickoff_instant` row for every club-week with a game in the fit and
judged weeks, each with its `home_field` row; the pairing one to one with those kickoff club-weeks
and symmetric (D faces c exactly when c faces D); stamped filings for every fit and judged week; ADP
for the seasons named. A missing one refuses the run and is named. (Round 3's rest-of-season priors
refit equal to their record is checked by the run as it refits them: `weekly2.judge.rate_priors`.)
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from sqlalchemy import Connection, text

from research.model.weekly2.gates import Thresholds
from research.model.weekly3.instant import Schedule, read_schedule
from research.model.weekly3.work import USAGE_ROWS
from research.pipeline.nflverse.context import CONTEXT_SOURCE, ContextMetric
from research.pipeline.nflverse.injury_reports import INJURY_SOURCE, InjuryMetric
from research.pipeline.nflverse.pbp import PBP_SOURCE, PbpMetric

PLAYER_INPUTS: Final = (
    *USAGE_ROWS,
    (INJURY_SOURCE, InjuryMetric.REPORT_STATUS),
)
TEAM_INPUTS: Final = (
    (PBP_SOURCE, PbpMetric.PACE_SECONDS_PER_PLAY),
    (PBP_SOURCE, PbpMetric.PASS_RATE),
    (PBP_SOURCE, PbpMetric.DROPBACKS),
    (PBP_SOURCE, PbpMetric.DROPBACKS_FACED),
    (CONTEXT_SOURCE, ContextMetric.OPPONENT_PASS_DEFENCE),  # the reported ablation's ratings
    (CONTEXT_SOURCE, ContextMetric.OPPONENT_RUSH_DEFENCE),
)
CLUB_EDGES: Final = ("player_week_teams", "club")
Input = tuple[str, str]


@dataclass(frozen=True, slots=True)
class StoreCounts:
    inputs: Mapping[tuple[Input, int], int]  # ((source, metric), season): rows
    filings: Mapping[tuple[int, int], int]  # (season, week): stamped report-status filings
    adp: Mapping[int, int]  # season: ADP rows
    schedules: Mapping[int, Schedule]  # each fit and judged season's schedule knowledge


def input_seasons(t: Thresholds) -> tuple[int, ...]:
    """The first fit season's prior season through the judgment season."""
    return tuple(range(min(t.fit_seasons) - 1, t.judgment_season + 1))


def round_seasons(t: Thresholds) -> tuple[int, ...]:
    return (*t.fit_seasons, t.judgment_season)


def _schedule_misses(schedule: Schedule, weeks: Sequence[int]) -> list[str]:
    s = schedule.season
    kicked = {key for key in schedule.kickoffs if key[0] in weeks}
    paired = {key for key in schedule.pairing if key[0] in weeks}
    missing = [
        f"a kickoff_instant row for {s} week {w} {c}, which the pairing says played" for w, c in sorted(paired - kicked)
    ]
    missing += [f"a pairing row for {s} week {w} {c}, which has a kickoff" for w, c in sorted(kicked - paired)]
    missing += [
        f"a home_field row for {s} week {w} {c}" for w, c in sorted(kicked) if (w, c) not in schedule.home_field
    ]
    missing += [
        f"a symmetric pairing for {s} week {w}: {c} faces {d} but {d} faces {schedule.pairing.get((w, d))}"
        for (w, c), d in sorted(schedule.pairing.items())
        if schedule.pairing.get((w, d)) != c
    ]
    return missing


def missing_preconditions(counts: StoreCounts, t: Thresholds) -> list[str]:
    """Each missing input, named; empty when the store holds them all."""
    missing = [
        f"{source} {metric} rows for {season}"
        for season in input_seasons(t)
        for source, metric in (*PLAYER_INPUTS, *TEAM_INPUTS, CLUB_EDGES)
        if counts.inputs.get(((source, metric), season), 0) <= 0
    ]
    for season in round_seasons(t):
        schedule = counts.schedules.get(season)
        if schedule is None:
            missing.append(f"the schedule knowledge (kickoffs, home field, pairing) for {season}")
            continue
        missing += _schedule_misses(schedule, t.weeks)
        missing += [
            f"stamped injury filings ({InjuryMetric.REPORT_STATUS}) for {season} week {w}"
            for w in t.weeks
            if counts.filings.get((season, w), 0) <= 0
        ]
    missing += [f"ADP ({t.adp_source}) for {s}" for s in t.adp_seasons if counts.adp.get(s, 0) <= 0]
    return missing


_PLAYER_COUNTS: Final = text(
    "select source, metric, season, count(*) as n from research.player_week_observations "
    "where season = any(:seasons) and source = any(:sources) and metric = any(:metrics) group by 1, 2, 3"
)
_TEAM_COUNTS: Final = text(
    "select source, metric, season, count(*) as n from research.team_week_observations "
    "where season = any(:seasons) and source = any(:sources) and metric = any(:metrics) group by 1, 2, 3"
)
_EDGE_COUNTS: Final = text(
    "select season, count(*) as n from research.player_week_teams where season = any(:seasons) group by 1"
)
_FILINGS: Final = text(
    "select season, week, count(*) as n from research.player_week_observations "
    "where source = :source and metric = :metric and season = any(:seasons) group by season, week"
)
_ADP: Final = text(
    "select season, count(*) as n from research.preseason_rankings "
    "where source = :source and season = any(:seasons) group by season"
)


def _input_counts(conn: Connection, seasons: list[int]) -> dict[tuple[Input, int], int]:
    found: dict[tuple[Input, int], int] = {}
    for query, inputs in ((_PLAYER_COUNTS, PLAYER_INPUTS), (_TEAM_COUNTS, TEAM_INPUTS)):
        params = {
            "seasons": seasons,
            "sources": sorted({s for s, _ in inputs}),
            "metrics": sorted({m for _, m in inputs}),
        }
        for row in conn.execute(query, params):
            found[((str(row.source), str(row.metric)), int(row.season))] = int(row.n)
    for row in conn.execute(_EDGE_COUNTS, {"seasons": seasons}):
        found[(CLUB_EDGES, int(row.season))] = int(row.n)
    return found


def read_counts(conn: Connection, t: Thresholds) -> StoreCounts:
    seasons = list(round_seasons(t))
    filings = conn.execute(
        _FILINGS, {"source": INJURY_SOURCE, "metric": InjuryMetric.REPORT_STATUS, "seasons": seasons}
    )
    adp = conn.execute(_ADP, {"source": t.adp_source, "seasons": list(t.adp_seasons)})
    return StoreCounts(
        _input_counts(conn, list(input_seasons(t))),
        {(int(r.season), int(r.week)): int(r.n) for r in filings},
        {int(r.season): int(r.n) for r in adp},
        {season: read_schedule(conn, season) for season in seasons},
    )
