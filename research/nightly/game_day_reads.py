"""THE GAME-DAY STATUS READS ON THE PAGE (Lane 222, B186): a build before each kickoff window.

The status read itself runs every hour of every day (`research-capture-harvest`, `0 0,2,6-23 * * *` Eastern,
`infra/research-schedule.sh`), and each publish hour writes the newest into `designations.json`
(`designations.mark_runs`), a read that found no change included (its check, `capture_checks`, which the
capture writes on an unchanged pass too). The player pages are prerendered, so a page shows the read its
build took, and a build came only when the run went public (the morning), when a season-long list moved
(`designations.build_on_change`), and on a push: on the Sunday of 2026-10-25 the 1 pm players' pages said
their status was read at 12:30 am.

So the publish hour before each kickoff window dispatches the web build when the read is newer than the
last build's. The hour `h` reads before the kickoffs `k` with `h + BUILD_LEAD < k <= h + BUILD_LEAD + 1 h`:
on a Sunday 12:00 ET before the 1:00 pm games, 15:00 before 4:05 and 4:25, 19:00 before the night game,
8:00 before a game abroad at 9:30; 19:00 before a Monday or Thursday night game. The morning read is the
run's own build when it goes public.

THE SAME HOUR'S READ (the coordinator's ruling, fix round 1). The publish job and the capture both fire on
the hour, so a window hour waits for this hour's capture to record its check (`await_capture`, at most
`CAPTURE_WAIT`, polled), then marks the run with it; a capture that has not checked by then is said in the
line and the hour proceeds on the newest read it has.

THE LEAD. The wait (at most 10 minutes), the publish step itself (about a minute) and the web build (14 to
27 minutes from the dispatch to the deploy, `web.yml` runs on 2026-10-25) take at most about 38 minutes, so
`BUILD_LEAD` is 40: every window's build is live before its first kickoff unless the build queues behind a
push's deploy. The web names the next read by the same rule from the run's schedule
(`web/src/lib/player/read-byline.ts`, `READ_BUILD_LEAD_MS`, which mirrors `BUILD_LEAD`).
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, Engine, text
from sqlalchemy.exc import SQLAlchemyError

from research.db.schema import CAPTURE_CHECKS
from research.model.instants import js_iso
from research.nightly.designation_runs import BY_DATE_SOURCE
from research.nightly.published_board import driver_line
from research.pipeline.kickoffs import stored_kickoffs
from research.season import PRODUCT_SEASON

BUILD_LEAD: Final = timedelta(minutes=40)
# How long a window hour waits for this hour's status capture, and how often it looks.
CAPTURE_WAIT: Final = timedelta(minutes=10)
CAPTURE_POLL: Final = timedelta(seconds=30)
_JUST_BEFORE: Final = timedelta(microseconds=1)
_EASTERN: Final = ZoneInfo("America/New_York")

Sleep = Callable[[float], None]
Clock = Callable[[], datetime]


def hour_of(instant: datetime) -> datetime:
    """The whole UTC hour holding `instant` (Eastern hours are whole UTC hours)."""
    return instant.astimezone(UTC).replace(minute=0, second=0, microsecond=0)


def read_hour(kickoff: datetime) -> datetime:
    """The publish hour that reads before `kickoff`: the last whole hour more than `BUILD_LEAD` before it."""
    return hour_of(kickoff - BUILD_LEAD - _JUST_BEFORE)


def window_read_due(kickoffs: Iterable[datetime], now: datetime) -> datetime | None:
    """The first kickoff of the window the publish hour holding `now` reads before, None in any other hour."""
    hour = hour_of(now)
    return min((k for k in kickoffs if read_hour(k) == hour), default=None)


def season_kickoffs(conn: Connection, season: int) -> list[datetime]:
    """Every stored kickoff of `season` (each club-game's, so a game is there twice)."""
    return [k.at for k in stored_kickoffs(conn, season)]


def window_words(kickoff: datetime) -> str:
    """The window a game-day build reads before, for the publish line: "the 13:00 ET kickoffs"."""
    return f"the {kickoff.astimezone(_EASTERN):%H:%M} ET kickoffs"


_CHECKED: Final = text(f"select checked_at from {CAPTURE_CHECKS.fullname} where source = :source")


def status_checked(conn: Connection) -> datetime | None:
    """When the status capture last read its list (captured or unchanged), None before it ever did."""
    return conn.execute(_CHECKED, {"source": BY_DATE_SOURCE}).scalar_one_or_none()


@dataclass(frozen=True, slots=True)
class GameDayHour:
    """This publish hour on the game-day cadence: the first kickoff of the window it reads before (None in
    any other hour) and what it did, for the job's log (None when there is nothing to say)."""

    window: datetime | None
    line: str | None = None


def await_capture(checked: Callable[[], datetime | None], since: datetime, sleep: Sleep, clock: Clock) -> bool:
    """Whether the status capture has checked at or after `since`, waiting for it at most `CAPTURE_WAIT`."""
    deadline = clock() + CAPTURE_WAIT
    while True:
        last = checked()
        if last is not None and last >= since:
            return True
        if clock() >= deadline:
            return False
        sleep(CAPTURE_POLL.total_seconds())


def game_day_hour(engine: Engine, now: datetime, sleep: Sleep, clock: Clock) -> GameDayHour:
    """The window this hour reads before, after this hour's status capture has recorded (or the wait ran
    out, said by name). Read in its own connection, apart from the status marks (review L4); a store that
    cannot be read is no window, said by name."""
    try:
        with engine.connect() as conn:
            window = window_read_due(season_kickoffs(conn, PRODUCT_SEASON), now)
            if window is None:
                return GameDayHour(None)

            def checked() -> datetime | None:
                found = status_checked(conn)
                conn.rollback()
                return found

            seen = await_capture(checked, hour_of(now), sleep, clock)
    except SQLAlchemyError as error:
        return GameDayHour(None, f"game day: the kickoffs were not read ({driver_line(error)}); no window build")
    words = window_words(window)
    if seen:
        return GameDayHour(window, f"game day: before {words}, this hour's status read is in")
    waited = int(CAPTURE_WAIT.total_seconds() // 60)
    return GameDayHour(
        window,
        f"game day: before {words}, this hour's status read did not land in {waited} minutes; "
        "the build takes the newest read there is",
    )


def newer(read_at: str, built_at: str | None) -> bool:
    """Whether a status read (`read_at`, a js instant) is newer than the one the last build took; a build
    with none recorded (one from before this lane) is always older (review L3: newer, never merely other)."""
    return built_at is None or datetime.fromisoformat(read_at) > datetime.fromisoformat(built_at)


def not_sent_note(window: datetime, failure: str, now: datetime) -> dict[str, str]:
    """The build record's note of a window build that was not sent, for the following hours' line."""
    return {"before": window_words(window), "reason": failure, "at": js_iso(now)}


def not_sent_words(note: object) -> str | None:
    """The following hours' words for a window build that was not sent, None without one."""
    if not isinstance(note, dict):
        return None
    before, reason = note.get("before"), note.get("reason")
    if not isinstance(before, str) or not isinstance(reason, str):
        return None
    return f"the build before {before} was not sent ({reason})"
