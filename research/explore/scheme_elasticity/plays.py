"""THE PLAY TABLE OF THE PROBE: each regular-season play of weeks 1 to 17 with its scheme flags (plan
section 5) and its play-level PPR points by role, from the house scoring.

Points: 0.04 a passing yard, 4 a passing touchdown, -2 an interception, 0.1 a rushing or receiving
yard, 6 a rushing or receiving touchdown, 1 a reception. Sacks score 0; fumbles are left out (the play
table does not name the fumbler).
"""

from typing import Final

import numpy as np
import pandas as pd

from research.explore.scheme_elasticity.coverage import KEYS, designed_run_mask, dropback_mask
from research.model.domain import STANDARD_SCORING

S: Final = STANDARD_SCORING
BOX_HEAVY: Final = 8
PPR_RECEPTION: Final = 1.0
MAN: Final = "MAN_COVERAGE"
ZONE: Final = "ZONE_COVERAGE"


def _bool(series: pd.Series) -> np.ndarray:
    return series.fillna(False).astype(bool).to_numpy()


def _optional_flag(values: pd.Series) -> pd.Series:
    """True, False or NaN, as floats, so a missing value stays missing."""
    return values.map({True: 1.0, False: 0.0}).astype(float)


def scheme_flags(frame: pd.DataFrame) -> pd.DataFrame:
    """The five conditions of plan section 5, NaN where the column carries no value."""
    box = frame["defenders_in_box"].where(frame["defenders_in_box"].notna(), frame["n_defense_box"])
    man = frame["man_zone"].map({MAN: 1.0, ZONE: 0.0})
    return frame.assign(
        dropback=dropback_mask(frame).to_numpy(),
        designed_run=designed_run_mask(frame).to_numpy(),
        blitz=np.where(frame["n_blitzers"].notna(), (frame["n_blitzers"] >= 1).astype(float), np.nan),
        pressure=_optional_flag(frame["was_pressure"]),
        play_action=_optional_flag(frame["is_play_action"]),
        man=man.astype(float),
        box_heavy=np.where(box.notna(), (box >= BOX_HEAVY).astype(float), np.nan),
    )


def play_points(frame: pd.DataFrame) -> pd.DataFrame:
    """The dropback's quarterback points, the target's PPR points and the designed carry's points."""
    yards = frame["yards_gained"].fillna(0.0).to_numpy(dtype=float)
    complete = _bool(frame["complete_pass"])
    passing = (
        complete * (yards * S.points_per_passing_yard)
        + _bool(frame["pass_touchdown"]) * S.points_per_passing_touchdown
        + _bool(frame["interception"]) * S.points_per_interception
    )
    scramble = _bool(frame["qb_scramble"])
    rushing = yards * S.points_per_rushing_yard + _bool(frame["rush_touchdown"]) * S.points_per_rushing_touchdown
    qb = np.where(scramble, rushing, np.where(_bool(frame["sack"]), 0.0, passing))
    receiving = complete * (
        PPR_RECEPTION
        + yards * S.points_per_receiving_yard
        + _bool(frame["pass_touchdown"]) * S.points_per_receiving_touchdown
    )
    carry = np.where(_bool(frame["designed_run"]), rushing, 0.0)
    dropback_qb = frame["passer_player_id"].where(frame["passer_player_id"].notna(), frame["rusher_player_id"])
    return frame.assign(
        qb_id=dropback_qb.where(frame["dropback"]),
        qb_points=np.where(frame["dropback"], qb, 0.0),
        receiver_points=np.where(frame["dropback"] & frame["receiver_player_id"].notna(), receiving, 0.0),
        carry_points=carry,
    )


def build(plays: pd.DataFrame, outcomes: pd.DataFrame, participation: pd.DataFrame, ftn: pd.DataFrame) -> pd.DataFrame:
    """Plays joined to their scheme columns and outcomes, flagged and scored."""
    part = participation.drop(columns=["season"])
    charted = ftn.drop(columns=["season", "week"])
    joined = plays.merge(part, on=KEYS, how="left").merge(charted, on=KEYS, how="left")
    joined = joined.merge(outcomes, on=KEYS, how="left")
    return play_points(scheme_flags(joined))


def on_field(plays: pd.DataFrame) -> pd.DataFrame:
    """One row per (scored dropback with a man/zone value, offensive player on the field): the
    receiver's opportunity of the `man_zone` term, with his points on it (0 when not targeted)."""
    kept = plays[plays["dropback"] & plays["man"].notna() & plays["offense_players"].notna()]
    exploded = kept.assign(player_id=kept["offense_players"].str.split(";")).explode("player_id")
    targeted = exploded["player_id"] == exploded["receiver_player_id"]
    return pd.DataFrame(
        {
            "season": exploded["season"].to_numpy(),
            "week": exploded["week"].to_numpy(),
            "defteam": exploded["defteam"].to_numpy(),
            "player_id": exploded["player_id"].to_numpy(),
            "condition": exploded["man"].to_numpy(),
            "points": np.where(targeted, exploded["receiver_points"], 0.0),
        }
    )
