"""THE VALUE ALLOWANCE (preregistration section 2.4, "value"): FPOE allowed per opportunity to the
position, by kind, so a defence is priced on what it gives up beyond each opportunity's expected value,
not on yards per play.

For defence D, position p and kind k at week W: over D's games of weeks before W, what D allowed per
opportunity against what the same offences gained in their other games, the construction of round 3's
allowances. FPOE is itself a difference, so the allowance takes amendment 2 item 2's form (ruled there
for the pass rate allowed, the one other difference-valued allowance): n x (mean allowed less mean
elsewhere) / (n + 6), shrunk toward 0 with the same six games of prior, round 3's
`difference_allowance`. With no counted game it is 0, the prior (2.10: "Allowance 1, the shrinkage's
prior", 0 on the difference scale).

The FPOE here leaves touchdowns out: a target's is its catch over expected times the reception value
plus its yards over expected over ten, a carry's its yards over expected over ten, a dropback's its
passing yards over expected over 25 less two per interception over expected. Touchdowns are the team
model's and the reconciliation's (2.6), so a defence's touchdowns are priced once, through the game.
"""

from collections.abc import Mapping, Sequence
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly3.allowance import difference_allowance
from research.model.weekly3.instant import Schedule
from research.model.weekly4.play_model import (
    FORMAT_NAMES,
    INTERCEPTION,
    PASSING_YARDS_PER_POINT,
    RECEPTION_VALUE,
    YARDS_PER_POINT,
)

KINDS: Final = ("target", "carry", "dropback")
_GAME: Final = ["season", "week", "posteam", "defteam", "position", "kind"]


def play_fpoe(plays: pd.DataFrame, name: str) -> np.ndarray:
    """Each play's FPOE without its touchdown, in format `name`."""
    kind = plays["kind"].to_numpy()
    over = plays["h_yards_over"].to_numpy(dtype=float)
    catch = plays["h_catch"].to_numpy(dtype=float) - plays["h_xcatch"].to_numpy(dtype=float)
    picks = plays["h_interceptions"].to_numpy(dtype=float) - plays["h_xinterceptions"].to_numpy(dtype=float)
    target = RECEPTION_VALUE[name] * catch + over / YARDS_PER_POINT
    dropback = over / PASSING_YARDS_PER_POINT + INTERCEPTION * picks
    return np.where(kind == "target", target, np.where(kind == "carry", over / YARDS_PER_POINT, dropback))


def game_values(plays: pd.DataFrame, positions: Mapping[str, str]) -> pd.DataFrame:
    """Per game, offence, position and kind: the opportunities and the FPOE sums in each format."""
    kept = plays.assign(position=plays["player_id"].map(positions))
    kept = kept[kept["position"].notna()]
    sums = {f"fpoe_{name}": play_fpoe(kept, name) for name in FORMAT_NAMES}
    return kept.assign(**sums).groupby(_GAME, as_index=False)[["h_n", *sums]].sum()


def schedule_of(pairing: pd.DataFrame, season: int) -> Schedule:
    """The season's pairing as round 3's `Schedule` (the allowance reads only the pairing)."""
    mine = pairing[pairing["season"] == season]
    pairs = {(int(w), str(c)): str(o) for w, c, o in zip(mine["week"], mine["club"], mine["opponent"], strict=True)}
    return Schedule(season, MappingProxyType({}), MappingProxyType({}), MappingProxyType(pairs))


def value_allowances(values: pd.DataFrame, pairing: pd.DataFrame, season: int, weeks: Sequence[int]) -> pd.DataFrame:
    """Every defence's value allowance at each of `weeks`, per position, kind and format."""
    schedule = schedule_of(pairing, season)
    mine = values[values["season"] == season]
    per: dict[tuple[str, str, str], dict[tuple[str, int], float]] = {}
    counted = mine[mine["h_n"] > 0]
    keys = list(zip(counted["position"], counted["kind"], counted["posteam"], counted["week"], strict=True))
    n = counted["h_n"].to_numpy(dtype=float)
    for name in FORMAT_NAMES:
        per_opportunity = counted[f"fpoe_{name}"].to_numpy(dtype=float) / n
        for (position, kind, offence, week), value in zip(keys, per_opportunity, strict=True):
            per.setdefault((str(position), str(kind), name), {})[(str(offence), int(week))] = float(value)
    defences = sorted({c for (_, c) in schedule.pairing})
    rows = []
    for (position, kind, name), table in per.items():

        def value(offence: str, at: int, table: Mapping[tuple[str, int], float] = table) -> float | None:
            return table.get((offence, at))

        for week in weeks:
            for defence in defences:
                found = difference_allowance(defence, week, schedule, value, value)
                rows.append((season, week, defence, position, kind, name, found.value, found.games))
    return pd.DataFrame(rows, columns=["season", "week", "defence", "position", "kind", "format", "value", "games"])


def row_allowances(rows: pd.DataFrame, allowances: pd.DataFrame) -> pd.DataFrame:
    """Each row's opponent's value allowance to his position, per kind and format (`allow_<kind>_<f>`),
    0 where none is counted."""
    wide = allowances.pivot_table(
        index=["season", "week", "defence", "position"], columns=["kind", "format"], values="value", aggfunc="first"
    )
    wide.columns = [f"allow_{pair[0]}_{pair[1]}" for pair in wide.columns.to_list()]
    keys = rows[["season", "week", "opponent", "position"]].rename(columns={"opponent": "defence"})
    joined = keys.merge(wide.reset_index(), on=["season", "week", "defence", "position"], how="left")
    found = pd.DataFrame(index=rows.index)
    for kind in KINDS:
        for name in FORMAT_NAMES:
            column = f"allow_{kind}_{name}"
            found[column] = joined[column].fillna(0.0).to_numpy() if column in joined else 0.0
    return found
