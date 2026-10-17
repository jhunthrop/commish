"""THE OPPONENT'S POSITION-LEVEL ALLOWANCE: how much of a kind of work a defence leaves to a
position group, against what the same offences get elsewhere.

Preregistration section 2 item 3. For defence D, kind k and position p: the position group's total
of k per team-game (summed over players at p on the offence) in D's games of weeks before W stamped
at or before t_g, over the same offences' position-group totals of k per game in their games of
weeks before W, stamped at or before t_g, other than their games against D, shrunk toward 1 with 6
games of prior (the context ingest's own constant): A = (n x ratio + 6) / (n + 6), n being D's
games counted. The quarterbacks' pass-attempt version reads D's `defence_dropbacks_faced` over
those offences' `dropbacks`. D's games and each offence's opponents come from the pairing.

Readings, written down: the ratio is the mean over D's counted games of what D allowed, over the
mean over the same games of the faced offence's mean in its other games (an offence met twice
counts twice). A game counts once its rows are stamped (the offence has a line that week, or for
dropbacks both club rows are read), and a D game whose offence has no other game is not counted.
With no game counted the allowance is 1 (the missing-input table); a group whose expected total is
0 (a quarterback's targets) carries no ratio and takes 1 too, counted apart.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

from research.model.weekly3.instant import Schedule
from research.model.weekly3.work import PASS_ATTEMPTS, Kind, PlayerGame, Work, sum_work
from research.pipeline.nflverse.context import _RATING_SHRINKAGE_GAMES
from research.pipeline.nflverse.pbp import PbpMetric

ALLOWANCE_PRIOR_GAMES: Final = _RATING_SHRINKAGE_GAMES  # section 2 item 3: "6 games of prior"
NO_GAME: Final = "allowance_without_a_game"
NO_EXPECTATION: Final = "allowance_without_an_expected_total"

ClubWeek = tuple[int, str]
GroupTotals = Mapping[ClubWeek, Mapping[str, Work]]  # (week, offence) -> position -> total work
TeamRows = Mapping[tuple[str, int], Mapping[str, float]]  # (club, week) -> metric -> value


@dataclass(frozen=True, slots=True)
class Allowance:
    value: float
    games: int
    default: str | None


def group_totals(games: Mapping[str, tuple[PlayerGame, ...]], positions: Mapping[str, str]) -> GroupTotals:
    """Each offence's work by week and position group, from every line-week read."""
    found: dict[ClubWeek, dict[str, list[Work]]] = {}
    for player_id, played in games.items():
        position = positions.get(player_id)
        for game in played:
            by_position = found.setdefault((game.week, game.club), {})
            if position is not None:
                by_position.setdefault(position, []).append(game.work)
    return MappingProxyType(
        {key: MappingProxyType({p: sum_work(works) for p, works in groups.items()}) for key, groups in found.items()}
    )


def _group(totals: GroupTotals, week: int, club: str, position: str, kind: Kind) -> float | None:
    by_position = totals.get((week, club))
    if by_position is None:
        return None  # no line of that club that week has been stamped
    work = by_position.get(position)
    return 0.0 if work is None else work.of(kind)


def _dropbacks(rows: TeamRows, club: str, week: int, metric: str) -> float | None:
    return rows.get((club, week), {}).get(metric)


def _shrunk(pairs: list[tuple[float, float]]) -> Allowance:
    if not pairs:
        return Allowance(1.0, 0, NO_GAME)
    count = len(pairs)
    expected = sum(e for _, e in pairs) / count
    if expected <= 0:
        return Allowance(1.0, count, NO_EXPECTATION)
    ratio = (sum(a for a, _ in pairs) / count) / expected
    return Allowance((count * ratio + ALLOWANCE_PRIOR_GAMES) / (count + ALLOWANCE_PRIOR_GAMES), count, None)


def allowance(  # noqa: PLR0913, PLR0917 - the allowance's every input, named
    defence: str,
    week: int,
    position: str,
    kind: Kind,
    schedule: Schedule,
    totals: GroupTotals,
    team_rows: TeamRows,
) -> Allowance:
    """D's allowance of `kind` to `position` before `week`, from the rows read at the instant."""
    dropbacks = position == "QB" and kind == PASS_ATTEMPTS

    def allowed(offence: str, at: int) -> float | None:
        if dropbacks:
            return _dropbacks(team_rows, defence, at, PbpMetric.DROPBACKS_FACED)
        return _group(totals, at, offence, position, kind)

    def gained(offence: str, at: int) -> float | None:
        if dropbacks:
            return _dropbacks(team_rows, offence, at, PbpMetric.DROPBACKS)
        return _group(totals, at, offence, position, kind)

    return ratio_allowance(defence, week, schedule, allowed, gained)


ValueAt = Callable[[str, int], float | None]  # (offence, week) -> the value, None when not stamped


def ratio_allowance(defence: str, week: int, schedule: Schedule, allowed: ValueAt, gained: ValueAt) -> Allowance:
    """D's allowance of any per-game value before `week`: over D's games, what D allowed against what
    the same offences gained in their other games, shrunk toward 1 (round 4 reads it for its new
    allowances, section 2.4, on the same construction)."""
    return _shrunk(allowance_pairs(defence, week, schedule, allowed, gained))


def difference_allowance(defence: str, week: int, schedule: Schedule, allowed: ValueAt, gained: ValueAt) -> Allowance:
    """The same pairs read as a difference, shrunk toward 0 with the same prior: n x (mean allowed less
    mean elsewhere) / (n + 6), for a value that is itself a difference (round 4, amendment 2 item 2)."""
    pairs = allowance_pairs(defence, week, schedule, allowed, gained)
    if not pairs:
        return Allowance(0.0, 0, NO_GAME)
    count = len(pairs)
    gap = sum(a - e for a, e in pairs) / count
    return Allowance(count * gap / (count + ALLOWANCE_PRIOR_GAMES), count, None)


def allowance_pairs(
    defence: str, week: int, schedule: Schedule, allowed: ValueAt, gained: ValueAt
) -> list[tuple[float, float]]:
    """Over D's games before `week`: (what D allowed, the same offence's mean in its other games)."""
    pairs: list[tuple[float, float]] = []
    for at in schedule.club_weeks(defence, week):
        offence = schedule.opponent(at, defence)
        if offence is None:
            continue
        given = allowed(offence, at)
        elsewhere = [
            value
            for other in schedule.club_weeks(offence, week)
            if schedule.opponent(other, offence) != defence and (value := gained(offence, other)) is not None
        ]
        if given is None or not elsewhere:
            continue
        pairs.append((given, sum(elsewhere) / len(elsewhere)))
    return pairs
