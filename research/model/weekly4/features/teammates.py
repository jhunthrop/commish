"""TEAMMATES OUT AND TEAMMATES RETURNING (round 4 preregistration, section 2.2, amendment 2 items 4
and 9).

**Vacated shares** (round 3's rule, on shares): over club teammates whose latest week-W filing at
t_g lists them Out or Doubtful and who played in one of the club's last three games, the sum of their
last-three-games shares of each kind. A withheld teammate who played none of them adds 0, counted.
Round 3's rule reads "his last three games" over every club of his season; here they are his last
three games at this club, since a share is of this club's volume (a share of another club's volume
says nothing about this one's).

**Returning shares.** A teammate counts as returning for week W only when he missed the club's
latest game, his absence being the run of the club's missed games ending with it, reaching back at
most three games (amendment 2 item 4); he played at least one game this season before the absence
(his pre-absence share: the mean of his per-game shares over his last three games played before it,
item 9); and there is evidence he plays: a week-W filing at t_g that is not Out or Doubtful, or a
row on the week-W depth chart (when the chart check fails and the replay reads week W-1's chart,
only the filing counts). No filing never means returned; such a teammate is counted as absent. The
results count, per season, the returning teammates whose absence carried no Out or Doubtful filing.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from research.model.weekly2.designation import WITHHELD, WeekStatus
from research.model.weekly4.features.plays import ZERO_COUNTS, Counts
from research.model.weekly4.features.shares import LAST_GAMES, GameShare, mean_share_vector, share_vector


@dataclass(frozen=True, slots=True)
class Teammates:
    """What one club-game's teammate terms read at t_g."""

    club: str
    recent_weeks: tuple[int, ...]  # the club's last three games before W, by week
    histories: Mapping[str, Sequence[GameShare]]  # each player's games this season before W
    clubs: Mapping[str, str]  # each player's latest club before W
    statuses: Mapping[str, WeekStatus]  # week W's latest filing at t_g, filed players only
    depth: frozenset[str] | None  # the week-W chart's players at the club; None on the W-1 fallback
    # Each earlier week's latest filing at t_g, (player, week) -> state: the absence's filings.
    earlier: Mapping[tuple[str, int], WeekStatus] = field(default_factory=dict)


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
    without_withheld_filing: int = 0  # of `counted`: no Out or Doubtful filing in any missed week


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


def absence(played: set[int], recent: Sequence[int]) -> list[int]:
    """The club's missed games ending with its latest one (empty when he played the latest)."""
    missed: list[int] = []
    for week in reversed(recent):
        if week in played:
            break
        missed.insert(0, week)
    return missed


def _evidence(pid: str, t: Teammates) -> bool:
    status = t.statuses.get(pid)
    on_chart = t.depth is not None and pid in t.depth
    return (status is not None and status != WITHHELD) or on_chart


def returning(player_id: str, t: Teammates) -> Returning:
    total, counted, no_evidence, no_before, unfiled = ZERO_COUNTS, 0, 0, 0, 0
    for pid in _mates(player_id, t):
        games = _at_club(t, pid)
        missed = absence({g.week for g in games}, t.recent_weeks)
        if not missed or t.statuses.get(pid) == WITHHELD:
            continue
        before = [g for g in games if g.week < missed[0]]
        if not before:
            no_before += 1
            continue
        if not _evidence(pid, t):
            no_evidence += 1
            continue
        total = total.plus(mean_share_vector(before[-LAST_GAMES:]))
        counted += 1
        unfiled += int(all(t.earlier.get((pid, week)) != WITHHELD for week in missed))
    return Returning(total, counted, no_evidence, no_before, unfiled)
