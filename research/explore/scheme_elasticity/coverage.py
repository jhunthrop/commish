"""COLUMN COVERAGE, PER SEASON, BEFORE ANY DESIGN: the share of the plays each scheme column applies
to that carry a value. Dropbacks for the pass columns, designed runs for the box counts. No outcome
column is read here.
"""

from typing import Final

import pandas as pd

KEYS: Final = ["game_id", "play_id"]
PASS_COLUMNS: Final = {
    "participation.was_pressure": "was_pressure",
    "participation.defense_man_zone_type": "man_zone",
    "participation.defense_coverage_type": "coverage_type",
    "participation.number_of_pass_rushers": "pass_rushers",
    "participation.offense_players": "offense_players",
    "ftn.n_blitzers": "n_blitzers",
    "ftn.is_play_action": "is_play_action",
}
RUN_COLUMNS: Final = {
    "participation.defenders_in_box": "defenders_in_box",
    "ftn.n_defense_box": "n_defense_box",
}


def dropback_mask(plays: pd.DataFrame) -> pd.Series:
    """A scored dropback: a dropback that is no two-point try, kneel or spike."""
    return (
        plays["qb_dropback"].fillna(False).astype(bool)
        & ~plays["two_point_attempt"].fillna(False).astype(bool)
        & ~plays["qb_spike"].fillna(False).astype(bool)
        & ~plays["qb_kneel"].fillna(False).astype(bool)
    )


def designed_run_mask(plays: pd.DataFrame) -> pd.Series:
    """A carry that is not a dropback (no scramble) and no two-point try or kneel."""
    return (
        plays["rush_attempt"].fillna(False).astype(bool)
        & ~plays["qb_dropback"].fillna(False).astype(bool)
        & ~plays["two_point_attempt"].fillna(False).astype(bool)
        & ~plays["qb_kneel"].fillna(False).astype(bool)
    )


def joined(plays: pd.DataFrame, participation: pd.DataFrame, ftn: pd.DataFrame) -> pd.DataFrame:
    part = participation.drop(columns=["season"])
    charted = ftn.drop(columns=["season", "week"])
    return plays.merge(part, on=KEYS, how="left").merge(charted, on=KEYS, how="left")


def _shares(frame: pd.DataFrame, columns: dict[str, str], kind: str) -> list[dict[str, object]]:
    found: list[dict[str, object]] = []
    for season, group in frame.groupby("season"):
        for label, column in columns.items():
            found.append(
                {
                    "season": int(str(season)),
                    "column": label,
                    "plays": kind,
                    "denominator": len(group),
                    "populated": int(group[column].notna().sum()),
                    "share": float(group[column].notna().mean()) if len(group) else float("nan"),
                }
            )
    return found


def coverage(plays: pd.DataFrame, participation: pd.DataFrame, ftn: pd.DataFrame) -> pd.DataFrame:
    frame = joined(plays, participation, ftn)
    rows = _shares(frame[dropback_mask(frame)], PASS_COLUMNS, "dropbacks")
    rows += _shares(frame[designed_run_mask(frame)], RUN_COLUMNS, "designed runs")
    return pd.DataFrame(rows)
