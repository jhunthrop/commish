"""THE FEATURES AT t_g (design 5.2 and 5.3; Amendment 7 items 3 and 6).

Each club-game row is club C's offense against club D's defense, at C's instant t_g. It carries:

- D's defense, from its admitted team-defense weeks this season before W and the season before: points
  allowed over the implied points it faced (shrunk toward 0, 6 games), interceptions and fumble
  recoveries a game (two seasons of prior), return touchdowns, safeties and blocks a game (a season of
  prior), and its field goals per scoring trip allowed (beta-binomial);
- C's offense: fumbles lost a game, field-goal attempts a game (the attempts' simple counterpart, reported),
  field goals per scoring trip (field goals over field goals, extra points and two-point tries) and its
  two-point rate per touchdown try (beta-binomial, from the kick plays);
- C's kicker at t_g (`tallies.club_kicker`: the kicker of the club's latest game, this season, else the
  season before): his makes over expected per attempt, the expected the league's band make rates of the
  seasons before (beta-binomial around his own expected, round 4 section 2.3's form), his share of
  attempts from 50 plus and his extra-point make rate (beta-binomial); a kicker filed Out or Doubtful
  for week W has no number (`kicker_withheld`, counted).

Defaults (item 6), each a column and counted: `no_prior_unit` when a unit has no week this season before
W (it reads the season before's, else the prior), `no_kicker_history` when the kicker has no attempt in
what is read (the position prior), `no_kicker` when the club has no kicker evidenced.

The league priors of season s read only the outcomes of seasons before s (`league_priors`).
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Final

import numpy as np

from research.model.weekly_kdef.rates import (
    POINTS_OVER_EXPECTED_K,
    SPECIAL_TEAMS_K,
    TAKEAWAY_K,
    GamePrior,
    TrialPrior,
    fixed_prior,
    moments_prior,
    shrunk_per_game,
    shrunk_rate,
    trials_prior,
)
from research.model.weekly_kdef.scoring import FG_BANDS
from research.model.weekly_kdef.tallies import Implied, Kicker, Tally, Unit, club_kicker, tally_of

FROZEN: Final = MappingProxyType
LONG_BANDS: Final = ("50_59", "60_plus")
# (feature, unit side, stat, prior kind): "moments", or a fixed weight in games with the league mean
# ("league") or 0 ("zero") as its mean.
GAME_RATES: Final = (
    ("def_pa_over_expected", "defense", "pa_over_expected", POINTS_OVER_EXPECTED_K, "zero"),
    ("def_int_per_game", "defense", "int", TAKEAWAY_K, "league"),
    ("def_fr_per_game", "defense", "fr", TAKEAWAY_K, "league"),
    ("def_return_td_per_game", "defense", "return_td", SPECIAL_TEAMS_K, "league"),
    ("def_safeties_per_game", "defense", "safeties", SPECIAL_TEAMS_K, "league"),
    ("def_blocks_per_game", "defense", "blocks", SPECIAL_TEAMS_K, "league"),
    ("off_fumbles_lost_per_game", "offense", "fumbles_lost", None, "moments"),
    ("off_fg_att_per_game", "offense", "fg_att", None, "moments"),
)
TRIAL_RATES: Final = ("fg_share", "two_point_rate", "kicker_accuracy", "kicker_long_share", "kicker_xp_rate")
DEFENSE_FEATURES: Final = (
    *(name for name, side, *_ in GAME_RATES if side == "defense"),
    "def_fg_share_allowed",
    "no_prior_unit_defense",
)
OFFENSE_FEATURES: Final = (
    *(name for name, side, *_ in GAME_RATES if side == "offense"),
    "off_fg_share",
    "off_two_point_rate",
    "no_prior_unit_offense",
)
KICKER_FEATURES: Final = (
    "kicker_accuracy_over_expected",
    "kicker_long_share",
    "kicker_xp_rate",
    "no_kicker_history",
)


@dataclass(frozen=True, slots=True)
class LeaguePriors:
    """Season s's priors, from the outcomes of the seasons before it."""

    games: Mapping[str, GamePrior]
    trials: Mapping[str, TrialPrior]
    band_make: Mapping[str, float]  # the league's make rate per distance band


def _units(tally: Tally, side: str) -> dict[str, Unit]:
    return tally.defense if side == "defense" else tally.offense


def _season_units(tallies: Iterable[Tally], side: str, stat: str) -> list[list[float]]:
    return [unit.values[stat] for t in tallies for unit in _units(t, side).values() if unit.values[stat]]


def _game_prior(tallies: list[Tally], side: str, stat: str, k: float | None, kind: str) -> GamePrior:
    found = moments_prior(_season_units(tallies, side, stat))
    if kind == "moments" or k is None:
        return found
    return fixed_prior(0.0 if kind == "zero" else found.mean, k)


def _trips(unit: Unit) -> tuple[float, float]:
    fg = sum(unit.values["fg_att"])
    trips = fg + sum(unit.values["pat_att"]) + sum(unit.values["two_point"])
    return fg, trips


def _expected_makes(k: Kicker, band_make: Mapping[str, float]) -> float:
    """His expected makes on his attempts with a distance band at the league's band rates (a blocked
    attempt has no band and is the line's as much as his, so accuracy reads the banded attempts)."""
    return sum(k.attempts[b] * band_make[b] for b in FG_BANDS)


def league_priors(seasons: list[Tally]) -> LeaguePriors:
    """Season s's priors over the club-seasons and kicker-seasons of `seasons` (each a season's outcomes)."""
    games = {name: _game_prior(seasons, side, stat, k, kind) for name, side, stat, k, kind in GAME_RATES}
    kickers = [k for t in seasons for k in t.kickers.values()]
    attempts = {b: sum(k.attempts[b] for k in kickers) for b in FG_BANDS}
    band_make = {b: (sum(k.makes[b] for k in kickers) / attempts[b]) if attempts[b] > 0 else 0.0 for b in FG_BANDS}
    offense = [u for t in seasons for u in t.offense.values()]
    shares = [_trips(u) for u in offense]
    two = [(sum(u.values["two_point"]), sum(u.values["two_point"]) + sum(u.values["xp_try"])) for u in offense]
    trials = {
        "fg_share": trials_prior([s for s, _ in shares], [n for _, n in shares]),
        "two_point_rate": trials_prior([s for s, _ in two], [n for _, n in two]),
        "kicker_accuracy": trials_prior(
            [k.fg_makes for k in kickers],
            [sum(k.attempts.values()) for k in kickers],
            [_expected_makes(k, band_make) for k in kickers],
        ),
        "kicker_long_share": trials_prior(
            [sum(k.attempts[b] for b in LONG_BANDS) for k in kickers], [sum(k.attempts.values()) for k in kickers]
        ),
        "kicker_xp_rate": trials_prior([k.xp_made for k in kickers], [k.xp_attempts for k in kickers]),
    }
    return LeaguePriors(FROZEN(games), FROZEN(trials), FROZEN(band_make))


def outcome_tally(
    defense: Iterable[Mapping[str, Any]],
    kicking: Iterable[Mapping[str, Any]],
    kicks: Iterable[Mapping[str, Any]],
    implied: Implied,
) -> Tally:
    def keyed(rows: Iterable[Mapping[str, Any]]) -> list[tuple[int, int, Mapping[str, Any]]]:
        return [(int(r["season"]), int(r["week"]), r) for r in rows]

    return tally_of(keyed(defense), keyed(kicking), keyed(kicks), implied)


def _rate(unit: Unit | None, stat: str, prior: GamePrior) -> float:
    values = [] if unit is None else unit.values[stat]
    return shrunk_per_game(float(sum(values)), float(len(values)), prior)


def _trial(successes: float, trials: float, prior: TrialPrior, centre: float | None = None) -> float:
    return shrunk_rate(successes, trials, prior.rate if centre is None else centre, prior)


def _allowed_trips(tally: Tally, defense: str) -> tuple[float, float]:
    """Field goals over scoring trips of the offenses the defense faced, in the games it faced them."""
    fg = trips = 0.0
    for (season, week, offense), faced_by in tally.faced.items():
        unit = tally.offense.get(offense)
        game = None if unit is None or faced_by != defense else unit.by_game.get((season, week))
        if not game:
            continue
        fg += game.get("fg_att", 0.0)
        trips += game.get("fg_att", 0.0) + game.get("pat_att", 0.0) + game.get("two_point", 0.0)
    return fg, trips


def defense_features(tally: Tally, club: str, this_season: int, priors: LeaguePriors) -> dict[str, float]:
    unit = tally.defense.get(club)
    found = {name: _rate(unit, stat, priors.games[name]) for name, side, stat, *_ in GAME_RATES if side == "defense"}
    fg, trips = _allowed_trips(tally, club)
    found["def_fg_share_allowed"] = _trial(fg, trips, priors.trials["fg_share"])
    found["no_prior_unit_defense"] = float(unit is None or not any(s == this_season for s, _ in unit.games))
    return found


def offense_features(tally: Tally, club: str, this_season: int, priors: LeaguePriors) -> dict[str, float]:
    unit = tally.offense.get(club)
    found = {name: _rate(unit, stat, priors.games[name]) for name, side, stat, *_ in GAME_RATES if side == "offense"}
    fg, trips = (0.0, 0.0) if unit is None else _trips(unit)
    found["off_fg_share"] = _trial(fg, trips, priors.trials["fg_share"])
    two = 0.0 if unit is None else sum(unit.values["two_point"])
    tries = two + (0.0 if unit is None else sum(unit.values["xp_try"]))
    found["off_two_point_rate"] = _trial(two, tries, priors.trials["two_point_rate"])
    found["no_prior_unit_offense"] = float(unit is None or not any(s == this_season for s, _ in unit.games))
    return found


def kicker_features(tally: Tally, kicker: str | None, priors: LeaguePriors) -> dict[str, float]:
    k = tally.kickers.get(kicker) if kicker is not None else None
    if k is None or k.fg_attempts + k.xp_attempts <= 0:
        t = priors.trials
        return {
            "kicker_accuracy_over_expected": 0.0,
            "kicker_long_share": t["kicker_long_share"].rate,
            "kicker_xp_rate": t["kicker_xp_rate"].rate,
            "no_kicker_history": 1.0,
        }
    attempts = sum(k.attempts.values())
    expected = _expected_makes(k, priors.band_make) / attempts if attempts > 0 else 0.0
    accuracy = (
        _trial(k.fg_makes, attempts, priors.trials["kicker_accuracy"], expected) - expected if attempts > 0 else 0.0
    )
    long_attempts = sum(k.attempts[b] for b in LONG_BANDS)
    return {
        "kicker_accuracy_over_expected": accuracy,
        "kicker_long_share": _trial(long_attempts, sum(k.attempts.values()), priors.trials["kicker_long_share"]),
        "kicker_xp_rate": _trial(k.xp_made, k.xp_attempts, priors.trials["kicker_xp_rate"]),
        "no_kicker_history": 0.0,
    }


@dataclass(frozen=True, slots=True)
class MomentView:
    """Every club's and kicker's features at one instant."""

    tally: Tally
    season: int
    priors: LeaguePriors

    def row(self, offense: str, defense: str, withheld: frozenset[str]) -> dict[str, Any]:
        kicker = club_kicker(self.tally, offense)
        found: dict[str, Any] = {
            **defense_features(self.tally, defense, self.season, self.priors),
            **offense_features(self.tally, offense, self.season, self.priors),
            **kicker_features(self.tally, kicker, self.priors),
            "kicker_id": kicker,
            "no_kicker": float(kicker is None),
            "kicker_withheld": float(kicker is not None and kicker in withheld),
        }
        return found


def as_array(values: Iterable[float]) -> np.ndarray:
    return np.asarray(list(values), dtype=float)
