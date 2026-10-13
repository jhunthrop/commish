"""HIS SITUATION: who calls the plays, age and pedigree, the offence, the schedule, the market.

Ported from `research-ts/src/capsules/facts/{coaching,pedigree,team-context,schedule,market-
movement}.ts` and `projections/nflverse/play-callers.ts` (`headCoachLookup`). Each is a pure
function of rows the depth pass read once. "We cannot tell" is None, never False.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Final, Literal

from research.capsules.facts.depth_model import Coaching, Fixture, MarketMovement, Pedigree, Schedule, TeamContext
from research.model.instants import epoch_ms, js_iso
from research.model.jsmath import js_max, js_pow, js_round
from research.pipeline.coaches import PlayCallerRow, play_caller_lookup
from research.pipeline.nflverse.pbp import PbpMetric
from research.pipeline.nflverse.schedule import ScheduleMetric

_OPENING_WEEK: Final = 1
_DAYS_IN_A_YEAR: Final = 365.25
_MS_IN_A_DAY: Final = 24 * 60 * 60 * 1000
FANTASY_PLAYOFF_WEEKS: Final = (15, 16, 17)


def _role(role: str) -> Literal["HC", "OC"] | None:
    """A play caller's role as the table holds it (`readCoachRows` refuses any other)."""
    if role == "HC":
        return "HC"
    return "OC" if role == "OC" else None


def coaching_for(team: str, season: int, rows: Sequence[PlayCallerRow]) -> Coaching | None:
    """`coachingFor`: the opening week's play caller and head coach, and whether each is new."""
    caller_of = play_caller_lookup(rows)
    heads: dict[str, tuple[str, int | None]] = {}
    for row in rows:
        if row.head_coach != "":
            heads[f"{row.team}|{row.season}"] = (row.head_coach, row.head_coach_first_season)
    play_caller = caller_of(team, season, _OPENING_WEEK)
    prior_caller = caller_of(team, season - 1, _OPENING_WEEK)
    head = heads.get(f"{team}|{season}")
    if play_caller is None and head is None:
        return None
    role = next(
        (
            _role(row.role)
            for row in rows
            if row.team == team and row.season == season and row.start_week <= _OPENING_WEEK <= row.end_week
        ),
        None,
    )
    return Coaching(
        season,
        None if head is None else head[0],
        None if head is None or head[1] is None else head[1] == season,
        play_caller,
        None if play_caller is None else role,
        None if play_caller is None or prior_caller is None else prior_caller != play_caller,
    )


@dataclass(frozen=True, slots=True)
class PedigreeRow:
    birth_date: date | None
    draft_year: int | None
    draft_pick: int | None
    draft_club: str | None
    rookie_season: int | None
    draft_round: int | None


def _age_on(birth: date | None, opening_day: datetime | None) -> float | None:
    if birth is None or opening_day is None:
        return None
    born_ms = epoch_ms(datetime(birth.year, birth.month, birth.day, tzinfo=UTC))
    years = (epoch_ms(opening_day) - born_ms) / _MS_IN_A_DAY / _DAYS_IN_A_YEAR
    return None if years <= 0 else js_round(years * 10) / 10


def pedigree_for(
    row: PedigreeRow, opening_day: datetime | None, product_season: int, college: str | None
) -> Pedigree | None:
    """`pedigreeFor`: None when not one field is known."""
    seasons = None if row.rookie_season is None else int(js_max(0, product_season - row.rookie_season))
    pedigree = Pedigree(
        _age_on(row.birth_date, opening_day),
        college,
        seasons,
        row.draft_year,
        row.draft_round,
        row.draft_pick,
        row.draft_club,
        None if row.draft_year is None else row.draft_pick is None,
    )
    stated = any(
        value is not None
        for value in (
            pedigree.age_on_opening_day,
            pedigree.college,
            pedigree.seasons_played,
            pedigree.draft_year,
            pedigree.draft_round,
            pedigree.draft_pick,
            pedigree.draft_club,
            pedigree.undrafted,
        )
    )
    return pedigree if stated else None


@dataclass(frozen=True, slots=True)
class TeamMetricRow:
    week: int
    metric: str
    value: float


def _mean_of(rows: Sequence[TeamMetricRow], metric: str, digits: int) -> float | None:
    values = [row.value for row in rows if row.metric == metric]
    if not values:
        return None
    factor = js_pow(10, digits)
    total = 0.0
    for value in values:
        total += value
    return js_round((total / len(values)) * factor) / factor


def _sum_of(rows: Sequence[TeamMetricRow], metric: str) -> float | None:
    values = [row.value for row in rows if row.metric == metric]
    if not values:
        return None
    total = 0.0
    for value in values:
        total += value
    return total


def _first_of(rows: Sequence[TeamMetricRow], metric: str) -> float | None:
    return next((row.value for row in rows if row.metric == metric), None)


def team_context_for(
    prior_season: int, prior_rows: Sequence[TeamMetricRow], week_one_rows: Sequence[TeamMetricRow]
) -> TeamContext | None:
    """`teamContextFor`: last season's pace, pass rate and wins, this season's week-one game line."""
    context = TeamContext(
        prior_season,
        _mean_of(prior_rows, PbpMetric.PACE_SECONDS_PER_PLAY, 1),
        _mean_of(prior_rows, PbpMetric.PASS_RATE, 3),
        _sum_of(prior_rows, ScheduleMetric.GAME_RESULT),
        _first_of(week_one_rows, ScheduleMetric.IMPLIED_TEAM_TOTAL),
        _first_of(week_one_rows, ScheduleMetric.POINT_SPREAD),
    )
    stated = (
        context.pace_seconds_per_play,
        context.pass_rate,
        context.wins,
        context.week_one_implied_total,
        context.week_one_spread,
    )
    return context if any(value is not None for value in stated) else None


@dataclass(frozen=True, slots=True)
class ScheduledGame:
    week: int
    home_team: str
    away_team: str


def schedule_for(team: str, games: Sequence[ScheduledGame], indoors_by_week: Mapping[int, bool]) -> Schedule | None:
    """`scheduleFor`: the published fixtures, counted, with no strength judgment."""
    fixtures = sorted(
        (
            Fixture(g.week, g.away_team if g.home_team == team else g.home_team, g.home_team == team)
            for g in games
            if team in (g.home_team, g.away_team)
        ),
        key=lambda fixture: fixture.week,
    )
    if not fixtures:
        return None
    known = [f for f in fixtures if f.week in indoors_by_week]
    indoor = None if not known else sum(1 for f in known if indoors_by_week.get(f.week) is True)
    return Schedule(
        next((f for f in fixtures if f.week == _OPENING_WEEK), None),
        sum(1 for f in fixtures if f.home),
        sum(1 for f in fixtures if not f.home),
        indoor,
        tuple(f for f in fixtures if f.week in FANTASY_PLAYOFF_WEEKS),
    )


@dataclass(frozen=True, slots=True)
class AdpCapture:
    adp: float
    captured_at: datetime


def market_movement_for(history: Sequence[AdpCapture]) -> MarketMovement | None:
    """`marketMovementFor`: the earliest and latest captures in the window, on different days."""
    if len(history) < 2:  # noqa: PLR2004 - a movement needs two captures
        return None
    ordered = sorted(history, key=lambda capture: epoch_ms(capture.captured_at))
    earlier, latest = ordered[0], ordered[-1]
    earlier_at, latest_at = js_iso(earlier.captured_at)[:10], js_iso(latest.captured_at)[:10]
    if earlier_at == latest_at:
        return None
    picks = js_round((earlier.adp - latest.adp) * 10) / 10
    return MarketMovement(latest.adp, latest_at, earlier.adp, earlier_at, picks)
