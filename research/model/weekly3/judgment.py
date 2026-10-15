"""THE JUDGED WEEKS, READ: the judgment season scored, G1 to G4 through round 2's assessment (G5 is
the run's, `round.py`), and every number section 5 reports without gating.

Preregistration section 5, "Population and statistics" (round 2's, unchanged) and "Reported, not
gated": beside round 2's reported block (each source's rho per position and format, places off,
the chance in half and standard and for flex pairs, MAE and RMSE of x, the rate alone), the rate
times round 2's opponent factor (its elasticities refit on this round's fit seasons), round 3
without vacated volume and without the allowances, every number at Thursday's instant, each kind's
stage-1 RMSE against the season-to-date mean on the judged weeks, the missing-input counts, the
withheld and flagged rows, the first games after a trade and the club-games with vacated volume.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from types import MappingProxyType
from typing import Any, Final

from sqlalchemy import Connection

from research.model.domain import Position
from research.model.priors import ModelArtifacts
from research.model.ros.model import FORMATS
from research.model.weekly2 import gates
from research.model.weekly2.designation import WITHHELD
from research.model.weekly2.factor import opponent_factor
from research.model.weekly2.gates import Thresholds
from research.model.weekly2.judge import Scored
from research.model.weekly2.judgment import assess
from research.model.weekly2.statistics import (
    BENCHMARKS,
    BoardRow,
    Contender,
    JudgedRow,
    bootstrap_draws,
    ordering_difference,
    orderings,
    places_mean,
    rho_deltas,
)
from research.model.weekly3.features import without_allowances, without_vacated
from research.model.weekly3.judge import Member, RoundFit, default_counts, members, stage_one_error, vacated_club_games
from research.model.weekly3.ledger import Game, Stamp
from research.model.weekly3.number import Points, WeekNumber, view_number, week_number
from research.model.weekly3.outcomes import GameOutcomeReader
from research.model.weekly3.season import Placed, SeasonRead, read_season

FROZEN: Final = MappingProxyType


@dataclass(frozen=True, slots=True)
class Judgment:
    lines: tuple[gates.GateLine, ...]  # G1 to G4, 25 lines
    numbers: Mapping[str, Any]
    served: tuple[int, ...]
    rows: int
    stamps: tuple[Stamp, ...]
    games: tuple[Game, ...]


def _judged_row(member: Member, number: Points | None, questionable: bool) -> JudgedRow:
    placed = member.placed
    board = member.week.board
    return JudgedRow(
        board.week,
        member.player_id,
        member.position,
        number,
        None if placed is None else placed.player.rate,
        None if placed is None else placed.player.board,
        board.adp.get(member.player_id),
        board.form.get(member.player_id),
        member.outcome.points,
        questionable,
    )


def score_season(
    read: SeasonRead, fitted: RoundFit, positions: Mapping[str, Position], t: Thresholds, version: str
) -> Scored:
    """Round 2's scored shape: the population rows, the whole board's rows (S3) and the contenders
    for the chance, with every player's stamped number."""
    numbers: list[WeekNumber] = []
    board_rows: list[BoardRow] = []
    for week in read.weeks:
        lined = read.outcomes.get(week.board.week, {})
        for placed in week.placed.values():
            found = week_number(read.season, week.board.week, placed, fitted.fitted, t.model_name, version)
            numbers.append(found)
            outcome = lined.get(found.player_id)
            if found.number is not None and outcome is not None:
                board_rows.append(BoardRow(found.position, found.number, outcome.points))
    by_key = {(n.week, n.player_id): n for n in numbers}
    rows: list[JudgedRow] = []
    contenders: dict[tuple[int, str, str], list[Contender]] = {}
    for member in members(read, positions, t):
        at = member.week.board.week
        number = by_key.get((at, member.player_id))
        value = None if number is None else number.number
        rows.append(_judged_row(member, value, number is not None and number.questionable))
        if value is None:
            continue
        for name in FORMATS:
            offsets = fitted.ranges.offsets(member.position, name, value[name])
            contender = Contender(member.player_id, value[name], offsets, member.outcome.points[name])
            contenders.setdefault((at, member.position, name), []).append(contender)
    return Scored(
        tuple(rows),
        tuple(board_rows),
        FROZEN({key: tuple(found) for key, found in contenders.items()}),
        tuple(numbers),
    )


Ablation = Callable[[Placed], Points | None]


def ablations(fitted: RoundFit) -> dict[str, Ablation]:
    """The reported variants of the number, each on the judged population."""

    def factor(placed: Placed) -> Points | None:
        if view_number(placed, placed.own, fitted.fitted) is None:
            return None
        player = placed.player
        c = opponent_factor(player.d_pass, player.d_rush, fitted.elasticities[player.position])
        return FROZEN({name: player.rate[name] * c for name in FORMATS})

    return {
        "rate_times_round_two_factor": factor,
        "without_vacated_volume": lambda p: view_number(p, p.own, fitted.fitted, without_vacated),
        "without_allowances": lambda p: view_number(p, p.own, fitted.fitted, without_allowances),
        "thursday_view": lambda p: view_number(p, p.thursday, fitted.fitted),
    }


def _ordering(rows: Sequence[JudgedRow], t: Thresholds) -> dict[str, Any]:
    weeks = list(t.weeks)
    found = orderings(rows, weeks, "ppr", t)
    draws = bootstrap_draws(len(weeks), t)
    against = {bench: ordering_difference(rho_deltas(found, bench, weeks), draws, t) for bench in BENCHMARKS}
    return {
        **{
            f"against_{bench}": {"pooled": asdict(o.pooled), "by_position": dict(o.by_position)}
            for bench, o in against.items()
        },
        "places_off_pooled": places_mean(found, "model"),
    }


def ablation_numbers(judged: Sequence[Member], scored: Scored, fitted: RoundFit, t: Thresholds) -> dict[str, Any]:
    """Each variant scored as the model is: its ordering against ADP and form, and places off."""
    found: dict[str, Any] = {}
    for name, variant in ablations(fitted).items():
        rows = [
            replace(row, number=None if member.placed is None else variant(member.placed))
            for member, row in zip(judged, scored.rows, strict=True)
        ]
        found[name] = _ordering(rows, t)
    thursday = [
        m
        for m in judged
        if m.placed is not None and m.placed.moment is not None and m.placed.thursday.status == WITHHELD
    ]
    found["thursday_view"]["withheld"] = len(thursday)
    return found


def judge_round(  # noqa: PLR0913, PLR0917 - the judgment's every input, named
    conn: Connection,
    t: Thresholds,
    fitted: RoundFit,
    artifacts: ModelArtifacts,
    positions: Mapping[str, Position],
    version: str,
    reader: GameOutcomeReader,
) -> Judgment:
    """The judgment season read once through its reader, scored and assessed."""
    read, reader = read_season(conn, t.judgment_season, t, fitted.rate.priors, artifacts, positions, reader)
    scored = score_season(read, fitted, positions, t, version)
    lines, numbers = assess(scored, fitted.ranges.band, t)
    judged = members(read, positions, t)
    staged = [m for m in judged if m.placed is not None and m.placed.own.features is not None]
    numbers = {
        **numbers,
        "board_moment": read.board_moment,
        "round_three": {
            "ablations": ablation_numbers(judged, scored, fitted, t),
            "stage_one_error": stage_one_error(staged, fitted.fitted.stage),
            "counts": default_counts(judged),
            "club_games_with_vacated_volume": vacated_club_games([read]),
        },
    }
    return Judgment(tuple(lines), FROZEN(numbers), reader.served, len(scored.rows), read.all_stamps, read.games)
