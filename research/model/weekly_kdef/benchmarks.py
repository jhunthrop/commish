"""THE BENCHMARKS (design 6.2; Amendment 7 item 9), each scored on the same rows as the model.

- **Recent form**: points a game this season before W under the judged scoring, else last season's
  (`rows.Form`, read at the row's instant from the admitted weeks).
- **The streamer's sheet**: defenses in order of the opponent's implied points, fewest first; kickers in
  order of the club's implied points, most first; ties by recent form (then by the row's id, so the order
  is fixed). It reads the same game figure at the same instant as the model. Its value is its order:
  minus the row's place in the week.
- **ESPN's archived weekly projection**: re-scored from its own components under the judged scoring where
  they map, else its own total (`scoring.espn_points`); a D/ST by its id `-16000 - club` through the
  crosswalk to `team-def:<club>`, a kicker by his ESPN id. Never an input; its stamp is unknown and taken as
  its last pre-game version, which can only favour ESPN (`kdef_archive.STAMP_CAVEAT`, printed beside KD3).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly_kdef.reads import ArchivedRow
from research.model.weekly_kdef.scoring import espn_points
from research.pipeline.espn.kdef_archive import STAMP_CAVEAT, components
from research.pipeline.nflverse.team_codes import team_defense_espn_id

CAVEAT: Final = STAMP_CAVEAT
DEFENSE_PREFIX: Final = "team-def:"


def sheet_values(rows: pd.DataFrame, position: str) -> np.ndarray:
    """Per row, minus its place in its week's sheet (`rows` one position's: `week`, `implied`, `form`,
    `unit`)."""
    sign = -1.0 if position == "DEF" else 1.0  # a defense wants its opponent to score little
    found = np.zeros(len(rows))
    frame = rows.reset_index(drop=True).assign(
        _primary=lambda f: sign * f["implied"].to_numpy(dtype=float),
        _form=lambda f: np.nan_to_num(f["form"].to_numpy(dtype=float), nan=-np.inf),
    )
    for _, week in frame.groupby("week"):
        ordered = week.sort_values(["_primary", "_form", "unit"], ascending=[False, False, True], na_position="last")
        found[ordered.index.to_numpy()] = -np.arange(1, len(ordered) + 1, dtype=float)
    return found


@dataclass(slots=True)
class EspnCounts:
    rescored: int = 0
    totals_taken: int = 0
    archive_rows_without_a_universe_id: int = 0
    population_rows_without_espn: dict[str, int] = field(default_factory=dict)


def espn_values(
    archive: Sequence[ArchivedRow], crosswalk: Mapping[str, str]
) -> tuple[dict[tuple[int, str], float], EspnCounts]:
    """ESPN's number per (week, universe id) under the judged scoring, and the counts of how it was had."""
    counts = EspnCounts()
    found: dict[tuple[int, str], float] = {}
    for row in archive:
        unit = crosswalk.get(row.espn_id)
        if unit is None:
            counts.archive_rows_without_a_universe_id += 1
            continue
        value, rescored = espn_points(row.position, components(row.position, row.stats), row.applied_total)
        counts.rescored += int(rescored)
        counts.totals_taken += int(not rescored)
        found[(row.week, unit)] = value
    return found, counts


def judged_crosswalk(teams: pd.DataFrame, season: int) -> dict[str, str]:
    """ESPN's D/ST ids for the judged season's clubs only: a relocated club's old code (OAK, SD) shares its
    ESPN id with the new one, so the fit seasons' codes must never stand in the judged season's map."""
    return defense_crosswalk(sorted(set(teams.loc[teams["season"] == season, "club"].astype(str))))


def defense_crosswalk(clubs: Sequence[str]) -> dict[str, str]:
    """ESPN's D/ST id for each club, to the universe's `team-def:<club>`."""
    return {team_defense_espn_id(club): f"{DEFENSE_PREFIX}{club}" for club in clubs}
