"""THE UNITS' GAMES, TALLIED: one tally of a club's defense, a club's offense and a kicker over a set of
week rows (the admitted rows at t_g, or a whole season's outcomes for the league priors), so the priors and
the features read the same arithmetic.

From the team-defense weeks: per defense (`team`), each game's points allowed over the implied points it
faced, its interceptions, fumble recoveries, return touchdowns, safeties and blocks; per offense
(`opponent_team`), its fumbles lost. From the kicking weeks:
per club, its field-goal and extra-point attempts per game; per kicker, his attempts and makes by distance
band, his extra points. From the kick plays: per club, its two-point tries and extra-point tries.
"""

from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Final

from research.model.weekly_kdef.scoring import FG_BANDS

Implied = Callable[[int, int, str], float | None]  # (season, week, offense club) -> its implied points
DEFENSE_STATS: Final = ("pa_over_expected", "int", "fr", "return_td", "safeties", "blocks")
OFFENSE_STATS: Final = ("fumbles_lost", "fg_att", "pat_att", "two_point", "xp_try")
_BLOCKS: Final = ("def_punt_blocks", "def_pat_blocks", "def_fg_blocks")


def _number(value: Any) -> float:
    return 0.0 if value is None else float(value)


@dataclass(slots=True)
class Unit:
    """One unit's per-game values by stat, and its game keys."""

    values: dict[str, list[float]] = field(default_factory=lambda: defaultdict(list))
    games: set[tuple[int, int]] = field(default_factory=set)
    by_game: dict[tuple[int, int], dict[str, float]] = field(default_factory=lambda: defaultdict(dict))


@dataclass(slots=True)
class Kicker:
    attempts: dict[str, float] = field(default_factory=lambda: dict.fromkeys(FG_BANDS, 0.0))
    makes: dict[str, float] = field(default_factory=lambda: dict.fromkeys(FG_BANDS, 0.0))
    blocked: float = 0.0
    xp_made: float = 0.0
    xp_attempts: float = 0.0
    last: tuple[int, int, float] = (0, 0, 0.0)  # (season, week, the week's attempts) of his latest game
    club: str | None = None

    @property
    def fg_attempts(self) -> float:
        return sum(self.attempts.values()) + self.blocked

    @property
    def fg_makes(self) -> float:
        return sum(self.makes.values())


@dataclass(slots=True)
class Tally:
    defense: dict[str, Unit] = field(default_factory=lambda: defaultdict(Unit))
    offense: dict[str, Unit] = field(default_factory=lambda: defaultdict(Unit))
    kickers: dict[str, Kicker] = field(default_factory=lambda: defaultdict(Kicker))
    faced: dict[tuple[int, int, str], str] = field(default_factory=dict)  # (season, week, offense) -> defense


def add_defense(tally: Tally, rows: Iterable[tuple[int, int, Mapping[str, Any]]], implied: Implied) -> None:
    for season, week, v in rows:
        team, opponent = str(v["team"]), str(v["opponent_team"])
        tally.faced[(season, week, opponent)] = team
        d, o = tally.defense[team], tally.offense[opponent]
        d.games.add((season, week))
        o.games.add((season, week))
        faced = implied(season, week, opponent)
        if faced is not None and v.get("points_allowed") is not None:
            d.values["pa_over_expected"].append(_number(v["points_allowed"]) - faced)
        d.values["int"].append(_number(v["def_interceptions"]))
        d.values["fr"].append(_number(v["fumble_recovery_opp"]))
        d.values["return_td"].append(_number(v["special_teams_tds"]))
        d.values["safeties"].append(_number(v["def_safeties"]))
        d.values["blocks"].append(sum(_number(v[c]) for c in _BLOCKS))
        o.values["fumbles_lost"].append(_number(v["fumble_recovery_opp"]))


def _band_counts(v: Mapping[str, Any], kind: str) -> dict[str, float]:
    names = {"0_19": "0_19", "20_29": "20_29", "30_39": "30_39", "40_49": "40_49", "50_59": "50_59", "60_plus": "60"}
    return {band: _number(v[f"fg_{kind}_{name}"]) for band, name in names.items()}


def add_kicking(tally: Tally, rows: Iterable[tuple[int, int, Mapping[str, Any]]]) -> None:
    club_week: dict[tuple[str, int, int], dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for season, week, v in rows:
        club = str(v["team"])
        made, missed = _band_counts(v, "made"), _band_counts(v, "missed")
        k = tally.kickers[str(v["player_id"])]
        for band in FG_BANDS:
            k.attempts[band] += made[band] + missed[band]
            k.makes[band] += made[band]
        k.blocked += _number(v["fg_blocked"])
        k.xp_made += _number(v["pat_made"])
        k.xp_attempts += _number(v["pat_att"])
        attempts = _number(v["fg_att"]) + _number(v["pat_att"])
        if (season, week, attempts) > k.last:
            k.last, k.club = (season, week, attempts), club
        cw = club_week[(club, season, week)]
        cw["fg_att"] += _number(v["fg_att"])
        cw["pat_att"] += _number(v["pat_att"])
    for (club, season, week), found in club_week.items():
        unit = tally.offense[club]
        unit.games.add((season, week))
        unit.values["fg_att"].append(found["fg_att"])
        unit.values["pat_att"].append(found["pat_att"])
        unit.by_game[(season, week)].update(found)


def add_kicks(tally: Tally, rows: Iterable[tuple[int, int, Mapping[str, Any]]]) -> None:
    """Each club's two-point and extra-point tries, from the kick plays."""
    tries: dict[tuple[str, int, int], list[float]] = defaultdict(lambda: [0.0, 0.0])
    for season, week, v in rows:
        if v.get("posteam") is None:
            continue
        found = tries[(str(v["posteam"]), season, week)]
        found[0] += float(v.get("two_point_conv_result") is not None)
        found[1] += float(v.get("extra_point_result") is not None)
    for (club, season, week), (two, xp) in tries.items():
        unit = tally.offense[club]
        unit.values["two_point"].append(two)
        unit.values["xp_try"].append(xp)
        unit.by_game[(season, week)].update({"two_point": two, "xp_try": xp})


def tally_of(
    defense: Iterable[tuple[int, int, Mapping[str, Any]]],
    kicking: Iterable[tuple[int, int, Mapping[str, Any]]],
    kicks: Iterable[tuple[int, int, Mapping[str, Any]]],
    implied: Implied,
) -> Tally:
    tally = Tally()
    add_defense(tally, defense, implied)
    add_kicking(tally, kicking)
    add_kicks(tally, kicks)
    return tally


def club_kicker(tally: Tally, club: str) -> str | None:
    """The kicker who kicked the club's latest game in the tally (most attempts that week, then by id)."""
    best: tuple[tuple[int, int, float], str] | None = None
    for pid, k in tally.kickers.items():
        if k.club != club:
            continue
        key = (k.last, pid)
        if best is None or (key[0], _negated(pid)) > (best[0], _negated(best[1])):
            best = key
    return None if best is None else best[1]


def _negated(pid: str) -> tuple[int, ...]:
    return tuple(-ord(c) for c in pid)
