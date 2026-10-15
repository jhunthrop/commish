"""THE IN-SEASON BOARDS: the preseason boards re-ranked by the rest-of-season model from the switch week.

`ros_boards` takes the night's preseason boards, the season so far the player pages read
(`SeasonContext`), the run's instant and the model's stored inputs (`RosSetup`), and returns the boards
the run prints. In season every board ranks the judged universe: each player on the preseason board,
and each player with a line this season who was not on it (his preseason rank and points null). Each
is valued under the format's shape by rest-of-season points, with no range. Before the switch week, or
with the artifact, the season's lines or the raw line missing, the boards stay preseason with the
reason; a format the raw line does not carry stays preseason alone, and the reason names it.

The window starts at the first week with a game still to kick off at the run's instant, from the stored
schedule (`SeasonContext.games`), never the clock alone; the lines run through the last week whose games
are all in the records (`SeasonContext.through`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Final

from research.model.ros.live import (
    FIRST_MODEL_WEEK,
    PlayerWeeks,
    SeasonPlayer,
    WeekFacts,
    Window,
    player_to_date,
    stale_prior,
    window_of,
)
from research.model.ros.model import FORMATS, RosPriors, project
from research.model.ros.raw_line import RawLine
from research.nightly.build.player_season import SCORING, SeasonContext
from research.nightly.config import PAGE_FORMAT
from research.nightly.reads.board import BoardEntry, FormatBoard, StoredRow, board_entries
from research.nightly.reads.schedule import Game

MODEL_NAME: Final = "commish_ros_v3"
Projections = Mapping[str, tuple[Mapping[str, float], float]]


@dataclass(frozen=True, slots=True)
class RosSetup:
    """The model's stored inputs: its fitted numbers and the raw line (None when missing), and the
    season's players with a line (empty before the switch week, when nothing reads them)."""

    priors: RosPriors | None
    raw: RawLine | None
    season_players: tuple[SeasonPlayer, ...] = ()
    # Why the inputs could not be read, when a read failed (the report names it, not a missing artifact).
    unread: str | None = None


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
    # The format ids whose board ranks the rest of the season tonight.
    in_season: frozenset[str] = frozenset()


def pending_weeks(games: Mapping[str, Sequence[Game]], instant: datetime) -> list[int]:
    """The weeks with a game still to kick off at `instant`."""
    return sorted({g.week for slate in games.values() for g in slate if g.kickoff > instant})


def _served_projected(boards: Sequence[FormatBoard]) -> dict[str, dict[str, float]]:
    """Each board player's served season points by scoring, from the boards the run carries."""
    found: dict[str, dict[str, float]] = {}
    for board in boards:
        for entry in board.entries:
            found.setdefault(entry.row.universe_id, {})[board.format.scoring] = entry.row.projected
    return {uid: {name: by.get(name, by.get("ppr", 0.0)) for name in FORMATS} for uid, by in found.items()}


def _weeks(provider_id: str, context: SeasonContext) -> dict[int, WeekFacts]:
    lines, snaps = context.store.lines.get(provider_id, {}), context.store.snaps.get(provider_id, {})
    return {week: WeekFacts(lines.get(week, {}), snaps.get(week, {})) for week in {*lines, *snaps}}


def _off_board_rows(board: FormatBoard, players: Sequence[SeasonPlayer]) -> list[StoredRow]:
    """A row for every player with a line this season the page board does not rank (points filled later)."""
    on = {entry.row.universe_id for entry in board.entries} | {entry.row.player_id for entry in board.entries}
    return [
        StoredRow(
            universe_id=p.universe_id,
            player_id=p.provider_id,
            name=p.name,
            position=p.position,
            team=p.team,
            headshot_url=p.headshot_url,
            market_adp=p.market_adp,
            projected=0.0,
            floor=None,
            median=None,
            ceiling=None,
            expected_games=0.0,
        )
        for p in players
        if p.universe_id not in on and p.provider_id not in on
    ]


@dataclass(frozen=True, slots=True)
class Ready:
    """Every input the in-season boards need: the window, the fitted numbers and the raw line."""

    window: Window
    priors: RosPriors
    raw: RawLine


def whole_line(line: Mapping[str, float] | None, scorings: frozenset[str]) -> dict[str, float] | None:
    """A player's raw line with every scoring the model computes: one the line lacks takes his PPR
    figure, never read, since a board of a scoring the line lacks stays preseason (`ros_boards`)."""
    if not line:
        return None
    stand_in = next(line[name] for name in FORMATS if name in line)
    return {name: line[name] if name in scorings and name in line else line.get("ppr", stand_in) for name in FORMATS}


def _projections(
    boards: Sequence[FormatBoard], extra: Sequence[StoredRow], context: SeasonContext, ready: Ready
) -> dict[str, tuple[Mapping[str, float], float]]:
    """Rest-of-season points by scoring and expected games, for the page board's players and the ones
    with a line it does not rank."""
    page = next(b for b in boards if b.format.id == PAGE_FORMAT.id)
    served = _served_projected(boards)
    schedule = {club: [g.week for g in slate] for club, slate in context.games.items()}
    scorings = carried(ready.raw)
    per_game = ready.raw.per_game
    found: dict[str, tuple[Mapping[str, float], float]] = {}
    for row, stale in [
        *(
            (
                e.row,
                stale_prior(
                    whole_line(per_game.get(e.row.universe_id), scorings),
                    served[e.row.universe_id],
                    e.row.expected_games,
                ),
            )
            for e in page.entries
        ),
        *((row, None) for row in extra),
    ]:
        clubs = context.store.teams.get(row.player_id, {})
        who = PlayerWeeks(row.universe_id, row.position, row.team, clubs, _weeks(row.player_id, context))
        projection = project(player_to_date(who, ready.window, schedule, stale, SCORING), ready.priors)
        found[row.universe_id] = (projection.projected, projection.expected_games)
    return found  # fmt: skip


def _reranked(board: FormatBoard, extra: Sequence[StoredRow], found: Projections) -> FormatBoard:
    """The board re-valued by rest-of-season points, with each off-board row it does not already rank
    (a player off the PPR board can be on this one: he is ranked once, keeping his preseason entry)."""
    preseason: dict[str, BoardEntry | None] = {entry.row.universe_id: entry for entry in board.entries}
    extra = [row for row in extra if row.universe_id not in preseason]
    rows = [
        replace(
            row,
            projected=found[row.universe_id][0][board.format.scoring],
            expected_games=found[row.universe_id][1],
            floor=None,
            median=None,
            ceiling=None,
        )
        for row in [*(entry.row for entry in board.entries), *extra]
    ]
    preseason |= {row.universe_id: None for row in extra}
    return replace(board, entries=board_entries(rows, board.format, preseason))


def carried(raw: RawLine) -> frozenset[str]:
    """The scorings the raw line holds for every player it has."""
    return frozenset(name for name in FORMATS if all(name in by for by in raw.per_game.values()))


def held_because(board: FormatBoard, scorings: frozenset[str], found: Projections) -> str | None:
    """Why this format's board stays preseason tonight, or None when it ranks the rest of the season."""
    if board.format.scoring not in scorings:
        return f"the raw line holds no {board.format.scoring} points"
    unranked = sum(1 for entry in board.entries if entry.row.universe_id not in found)
    return None if unranked == 0 else f"it ranks {unranked} players the PPR board does not"


def _ready(boards: tuple[FormatBoard, ...], context: SeasonContext, instant: datetime, setup: RosSetup) -> Ready | str:
    """Every input, or why every board stays preseason tonight."""
    if setup.unread is not None:
        return f"the model's inputs could not be read ({setup.unread})"
    if setup.priors is None:
        return "the rest-of-season artifact is not in the store"
    window = window_of(pending_weeks(context.games, instant), context.through)
    if isinstance(window, str):
        return window
    if setup.raw is None or not setup.raw.per_game:
        return "the raw line for the season's raw board is not in the store"
    if not any(b.format.id == PAGE_FORMAT.id for b in boards):
        return "the page format's board is not carried"
    return Ready(window, setup.priors, setup.raw)


def ros_boards(boards: Sequence[FormatBoard], context: SeasonContext, instant: datetime, setup: RosSetup) -> RosResult:
    """The boards the run prints, with the basis of the in-season ones or why they are preseason. A
    format whose board cannot be ranked as judged (a scoring the raw line lacks, a player the PPR board
    does not rank) stays preseason alone, and the status names it."""
    preseason = tuple(boards)
    ready = _ready(preseason, context, instant, setup)
    if isinstance(ready, str):
        return RosResult(preseason, None, f"preseason: {ready}")
    window = ready.window
    page = next(b for b in preseason if b.format.id == PAGE_FORMAT.id)
    extra = _off_board_rows(page, setup.season_players)
    found = _projections(preseason, extra, context, ready)
    scorings = carried(ready.raw)
    held = {b.format.id: why for b in preseason if (why := held_because(b, scorings, found)) is not None}
    out = tuple(b if b.format.id in held else _reranked(b, extra, found) for b in preseason)
    ranked = frozenset(b.format.id for b in preseason if b.format.id not in held)
    kept = "; ".join(f"preseason for {fid}: {why}" for fid, why in held.items())
    if not ranked:
        return RosResult(preseason, None, f"preseason: {kept}")
    status = (
        f"rest of season from week {window.from_week} (switch week {FIRST_MODEL_WEEK - 1}), lines through week "
        f"{window.through}, model {MODEL_NAME}, {len(extra)} players off the preseason board ranked"
        + (f"; {kept}" if kept else "")
    )
    return RosResult(out, RosBasis(window.from_week, window.through, instant), status, ranked)
