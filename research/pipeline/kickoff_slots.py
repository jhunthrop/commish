"""THE KICKOFF SLOTS: when the weekly round 4's two benchmarks are captured (preregistration §2.9, §6.1).

Tank01's weekly projection and the anytime-touchdown market are captured once per kickoff slot, so
each benchmark is read as it stood shortly before the games it describes. A slot is a week's games
that kick off on one New York day, with Sunday split at 15:00 into early and late (the late window
carries the night game): Thursday, Sunday early, Sunday late and Monday every week, the Friday,
Saturday or Wednesday games of the weeks that have them under their day, and a Sunday game abroad
before noon New York as its own morning slot.

A slot is DUE in the `LEAD` before its first kickoff, and a capture whose rows already stand in that
window is not repeated: the hourly harvest fires once or twice inside it, and the first one captures.
"""

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from research.pipeline.kickoffs import TeamKickoff

LEAD: Final = timedelta(hours=2)
# How far an event's own start may sit from the stored kickoffs and still belong to a slot: the odds
# provider's instant and nflverse's can differ by minutes, and a late flex can move a game by hours.
EVENT_TOLERANCE: Final = timedelta(hours=3)
_NEW_YORK: Final = ZoneInfo("America/New_York")
_SUNDAY: Final = 6
_LATE_FROM_HOUR: Final = 15
_EARLY_FROM_HOUR: Final = 12
_DAY_NAMES: Final = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


@dataclass(frozen=True, slots=True)
class Slot:
    season: int
    week: int
    name: str
    first_kickoff: datetime
    last_kickoff: datetime

    @property
    def opens(self) -> datetime:
        return self.first_kickoff - LEAD

    def holds(self, kickoff: datetime) -> bool:
        return self.first_kickoff <= kickoff <= self.last_kickoff


def slot_name(kickoff: datetime) -> str:
    local = kickoff.astimezone(_NEW_YORK)
    day = _DAY_NAMES[local.weekday()]
    if local.weekday() != _SUNDAY:
        return day
    if local.hour >= _LATE_FROM_HOUR:
        return f"{day}-late"
    return f"{day}-early" if local.hour >= _EARLY_FROM_HOUR else f"{day}-morning"


def kickoff_slots(kickoffs: Sequence[TeamKickoff]) -> list[Slot]:
    """Every slot of the kickoffs, earliest first."""
    grouped: dict[tuple[int, int, str, str], list[datetime]] = defaultdict(list)
    for k in kickoffs:
        local_day = k.at.astimezone(_NEW_YORK).date().isoformat()
        grouped[(k.season, k.week, local_day, slot_name(k.at))].append(k.at)
    slots = [Slot(season, week, name, min(times), max(times)) for (season, week, _day, name), times in grouped.items()]
    return sorted(slots, key=lambda s: s.first_kickoff)


def _gap(slot: Slot, instant: datetime) -> timedelta:
    if slot.holds(instant):
        return timedelta(0)
    return slot.first_kickoff - instant if instant < slot.first_kickoff else instant - slot.last_kickoff


def slot_of(slots: Sequence[Slot], instant: datetime) -> Slot | None:
    """The slot an event's start belongs to: the nearest, within `EVENT_TOLERANCE`."""
    nearest = min(slots, key=lambda s: _gap(s, instant), default=None)
    return nearest if nearest is not None and _gap(nearest, instant) <= EVENT_TOLERANCE else None


def due_slot(slots: Sequence[Slot], now: datetime) -> Slot | None:
    """The slot whose capture window holds `now`, if any."""
    return next((s for s in slots if s.opens <= now < s.first_kickoff), None)
