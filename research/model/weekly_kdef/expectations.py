"""EACH CLUB-GAME'S COMPONENT EXPECTATIONS, BEFORE THE JOINT (design 5.2 to 5.4).

For a row (club C's offense against club D's defense) of season s: the points distribution of C's score
(the kernel over the club-games of the seasons before s, tilted to the points model's mean), its three band
masses and edges; D's expected sacks (the team model's sacks for C's offense), interceptions, fumble
recoveries, touchdowns per takeaway, return touchdowns, safeties and blocks (their shrunk rates at t_g),
and the yards C is expected to gain (C's expected plays times its yards per play against D's: C's shrunk
yards per play plus D's shrunk yards per play allowed less the league's); C's expected field-goal attempts, their distance
bands, each band's make probability at the band's mean distance of the seasons before s, its touchdown
tries (the team model's offensive touchdowns plus the league's other touchdowns a game), its two-point rate
and its kicker's extra-point make probability.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, fields
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly_kdef import kernel
from research.model.weekly_kdef.components import Components, band_probabilities
from research.model.weekly_kdef.scoring import FG_BAND_LOW, FG_BANDS

FROZEN: Final = MappingProxyType


@dataclass(frozen=True, slots=True)
class SeasonConstants:
    """What a row of season s reads from the seasons before s, beyond the fitted models."""

    band_distance: tuple[float, ...]  # each band's mean field-goal distance (its shortest with none seen)
    non_offensive_td_per_game: float
    td_per_takeaway: Mapping[tuple[int, int], float]  # (home, indoor) -> defensive touchdowns per takeaway


def season_constants(rows: pd.DataFrame, kicks: pd.DataFrame, season: int) -> SeasonConstants:
    """The constants of season s from the rows and the field goals of the seasons before it."""
    before = rows[(rows["season"] < season) & (rows["has_defense_line"] == 1)]
    plays = kicks[kicks["season"] < season]
    distance = tuple(
        float(plays.loc[plays["band"] == b, "distance"].mean()) if (plays["band"] == b).any() else float(low)
        for b, low in zip(FG_BANDS, FG_BAND_LOW, strict=True)
    )
    offensive = before["rushing_touchdowns"].fillna(0) + before["receiving_touchdowns"].fillna(0)
    other = float((before["club_td_tries"] - offensive).mean()) if len(before) else 0.0
    takeaways: dict[tuple[int, int], float] = {}
    for home in (0, 1):
        for indoor in (0, 1):
            cell = before[((before["home"] > 0.5) == bool(home)) & ((before["indoor"] > 0.5) == bool(indoor))]  # noqa: PLR2004
            taken = float((cell["d_interceptions"] + cell["d_fumble_recoveries"]).sum())
            takeaways[(home, indoor)] = float(cell["d_defensive_touchdowns"].sum()) / taken if taken > 0 else 0.0
    return SeasonConstants(distance, max(other, 0.0), FROZEN(takeaways))


@dataclass(frozen=True, slots=True)
class Expectations:
    """Per row, before the per-band multipliers."""

    dist: np.ndarray  # rows x 61
    masses: np.ndarray  # rows x 3
    low: np.ndarray
    high: np.ndarray
    sacks: np.ndarray
    interceptions: np.ndarray
    fumble_recoveries: np.ndarray
    td_per_takeaway: np.ndarray
    return_touchdowns: np.ndarray
    safeties: np.ndarray
    blocks: np.ndarray
    yards: np.ndarray
    attempts: np.ndarray
    bands: np.ndarray  # rows x 6
    makes: np.ndarray  # rows x 6
    touchdowns: np.ndarray
    two_point_rate: np.ndarray
    extra_point: np.ndarray


@dataclass(frozen=True, slots=True)
class KernelBase:
    """The club-games the kernel weighs: their season, implied points and score."""

    seasons: np.ndarray
    implied: np.ndarray
    scores: np.ndarray
    bandwidth: float


def kernel_base(rows: pd.DataFrame, bandwidth: float) -> KernelBase:
    kept = rows[rows["has_defense_line"] == 1]
    kept = kept[np.isfinite(kept["implied_points"].to_numpy(dtype=float))]
    return KernelBase(
        kept["season"].to_numpy(),
        kept["implied_points"].to_numpy(dtype=float),
        kept["d_points_allowed"].to_numpy(dtype=float),
        bandwidth,
    )


def distributions(frame: pd.DataFrame, base: KernelBase, means: np.ndarray) -> np.ndarray:
    """Each row's tilted points distribution, its kernel over the club-games of the seasons before its own."""
    found = np.zeros((len(frame), len(kernel.SCORES)))
    seasons = frame["season"].to_numpy()
    implied = frame["implied_points"].to_numpy(dtype=float)
    for season in sorted(set(seasons.tolist())):
        rows = seasons == season
        prior = base.seasons < season
        raw = kernel.kernel(base.implied[prior], base.scores[prior], implied[rows], base.bandwidth)
        found[rows] = kernel.tilt(raw, means[rows])
    return found


def _by_season(frame: pd.DataFrame, constants: Mapping[int, SeasonConstants], pick: str) -> np.ndarray:
    seasons = frame["season"].to_numpy()
    return np.array([getattr(constants[int(s)], pick) for s in seasons], dtype=float)


def _make_probabilities(
    frame: pd.DataFrame, components: Components, constants: Mapping[int, SeasonConstants]
) -> np.ndarray:
    found = np.zeros((len(frame), len(FG_BANDS)))
    seasons = frame["season"].to_numpy()
    for j in range(len(FG_BANDS)):
        distance = np.array([constants[int(s)].band_distance[j] for s in seasons])
        found[:, j] = np.clip(components.models["make"].predict(frame.assign(distance=distance)), 0.0, 1.0)
    return found


def _takeaway_rate(frame: pd.DataFrame, constants: Mapping[int, SeasonConstants]) -> np.ndarray:
    keys = zip(frame["season"], frame["home"] > 0.5, frame["indoor"] > 0.5, strict=True)  # noqa: PLR2004
    return np.array([constants[int(s)].td_per_takeaway[(int(h), int(i))] for s, h, i in keys])


def expectations(
    frame: pd.DataFrame, components: Components, base: KernelBase, constants: Mapping[int, SeasonConstants]
) -> Expectations:
    """Each row's expectations (the frame carries the team model's `exp_*` columns)."""
    m = components.models
    means = m["points"].predict(frame)
    dist = distributions(frame, base, means)
    masses, low, high = kernel.band_masses(dist)
    per_play = (
        frame["off_yards_per_play"].to_numpy(dtype=float)
        + frame["def_yards_per_play_allowed"].to_numpy(dtype=float)
        - frame["league_yards_per_play"].to_numpy(dtype=float)
    )
    offensive = frame["exp_rushing_touchdowns"].to_numpy(dtype=float) + frame["exp_receiving_touchdowns"].to_numpy(
        dtype=float
    )
    return Expectations(
        dist=dist,
        masses=masses,
        low=low,
        high=high,
        sacks=frame["exp_sacks"].to_numpy(dtype=float),
        interceptions=m["interceptions"].predict(frame),
        fumble_recoveries=m["fumble_recoveries"].predict(frame),
        td_per_takeaway=_takeaway_rate(frame, constants),
        return_touchdowns=frame["def_return_td_per_game"].to_numpy(dtype=float),
        safeties=frame["def_safeties_per_game"].to_numpy(dtype=float),
        blocks=frame["def_blocks_per_game"].to_numpy(dtype=float),
        yards=np.maximum(per_play, 0.0) * frame["exp_plays"].to_numpy(dtype=float),
        attempts=m["attempts"].predict(frame),
        bands=band_probabilities(m, frame),
        makes=_make_probabilities(frame, components, constants),
        touchdowns=offensive + _by_season(frame, constants, "non_offensive_td_per_game"),
        two_point_rate=frame["off_two_point_rate"].to_numpy(dtype=float),
        extra_point=np.clip(m["extra_point"].predict(frame), 0.0, 1.0),
    )


def subset(e: Expectations, rows: Sequence[int] | np.ndarray) -> Expectations:
    """The expectations of the named rows."""
    index = np.asarray(rows)
    return Expectations(**{f.name: getattr(e, f.name)[index] for f in fields(Expectations)})
