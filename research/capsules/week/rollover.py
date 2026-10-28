"""THE ROLL-OVER (Lane 256, the founder's ruling of 2026-10-27): every board player's read for the coming week is
written in one pass, from one facts instant, so the reads are the same for everyone.

The coming week is the board week (`collect.board_week`). Its reads are written on the first nightly pass where
- every game of the weeks before it is final (the store's finals, `schedule.game_states`),
- the published rest-of-season board covers it (`published_boards.from_week`), and
- its published projection is held (a `tank01_projection_rows` snapshot of the week),
or, whatever is still missing, on the last nightly before the week's first kickoff (a read written without the
projection is better than no read for the week). Before then the pass writes nothing for the week.

On a normal week (the week before ends on a Monday night game) that is the Wednesday 05:30 UTC nightly, Tuesday
night in Central time: the 00:00 ET capture reads Monday's final, the Tuesday 05:30 UTC run passes and publishes
the board from the new week within the hour after it, and the new week's projection is first read from 06:00 ET
on Tuesday (`tank01.projections.daily_opens`), so the Tuesday run has no projection and the Wednesday run does.

Until the roll-over has run, the page says when the reads are written (`reads_due`, Lane 265): the instant of
the first nightly whose pass can write them by the same three waits (the finals held, the board covering the
week, which the run's own board says it will once published, and the projection, read from its daily opening),
else the last nightly before the week's first kickoff. The page names that instant's night on the Eastern
clock ("Tuesday" on a normal week, `night_of`) and says the reads are not written yet once its clock passes
it, so a run that is never published leaves no stale promise behind.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from typing import Final

from sqlalchemy import Connection, text

from research.model.instants import js_iso
from research.nightly.reads.schedule import EASTERN, ClubWeek, Game, GameState
from research.pipeline.tank01.projections import daily_opens

# The nightly's start (`infra/research-schedule.sh`, research-nightly, "30 5 * * *" Etc/UTC).
NIGHTLY_AT: Final = time(5, 30)
_DAY: Final = timedelta(days=1)
# A run in the small hours belongs to the night before: the night is the Eastern day this long before the run
# (web/src/lib/player/week-read.ts NIGHT_RUNS_PAST_MIDNIGHT, ported to both apps).
NIGHT_RUNS_PAST_MIDNIGHT: Final = timedelta(hours=6)
# The nights by `date.weekday()`, a fixed English table the web's enum names (never the locale's `%A`).
NIGHTS: Final = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
FINAL: Final = "final"


def finals_wait(week: int) -> str:
    return f"the games before week {week} to be final"


def board_wait(week: int) -> str:
    return f"the board from week {week}"


def projection_wait(week: int) -> str:
    return f"week {week}'s published projection"


def night_of(at: datetime) -> str:
    """The night a nightly at `at` belongs to, on the Eastern clock: "Tuesday" for Wednesday 05:30 UTC."""
    return NIGHTS[(at.astimezone(EASTERN) - NIGHT_RUNS_PAST_MIDNIGHT).weekday()]


@dataclass(frozen=True, slots=True)
class Rollover:
    """Whether the coming week's reads are written on a pass at `as_of`, and what it still waits on."""

    week: int
    ready: bool
    waits_on: tuple[str, ...] = ()

    def line(self) -> str:
        if not self.waits_on:
            return f"week {self.week}'s roll-over is due"
        waits = ", ".join(self.waits_on)
        return (
            f"week {self.week}'s roll-over {'is due on its last pass, without' if self.ready else 'waits on'} {waits}"
        )


@dataclass(frozen=True, slots=True)
class ReadsDue:
    """The week whose reads are not written yet, and the instant of the nightly that writes them."""

    week: int
    at: datetime

    @property
    def night(self) -> str:
        return night_of(self.at)

    def json(self) -> dict[str, object]:
        # `night` stays one deploy for the web before Lane 265, whose reader requires it; the clients read `at`.
        return {"week": self.week, "night": self.night, "at": js_iso(self.at)}


def published_from_week(conn: Connection, season: int, as_of: datetime) -> int | None:
    """The first week the published rest-of-season board covers at `as_of` (the API's `BoardWeek`), if any."""
    published = conn.execute(
        text(
            "select min(from_week) from research.published_boards where season = :s "
            "and order_basis = 'rest_of_season' and published_at <= :at"
        ),
        {"s": season, "at": as_of},
    ).scalar_one()
    return None if published is None else int(published)


def projection_held(conn: Connection, season: int, week: int, as_of: datetime) -> bool:
    """Whether a published projection snapshot of `week` was captured by `as_of`."""
    return bool(
        conn.execute(
            text(
                "select exists (select 1 from research.tank01_projection_rows "
                "where season = :s and week = :w and captured_at <= :at)"
            ),
            {"s": season, "w": week, "at": as_of},
        ).scalar_one()
    )


def week_bounds_of(games: Mapping[str, Sequence[Game]]) -> dict[int, tuple[datetime, datetime]]:
    """Each week's first and last kickoff, from the clubs' slates."""
    bounds: dict[int, tuple[datetime, datetime]] = {}
    for slate in games.values():
        for game in slate:
            first, last = bounds.get(game.week, (game.kickoff, game.kickoff))
            bounds[game.week] = (min(first, game.kickoff), max(last, game.kickoff))
    return bounds


def next_nightly(after: datetime) -> datetime:
    """The first nightly start strictly after `after`."""
    at = datetime.combine(after.astimezone(UTC).date(), NIGHTLY_AT, UTC)
    return at if at > after else at + _DAY


def _last_nightly_before(kickoff: datetime) -> datetime:
    at = next_nightly(kickoff - _DAY)
    return at if at < kickoff else at - _DAY


def rollover(  # noqa: PLR0913, PLR0917 - the rule's inputs, each read once by the caller
    week: int,
    games: Mapping[str, Sequence[Game]],
    states: Mapping[ClubWeek, GameState],
    published_from: int | None,
    held: bool,
    as_of: datetime,
) -> Rollover:
    """Whether a nightly pass at `as_of` writes week `week`'s reads: once the weeks before it are final, the
    published board covers it and its published projection is held, or on its last nightly before its first
    kickoff whatever is missing."""
    waits: list[str] = []
    if any(state != FINAL for (_club, of), state in states.items() if of < week):
        waits.append(finals_wait(week))
    if published_from is None or published_from < week:
        waits.append(board_wait(week))
    if not held:
        waits.append(projection_wait(week))
    first = week_bounds_of(games).get(week, (None, None))[0]
    last_pass = first is not None and next_nightly(as_of) >= first
    return Rollover(week, not waits or last_pass, tuple(waits))


def reads_due(
    state: Rollover,
    games: Mapping[str, Sequence[Game]],
    held: bool,
    run_board_from: int | None,
    as_of: datetime,
) -> ReadsDue | None:
    """The nightly that writes the coming week's reads, while the roll-over has not run; None once it has.
    The first nightly after `as_of` whose pass meets every wait: the projection from its daily opening, the
    board once the run's own (`run_board_from`, its first week) covers the week; the finals, or a board the
    run's does not cover, only on the last nightly before the week's first kickoff, as the rule then writes
    whatever is missing."""
    if state.ready:
        return None
    bounds = week_bounds_of(games)
    span = bounds.get(state.week)
    if span is None:
        return None
    last = max(_last_nightly_before(span[0]), next_nightly(as_of))
    board_later = board_wait(state.week) in state.waits_on and (run_board_from is None or run_board_from < state.week)
    if finals_wait(state.week) in state.waits_on or board_later:
        return ReadsDue(state.week, last)
    opens = as_of if held else max(as_of, daily_opens(bounds, state.week))
    at = next_nightly(opens)
    return ReadsDue(state.week, last if at >= span[0] else at)
