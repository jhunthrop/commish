"""TEAMMATES OUT AND TEAMMATES RETURNING (round 4 preregistration, section 2.2).

**Vacated shares** (round 3's rule, on shares): over club teammates whose latest week-W filing at
t_g lists them Out or Doubtful and who played in one of the club's last three games, the sum of their
last-three-games shares of each kind. A withheld teammate who played none of them adds 0, counted.

**Returning shares.** A teammate counts as returning for week W only when he missed at least one of
the club's last three games and at most all three, played at least one game this season before the
absence (his pre-absence share: his share over his last three games played before it), and there is
evidence he plays: a week-W filing at t_g that is not Out or Doubtful, or a row on the week-W depth
chart (when the chart check fails and the replay reads week W-1's chart, only the filing counts). No
filing never means returned; such a teammate is counted as absent.

The absence, read here: the run of the club's last three games he missed that ends with the club's
latest game. A teammate who missed an earlier one of the three and has played since is not away, so
he has no absence to return from (the report names this reading).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from research.model.weekly2.designation import WITHHELD, WeekStatus
from research.model.weekly4.features.plays import ZERO_COUNTS, Counts
from research.model.weekly4.features.shares import LAST_GAMES, GameShare, share_vector


@dataclass(frozen=True, slots=True)
class Teammates:
    """What one club-game's teammate terms read at t_g."""

    club: str
    recent_weeks: tuple[int, ...]  # the club's last three games before W, by week
    histories: Mapping[str, Sequence[GameShare]]  # each player's games this season before W
    clubs: Mapping[str, str]  # each player's latest club before W
    statuses: Mapping[str, WeekStatus]  # week W's latest filing at t_g, filed players only
    depth: frozenset[str] | None  # the week-W chart's players at the club; None on the W-1 fallback


@dataclass(frozen=True, slots=True)
class Vacated:
    shares: Counts
    counted: int
    left_out: int


@dataclass(frozen=True, slots=True)
class Returning:
    shares: Counts
    counted: int
    without_evidence: int
    without_pre_absence: int


def _mates(player_id: str, t: Teammates) -> list[str]:
    return sorted(pid for pid, club in t.clubs.items() if club == t.club and pid != player_id)


def _at_club(t: Teammates, pid: str) -> list[GameShare]:
    return [g for g in t.histories.get(pid, ()) if g.club == t.club]


def vacated(player_id: str, t: Teammates) -> Vacated:
    recent = set(t.recent_weeks)
    total, counted, left_out = ZERO_COUNTS, 0, 0
    for pid in _mates(player_id, t):
        if t.statuses.get(pid) != WITHHELD:
            continue
        games = _at_club(t, pid)
        if any(g.week in recent for g in games):
            total = total.plus(share_vector(games[-LAST_GAMES:]))
            counted += 1
        else:
            left_out += 1
    return Vacated(total, counted, left_out)


def absence_start(played: set[int], recent: Sequence[int]) -> int | None:
    """The first week of the run of the club's last games he missed that ends with its latest game."""
    start = None
    for week in reversed(recent):
        if week in played:
            break
        start = week
    return start


def _evidence(pid: str, t: Teammates) -> bool:
    status = t.statuses.get(pid)
    on_chart = t.depth is not None and pid in t.depth
    return (status is not None and status != WITHHELD) or on_chart


def returning(player_id: str, t: Teammates) -> Returning:
    total, counted, no_evidence, no_before = ZERO_COUNTS, 0, 0, 0
    for pid in _mates(player_id, t):
        games = _at_club(t, pid)
        start = absence_start({g.week for g in games}, t.recent_weeks)
        if start is None or t.statuses.get(pid) == WITHHELD:
            continue
        before = [g for g in games if g.week < start]
        if not before:
            no_before += 1
            continue
        if not _evidence(pid, t):
            no_evidence += 1
            continue
        total = total.plus(share_vector(before[-LAST_GAMES:]))
        counted += 1
    return Returning(total, counted, no_evidence, no_before)
