"""THE GAME-DAY STATUS READS ON THE PAGE (Lane 222, B186): a build before each kickoff window.

The status read itself runs every hour of every day (`research-capture-harvest`, `0 0,2,6-23 * * *` Eastern,
`infra/research-schedule.sh`), and each publish hour writes the newest into `designations.json`
(`designations.mark_runs`), a read that found no change included (its check, `capture_checks`). The player
pages are prerendered, so a page shows the read its build took, and a build came only when the run went
public (the morning), when a season-long list moved (`designations.build_on_change`), and on a push: on the
Sunday of 2026-10-25 the 1 pm players' pages said their status was read at 12:30 am.

So the publish hour before each kickoff window dispatches the web build when the read is newer than the
last build's. The hour `h` reads before the kickoffs `k` with `h + BUILD_LEAD < k <= h + BUILD_LEAD + 1 h`,
so the build (about twenty minutes from the dispatch to the deploy, `web.yml`) is live before them: on a
Sunday 12:00 ET before the 1:00 pm games, 15:00 before 4:05 and 4:25, 19:00 before the night game, 9:00
before a game abroad at 9:30; 19:00 before a Monday or Thursday night game. The morning read is the run's
own build when it goes public. The web names the next read by the same rule from the run's schedule
(`web/src/lib/player/read-byline.ts`, `READ_BUILD_LEAD_MS`, which mirrors `BUILD_LEAD`).
"""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from sqlalchemy import Connection

from research.pipeline.kickoffs import stored_kickoffs

# The web build's time from the dispatch to the deploy, with its margin (web.yml runs on 2026-10-25: 14 to 27
# minutes with the gates; a dispatched build that queues behind a push's deploy can take longer).
BUILD_LEAD: Final = timedelta(minutes=25)
_JUST_BEFORE: Final = timedelta(microseconds=1)
_EASTERN: Final = ZoneInfo("America/New_York")


def _hour_of(instant: datetime) -> datetime:
    """The whole UTC hour holding `instant` (Eastern hours are whole UTC hours)."""
    return instant.astimezone(UTC).replace(minute=0, second=0, microsecond=0)


def read_hour(kickoff: datetime) -> datetime:
    """The publish hour that reads before `kickoff`: the last whole hour more than `BUILD_LEAD` before it."""
    return _hour_of(kickoff - BUILD_LEAD - _JUST_BEFORE)


def window_read_due(kickoffs: Iterable[datetime], now: datetime) -> datetime | None:
    """The first kickoff of the window the publish hour holding `now` reads before, None in any other hour."""
    hour = _hour_of(now)
    return min((k for k in kickoffs if read_hour(k) == hour), default=None)


def season_kickoffs(conn: Connection, season: int) -> list[datetime]:
    """Every stored kickoff of `season` (each club-game's, so a game is there twice)."""
    return [k.at for k in stored_kickoffs(conn, season)]


def window_words(kickoff: datetime) -> str:
    """The window a game-day build reads before, for the publish line: "the 13:00 ET kickoffs"."""
    return f"the {kickoff.astimezone(_EASTERN):%H:%M} ET kickoffs"
