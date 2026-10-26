"""Lane 222 (B186): the publish hour before each kickoff window rebuilds the pages on a newer status read.

The hours are pinned on the 2026 week 7 Sunday (Eastern daylight time, UTC-4) and on a standard-time Monday,
so the rule never leans on the machine's clock or zone.
"""

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest

from research.nightly.config import LATEST_KEY
from research.nightly.designations import (
    BUILD_FILE,
    Hour,
    Marked,
    PlayerStatus,
    StatusRead,
    build_on_change,
)
from research.nightly.game_day_reads import BUILD_LEAD, read_hour, window_read_due, window_words
from research.nightly.publish import PublishOutcome, encode
from research.nightly.run_store import JSON_TYPE, LocalRunStore

_FIXTURE = Path(__file__).resolve().parents[1] / "nightly" / "contract" / "fixture"
_RUN = "2026-10-21T12-ros"
_GIBBS = "4429795"


def _utc(day: int, hour: int, minute: int = 0, month: int = 10) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=UTC)


# Sunday 2026-10-25, EDT: 9:30 am abroad, 1:00 pm, 4:05 pm, 4:25 pm and 8:20 pm Eastern.
_SUNDAY = (_utc(25, 13, 30), _utc(25, 17), _utc(25, 17), _utc(25, 20, 5), _utc(25, 20, 25), _utc(26, 0, 20))


def test_the_build_lead_leaves_a_build_room_before_kickoff() -> None:
    assert BUILD_LEAD.total_seconds() == 25 * 60


@pytest.mark.parametrize(
    ("kickoff", "hour"),
    [
        (_utc(25, 13, 30), _utc(25, 13)),  # 9:30 am abroad: read at 9:00 ET
        (_utc(25, 17), _utc(25, 16)),  # 1:00 pm: read at 12:00 ET
        (_utc(25, 20, 5), _utc(25, 19)),  # 4:05 pm: read at 3:00 ET
        (_utc(25, 20, 25), _utc(25, 19)),  # 4:25 pm: the same read
        (_utc(26, 0, 20), _utc(25, 23)),  # 8:20 pm: read at 7:00 ET
        (_utc(25, 17, 25), _utc(25, 16)),  # exactly the lead past an hour: that hour leaves no room, the one before
        (_utc(25, 17, 26), _utc(25, 17)),
        (_utc(17, 1, 15, month=11), _utc(17, 0, month=11)),  # Monday 7:15 pm EST (UTC-5): read at 7:00 pm ET
    ],
)
def test_each_kickoff_is_read_before_by_the_last_hour_with_room_for_the_build(
    kickoff: datetime, hour: datetime
) -> None:
    assert read_hour(kickoff) == hour


def test_a_sunday_has_four_game_day_reads_and_no_other_hour_is_one() -> None:
    due = {h: window_read_due(_SUNDAY, _utc(25, h, 2)) for h in range(24)}
    assert {h: k for h, k in due.items() if k is not None} == {
        13: _utc(25, 13, 30),
        16: _utc(25, 17),
        19: _utc(25, 20, 5),
        23: _utc(26, 0, 20),
    }
    assert window_words(_utc(25, 20, 5)) == "the 16:05 ET kickoffs"


@pytest.fixture
def store(tmp_path: Path) -> LocalRunStore:
    shutil.copytree(_FIXTURE / "runs", tmp_path / "runs")
    made = LocalRunStore(tmp_path)
    made.put(LATEST_KEY, encode({"runId": _RUN}), JSON_TYPE)
    return made


class _Dispatcher:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def dispatch(self, run_id: str) -> str | None:
        self.calls.append(run_id)
        return None


def _marked(checked: datetime) -> Marked:
    read = StatusRead(
        _utc(25, 5), checked, "tank01_injuries_by_date", {_GIBBS: PlayerStatus("injured_reserve", True, None)}
    )
    return Marked(read, {_RUN: frozenset({_GIBBS})}, {_RUN: 2026}, "marked")


def _hour(dispatcher: _Dispatcher, now: datetime, *, dispatched: bool = False) -> Hour:
    window = window_read_due(_SUNDAY, now)
    return Hour(dispatcher, PublishOutcome(_RUN, "publish", True, dispatched=dispatched), now, window)  # type: ignore[arg-type]


def test_the_hour_before_a_window_builds_on_a_newer_read_and_only_then(store: LocalRunStore) -> None:
    dispatcher = _Dispatcher()
    # The run's own build in the morning takes the 7:00 ET read.
    own = build_on_change(store, _marked(_utc(25, 11)), _hour(dispatcher, _utc(25, 12, 1), dispatched=True))
    assert own.ok and dispatcher.calls == []
    record = json.loads(store.get(f"runs/{_RUN}/{BUILD_FILE}") or b"{}")
    assert record["statusReadAt"] == "2026-10-25T11:00:00.000Z"
    # 11:00 ET is no window's hour: the newer read waits.
    quiet = build_on_change(store, _marked(_utc(25, 14)), _hour(dispatcher, _utc(25, 15, 1)))
    assert "unchanged since its last build" in quiet.line and dispatcher.calls == []
    # 12:00 ET, before the 1:00 pm games: a newer read, so the build is dispatched and its read recorded.
    before = build_on_change(store, _marked(_utc(25, 15)), _hour(dispatcher, _utc(25, 16, 1)))
    assert before.line == (
        f"designations: run {_RUN}, 1 season-long, read again before the 13:00 ET kickoffs; "
        "the web build of it was dispatched"
    )
    assert dispatcher.calls == [_RUN]
    record = json.loads(store.get(f"runs/{_RUN}/{BUILD_FILE}") or b"{}")
    assert record["statusReadAt"] == "2026-10-25T15:00:00.000Z"
    # 3:00 pm ET with the same read (the capture job did not check since): nothing new to show.
    same = build_on_change(store, _marked(_utc(25, 15)), _hour(dispatcher, _utc(25, 19, 1)))
    assert "unchanged since its last build" in same.line and dispatcher.calls == [_RUN]
    # A read that found no change still moves the check, and so the stamp the page names.
    again = build_on_change(store, _marked(_utc(25, 18)), _hour(dispatcher, _utc(25, 19, 1)))
    assert "before the 16:05 ET kickoffs" in again.line and dispatcher.calls == [_RUN, _RUN]
