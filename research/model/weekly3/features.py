"""ONE GAME'S STAGE-1 INPUTS: a player's means, his withheld teammates' work, his club's pace and
pass rate, the opponent's allowance and home field, each default marked.

Preregistration section 2 item 2 and the missing-input table. For player i at position p on club
c, week W, read at t_g (`Snapshot`): his season-to-date mean of each kind over his games this season
before W; his mean over his last three games played before W (over the games he has when fewer);
his prior-season mean (0 with the no-prior-season indicator when he has none); vacated volume, the
sum over club teammates whose week-W filing at t_g lists them Out or Doubtful and who played in one
of the club's last three games of their last-three-games mean (a withheld teammate who played none
of them adds 0, counted); the club's pace and pass rate, each the unweighted mean over the club's
games before W that carry a value (with none, the fit population's mean at the design row,
counted); the opponent's allowance of every kind (`allowance.py`); home field. A player with no game
this season has no inputs: his number is the rate (`number.py`).
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from typing import Final

from research.model.weekly2.designation import WITHHELD
from research.model.weekly3.allowance import Allowance
from research.model.weekly3.instant import Schedule
from research.model.weekly3.snapshot import Snapshot
from research.model.weekly3.work import ONES, ZERO, Kind, PlayerGame, Work, mean_work, sum_work
from research.pipeline.nflverse.pbp import PbpMetric

LAST_GAMES: Final = 3  # section 2 item 2: "his last three games played", "the club's last three games"
NEUTRAL_HOME: Final = 0.5  # section 2 item 5: the neutral game's home field

FEWER_THAN_THREE: Final = "fewer_than_three_games"
NO_PRIOR_SEASON: Final = "no_prior_season"
TEAMMATE_NOT_IN_LAST_THREE: Final = "withheld_teammate_not_in_the_clubs_last_three"
CLUB_GAME_WITHOUT_PACE: Final = "club_game_without_pace_or_pass_rate"
NO_FILING: Final = "no_filing"

AllowanceOf = Callable[[str, Kind], Allowance]  # (position, kind) -> the opponent's allowance


@dataclass(frozen=True, slots=True)
class Features:
    season_mean: Work
    last_three: Work
    prior: Work
    no_prior: bool
    vacated: Work
    pace: float | None
    pass_rate: float | None
    allowance: Work  # snap share carries 1: the snap-share lines read no allowance
    home: float
    defaults: frozenset[str]
    vacating: int  # withheld teammates counted in the vacated volume


def last_three(games: tuple[PlayerGame, ...]) -> Work:
    return mean_work([g.work for g in games[-LAST_GAMES:]])


def vacated(player_id: str, club: str, snapshot: Snapshot, schedule: Schedule) -> tuple[Work, int, int]:
    """The vacated volume, the teammates counted in it, and the withheld teammates left out because
    they played none of the club's last three games."""
    recent = set(schedule.club_weeks(club, snapshot.week)[-LAST_GAMES:])
    counted: list[Work] = []
    left_out = 0
    for teammate, status in sorted(snapshot.statuses.items()):
        if teammate == player_id or status != WITHHELD or snapshot.clubs.get(teammate) != club:
            continue
        played = snapshot.games.get(teammate, ())
        if any(g.week in recent and g.club == club for g in played):
            counted.append(last_three(played))
        else:
            left_out += 1
    return sum_work(counted), len(counted), left_out


def _club_mean(snapshot: Snapshot, schedule: Schedule, club: str, metric: str) -> tuple[float | None, bool]:
    """The mean over the club's games before W that carry the metric, and whether any lacked it."""
    weeks = schedule.club_weeks(club, snapshot.week)
    values = [v for w in weeks if (v := snapshot.team_rows.get((club, w), {}).get(metric)) is not None]
    return (sum(values) / len(values) if values else None), len(values) < len(weeks)


def _allowances(position: str, allowance_of: AllowanceOf, kinds: tuple[Kind, ...]) -> tuple[Work, set[str]]:
    found = ONES
    defaults: set[str] = set()
    for kind in kinds:
        given = allowance_of(position, kind)
        found = found.with_kind(kind, given.value)
        if given.default is not None:
            defaults.add(given.default)
    return found, defaults


def game_features(  # noqa: PLR0913, PLR0917 - one game's every input, named
    player_id: str,
    position: str,
    club: str,
    snapshot: Snapshot,
    prior: Mapping[str, Work],
    schedule: Schedule,
    allowance_of: AllowanceOf,
    kinds: tuple[Kind, ...],
) -> Features | None:
    """His stage-1 inputs for his club's week-W game at the snapshot's instant; None when he has no
    game this season before W."""
    games = snapshot.games.get(player_id, ())
    if not games:
        return None
    defaults: set[str] = set().union(*(g.defaults for g in games))
    if len(games) < LAST_GAMES:
        defaults.add(FEWER_THAN_THREE)
    own_prior = prior.get(player_id)
    if own_prior is None:
        defaults.add(NO_PRIOR_SEASON)
    vacancy, vacating, left_out = vacated(player_id, club, snapshot, schedule)
    if left_out:
        defaults.add(TEAMMATE_NOT_IN_LAST_THREE)
    pace, pace_short = _club_mean(snapshot, schedule, club, PbpMetric.PACE_SECONDS_PER_PLAY)
    pass_rate, rate_short = _club_mean(snapshot, schedule, club, PbpMetric.PASS_RATE)
    if pace_short or rate_short:
        defaults.add(CLUB_GAME_WITHOUT_PACE)
    allowance, allowance_defaults = _allowances(position, allowance_of, tuple(k for k in kinds if k != "snap_share"))
    home = schedule.home(snapshot.week, club)
    if home is None:
        raise ValueError(f"no home_field row for {club} in {snapshot.season} week {snapshot.week}")
    if player_id not in snapshot.statuses:
        defaults.add(NO_FILING)
    return Features(
        mean_work([g.work for g in games]),
        last_three(games),
        ZERO if own_prior is None else own_prior,
        own_prior is None,
        vacancy,
        pace,
        pass_rate,
        allowance,
        home,
        frozenset(defaults | allowance_defaults),
        vacating,
    )


def neutral(features: Features) -> Features:
    """Section 2 item 5's neutral game: vacated volume 0, every allowance 1, home 0.5, the last-three
    mean set to the season-to-date mean, everything else as for the game."""
    return replace(features, last_three=features.season_mean, vacated=ZERO, allowance=ONES, home=NEUTRAL_HOME)


def without_vacated(features: Features) -> Features:
    """The reported ablation: round 3 without vacated volume."""
    return replace(features, vacated=ZERO)


def without_allowances(features: Features) -> Features:
    """The reported ablation: round 3 without the allowances."""
    return replace(features, allowance=ONES)
