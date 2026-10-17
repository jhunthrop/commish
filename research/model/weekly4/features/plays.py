"""A GAME'S PLAYS, TALLIED: each player's opportunities, his club's totals, the defence's pressure and
the position groups' targets by depth and location.

The round 4 preregistration, sections 2.2 to 2.4, read on the play table (`nflverse_pbp_plays`,
section 2.9). The kinds of opportunity, each a count of plays:

- a **target**: a pass (play type `pass`, not a sack) with a receiver,
- a **designed rush** ("carry"): a run (play type `run`) with a rusher, not a quarterback scramble,
- a **dropback**: a play nflverse flags `qb_dropback` (passes, sacks and scrambles), credited to the
  passer, or on a scramble to the rusher,
- **air yards**: the sum of air yards over targets (a target without an air-yards value adds 0),
- **red-zone** and **inside-the-ten** opportunities: targets plus designed rushes from the
  opponent's 20 and 10 or closer (`yardline_100`).

Two-point attempts, kneels, spikes, penalties without a play and special teams are no opportunity.
A target's depth is behind the line (air yards below 0), under 10, 10 to 19, or 20 and over; its
location is outside (left or right) or the middle.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, fields, replace
from datetime import datetime
from types import MappingProxyType
from typing import Final

SCRIMMAGE: Final = frozenset({"pass", "run"})
RED_ZONE_YARDS: Final = 20
INSIDE_TEN_YARDS: Final = 10
DEPTH_BUCKETS: Final = ("behind", "short", "intermediate", "deep")
_DEPTH_EDGES: Final = (0.0, 10.0, 20.0)  # air yards at which the next bucket starts
_OUTSIDE: Final = frozenset({"left", "right"})
_MIDDLE: Final = "middle"


@dataclass(frozen=True, slots=True)
class Play:
    """One play of the play table, the columns the features and the play rows read."""

    game_id: str
    play_id: int
    season: int
    week: int
    as_of: datetime
    posteam: str | None
    defteam: str | None
    down: int | None
    ydstogo: int | None
    yardline_100: int | None
    play_type: str
    qb_dropback: bool | None
    qb_scramble: bool | None
    sack: bool | None
    qb_hit: bool | None
    two_point_attempt: bool | None
    passer_player_id: str | None
    rusher_player_id: str | None
    receiver_player_id: str | None
    yards_gained: float | None
    air_yards: float | None
    complete_pass: bool | None
    interception: bool | None
    pass_touchdown: bool | None
    rush_touchdown: bool | None
    pass_location: str | None
    run_location: str | None
    run_gap: str | None


PLAY_COLUMNS: Final = tuple(f.name for f in fields(Play))


def _scrimmage(play: Play) -> bool:
    return play.play_type in SCRIMMAGE and not play.two_point_attempt and play.posteam is not None


def is_target(play: Play) -> bool:
    return _scrimmage(play) and play.play_type == "pass" and not play.sack and play.receiver_player_id is not None


def is_designed_rush(play: Play) -> bool:
    return _scrimmage(play) and play.play_type == "run" and not play.qb_scramble and play.rusher_player_id is not None


def is_dropback(play: Play) -> bool:
    return _scrimmage(play) and bool(play.qb_dropback)


def dropper(play: Play) -> str | None:
    """Who a dropback is credited to: the passer, or on a scramble the rusher."""
    return play.passer_player_id or (play.rusher_player_id if play.qb_scramble else None)


def depth_bucket(air_yards: float | None) -> str | None:
    if air_yards is None:
        return None
    for bucket, edge in zip(DEPTH_BUCKETS, _DEPTH_EDGES, strict=False):
        if air_yards < edge:
            return bucket
    return DEPTH_BUCKETS[-1]


@dataclass(frozen=True, slots=True)
class Counts:
    """A player's or a club's opportunities of each kind in one game (or summed over games)."""

    targets: float = 0.0
    carries: float = 0.0
    air_yards: float = 0.0
    red_zone: float = 0.0
    inside_ten: float = 0.0
    dropbacks: float = 0.0

    def of(self, kind: str) -> float:
        value: float = getattr(self, kind)
        return value

    def plus(self, other: "Counts") -> "Counts":
        return Counts(*(getattr(self, k) + getattr(other, k) for k in SHARE_KINDS))

    def scaled(self, by: float) -> "Counts":
        return Counts(*(getattr(self, k) * by for k in SHARE_KINDS))


SHARE_KINDS: Final = tuple(f.name for f in fields(Counts))
ZERO_COUNTS: Final = Counts()


def _opportunity(play: Play, carry: bool) -> Counts:
    """One target (carry False) or one designed rush (carry True) as counts."""
    yards = play.yardline_100
    red = 1.0 if yards is not None and yards <= RED_ZONE_YARDS else 0.0
    ten = 1.0 if yards is not None and yards <= INSIDE_TEN_YARDS else 0.0
    if carry:
        return Counts(carries=1.0, red_zone=red, inside_ten=ten)
    return Counts(targets=1.0, air_yards=play.air_yards or 0.0, red_zone=red, inside_ten=ten)


def _bucket_vector(bucket: str | None) -> tuple[float, ...]:
    return tuple(1.0 if b == bucket else 0.0 for b in DEPTH_BUCKETS)


def _add(a: tuple[float, ...], b: tuple[float, ...]) -> tuple[float, ...]:
    return tuple(x + y for x, y in zip(a, b, strict=True))


_NO_DEPTH: Final = (0.0, 0.0, 0.0, 0.0)


@dataclass(frozen=True, slots=True)
class PlayerTally:
    """One player's game: his club, his opportunities, and what his targets and touches were."""

    club: str
    counts: Counts = ZERO_COUNTS
    receptions: float = 0.0
    rush_attempts: float = 0.0  # designed rushes and scrambles: the touches broken tackles are over
    depth: tuple[float, ...] = _NO_DEPTH  # targets per depth bucket
    outside: float = 0.0
    middle: float = 0.0
    air_yard_targets: float = 0.0  # targets that carry an air-yards value


@dataclass(frozen=True, slots=True)
class Pressure:
    """A defence's game: the dropbacks it faced, its sacks and its quarterback hits."""

    dropbacks: float = 0.0
    sacks: float = 0.0
    hits: float = 0.0


@dataclass(frozen=True, slots=True)
class GroupTargets:
    """A position group's game on offence: targets and designed rushes, and targets by depth and location."""

    air: float = 0.0
    ground: float = 0.0
    depth: tuple[float, ...] = _NO_DEPTH
    outside: float = 0.0
    middle: float = 0.0


PlayerWeek = tuple[str, int]  # (player, week)
ClubWeek = tuple[str, int]  # (club, week)


@dataclass(frozen=True, slots=True)
class Tallies:
    players: Mapping[PlayerWeek, PlayerTally]
    clubs: Mapping[ClubWeek, Counts]
    defences: Mapping[ClubWeek, Pressure]
    groups: Mapping[ClubWeek, Mapping[str, GroupTargets]]


@dataclass(slots=True)
class _Builder:
    players: dict[PlayerWeek, PlayerTally] = field(default_factory=dict)
    clubs: dict[ClubWeek, Counts] = field(default_factory=dict)
    defences: dict[ClubWeek, Pressure] = field(default_factory=dict)
    groups: dict[ClubWeek, dict[str, GroupTargets]] = field(default_factory=dict)

    def player(self, player_id: str, play: Play) -> PlayerTally:
        club = play.posteam or ""
        return self.players.get((player_id, play.week)) or PlayerTally(club)

    def club(self, play: Play, counts: Counts) -> None:
        key = (play.posteam or "", play.week)
        self.clubs[key] = self.clubs.get(key, ZERO_COUNTS).plus(counts)

    def group(self, play: Play, position: str | None) -> GroupTargets:
        return self.groups.setdefault((play.posteam or "", play.week), {}).get(position or "", GroupTargets())

    def set_group(self, play: Play, position: str | None, value: GroupTargets) -> None:
        if position is not None:
            self.groups.setdefault((play.posteam or "", play.week), {})[position] = value


def _target(b: _Builder, play: Play, positions: Mapping[str, str]) -> None:
    receiver = play.receiver_player_id or ""
    counts = _opportunity(play, carry=False)
    bucket = _bucket_vector(depth_bucket(play.air_yards))
    outside = 1.0 if play.pass_location in _OUTSIDE else 0.0
    middle = 1.0 if play.pass_location == _MIDDLE else 0.0
    t = b.player(receiver, play)
    b.players[(receiver, play.week)] = replace(
        t,
        counts=t.counts.plus(counts),
        receptions=t.receptions + (1.0 if play.complete_pass else 0.0),
        depth=_add(t.depth, bucket),
        outside=t.outside + outside,
        middle=t.middle + middle,
        air_yard_targets=t.air_yard_targets + (0.0 if play.air_yards is None else 1.0),
    )
    b.club(play, counts)
    position = positions.get(receiver)
    g = b.group(play, position)
    b.set_group(
        play,
        position,
        replace(g, air=g.air + 1.0, depth=_add(g.depth, bucket), outside=g.outside + outside, middle=g.middle + middle),
    )


def _rush(b: _Builder, play: Play, positions: Mapping[str, str]) -> None:
    rusher = play.rusher_player_id or ""
    t = b.player(rusher, play)
    if is_designed_rush(play):
        counts = _opportunity(play, carry=True)
        b.players[(rusher, play.week)] = replace(t, counts=t.counts.plus(counts), rush_attempts=t.rush_attempts + 1.0)
        b.club(play, counts)
        position = positions.get(rusher)
        g = b.group(play, position)
        b.set_group(play, position, replace(g, ground=g.ground + 1.0))
    elif play.qb_scramble:
        b.players[(rusher, play.week)] = replace(t, rush_attempts=t.rush_attempts + 1.0)


def _dropback(b: _Builder, play: Play) -> None:
    who = dropper(play)
    b.club(play, Counts(dropbacks=1.0))
    if who is not None:
        t = b.player(who, play)
        b.players[(who, play.week)] = replace(t, counts=t.counts.plus(Counts(dropbacks=1.0)))
    if play.defteam is not None:
        key = (play.defteam, play.week)
        p = b.defences.get(key, Pressure())
        b.defences[key] = Pressure(
            p.dropbacks + 1.0, p.sacks + (1.0 if play.sack else 0.0), p.hits + (1.0 if play.qb_hit else 0.0)
        )


def merge(parts: Iterable[Tallies]) -> Tallies:
    """The tallies of several games (their keys are disjoint: a club plays once a week)."""
    players: dict[PlayerWeek, PlayerTally] = {}
    clubs: dict[ClubWeek, Counts] = {}
    defences: dict[ClubWeek, Pressure] = {}
    groups: dict[ClubWeek, Mapping[str, GroupTargets]] = {}
    for part in parts:
        players.update(part.players)
        clubs.update(part.clubs)
        defences.update(part.defences)
        groups.update(part.groups)
    return Tallies(
        MappingProxyType(players), MappingProxyType(clubs), MappingProxyType(defences), MappingProxyType(groups)
    )


def tally(plays: Iterable[Play], positions: Mapping[str, str]) -> Tallies:
    """Every game's tallies among `plays`, by (player, week) and (club, week)."""
    b = _Builder()
    for play in plays:
        if is_target(play):
            _target(b, play, positions)
        if _scrimmage(play) and play.play_type == "run" and play.rusher_player_id is not None:
            _rush(b, play, positions)
        if is_dropback(play):
            _dropback(b, play)
    return Tallies(
        MappingProxyType(b.players),
        MappingProxyType(b.clubs),
        MappingProxyType(b.defences),
        MappingProxyType({k: MappingProxyType(v) for k, v in b.groups.items()}),
    )
