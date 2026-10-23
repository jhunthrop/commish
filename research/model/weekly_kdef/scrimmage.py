"""THE PLAYS AT t_g (design 5.2 and 5.3): the opposing passer, yards per play, and the fourth-down habit.

Read through the input rule's `plays` kind (the season's plays of weeks before W stamped at or before t_g)
and `prior` kind (the season before, read once at the season's first instant, refused unless none of its
plays is stamped after it), and the week-W depth chart (`depth`, or `depth_prior` on the stamp check's
fail: the coordinator's recorded rule, round 4 section 5 item 6).

- **The opposing passer** (the interceptions row; Amendment 7 item 6's `no_passer_history`): the club's
  first quarterback on its depth chart at t_g, passing over one filed Out or Doubtful for week W to the next
  quarterback on it; with no chart, the passer of the most dropbacks in the club's latest game before W,
  unless he is filed out. His interceptions per dropback this season before W and the season before, shrunk
  in the beta-binomial form toward the league's rate. With no dropback read, or no starter evidenced, the
  prior and `no_passer_history` 1.
- **Yards per play** (the yards-allowed row): a club's yards gained per scrimmage play and its defense's
  yards allowed per play, this season before W and the season before, each shrunk in the normal form (k by
  the method of moments over the clubs, in plays) toward the league's yards per play.
- **The fourth-down habit** (the field-goal attempts row): a club's share of its fourth downs inside the
  opponent's 40 it went for (a pass or a run, against a field goal or a punt), beta-binomial toward the
  league's share.

The priors are the season before's (this season's admitted plays when the season before has none: the
play table starts in 2016).
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.model.reads.observations import LAST_POSSIBLE_WEEK
from research.model.weekly3.ledger import SEASON_WIDE, InputRuleError, Stamp
from research.model.weekly4.features import reads
from research.model.weekly4.features.admitted import admit_read
from research.model.weekly4.features.depth import DepthRule, depth_charts
from research.model.weekly4.features.plays import Play, dropper, is_dropback
from research.model.weekly4.features.reads import DepthRow, as_of_rows
from research.model.weekly4.features.view import PLAY_PAIRS
from research.model.weekly_kdef.rates import (
    GamePrior,
    TrialPrior,
    moments_prior,
    shrunk_per_game,
    shrunk_rate,
    trials_prior,
)
from research.pipeline.nflverse.team_eras import current_code, season_code

QUARTERBACK: Final = "QB"
SCRIMMAGE: Final = ("pass", "run")
FOURTH_DOWN: Final = 4
FIELD_GOAL_RANGE: Final = 40  # "inside the 40": the ball at or inside the opponent's 40-yard line
KICKS: Final = ("field_goal", "punt")
_PRIOR_PLAYS_AFTER: Final = text(
    "select count(*) from research.nflverse_pbp_plays where season = :prior_season and as_of > :after"
)


@dataclass(frozen=True, slots=True)
class SeasonPlays:
    season: int
    plays: tuple[Play, ...]
    prior: tuple[Play, ...]
    depth: tuple[DepthRow, ...]
    rule: DepthRule
    prior_tally: "PlayTally"  # the season before's, tallied once


def read_season_plays(  # noqa: PLR0913, PLR0917 - a season's reads, named
    conn: Connection, season: int, first: datetime, last: datetime, last_week: int, rule: DepthRule
) -> tuple[SeasonPlays, Stamp]:
    """The season's plays and depth charts through its last instant, and the season before's plays read
    once at its first instant (refused unless none of them is stamped after it)."""
    later = int(conn.execute(_PRIOR_PLAYS_AFTER, {"prior_season": season - 1, "after": first}).scalar_one())
    if later > 0:
        raise InputRuleError(
            f"{later} plays of {season - 1} are stamped after {first}; one read of the season before is not exact"
        )
    prior = [_serving(season, p) for p in reads.plays(conn, season - 1, LAST_POSSIBLE_WEEK, first)]
    stamp = admit_read("prior", PLAY_PAIRS, prior, season, SEASON_WIDE, first)
    found = SeasonPlays(
        season,
        tuple(reads.plays(conn, season, last_week - 1, last)),
        tuple(prior),
        tuple(reads.depth_rows(conn, season, last_week, last)),
        rule,
        tally_plays(prior),
    )
    return found, stamp


def _serving(season: int, p: Play) -> Play:
    """A season-before play with its clubs spelled as the season it serves spells them (OAK's 2019 plays
    as LV's for 2020), so a relocated club's history joins its rows."""

    def spelled(code: str | None) -> str | None:
        return None if code is None else season_code(season, current_code(code))

    return replace(p, posteam=spelled(p.posteam), defteam=spelled(p.defteam))


def _scrimmage(p: Play) -> bool:
    return p.play_type in SCRIMMAGE and not p.two_point_attempt


Snap = tuple[str, str, int, int]


@dataclass(slots=True)
class PlayTally:
    passers: dict[str, list[float]]  # passer -> [interceptions, dropbacks]
    latest: dict[str, str]  # club -> its latest game's passer of the most dropbacks
    gained: dict[str, list[float]]  # offense -> yards per scrimmage play
    allowed: dict[str, list[float]]  # defense -> yards per scrimmage play
    fourth: dict[str, list[float]]  # offense -> [went for it, fourth downs in field-goal range]
    # (offense, defense, season, week) -> [scrimmage plays, dropbacks, interceptions]: each game's exposure
    snaps: dict[Snap, list[float]]


def _latest(games: Mapping[tuple[str, int, int, str], int]) -> dict[str, str]:
    """Per club its latest game's passer of the most dropbacks (then the larger id, so the pick is fixed)."""
    found: dict[str, tuple[int, int, int, str]] = {}
    for (club, season, week, who), count in games.items():
        key = (season, week, count, who)
        found[club] = max(found.get(club, key), key)
    return {club: key[3] for club, key in found.items()}


def tally_plays(plays: Sequence[Play]) -> PlayTally:
    snaps: dict[Snap, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    passers: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    games: dict[tuple[str, int, int, str], int] = defaultdict(int)
    gained: dict[str, list[float]] = defaultdict(list)
    allowed: dict[str, list[float]] = defaultdict(list)
    fourth: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for p in plays:
        if p.posteam is None:
            continue
        who = dropper(p) if is_dropback(p) else None
        if who is not None:
            passers[who][0] += float(bool(p.interception))
            passers[who][1] += 1.0
            games[(p.posteam, p.season, p.week, who)] += 1
        if _scrimmage(p) and p.defteam is not None:
            game = snaps[(p.posteam, p.defteam, p.season, p.week)]
            game[0] += 1.0
            game[1] += float(is_dropback(p))
            game[2] += float(is_dropback(p) and bool(p.interception))
        if _scrimmage(p) and p.yards_gained is not None and p.defteam is not None:
            gained[p.posteam].append(float(p.yards_gained))
            allowed[p.defteam].append(float(p.yards_gained))
        in_range = p.down == FOURTH_DOWN and p.yardline_100 is not None and p.yardline_100 <= FIELD_GOAL_RANGE
        if in_range and (_scrimmage(p) or p.play_type in KICKS):
            fourth[p.posteam][0] += float(_scrimmage(p))
            fourth[p.posteam][1] += 1.0
    return PlayTally(dict(passers), _latest(games), dict(gained), dict(allowed), dict(fourth), dict(snaps))


def merged(before: PlayTally, after: PlayTally) -> PlayTally:
    """The season before's tally with this season's after it (its latest passer wins where it has one)."""

    def summed[K](a: Mapping[K, list[float]], b: Mapping[K, list[float]]) -> dict[K, list[float]]:
        width = len(next(iter({**a, **b}.values()), []))
        zero = [0.0] * width
        return {k: [x + y for x, y in zip(a.get(k, zero), b.get(k, zero), strict=True)] for k in {*a, *b}}

    def joined(a: Mapping[str, list[float]], b: Mapping[str, list[float]]) -> dict[str, list[float]]:
        return {k: [*a.get(k, []), *b.get(k, [])] for k in {*a, *b}}

    return PlayTally(
        summed(before.passers, after.passers),
        {**before.latest, **after.latest},
        joined(before.gained, after.gained),
        joined(before.allowed, after.allowed),
        summed(before.fourth, after.fourth),
        summed(before.snaps, after.snaps),
    )


def starter(
    club: str,
    chart: Mapping[str, Mapping[str, int]],
    quarterbacks: frozenset[str],
    latest: Mapping[str, str],
    withheld: frozenset[str],
) -> str | None:
    listed = sorted((rank, pid) for pid, rank in chart.get(club, {}).items() if pid in quarterbacks)
    for _, pid in listed:
        if pid not in withheld:
            return pid
    if listed:
        return None
    fallback = latest.get(club)
    return None if fallback is None or fallback in withheld else fallback


@dataclass(frozen=True, slots=True)
class Priors:
    passer: TrialPrior
    yards: GamePrior  # per play, k in plays
    fourth: TrialPrior


def _priors(t: PlayTally) -> Priors:
    return Priors(
        trials_prior([v[0] for v in t.passers.values()], [v[1] for v in t.passers.values()]),
        moments_prior(list(t.gained.values())),
        trials_prior([v[0] for v in t.fourth.values()], [v[1] for v in t.fourth.values()]),
    )


@dataclass(frozen=True, slots=True)
class PlayView:
    """Every club's play terms at one instant (`of`)."""

    tally: PlayTally
    starters: Mapping[str, str | None]
    priors: Priors
    stamps: tuple[Stamp, ...]

    def of(self, offense: str, defense: str) -> dict[str, float]:
        who = self.starters.get(offense)
        ints, dropbacks = self.tally.passers.get(who, [0.0, 0.0]) if who is not None else [0.0, 0.0]
        gained = self.tally.gained.get(offense, [])
        allowed = self.tally.allowed.get(defense, [])
        went, chances = self.tally.fourth.get(offense, [0.0, 0.0])
        p = self.priors
        return {
            "passer_int_rate": shrunk_rate(ints, dropbacks, p.passer.rate, p.passer),
            "no_passer_history": float(dropbacks <= 0),
            "off_yards_per_play": shrunk_per_game(sum(gained), float(len(gained)), p.yards),
            "def_yards_per_play_allowed": shrunk_per_game(sum(allowed), float(len(allowed)), p.yards),
            "league_yards_per_play": p.yards.mean,
            "fourth_down_go_rate": shrunk_rate(went, chances, p.fourth.rate, p.fourth),
        }


def plays_at(sp: SeasonPlays, week: int, moment: datetime, withheld: frozenset[str]) -> PlayView:
    """Every club's play terms at one instant."""
    admitted = as_of_rows(sp.plays, 1, week - 1, moment)
    stamp = admit_read("plays", PLAY_PAIRS, admitted, sp.season, week, moment)
    chart = depth_charts(sp.depth, sp.season, week, moment, sp.rule)
    quarterbacks = frozenset(r.player_id for r in sp.depth if r.position == QUARTERBACK)
    current = tally_plays(admitted)
    tally = merged(sp.prior_tally, current)
    priors = _priors(sp.prior_tally if sp.prior else current)
    clubs = {*chart.ranks, *tally.latest}
    starters = {club: starter(club, chart.ranks, quarterbacks, tally.latest, withheld) for club in clubs}
    return PlayView(tally, starters, priors, (stamp, chart.stamp))
