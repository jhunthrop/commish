"""WHO GETS A NUMBER: THE PROJECTED SET, DEFINED (preregistration 2.2).

A player of the population gets a number for week W when, at t_g, the designation filter does not
withhold him and there is evidence he plays: (a) a row on the week-W depth chart at any depth, or (b) an
offensive snap in one of his club's last three games before W (Amendment 3's played game). Neither the
rule nor the designation filter is applied to fit rows (2.2, reading 26).

The run reads the rule from the store's row, which was built under it: `withheld` (the designation
filter), `depth_rank` (his rank on the week-W chart, NaN with none; the store built with
`--depth-chart week`) and `played_in_last_three` (a snap in one of the club's last three games). A reading:
the store ranks him on his club's chart whatever slot lists him, so "a row at his position" is read as any
row of his on the club's week-W chart.

`evidence` is the same rule on the raw reads, through round 3's input rule (`weekly3.ledger.admit`): the
chart is a week-W read, the snaps a read of weeks before W, so a week-W snap row raises `InputRuleError`
and a week-W chart row is admitted.
"""

from collections.abc import Collection, Sequence
from datetime import datetime
from typing import Final, Protocol

import numpy as np
import pandas as pd

from research.model.weekly3.ledger import Stamped, admit

NO_PLAY_EVIDENCE: Final = "no_play_evidence"


class ChartRow(Stamped, Protocol):
    @property
    def player_id(self) -> str: ...


class SnapRow(Stamped, Protocol):
    @property
    def player_id(self) -> str: ...
    @property
    def value(self) -> float: ...


def evidence(  # noqa: PLR0913, PLR0917 - the rule's every read, named
    player_id: str,
    chart: Sequence[ChartRow],
    snaps: Sequence[SnapRow],
    club_weeks: Collection[int],
    season: int,
    week: int,
    moment: datetime,
) -> bool:
    """Evidence he plays at t_g: a week-W chart row of his, or a snap in one of `club_weeks` (his club's last
    three games before W). Each read through the input rule."""
    admit(chart, season, week, moment, "depth")
    admit(snaps, season, week, moment, "box")
    charted = any(r.player_id == player_id for r in chart)
    snapped = any(r.player_id == player_id and r.week in club_weeks and r.value > 0 for r in snaps)
    return charted or snapped


def has_evidence(rows: pd.DataFrame) -> np.ndarray:
    """The store's form of (a) or (b)."""
    charted = np.isfinite(rows["depth_rank"].to_numpy(dtype=float, na_value=np.nan))
    snapped = rows["played_in_last_three"].fillna(0).to_numpy(dtype=int) == 1
    found: np.ndarray = charted | snapped
    return found


def numbered(rows: pd.DataFrame) -> np.ndarray:
    """2.2: not withheld, with evidence he plays."""
    found: np.ndarray = (rows["withheld"].fillna(0).to_numpy(dtype=int) == 0) & has_evidence(rows)
    return found


def no_play_evidence(rows: pd.DataFrame) -> pd.DataFrame:
    """3.2, reported: the rows the rule removes for want of evidence (not withheld), by position and week."""
    removed = rows[(rows["withheld"].fillna(0).to_numpy(dtype=int) == 0) & ~has_evidence(rows)]
    counted = removed.groupby(["position", "week"]).size().rename(NO_PLAY_EVIDENCE).reset_index()
    found: pd.DataFrame = counted.sort_values(["position", "week"]).reset_index(drop=True)
    return found
