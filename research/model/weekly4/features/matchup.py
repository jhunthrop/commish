"""THE MATCHUP AND THE CLUBS' TEMPO (round 4 preregistration, sections 2.4 and 2.5).

- **Role allowances** on round 3's construction (`weekly3.allowance.ratio_allowance`, shrunk toward 1
  with 6 games of prior): to running backs, the share of their opportunities that came through the
  air; to wide receivers and tight ends, targets per game by depth (behind the line, under 10, 10 to
  19, 20 and over) and by location (outside, the middle). Round 3's volume allowances (targets,
  carries, red-zone opportunities, the quarterbacks' dropbacks) are read by round 3's own code.
- **Pressure**: the defence's sack rate and quarterback-hit rate per dropback faced over its games
  before W, from the play table; and the pressures it generates from PFR via nflverse, read here as
  the passers it faced: their `times_pressured` over their dropbacks in its games. With no game
  faced, or no PFR row (2016 and 2017 have none), the rate is NaN with its indicator.
- **Tempo**: each club's pace (seconds per neutral play) and pass rate over expectation, the mean
  over its games before W that carry a value (round 3's rule), shrunk with 6 games of prior: the
  pass rate over expectation toward 0, the pace toward the league's mean pace over the same weeks.
  With no value at all, NaN with `no_pace`. (The shrinkage targets are this lane's reading of "with
  the same shrinkage", named in the report.)
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from research.model.weekly3.allowance import ALLOWANCE_PRIOR_GAMES, Allowance, TeamRows, ValueAt, ratio_allowance
from research.model.weekly3.instant import Schedule
from research.model.weekly4.features.plays import DEPTH_BUCKETS, GroupTargets, Tallies
from research.pipeline.nflverse.pbp import PbpMetric

RB_AIR_SHARE: Final = "rb_air_share"
OUTSIDE: Final = "outside"
MIDDLE: Final = "middle"
ROLE_ALLOWANCES: Final = (RB_AIR_SHARE, *(f"depth_{b}" for b in DEPTH_BUCKETS), OUTSIDE, MIDDLE)
RECEIVER_POSITIONS: Final = frozenset({"WR", "TE"})
NO_PRESSURE_GAME: Final = "defence_without_a_dropback_faced"
NO_PFR_PRESSURE: Final = "defence_without_a_pfr_pressure_row"
NO_PACE: Final = "no_pace"
CLUB_GAME_WITHOUT_PACE: Final = "club_game_without_pace_or_pass_rate"


def _group_value(tallies: Tallies, position: str, name: str) -> ValueAt:
    def value(offence: str, at: int) -> float | None:
        if (offence, at) not in tallies.clubs:
            return None  # the game is not among the plays admitted at the instant
        group = tallies.groups.get((offence, at), {}).get(position, GroupTargets())
        if name == RB_AIR_SHARE:
            touches = group.air + group.ground
            return None if touches <= 0 else group.air / touches
        if name == OUTSIDE:
            return group.outside
        if name == MIDDLE:
            return group.middle
        return group.depth[DEPTH_BUCKETS.index(name.removeprefix("depth_"))]

    return value


def role_allowances(
    defence: str, week: int, position: str, schedule: Schedule, tallies: Tallies
) -> dict[str, Allowance]:
    """The role allowances that apply to the position (running backs: the air share; receivers:
    depth and location); the others are absent and read as 1, the shrinkage's prior."""
    if position == "RB":
        names: tuple[str, ...] = (RB_AIR_SHARE,)
    elif position in RECEIVER_POSITIONS:
        names = tuple(n for n in ROLE_ALLOWANCES if n != RB_AIR_SHARE)
    else:
        names = ()
    found: dict[str, Allowance] = {}
    for name in names:
        value = _group_value(tallies, position, name)
        found[name] = ratio_allowance(defence, week, schedule, value, value)
    return found


@dataclass(frozen=True, slots=True)
class DefencePressure:
    sack_rate: float
    hit_rate: float
    pfr_rate: float
    defaults: frozenset[str]


Pressured = Mapping[int, Mapping[str, float]]  # week -> passer -> PFR `times_pressured`


def defence_pressure(
    defence: str, week: int, schedule: Schedule, tallies: Tallies, pressured: Pressured
) -> DefencePressure:
    """D's pressure over its games before W, from the plays and the PFR rows admitted at the instant."""
    dropbacks = sacks = hits = 0.0
    pfr_pressures = pfr_dropbacks = 0.0
    for at in schedule.club_weeks(defence, week):
        faced = tallies.defences.get((defence, at))
        if faced is not None:
            dropbacks, sacks, hits = dropbacks + faced.dropbacks, sacks + faced.sacks, hits + faced.hits
        offence = schedule.opponent(at, defence)
        for pid, times in pressured.get(at, {}).items():
            tally = tallies.players.get((pid, at))
            if tally is not None and tally.club == offence:
                pfr_pressures += times
                pfr_dropbacks += tally.counts.dropbacks
    defaults: set[str] = set()
    if dropbacks <= 0:
        defaults.add(NO_PRESSURE_GAME)
    if pfr_dropbacks <= 0:
        defaults.add(NO_PFR_PRESSURE)
    return DefencePressure(
        sacks / dropbacks if dropbacks > 0 else math.nan,
        hits / dropbacks if dropbacks > 0 else math.nan,
        pfr_pressures / pfr_dropbacks if pfr_dropbacks > 0 else math.nan,
        frozenset(defaults),
    )


@dataclass(frozen=True, slots=True)
class Tempo:
    pace: float
    pass_rate_over_expected: float
    games: int
    defaults: frozenset[str]


def league_pace(rows: TeamRows) -> float:
    values = [v for found in rows.values() if (v := found.get(PbpMetric.PACE_SECONDS_PER_PLAY)) is not None]
    return sum(values) / len(values) if values else math.nan


def _shrunk(mean: float, games: int, toward: float) -> float:
    return (games * mean + ALLOWANCE_PRIOR_GAMES * toward) / (games + ALLOWANCE_PRIOR_GAMES)


def club_tempo(club: str, week: int, schedule: Schedule, rows: TeamRows, league: float) -> Tempo:
    weeks = schedule.club_weeks(club, week)
    paces = [v for w in weeks if (v := rows.get((club, w), {}).get(PbpMetric.PACE_SECONDS_PER_PLAY)) is not None]
    rates = [v for w in weeks if (v := rows.get((club, w), {}).get(PbpMetric.PASS_RATE_OVER_EXPECTED)) is not None]
    defaults: set[str] = set()
    if len(paces) < len(weeks) or len(rates) < len(weeks):
        defaults.add(CLUB_GAME_WITHOUT_PACE)
    if not paces or not rates:
        defaults.add(NO_PACE)
    pace = _shrunk(sum(paces) / len(paces), len(paces), league) if paces else math.nan
    rate = _shrunk(sum(rates) / len(rates), len(rates), 0.0) if rates else math.nan
    return Tempo(pace, rate, len(weeks), frozenset(defaults))
