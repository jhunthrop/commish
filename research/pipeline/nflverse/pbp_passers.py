"""EACH PASSER'S DROPBACKS, COUNTED FROM THE SAME PLAY-BY-PLAY STREAM.

The denominator a passer's pressure rate needs (`nflverse_pfr_advstats` publishes how often he was
pressured, not how often he dropped back). A dropback is nflverse's own `qb_dropback` flag, credited
to `passer_id`, the dropback's passer on every dropback (scrambles included, where
`passer_player_id` is blank); two-point tries are left out, as the player counts leave them out.
"""

import functools
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from research.pipeline.jscompat import js_locale_compare
from research.pipeline.nflverse.config import SEASON_TYPE
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.pbp import flag, identifier, number_or_null
from research.pipeline.observations import PlayerWeekObservation

PBP_PASSER_SOURCE: Final = "nflverse_pbp_passer"
PASSER_COLUMNS: Final = ("season_type", "season", "week", "game_date", "qb_dropback", "passer_id", "two_point_attempt")


class PasserMetric:
    DROPBACKS: Final = "dropbacks"


@dataclass(frozen=True, slots=True)
class PasserWeek:
    season: int
    week: int
    player_id: str
    game_date: str
    dropbacks: int


class PasserDropbacks:
    """Dropbacks per passer per week, fed one play-by-play row at a time."""

    def __init__(self) -> None:
        self._weeks: dict[tuple[int, int, str], PasserWeek] = {}

    def add(self, row: CsvRow) -> None:
        if row.get("season_type") != SEASON_TYPE or not flag(row, "qb_dropback") or flag(row, "two_point_attempt"):
            return
        passer = identifier(row, "passer_id")
        season, week = number_or_null(row, "season"), number_or_null(row, "week")
        if passer is None or season is None or week is None:
            return
        key = (int(season), int(week), passer)
        held = self._weeks.get(key)
        count = 1 if held is None else held.dropbacks + 1
        self._weeks[key] = PasserWeek(key[0], key[1], passer, row.get("game_date") or "", count)

    def weeks(self) -> list[PasserWeek]:
        def order(a: PasserWeek, b: PasserWeek) -> int:
            return (a.season - b.season) or (a.week - b.week) or js_locale_compare(a.player_id, b.player_id)

        return sorted(self._weeks.values(), key=functools.cmp_to_key(order))


@dataclass(frozen=True, slots=True)
class PasserObservations:
    observations: list[PlayerWeekObservation]
    unknown_players: list[str]


def passer_observations(
    weeks: Sequence[PasserWeek], as_of_for: Callable[[str], datetime], known: frozenset[str]
) -> PasserObservations:
    """One `dropbacks` row per known passer per week, stamped from his game's day."""
    unknown = sorted({w.player_id for w in weeks if w.player_id not in known})
    rows = [
        PlayerWeekObservation(
            w.season, w.week, w.player_id, PBP_PASSER_SOURCE, PasserMetric.DROPBACKS, float(w.dropbacks),
            as_of_for(w.game_date),
        )
        for w in weeks
        if w.player_id in known
    ]  # fmt: skip
    return PasserObservations(rows, unknown)
