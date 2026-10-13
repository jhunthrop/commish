"""PLAY-BY-PLAY, REDUCED AS IT STREAMS (`src/projections/nflverse/pbp.ts`, `pbp-players.ts`).

Two independent accumulators fed from one pass over a season. The team one builds the line
composite (adjusted line yards, stuffs, sacks allowed), neutral-situation pace and pass rate, and
what each defence allowed. The player one counts carries and targets, the red-zone and inside-ten
slices, and air yards. Two-point tries are excluded from the player counts; kneels and spikes from
everything situational.
"""

import functools
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime

from research.pipeline.jscompat import js_is_finite, js_locale_compare, js_number, js_string, js_trim
from research.pipeline.nflverse.config import SEASON_TYPE
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.observations import PlayerWeekObservation, TeamWeekObservation

PBP_SOURCE = "nflverse_pbp"
PBP_PLAYER_SOURCE = "nflverse_pbp_player"


class PbpMetric:
    ADJUSTED_LINE_YARDS = "line_adjusted_line_yards"
    STUFFED_RATE = "line_stuffed_rate"
    SACK_RATE_ALLOWED = "line_sack_rate_allowed"
    PACE_SECONDS_PER_PLAY = "pace_seconds_per_play"
    PASS_RATE = "pass_rate"
    PASS_RATE_OVER_EXPECTED = "pass_rate_over_expected"
    NEUTRAL_PLAYS = "neutral_plays"
    DESIGNED_RUSHES = "designed_rushes"
    DROPBACKS = "dropbacks"
    PASS_YARDS_ALLOWED_PER_DROPBACK = "defence_pass_yards_allowed_per_dropback"
    RUSH_YARDS_ALLOWED_PER_CARRY = "defence_rush_yards_allowed_per_carry"
    DROPBACKS_FACED = "defence_dropbacks_faced"
    CARRIES_FACED = "defence_carries_faced"


class PbpPlayerMetric:
    CARRIES = "pbp_carries"
    TARGETS = "pbp_targets"
    RED_ZONE_CARRIES = "red_zone_carries"
    RED_ZONE_TARGETS = "red_zone_targets"
    INSIDE_TEN_CARRIES = "inside_ten_carries"
    INSIDE_TEN_TARGETS = "inside_ten_targets"
    AIR_YARDS = "air_yards"
    AIR_YARD_TARGETS = "air_yard_targets"


PBP_COLUMNS: tuple[str, ...] = (
    "season", "week", "season_type", "posteam", "defteam", "game_id", "game_date", "play_type", "rush_attempt",
    "qb_scramble", "qb_kneel", "qb_spike", "qb_dropback", "sack", "yards_gained", "game_seconds_remaining",
    "half_seconds_remaining", "qtr", "wp", "fixed_drive", "pass_oe",
)  # fmt: skip
PBP_PLAYER_COLUMNS: tuple[str, ...] = (
    "yardline_100",
    "rusher_player_id",
    "receiver_player_id",
    "air_yards",
    "two_point_attempt",
)

_MIN_WP, _MAX_WP = 0.2, 0.8
_MIN_HALF_SECONDS = 120
_LAST_REGULATION_QUARTER = 4
_MAX_SECONDS_BETWEEN_PLAYS = 60
_LINE_YARD_BANDS: tuple[tuple[float, float], ...] = ((3, 1), (8, 0.5), (float("inf"), 0))
_LOSS_WEIGHT = 1.2
_RED_ZONE, _INSIDE_TEN = 20, 10


def flag(row: CsvRow, column: str) -> bool:
    return row.get(column) == "1"


def number_or_null(row: CsvRow, column: str) -> float | None:
    raw = row.get(column)
    if raw is None or js_trim(raw) == "" or raw == "NA":
        return None
    value = js_number(raw)
    return value if js_is_finite(value) else None


def _identifier(row: CsvRow, column: str) -> str | None:
    raw = row.get(column)
    if raw is None or js_trim(raw) == "" or raw == "NA":
        return None
    return raw


def line_yards_for(yards_gained: float) -> float:
    """`lineYardsFor`: full credit for the first three yards, half for the next five, none after."""
    if yards_gained < 0:
        return yards_gained * _LOSS_WEIGHT
    credited = 0.0
    floor = 0.0
    for up_to, weight in _LINE_YARD_BANDS:
        ceiling = min(yards_gained, up_to)
        if ceiling > floor:
            credited += (ceiling - floor) * weight
        floor = max(floor, up_to)
    return credited


@dataclass
class _TeamTally:
    season: float
    week: float
    team: str
    game_date: str
    designed_rushes: int = 0
    line_yards: float = 0.0
    stuffs: int = 0
    dropbacks: int = 0
    sacks: int = 0
    neutral_plays: int = 0
    neutral_passes: int = 0
    neutral_seconds: float = 0.0
    neutral_seconds_plays: int = 0
    pass_over_expected_sum: float = 0.0
    pass_over_expected_plays: int = 0
    dropbacks_faced: int = 0
    pass_yards_allowed: float = 0.0
    carries_faced: int = 0
    rush_yards_allowed: float = 0.0
    opponents: set[str] = field(default_factory=set)


@dataclass(frozen=True)
class TeamWeekPlayProfile:
    season: int
    week: int
    team: str
    game_date: str
    values: tuple[tuple[str, float | None], ...]


def _over(part: float, whole: float) -> float | None:
    return None if whole == 0 else part / whole


class PlayByPlayAggregator:
    def __init__(self) -> None:
        self._tallies: dict[str, _TeamTally] = {}
        self._last_drive_key: str | None = None
        self._last_drive_seconds: float | None = None

    def _tally(self, season: float, week: float, team: str, game_date: str) -> _TeamTally:
        key = f"{js_string(season)}|{js_string(week)}|{team}"
        existing = self._tallies.get(key)
        if existing is None:
            existing = _TeamTally(season=season, week=week, team=team, game_date=game_date)
            self._tallies[key] = existing
        return existing

    def add(self, row: CsvRow) -> None:
        if row.get("season_type") != SEASON_TYPE:
            return
        team = row.get("posteam")
        if team is None or js_trim(team) == "":
            return
        season = number_or_null(row, "season")
        week = number_or_null(row, "week")
        if season is None or week is None:
            return
        game_date = row.get("game_date") or ""
        tally = self._tally(season, week, team, game_date)
        defence = row.get("defteam")
        against = None if defence is None or js_trim(defence) == "" else self._tally(season, week, defence, game_date)
        if against is not None:
            against.opponents.add(team)

        gained = number_or_null(row, "yards_gained")
        yards = 0.0 if gained is None else gained
        kneel = flag(row, "qb_kneel")
        spike = flag(row, "qb_spike")
        if flag(row, "rush_attempt") and not flag(row, "qb_scramble") and not kneel:
            tally.designed_rushes += 1
            tally.line_yards += line_yards_for(yards)
            if yards <= 0:
                tally.stuffs += 1
            if against is not None:
                against.carries_faced += 1
                against.rush_yards_allowed += yards
        if flag(row, "qb_dropback") and not kneel and not spike:
            tally.dropbacks += 1
            if flag(row, "sack"):
                tally.sacks += 1
            if against is not None:
                against.dropbacks_faced += 1
                against.pass_yards_allowed += yards

        play_type = row.get("play_type") or ""
        if play_type not in ("run", "pass") or kneel or spike:
            self._last_drive_key = None
            self._last_drive_seconds = None
            return
        self._situational(row, tally, team, play_type)

    def _situational(self, row: CsvRow, tally: _TeamTally, team: str, play_type: str) -> None:
        wp = number_or_null(row, "wp")
        half_seconds = number_or_null(row, "half_seconds_remaining")
        quarter = number_or_null(row, "qtr")
        neutral = (
            wp is not None
            and _MIN_WP <= wp <= _MAX_WP
            and half_seconds is not None
            and half_seconds >= _MIN_HALF_SECONDS
            and quarter is not None
            and quarter <= _LAST_REGULATION_QUARTER
        )
        drive_key = f"{team}|{row.get('game_id') or ''}|{row.get('fixed_drive') or ''}"
        game_seconds = number_or_null(row, "game_seconds_remaining")
        if neutral:
            tally.neutral_plays += 1
            if play_type == "pass":
                tally.neutral_passes += 1
            over_expected = number_or_null(row, "pass_oe")
            if over_expected is not None:
                tally.pass_over_expected_sum += over_expected
                tally.pass_over_expected_plays += 1
            if self._last_drive_key == drive_key and self._last_drive_seconds is not None and game_seconds is not None:
                elapsed = self._last_drive_seconds - game_seconds
                if 0 < elapsed <= _MAX_SECONDS_BETWEEN_PLAYS:
                    tally.neutral_seconds += elapsed
                    tally.neutral_seconds_plays += 1
        self._last_drive_key = drive_key
        self._last_drive_seconds = game_seconds

    def profiles(self) -> list[TeamWeekPlayProfile]:
        def order(a: _TeamTally, b: _TeamTally) -> int:
            return _sign(a.season - b.season) or _sign(a.week - b.week) or js_locale_compare(a.team, b.team)

        profiles: list[TeamWeekPlayProfile] = []
        for t in sorted(self._tallies.values(), key=functools.cmp_to_key(order)):
            values: tuple[tuple[str, float | None], ...] = (
                (PbpMetric.ADJUSTED_LINE_YARDS, _over(t.line_yards, t.designed_rushes)),
                (PbpMetric.STUFFED_RATE, _over(t.stuffs, t.designed_rushes)),
                (PbpMetric.SACK_RATE_ALLOWED, _over(t.sacks, t.dropbacks)),
                (PbpMetric.PACE_SECONDS_PER_PLAY, _over(t.neutral_seconds, t.neutral_seconds_plays)),
                (PbpMetric.PASS_RATE, _over(t.neutral_passes, t.neutral_plays)),
                (PbpMetric.PASS_RATE_OVER_EXPECTED, _over(t.pass_over_expected_sum, t.pass_over_expected_plays)),
                (PbpMetric.NEUTRAL_PLAYS, float(t.neutral_plays)),
                (PbpMetric.DESIGNED_RUSHES, float(t.designed_rushes)),
                (PbpMetric.DROPBACKS, float(t.dropbacks)),
                (PbpMetric.PASS_YARDS_ALLOWED_PER_DROPBACK, _over(t.pass_yards_allowed, t.dropbacks_faced)),
                (PbpMetric.RUSH_YARDS_ALLOWED_PER_CARRY, _over(t.rush_yards_allowed, t.carries_faced)),
                (PbpMetric.DROPBACKS_FACED, float(t.dropbacks_faced)),
                (PbpMetric.CARRIES_FACED, float(t.carries_faced)),
            )
            profiles.append(TeamWeekPlayProfile(int(t.season), int(t.week), t.team, t.game_date, values))
        return profiles


def _sign(value: float) -> int:
    return (value > 0) - (value < 0)


def play_profile_observations(
    profiles: Sequence[TeamWeekPlayProfile], as_of_for: Callable[[TeamWeekPlayProfile], datetime]
) -> list[TeamWeekObservation]:
    rows: list[TeamWeekObservation] = []
    for profile in profiles:
        as_of = as_of_for(profile)
        for metric, value in profile.values:
            if value is not None:
                rows.append(
                    TeamWeekObservation(profile.season, profile.week, profile.team, PBP_SOURCE, metric, value, as_of)
                )
    return rows


@dataclass
class _PlayerTally:
    season: float
    week: float
    player_id: str
    game_date: str
    carries: int = 0
    targets: int = 0
    red_zone_carries: int = 0
    red_zone_targets: int = 0
    inside_ten_carries: int = 0
    inside_ten_targets: int = 0
    air_yards: float = 0.0
    air_yard_targets: int = 0


class PlayerPlayAggregator:
    def __init__(self) -> None:
        self._tallies: dict[str, _PlayerTally] = {}

    def _tally(self, season: float, week: float, player_id: str, game_date: str) -> _PlayerTally:
        key = f"{js_string(season)}|{js_string(week)}|{player_id}"
        existing = self._tallies.get(key)
        if existing is None:
            existing = _PlayerTally(season=season, week=week, player_id=player_id, game_date=game_date)
            self._tallies[key] = existing
        return existing

    def add(self, row: CsvRow) -> None:
        if row.get("season_type") != SEASON_TYPE:
            return
        season = number_or_null(row, "season")
        week = number_or_null(row, "week")
        if season is None or week is None:
            return
        if flag(row, "two_point_attempt"):
            return
        game_date = row.get("game_date") or ""
        yardline = number_or_null(row, "yardline_100")
        red_zone = yardline is not None and yardline <= _RED_ZONE
        inside_ten = yardline is not None and yardline <= _INSIDE_TEN
        rusher = _identifier(row, "rusher_player_id")
        if (
            rusher is not None
            and flag(row, "rush_attempt")
            and not flag(row, "qb_scramble")
            and not flag(row, "qb_kneel")
        ):
            tally = self._tally(season, week, rusher, game_date)
            tally.carries += 1
            tally.red_zone_carries += 1 if red_zone else 0
            tally.inside_ten_carries += 1 if inside_ten else 0
        receiver = _identifier(row, "receiver_player_id")
        if receiver is not None and row.get("play_type") == "pass":
            tally = self._tally(season, week, receiver, game_date)
            tally.targets += 1
            tally.red_zone_targets += 1 if red_zone else 0
            tally.inside_ten_targets += 1 if inside_ten else 0
            air = number_or_null(row, "air_yards")
            if air is not None:
                tally.air_yards += air
                tally.air_yard_targets += 1

    def touches(self) -> list[_PlayerTally]:
        def order(a: _PlayerTally, b: _PlayerTally) -> int:
            return _sign(a.season - b.season) or _sign(a.week - b.week) or js_locale_compare(a.player_id, b.player_id)

        return sorted(self._tallies.values(), key=functools.cmp_to_key(order))


@dataclass(frozen=True)
class TouchObservations:
    observations: list[PlayerWeekObservation]
    unknown_players: list[str]


def player_touch_observations(
    touches: Sequence[_PlayerTally], as_of_for: Callable[[str], datetime], known: frozenset[str]
) -> TouchObservations:
    unknown: set[str] = set()
    observations: list[PlayerWeekObservation] = []
    for t in touches:
        if t.player_id not in known:
            unknown.add(t.player_id)
            continue
        as_of = as_of_for(t.game_date)
        for metric, value in (
            (PbpPlayerMetric.CARRIES, t.carries),
            (PbpPlayerMetric.TARGETS, t.targets),
            (PbpPlayerMetric.RED_ZONE_CARRIES, t.red_zone_carries),
            (PbpPlayerMetric.RED_ZONE_TARGETS, t.red_zone_targets),
            (PbpPlayerMetric.INSIDE_TEN_CARRIES, t.inside_ten_carries),
            (PbpPlayerMetric.INSIDE_TEN_TARGETS, t.inside_ten_targets),
            (PbpPlayerMetric.AIR_YARDS, t.air_yards),
            (PbpPlayerMetric.AIR_YARD_TARGETS, t.air_yard_targets),
        ):
            observations.append(
                PlayerWeekObservation(
                    int(t.season), int(t.week), t.player_id, PBP_PLAYER_SOURCE, metric, float(value), as_of
                )
            )
    return TouchObservations(observations, sorted(unknown))
