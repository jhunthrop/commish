"""THE IN-SEASON BOARDS: the preseason boards re-ranked by the rest-of-season model from the switch week.

`ros_boards` takes the night's preseason boards, the season so far the player pages read
(`SeasonContext`), the run's instant and the model's stored inputs (`RosSetup`), and returns the boards
the run prints. In season every board ranks the judged universe: each player on the preseason board,
and each player with a line this season who was not on it (his preseason rank and points null). Each
is valued under the format's shape by rest-of-season points, with no range. Before the switch week, or
with the artifact, the season's lines or the raw line missing, the boards stay preseason with the
reason; a format the raw line does not carry stays preseason alone, and the reason names it.

The window starts at the first week with a game still to play at the run's instant, by the run's one
game state (`schedule.game_states`, the stored schedule and the finals held), never the clock alone; the
lines run through the last week whose games are all in the records (`SeasonContext.through`). Each
player's rest of season is his club's games left (Lane 86): once his club's game of the
window's first week has kicked off it is no game left, and his row says the week he starts from.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Final

from research.model.ros.live import (
    FIRST_MODEL_WEEK,
    ClubSlates,
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
from research.nightly.build.page_club import ClubCall, call_for
from research.nightly.build.player_season import SCORING, SeasonContext
from research.nightly.config import PAGE_FORMAT
from research.nightly.reads.board import BoardEntry, FormatBoard, StoredRow, board_entries
from research.nightly.reads.schedule import ClubWeek, GameState, first_week_to_play, weeks_left, weeks_to_play

MODEL_NAME: Final = "commish_ros_v3"


@dataclass(frozen=True, slots=True)
class RestFigures:
    """One player's rest of season: points by scoring, expected games, and the week it starts from
    (his club's first game still to play, None with none left); and by scoring the preseason pace a
    game the model starts him from (Lane 100), None for a player the preseason line does not hold."""

    projected: Mapping[str, float]
    expected_games: float
    from_week: int | None
    # One more club game after his counted ones, by scoring (Lane 96, the week 18 a league may value).
    game_points: Mapping[str, float]
    preseason_per_game: Mapping[str, float] | None = None


Projections = Mapping[str, RestFigures]


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
    `through`, refreshed at the run's instant. `partial` is set while a game of `from_week` has kicked
    off at the run (Lane 86): its clubs count from their next week, and the words say the board counts
    that week's games left."""

    from_week: int
    through: int
    refreshed_at: datetime
    partial: bool = False


@dataclass(frozen=True, slots=True)
class RosResult:
    boards: tuple[FormatBoard, ...]
    basis: RosBasis | None
    status: str
    # The format ids whose board ranks the rest of the season tonight.
    in_season: frozenset[str] = frozenset()


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


def _off_board_rows(
    board: FormatBoard, players: Sequence[SeasonPlayer], calls: Mapping[str, ClubCall]
) -> list[StoredRow]:
    """A row for every player with a line this season the page board does not rank (points filled later),
    under the page's club (Lane 120)."""
    on = {entry.row.universe_id for entry in board.entries} | {entry.row.player_id for entry in board.entries}
    return [
        StoredRow(
            universe_id=p.universe_id,
            player_id=p.provider_id,
            name=p.name,
            position=p.position,
            team=call_for(calls, p.provider_id).club,
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
    boards: Sequence[FormatBoard],
    extra: Sequence[StoredRow],
    context: SeasonContext,
    states: Mapping[ClubWeek, GameState],
    ready: Ready,
) -> dict[str, RestFigures]:
    """Rest-of-season points by scoring, expected games and the week they start from, for the page
    board's players and the ones with a line it does not rank: each over his club's games left."""
    page = next(b for b in boards if b.format.id == PAGE_FORMAT.id)
    served = _served_projected(boards)
    slates = ClubSlates(
        {club: [g.week for g in slate] for club, slate in context.games.items()},
        {club: weeks_to_play(states, club) for club in context.games},
    )
    scorings = carried(ready.raw)
    per_game = ready.raw.per_game
    found: dict[str, RestFigures] = {}
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
        who = PlayerWeeks(row.universe_id, row.position, row.team, _weeks(row.player_id, context))
        player = player_to_date(who, ready.window, slates, stale, SCORING)
        projection = project(player, ready.priors)
        start = first_week_to_play(states, row.team) if player.remaining_weeks and row.team is not None else None
        pace = None if stale is None or stale.per_game is None else dict(stale.per_game)
        found[row.universe_id] = RestFigures(
            projected=projection.projected,
            expected_games=projection.expected_games,
            from_week=start,
            game_points=_one_game(projection.game_points, row.team),
            preseason_per_game=pace,
        )
    return found  # fmt: skip


def _one_game(game_points: Mapping[str, float], club: str | None) -> Mapping[str, float]:
    """His points for one more club game (Lane 96): the model's rate for a player on a club, 0 for a
    free agent (no club, Lane 123), who has no game this week or any week after (Lane 127, B103)."""
    return game_points if club is not None else dict.fromkeys(game_points, 0.0)


def _reranked(board: FormatBoard, extra: Sequence[StoredRow], found: Projections) -> FormatBoard:
    """The board re-valued by rest-of-season points, with each off-board row it does not already rank
    (a player off the PPR board can be on this one: he is ranked once, keeping his preseason entry)."""
    preseason: dict[str, BoardEntry | None] = {entry.row.universe_id: entry for entry in board.entries}
    extra = [row for row in extra if row.universe_id not in preseason]
    rows = [
        replace(
            row,
            projected=found[row.universe_id].projected[board.format.scoring],
            expected_games=found[row.universe_id].expected_games,
            from_week=found[row.universe_id].from_week,
            game_points=found[row.universe_id].game_points[board.format.scoring],
            preseason_per_game=_pace(found[row.universe_id], board.format.scoring),
            floor=None,
            median=None,
            ceiling=None,
        )
        for row in [*(entry.row for entry in board.entries), *extra]
    ]
    preseason |= {row.universe_id: None for row in extra}
    return replace(board, entries=board_entries(rows, board.format, preseason))


def _pace(figures: RestFigures, scoring: str) -> float | None:
    """The preseason pace a game the model starts him from in `scoring`, None when it holds none."""
    return None if figures.preseason_per_game is None else figures.preseason_per_game.get(scoring)


def carried(raw: RawLine) -> frozenset[str]:
    """The scorings the raw line holds for every player it has."""
    return frozenset(name for name in FORMATS if all(name in by for by in raw.per_game.values()))


def held_because(board: FormatBoard, scorings: frozenset[str], found: Projections) -> str | None:
    """Why this format's board stays preseason tonight, or None when it ranks the rest of the season."""
    if board.format.scoring not in scorings:
        return f"the raw line holds no {board.format.scoring} points"
    unranked = sum(1 for entry in board.entries if entry.row.universe_id not in found)
    return None if unranked == 0 else f"it ranks {unranked} players the PPR board does not"


def _ready(
    boards: tuple[FormatBoard, ...], context: SeasonContext, states: Mapping[ClubWeek, GameState], setup: RosSetup
) -> Ready | str:
    """Every input, or why every board stays preseason tonight."""
    if setup.unread is not None:
        return f"the model's inputs could not be read ({setup.unread})"
    if setup.priors is None:
        return "the rest-of-season artifact is not in the store"
    window = window_of(weeks_left(states), context.through)
    if isinstance(window, str):
        return window
    if setup.raw is None or not setup.raw.per_game:
        return "the raw line for the season's raw board is not in the store"
    if not any(b.format.id == PAGE_FORMAT.id for b in boards):
        return "the page format's board is not carried"
    return Ready(window, setup.priors, setup.raw)


def ros_boards(
    boards: Sequence[FormatBoard],
    context: SeasonContext,
    instant: datetime,
    states: Mapping[ClubWeek, GameState],
    setup: RosSetup,
) -> RosResult:
    """The boards the run prints, with the basis of the in-season ones or why they are preseason, at
    `instant` with every game's state then (`schedule.game_states`). A format whose board cannot be
    ranked as judged (a scoring the raw line lacks, a player the PPR board does not rank) stays
    preseason alone, and the status names it."""
    preseason = tuple(boards)
    ready = _ready(preseason, context, states, setup)
    if isinstance(ready, str):
        return RosResult(preseason, None, f"preseason: {ready}")
    window = ready.window
    page = next(b for b in preseason if b.format.id == PAGE_FORMAT.id)
    extra = _off_board_rows(page, setup.season_players, context.clubs)
    found = _projections(preseason, extra, context, states, ready)
    scorings = carried(ready.raw)
    held = {b.format.id: why for b in preseason if (why := held_because(b, scorings, found)) is not None}
    out = tuple(b if b.format.id in held else _reranked(b, extra, found) for b in preseason)
    ranked = frozenset(b.format.id for b in preseason if b.format.id not in held)
    kept = "; ".join(f"preseason for {fid}: {why}" for fid, why in held.items())
    if not ranked:
        return RosResult(preseason, None, f"preseason: {kept}")
    status = (
        f"rest of season from week {window.from_week} (switch week {FIRST_MODEL_WEEK}), lines through week "
        f"{window.through}, model {MODEL_NAME}, {len(extra)} players off the preseason board ranked"
        + (f"; {kept}" if kept else "")
    )
    partial = any(state != "upcoming" for (_, week), state in states.items() if week == window.from_week)
    return RosResult(out, RosBasis(window.from_week, window.through, instant, partial), status, ranked)
