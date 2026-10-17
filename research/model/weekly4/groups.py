"""THE SEVEN FACTOR GROUPS AND THEIR NEUTRAL VALUES (preregistration section 2.7).

(1) his role and its trend, (2) teammates out or returning, (3) the matchup, (4) the game's expected
score and margin, (5) weather and roof, (6) home field and rest, (7) his efficiency against expected.

Neutral values: the league's mean implied points over the season's weeks before W and a margin of 0,
every allowance 1 (the value allowance, a difference, 0), no vacated or returning share, indoor
weather, his last three equal to his season, efficiency at the role prior. Home field has no neutral
value inside a tree, so its group's neutral setting is the mean of the point function at home 0 and at
home 1 (`neutralise(..., home=h)`, the caller averaging). Readings, stated: the defence's pressure and
pass rate allowed and the opponent's tempo are the matchup's, neutral at the league's mean of the
week's club-games (the pass rate allowed, a difference, at 0); rest's neutral is a week, 7 days.

Groups 3 to 6 apply to the whole club and the opponent's game (they are inputs of the team model and
of every teammate's share), groups 1, 2 and 7 to the player alone; the caller applies each to the rows
it governs. Efficiency's neutral is applied to the history (`neutral_efficiency`): with no
opportunity, every shrunk term is its prior.
"""

from collections.abc import Collection, Mapping
from typing import Any, Final

import pandas as pd

from research.model.weekly4.features.columns import SHARE_STATS
from research.model.weekly4.features.game import INDOOR_PRECIPITATION, INDOOR_TEMPERATURE_F, INDOOR_WIND_MPH
from research.model.weekly4.features.plays import SHARE_KINDS

GROUPS: Final = ("role", "teammates", "matchup", "game", "weather", "home_rest", "efficiency")
GAME_GROUPS: Final = frozenset({"matchup", "game", "weather", "home_rest"})
NEUTRAL_REST_DAYS: Final = 7.0
NEUTRAL_ALLOWANCE: Final = 1.0
_LEAGUE: Final = (
    "opponent_sack_rate",
    "opponent_hit_rate",
    "opponent_pfr_pressure_rate",
    "opponent_pace",
    "opponent_pass_rate_over_expected",
)
_HISTORY_COUNTS: Final = (
    "target_n",
    "target_catch",
    "target_xcatch",
    "target_yards_over",
    "target_td",
    "target_xtd",
    "carry_n",
    "carry_yards_over",
    "carry_td",
    "carry_xtd",
    "dropback_n",
    "dropback_yards_over",
    "dropback_scrambles",
    "dropback_not_sacked",
)


def league_means(rows: pd.DataFrame) -> dict[str, float]:
    """The cross-section's means the neutral values read (the caller passes the right cross-section:
    the week's club-games, and for the implied points the season's weeks before W)."""
    found = {name: float(rows[name].mean()) for name in _LEAGUE if name in rows}
    if "implied_points" in rows:
        found["implied_points"] = float(rows["implied_points"].mean())
    return found


def _set(frame: pd.DataFrame, values: Mapping[str, Any]) -> pd.DataFrame:
    present = {k: v for k, v in values.items() if k in frame}
    return frame.assign(**present) if present else frame


def neutralise(
    rows: pd.DataFrame, groups: Collection[str], means: Mapping[str, float], home: float | None = None
) -> pd.DataFrame:
    """The rows with each named group at its neutral value (a new frame; `rows` is unchanged)."""
    found = rows
    if "role" in groups:
        updates: dict[str, object] = {}
        for kind in SHARE_KINDS:
            season = f"share_season_{kind}"
            if season in found:
                for stat in SHARE_STATS:
                    if stat not in {"season", "prior"}:
                        updates[f"share_{stat}_{kind}"] = found[season]
        if "snap_season" in found:
            updates["snap_last_three"] = found["snap_season"]
        updates["snap_trend"] = 0.0
        found = _set(found, updates)
    if "teammates" in groups:
        zeros: dict[str, object] = {f"{side}_{k}": 0.0 for side in ("vacated", "returning") for k in SHARE_KINDS}
        found = _set(found, {**zeros, "returning_teammates": 0, "vacating_teammates": 0})
    if "matchup" in groups:
        allowances = {c: NEUTRAL_ALLOWANCE for c in found.columns if c.startswith("allowance_")}
        values = {c: 0.0 for c in found.columns if c.startswith("allow_")}
        league = {name: means[name] for name in _LEAGUE if name in means}
        found = _set(found, {**allowances, **values, **league, "opponent_pass_rate_allowed": 0.0})
    if "game" in groups:
        implied = means.get("implied_points", float("nan"))
        found = _set(found, {"implied_points": implied, "opponent_implied_points": implied, "spread": 0.0})
    if "weather" in groups:
        found = _set(
            found,
            {
                "roof": "dome",
                "indoor": 1.0,
                "temperature_f": INDOOR_TEMPERATURE_F,
                "wind_mph": INDOOR_WIND_MPH,
                "precipitation": INDOOR_PRECIPITATION,
            },
        )
    if "home_rest" in groups:
        found = _set(found, {"rest_days": NEUTRAL_REST_DAYS, **({} if home is None else {"home": home})})
    return found


def neutral_efficiency(history: pd.DataFrame) -> pd.DataFrame:
    """The history with no opportunity counted: every shrunk term at its prior (group 7)."""
    return _set(history, dict.fromkeys(_HISTORY_COUNTS, 0.0))
