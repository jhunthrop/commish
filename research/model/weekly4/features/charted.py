"""THE CHARTED FEATURES: Next Gen Stats and PFR via nflverse, season to date (round 4
preregistration, sections 2.2 and 2.3; section 5 item 8 and amendment 1 note 5).

A week's NGS and PFR rows are admitted in replay at the in-season pass of the Wednesday 18:00 New
York after the week's last game (its kickoff plus the depth chart ingest's game length), whatever
their stored stamp: `restamp` gives each row that stamp before the instant's view reads it.

Each feature is the player's season to date over the weeks he has a row, weighted as the feed
weights it: NGS rush yards over expected per carry (by carries), average separation (by targets),
completion over expectation and time to throw (by attempts); PFR broken tackles per touch (his
broken tackles over his designed rushes, scrambles and receptions in those weeks, from the plays)
and a quarterback's times pressured per dropback (over his dropbacks in those weeks). With no row
the feature is NaN with its missing indicator (2.10).
"""

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import replace
from datetime import UTC, datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from research.model.weekly3.instant import Schedule
from research.model.weekly3.ledger import InputRuleError
from research.model.weekly4.features.admitted import PRESSURED_METRIC
from research.model.weekly4.features.plays import PlayerTally
from research.pipeline.nflverse.depth_chart_weeks import GAME_LENGTH
from research.pipeline.observations import PlayerWeekObservation

_NEW_YORK: Final = ZoneInfo("America/New_York")
_WEDNESDAY: Final = 2
_PASS_AT: Final = time(18, 0)

# (feature, value metric, weight metric) for the NGS weighted means.
NGS_FEATURES: Final = (
    ("ngs_rush_yards_over_expected_per_carry", "rush_yards_over_expected_per_att", "rush_attempts"),
    ("ngs_average_separation", "rec_avg_separation", "rec_targets"),
    ("ngs_completion_over_expected", "pass_completion_pct_above_expectation", "pass_attempts"),
    ("ngs_time_to_throw", "pass_avg_time_to_throw", "pass_attempts"),
)
PFR_BROKEN_TACKLES: Final = "pfr_broken_tackles_per_touch"
PFR_PRESSURED: Final = "pfr_pressured_per_dropback"
CHARTED_FEATURES: Final = (*(name for name, _, _ in NGS_FEATURES), PFR_BROKEN_TACKLES, PFR_PRESSURED)
_BROKEN: Final = ("receiving_broken_tackles", "rushing_broken_tackles")


def missing_indicator(feature: str) -> str:
    return f"no_{feature}"


def wednesday_pass_after(last_kickoff: datetime) -> datetime:
    """The first Wednesday 18:00 New York at or after the week's last game is over."""
    over = (last_kickoff + GAME_LENGTH).astimezone(_NEW_YORK)
    days = (_WEDNESDAY - over.weekday()) % 7
    candidate = datetime.combine(over.date() + timedelta(days=days), _PASS_AT, _NEW_YORK)
    if candidate < over:
        candidate += timedelta(days=7)
    return candidate.astimezone(UTC)


def week_passes(schedule: Schedule) -> dict[int, datetime]:
    last: dict[int, datetime] = {}
    for (week, _), kickoff in schedule.kickoffs.items():
        last[week] = max(last.get(week, kickoff), kickoff)
    return {week: wednesday_pass_after(kickoff) for week, kickoff in last.items()}


def restamp(rows: Sequence[PlayerWeekObservation], passes: Mapping[int, datetime]) -> list[PlayerWeekObservation]:
    """Each row stamped at its week's Wednesday pass (item 8); a week with no kickoff is refused."""
    missing = sorted({row.week for row in rows} - set(passes))
    if missing:
        raise InputRuleError(f"charted rows of weeks {missing} have no kickoff, so no Wednesday pass admits them")
    return [replace(row, as_of=passes[row.week]) for row in rows]


def charted_at(
    versions: Sequence[PlayerWeekObservation], passes: Mapping[int, datetime], week: int, moment: datetime
) -> list[PlayerWeekObservation]:
    """What the charted read returns at t_g: of each row's stored versions of weeks before W, the
    newest stored at or before t_g, then stamped at its Wednesday pass and kept if that pass is at
    or before t_g (a version stored after t_g never reaches an earlier instant)."""
    newest: dict[tuple[int, str, str, str], PlayerWeekObservation] = {}
    for row in versions:
        if row.week >= week or row.as_of > moment:
            continue
        key = (row.week, row.player_id, row.source, row.metric)
        held = newest.get(key)
        if held is None or row.as_of >= held.as_of:
            newest[key] = row
    ordered = [newest[k] for k in sorted(newest)]
    return [row for row in restamp(ordered, passes) if row.as_of <= moment]


def _weighted(values: Mapping[int, float], weights: Mapping[int, float]) -> float:
    total = sum(weights.get(w, 0.0) for w in values)
    if total <= 0:
        return math.nan
    return sum(v * weights.get(w, 0.0) for w, v in values.items()) / total


def charted_features(
    rows: Sequence[PlayerWeekObservation], tallies: Mapping[int, PlayerTally]
) -> tuple[dict[str, float], frozenset[str]]:
    """His charted features from his rows admitted at the instant, and the missing indicators set.
    `tallies` are his plays' tallies by week, for the touches and dropbacks PFR's counts are over."""
    by_metric: dict[str, dict[int, float]] = defaultdict(dict)
    for row in rows:
        by_metric[row.metric][row.week] = row.value
    found: dict[str, float] = {}
    for name, value, weight in NGS_FEATURES:
        found[name] = _weighted(by_metric.get(value, {}), by_metric.get(weight, {}))
    broken_weeks = {w for m in _BROKEN for w in by_metric.get(m, {})}
    touches = sum(t.receptions + t.rush_attempts for w, t in tallies.items() if w in broken_weeks)
    broken = sum(by_metric.get(m, {}).get(w, 0.0) for m in _BROKEN for w in broken_weeks)
    found[PFR_BROKEN_TACKLES] = broken / touches if touches > 0 else math.nan
    pressured = by_metric.get(PRESSURED_METRIC, {})
    dropbacks = sum(t.counts.dropbacks for w, t in tallies.items() if w in pressured)
    found[PFR_PRESSURED] = sum(pressured.values()) / dropbacks if dropbacks > 0 else math.nan
    return found, frozenset(missing_indicator(n) for n, v in found.items() if math.isnan(v))
