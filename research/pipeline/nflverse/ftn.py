"""FTN DATA'S CHARTING, JOINED TO PLAY-BY-PLAY AND COUNTED PER PLAYER PER WEEK.

FTN charts every play (`ftn_charting`, 2022 on, keyed by `nflverse_game_id` and `nflverse_play_id`)
but names no player, so each charted play is joined to its play-by-play row, which names the
dropback's passer (`passer_id`) and the target (`receiver_player_id`). What a capsule can name is
counted, never averaged, so a season figure is a sum over weeks with its denominator beside it:

- a target's receiver: charted targets, catchable, contested, contested and caught, dropped, a
  created reception, on play action, on a screen;
- a dropback's passer: charted dropbacks, blitzed (one or more blitzers), on play action, out of the
  pocket; and of his pass attempts, interception-worthy throws and throwaways.

Two-point tries and sacks are no target; a sack is a dropback. FTN's booleans are `TRUE`/`FALSE`, and
anything else is a schema change. Columns are FTN's data dictionary's (nflreadr
`dictionary_ftn_charting`); FTN's pressure is not charted, so a passer's pressure comes from the
PFR feed (`pfr_advstats.py`).
"""

import functools
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Final

from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_locale_compare
from research.pipeline.nflverse.config import SEASON_TYPE
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.pbp import flag, identifier, number_or_null
from research.pipeline.observations import PlayerWeekObservation

FTN_SOURCE: Final = "nflverse_ftn_charting"
FTN_FLAGS: Final = (
    "is_play_action",
    "is_screen_pass",
    "is_qb_out_of_pocket",
    "is_interception_worthy",
    "is_throw_away",
    "is_catchable_ball",
    "is_contested_ball",
    "is_created_reception",
    "is_drop",
)
FTN_COLUMNS: Final = ("nflverse_game_id", "nflverse_play_id", *FTN_FLAGS, "n_blitzers")
PBP_JOIN_COLUMNS: Final = (
    "game_id", "play_id", "season_type", "season", "week", "game_date", "qb_dropback", "passer_id",
    "pass_attempt", "sack", "receiver_player_id", "complete_pass", "two_point_attempt",
)  # fmt: skip
_TRUE, _FALSE = "TRUE", "FALSE"


class FtnMetric:
    TARGETS: Final = "charted_targets"
    CATCHABLE_TARGETS: Final = "catchable_targets"
    CONTESTED_TARGETS: Final = "contested_targets"
    CONTESTED_CATCHES: Final = "contested_catches"
    DROPS: Final = "drops"
    CREATED_RECEPTIONS: Final = "created_receptions"
    PLAY_ACTION_TARGETS: Final = "play_action_targets"
    SCREEN_TARGETS: Final = "screen_targets"
    DROPBACKS: Final = "charted_dropbacks"
    BLITZED_DROPBACKS: Final = "blitzed_dropbacks"
    PLAY_ACTION_DROPBACKS: Final = "play_action_dropbacks"
    OUT_OF_POCKET_DROPBACKS: Final = "out_of_pocket_dropbacks"
    PASS_ATTEMPTS: Final = "charted_pass_attempts"
    INTERCEPTION_WORTHY_THROWS: Final = "interception_worthy_throws"
    THROWAWAYS: Final = "throwaways"


@dataclass(frozen=True, slots=True)
class ChartedPlay:
    flags: frozenset[str]
    blitzers: int

    def has(self, name: str) -> bool:
        return name in self.flags


def play_key(game_id: str, play_id: str) -> tuple[str, int]:
    """A play's join key: nflverse's game id and its integer play id (either file may print `41.0`)."""
    number = number_or_null({"id": play_id}, "id")
    if game_id.strip() == "" or number is None:
        raise SchemaDriftError(f"A charted play has no readable game or play id ({game_id!r}, {play_id!r}).")
    return game_id, int(number)


def _flags(row: CsvRow) -> frozenset[str]:
    set_flags = []
    for name in FTN_FLAGS:
        value = row.get(name)
        if value == _TRUE:
            set_flags.append(name)
        elif value != _FALSE:
            raise SchemaDriftError(f"FTN charting column {name} holds {value!r}, not TRUE or FALSE.")
    return frozenset(set_flags)


@dataclass(slots=True)
class ChartIndex:
    """Every charted play by its key, read once from the FTN file."""

    plays: dict[tuple[str, int], ChartedPlay] = field(default_factory=dict)

    def add(self, row: CsvRow) -> None:
        key = play_key(row.get("nflverse_game_id") or "", row.get("nflverse_play_id") or "")
        if key in self.plays:
            raise SchemaDriftError(f"FTN charting lists play {key[1]} of {key[0]} twice.")
        blitzers = number_or_null(row, "n_blitzers")
        self.plays[key] = ChartedPlay(_flags(row), 0 if blitzers is None else int(blitzers))


@dataclass(slots=True)
class _Tally:
    season: int
    week: int
    player_id: str
    game_date: str
    counts: dict[str, int] = field(default_factory=dict)

    def bump(self, metric: str, when: bool = True) -> None:
        self.counts[metric] = self.counts.get(metric, 0) + (1 if when else 0)


_RECEIVER_COUNTS: Final = (
    (FtnMetric.CATCHABLE_TARGETS, "is_catchable_ball"),
    (FtnMetric.CONTESTED_TARGETS, "is_contested_ball"),
    (FtnMetric.DROPS, "is_drop"),
    (FtnMetric.CREATED_RECEPTIONS, "is_created_reception"),
    (FtnMetric.PLAY_ACTION_TARGETS, "is_play_action"),
    (FtnMetric.SCREEN_TARGETS, "is_screen_pass"),
)
_DROPBACK_COUNTS: Final = (
    (FtnMetric.PLAY_ACTION_DROPBACKS, "is_play_action"),
    (FtnMetric.OUT_OF_POCKET_DROPBACKS, "is_qb_out_of_pocket"),
)
_THROW_COUNTS: Final = (
    (FtnMetric.INTERCEPTION_WORTHY_THROWS, "is_interception_worthy"),
    (FtnMetric.THROWAWAYS, "is_throw_away"),
)


@dataclass(slots=True)
class ChartedPlayers:
    """Fed the season's play-by-play one row at a time; counts each charted play's passer and target."""

    index: ChartIndex
    joined: int = 0
    uncharted: int = 0
    _tallies: dict[tuple[int, int, str], _Tally] = field(default_factory=dict)

    def _tally(self, season: int, week: int, player_id: str, game_date: str) -> _Tally:
        key = (season, week, player_id)
        held = self._tallies.get(key)
        if held is None:
            held = _Tally(season, week, player_id, game_date)
            self._tallies[key] = held
        return held

    def add(self, row: CsvRow) -> None:
        if row.get("season_type") != SEASON_TYPE or flag(row, "two_point_attempt"):
            return
        season, week = number_or_null(row, "season"), number_or_null(row, "week")
        passer, receiver = identifier(row, "passer_id"), identifier(row, "receiver_player_id")
        dropback = flag(row, "qb_dropback") and passer is not None
        target = flag(row, "pass_attempt") and not flag(row, "sack") and receiver is not None
        if season is None or week is None or not (dropback or target):
            return
        charted = self.index.plays.get(play_key(row.get("game_id") or "", row.get("play_id") or ""))
        if charted is None:
            self.uncharted += 1
            return
        self.joined += 1
        game_date = row.get("game_date") or ""
        if dropback and passer is not None:
            self._dropback(self._tally(int(season), int(week), passer, game_date), charted, row)
        if target and receiver is not None:
            self._target(self._tally(int(season), int(week), receiver, game_date), charted, row)

    @staticmethod
    def _dropback(tally: _Tally, play: ChartedPlay, row: CsvRow) -> None:
        tally.bump(FtnMetric.DROPBACKS)
        tally.bump(FtnMetric.BLITZED_DROPBACKS, play.blitzers > 0)
        for metric, name in _DROPBACK_COUNTS:
            tally.bump(metric, play.has(name))
        if flag(row, "pass_attempt") and not flag(row, "sack"):
            tally.bump(FtnMetric.PASS_ATTEMPTS)
            for metric, name in _THROW_COUNTS:
                tally.bump(metric, play.has(name))

    @staticmethod
    def _target(tally: _Tally, play: ChartedPlay, row: CsvRow) -> None:
        tally.bump(FtnMetric.TARGETS)
        tally.bump(FtnMetric.CONTESTED_CATCHES, play.has("is_contested_ball") and flag(row, "complete_pass"))
        for metric, name in _RECEIVER_COUNTS:
            tally.bump(metric, play.has(name))

    def tallies(self) -> list[_Tally]:
        def order(a: _Tally, b: _Tally) -> int:
            return (a.season - b.season) or (a.week - b.week) or js_locale_compare(a.player_id, b.player_id)

        return sorted(self._tallies.values(), key=functools.cmp_to_key(order))


@dataclass(frozen=True, slots=True)
class FtnObservations:
    observations: list[PlayerWeekObservation]
    unknown_players: list[str]


def ftn_observations(
    tallies: Sequence[_Tally], as_of_for: Callable[[str], datetime], known: frozenset[str]
) -> FtnObservations:
    """Every count of every known player's week, in metric order: a zero is a real count of his plays."""
    unknown = sorted({t.player_id for t in tallies if t.player_id not in known})
    rows: list[PlayerWeekObservation] = []
    for t in tallies:
        if t.player_id not in known:
            continue
        as_of = as_of_for(t.game_date)
        for metric in sorted(t.counts):
            rows.append(
                PlayerWeekObservation(t.season, t.week, t.player_id, FTN_SOURCE, metric, float(t.counts[metric]), as_of)
            )
    return FtnObservations(rows, unknown)
