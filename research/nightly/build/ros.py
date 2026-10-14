"""THE IN-SEASON BOARDS: the preseason boards re-ranked by the rest-of-season model from the switch week.

`ros_boards` takes the night's preseason boards, the season so far the player pages already read
(`SeasonContext`), the run's instant and the model's two inputs (`RosSetup`), and returns the boards
the run prints: re-valued under each format's shape by rest-of-season points, every row's range
null, each entry linked to its preseason entry. When the switch week is not reached or an input is
missing, the preseason boards come back unchanged with the reason, which the run's report carries.

The rest-of-season window starts at the first week with a game still to kick off at the run's
instant, from the stored schedule (`SeasonContext.games`), never the clock alone; the lines run
through the last week whose games are all in the records (`SeasonContext.through`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Final

from research.model.ros.live import (
    FIRST_MODEL_WEEK,
    PlayerWeeks,
    RawPrior,
    WeekFacts,
    Window,
    player_to_date,
    stale_prior,
    window_of,
)
from research.model.ros.model import FORMATS, RosPriors, project
from research.nightly.build.player_season import SCORING, SeasonContext
from research.nightly.config import PAGE_FORMAT
from research.nightly.reads.board import FormatBoard, board_entries

MODEL_NAME: Final = "commish_ros_v3"


@dataclass(frozen=True, slots=True)
class RosSetup:
    """The model's two stored inputs: its fitted numbers (None when the artifact is missing) and the
    raw board's points a game, by universe id."""

    priors: RosPriors | None
    raw: Mapping[str, RawPrior]


@dataclass(frozen=True, slots=True)
class RosBasis:
    """What the in-season boards rank: the rest of the season from `from_week`, lines through
    `through`, refreshed at the run's instant."""

    from_week: int
    through: int
    refreshed_at: datetime


@dataclass(frozen=True, slots=True)
class RosResult:
    boards: tuple[FormatBoard, ...]
    basis: RosBasis | None
    status: str


def _pending_weeks(context: SeasonContext, instant: datetime) -> list[int]:
    return sorted({g.week for slate in context.games.values() for g in slate if g.kickoff > instant})


def _served_projected(boards: Sequence[FormatBoard]) -> dict[str, dict[str, float]]:
    """Each player's served season points by scoring (ppr, half, std), from the boards the run carries;
    a scoring the run does not carry takes his PPR points (its ratio is then 1, and nothing reads it)."""
    found: dict[str, dict[str, float]] = {}
    for board in boards:
        for entry in board.entries:
            found.setdefault(entry.row.universe_id, {})[board.format.scoring] = entry.row.projected
    return {uid: {name: by.get(name, by.get("ppr", 0.0)) for name in FORMATS} for uid, by in found.items()}


def _player_weeks(board: FormatBoard, context: SeasonContext) -> list[tuple[str, PlayerWeeks, float]]:
    """Every player the page format's board ranks, as the season store holds him, with his served games."""
    store = context.store
    out = []
    for entry in board.entries:
        row = entry.row
        weeks = {
            week: WeekFacts(
                store.lines.get(row.player_id, {}).get(week, {}), store.snaps.get(row.player_id, {}).get(week, {})
            )
            for week in {*store.lines.get(row.player_id, {}), *store.snaps.get(row.player_id, {})}
        }
        who = PlayerWeeks(row.universe_id, row.position, row.team, store.teams.get(row.player_id, {}), weeks)
        out.append((row.universe_id, who, row.expected_games))
    return out


def _projections(
    boards: Sequence[FormatBoard], context: SeasonContext, window: Window, setup: RosSetup, priors: RosPriors
) -> dict[str, tuple[Mapping[str, float], float]]:
    """Rest-of-season points by scoring and expected games, for every player the page board ranks."""
    page = next(b for b in boards if b.format.id == PAGE_FORMAT.id)
    served = _served_projected(boards)
    schedule = {club: [g.week for g in slate] for club, slate in context.games.items()}
    found: dict[str, tuple[Mapping[str, float], float]] = {}
    for uid, who, games in _player_weeks(page, context):
        stale = stale_prior(setup.raw.get(uid), served[uid], games)
        projection = project(player_to_date(who, window, schedule, stale, SCORING), priors)
        found[uid] = (projection.projected, projection.expected_games)
    return found


def _reranked(board: FormatBoard, found: Mapping[str, tuple[Mapping[str, float], float]]) -> FormatBoard:
    rows = [
        replace(
            entry.row,
            projected=found[entry.row.universe_id][0][board.format.scoring],
            expected_games=found[entry.row.universe_id][1],
            floor=None,
            median=None,
            ceiling=None,
        )
        for entry in board.entries
    ]
    preseason = {entry.row.universe_id: entry for entry in board.entries}
    return replace(board, entries=board_entries(rows, board.format, preseason))


def ros_boards(boards: Sequence[FormatBoard], context: SeasonContext, instant: datetime, setup: RosSetup) -> RosResult:
    """The boards the run prints, with the basis of the in-season ones or why they are preseason."""
    preseason = tuple(boards)
    if setup.priors is None:
        return RosResult(preseason, None, "preseason: the rest-of-season artifact is not in the store")
    window = window_of(_pending_weeks(context, instant), context.through)
    if isinstance(window, str):
        return RosResult(preseason, None, f"preseason: {window}")
    found = _projections(boards, context, window, setup, setup.priors)
    missing = [b.format.id for b in boards if any(e.row.universe_id not in found for e in b.entries)]
    if missing:
        return RosResult(preseason, None, f"preseason: {', '.join(missing)} ranks a player the PPR board lacks")
    reranked = tuple(_reranked(board, found) for board in boards)
    status = (
        f"rest of season from week {window.from_week} (switch week {FIRST_MODEL_WEEK}), "
        f"lines through week {window.through}, model {MODEL_NAME}"
    )
    return RosResult(reranked, RosBasis(window.from_week, window.through, instant), status)
