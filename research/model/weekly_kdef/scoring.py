"""THE JUDGED SCORING (Amendment 7 item 8; design section 5.6): the house table of `research.model.domain`
for a defense (its points-allowed and yards-allowed bands, a sack 1, a takeaway 2, a defensive or return
touchdown 6, a safety 2), and for a kicker a field goal of 0-39 yards 3, 40-49 4, 50 plus 5, a missed
field goal -1 (a blocked one is a miss), an extra point 1 and a missed extra point -1 (never ESPN's 0).

The domain carries no blocked-kick value, so a block scores 0 here; it is still a published component.

ESPN'S ARCHIVED PROJECTION (item 9) is re-scored from its own projected components under this scoring
where they map, else its own total is taken. Its 50-plus field goals are either the 50-plus figure (stat
74) or the sum of its 50-59 and 60-plus parts (198 and 201), never the figure added to its parts: ESPN's
74 is the sum of 198 and 201.
"""

from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

import numpy as np

from research.model.domain import POINTS_ALLOWED_TIERS, STANDARD_SCORING, YARDS_ALLOWED_TIERS

FROZEN: Final = MappingProxyType
FG_BANDS: Final = ("0_19", "20_29", "30_39", "40_49", "50_59", "60_plus")
FG_BAND_LOW: Final = (0, 20, 30, 40, 50, 60)  # each band's shortest distance, yards
FG_POINTS: Final = FROZEN({"0_19": 3.0, "20_29": 3.0, "30_39": 3.0, "40_49": 4.0, "50_59": 5.0, "60_plus": 5.0})
FG_MISSED_POINTS: Final = -1.0
XP_POINTS: Final = 1.0
XP_MISSED_POINTS: Final = -1.0
ESPN_XP_MISSED_POINTS: Final = 0.0  # ESPN's league default, which its archived total carries
BLOCK_POINTS: Final = 0.0  # the domain's house table has no blocked-kick value

DEFENSE_POINTS: Final = FROZEN(
    {
        "sacks": float(STANDARD_SCORING.points_per_sack),
        "interceptions": float(STANDARD_SCORING.points_per_defensive_interception),
        "fumble_recoveries": float(STANDARD_SCORING.points_per_defensive_fumble_recovery),
        "defensive_touchdowns": float(STANDARD_SCORING.points_per_defensive_touchdown),
        "return_touchdowns": float(STANDARD_SCORING.points_per_return_touchdown),
        "safeties": float(STANDARD_SCORING.points_per_safety),
        "blocks": BLOCK_POINTS,
    }
)
DEFENSE_COUNTS: Final = tuple(DEFENSE_POINTS)
DEFENSE_COMPONENTS: Final = ("points_allowed", "yards_allowed", *DEFENSE_COUNTS)
KICKER_COMPONENTS: Final = (
    *(f"fg_made_{b}" for b in FG_BANDS),
    *(f"fg_missed_{b}" for b in FG_BANDS),
    "fg_blocked",
    "xp_made",
    "xp_missed",
)


def tier_points(values: np.ndarray, tiers: tuple[tuple[float, int], ...]) -> np.ndarray:
    """The band's points for each value: the first tier whose ceiling the value does not exceed."""
    values = np.asarray(values, dtype=float)
    ceilings = np.array([c for c, _ in tiers], dtype=float)
    points = np.array([float(p) for _, p in tiers])
    index = np.searchsorted(ceilings, values, side="left")
    return points[np.minimum(index, len(points) - 1)]


def points_allowed_points(points: np.ndarray) -> np.ndarray:
    return tier_points(points, POINTS_ALLOWED_TIERS)


def yards_allowed_points(yards: np.ndarray) -> np.ndarray:
    return tier_points(yards, YARDS_ALLOWED_TIERS)


def defense_points(components: Mapping[str, np.ndarray]) -> np.ndarray:
    """A defense's points under the judged scoring, elementwise over draws or rows."""
    total = points_allowed_points(components["points_allowed"]) + yards_allowed_points(components["yards_allowed"])
    for name, value in DEFENSE_POINTS.items():
        total = total + value * np.asarray(components[name], dtype=float)
    return np.asarray(total, dtype=float)


FLAT_FG_POINTS: Final = FROZEN(dict.fromkeys(FG_BANDS, 3.0))  # the reported flat-3 view (design 6.3)


def kicker_points(
    components: Mapping[str, np.ndarray],
    xp_missed_points: float = XP_MISSED_POINTS,
    fg_points: Mapping[str, float] = FG_POINTS,
) -> np.ndarray:
    """A kicker's points under the judged scoring (or another missed-extra-point or distance table),
    elementwise."""
    total = np.asarray(components["xp_made"], dtype=float) * XP_POINTS
    total = total + np.asarray(components["xp_missed"], dtype=float) * xp_missed_points
    total = total + np.asarray(components["fg_blocked"], dtype=float) * FG_MISSED_POINTS
    for band in FG_BANDS:
        total = total + np.asarray(components[f"fg_made_{band}"], dtype=float) * fg_points[band]
        total = total + np.asarray(components[f"fg_missed_{band}"], dtype=float) * FG_MISSED_POINTS
    return np.asarray(total, dtype=float)


# ESPN's points-allowed and yards-allowed band components, each with the band's lowest value, so the
# judged tiers price each band as the domain prices a value in it.
ESPN_POINTS_BANDS: Final = FROZEN(
    {
        "points_allowed_0": 0,
        "points_allowed_1_6": 1,
        "points_allowed_7_13": 7,
        "points_allowed_14_17": 14,
        "points_allowed_18_21": 18,
        "points_allowed_22_27": 22,
        "points_allowed_28_34": 28,
        "points_allowed_35_45": 35,
        "points_allowed_46_plus": 46,
    }
)
ESPN_YARDS_BANDS: Final = FROZEN(
    {
        "yards_allowed_0_99": 0,
        "yards_allowed_100_199": 100,
        "yards_allowed_200_299": 200,
        "yards_allowed_300_349": 300,
        "yards_allowed_350_399": 350,
        "yards_allowed_400_449": 400,
        "yards_allowed_450_499": 450,
        "yards_allowed_500_549": 500,
        "yards_allowed_550_plus": 550,
    }
)
_ESPN_DEFENSE_COUNTS: Final = FROZEN(
    {
        "sacks": ("sacks",),
        "interceptions": ("interceptions",),
        "fumble_recoveries": ("fumble_recoveries",),
        "defensive_touchdowns": ("defensive_touchdowns",),
        "return_touchdowns": ("blocked_kick_return_touchdowns", "kickoff_return_touchdowns", "punt_return_touchdowns"),
        "safeties": ("safeties",),
        "blocks": ("blocked_kicks",),
    }
)
_BAND_SUM_TOLERANCE: Final = 0.01


def espn_made_50_plus(c: Mapping[str, float]) -> float | None:
    """ESPN's made 50-plus field goals: the 50-plus figure, else the sum of its two parts, never both."""
    if "fg_made_50_plus" in c:
        return c["fg_made_50_plus"]
    parts = [c[name] for name in ("fg_made_50_59", "fg_made_60_plus") if name in c]
    return float(sum(parts)) if parts else None


def _espn_fg_missed(c: Mapping[str, float]) -> float | None:
    if "fg_missed" in c:
        return c["fg_missed"]
    if "fg_attempted" in c and "fg_made" in c:
        return c["fg_attempted"] - c["fg_made"]
    return None


def _espn_xp_missed(c: Mapping[str, float]) -> float | None:
    if "xp_missed" in c:
        return c["xp_missed"]
    if "xp_attempted" in c and "xp_made" in c:
        return c["xp_attempted"] - c["xp_made"]
    return None


def espn_kicker_points(c: Mapping[str, float], xp_missed_points: float = XP_MISSED_POINTS) -> float | None:
    """ESPN's kicker components scored with the judged values (or ESPN's own missed-extra-point 0), or
    None when a component the scoring reads is absent."""
    long = espn_made_50_plus(c)
    missed = _espn_fg_missed(c)
    xp_missed = _espn_xp_missed(c)
    needed = (c.get("fg_made_0_39"), c.get("fg_made_40_49"), long, missed, c.get("xp_made"), xp_missed)
    if any(value is None for value in needed):
        return None
    short, middle, long_made, fg_missed, xp_made, xp_miss = (float(v) for v in needed if v is not None)
    return (
        short * FG_POINTS["30_39"]
        + middle * FG_POINTS["40_49"]
        + long_made * FG_POINTS["50_59"]
        + fg_missed * FG_MISSED_POINTS
        + xp_made * XP_POINTS
        + xp_miss * xp_missed_points
    )


def _band_expectation(
    c: Mapping[str, float], bands: Mapping[str, int], tiers: tuple[tuple[float, int], ...]
) -> float | None:
    if abs(sum(c.get(name, 0.0) for name in bands) - 1.0) > _BAND_SUM_TOLERANCE:
        return None
    lows = np.array(list(bands.values()), dtype=float)
    weights = np.array([c.get(name, 0.0) for name in bands])
    return float(np.sum(weights * tier_points(lows, tiers)))


def espn_defense_points(c: Mapping[str, float]) -> float | None:
    """ESPN's D/ST components under the judged scoring, or None when a component it reads is absent."""
    allowed = _band_expectation(c, ESPN_POINTS_BANDS, POINTS_ALLOWED_TIERS)
    yards = _band_expectation(c, ESPN_YARDS_BANDS, YARDS_ALLOWED_TIERS)
    if allowed is None or yards is None:
        return None
    total = allowed + yards
    for name, sources in _ESPN_DEFENSE_COUNTS.items():
        if DEFENSE_POINTS[name] == 0.0:  # a block scores 0 (item 12f): its absence changes nothing
            continue
        if any(source not in c for source in sources):
            return None
        total += DEFENSE_POINTS[name] * sum(c[source] for source in sources)
    return total


def espn_points(position: str, components: Mapping[str, float], total: float) -> tuple[float, bool]:
    """ESPN's archived projection under the judged scoring: (points, re-scored from its components)."""
    found = espn_kicker_points(components) if position == "K" else espn_defense_points(components)
    return (total, False) if found is None else (found, True)
