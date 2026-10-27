"""EACH TERM'S MULTIPLIER FOR ONE (season, week), for the players asked about (plan section 5)."""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Final, cast

import numpy as np
import pandas as pd

from research.explore.scheme_elasticity.plays import on_field
from research.explore.scheme_elasticity.terms import (
    FALLBACK,
    DefenceRates,
    Splits,
    TermValue,
    before,
    defence_rates,
    history,
    mix_multiplier,
    play_action_multiplier,
    splits,
)

QB_TERMS: Final = ("blitz", "pressure", "play_action")
_COLUMNS: Final = ["season", "week", "game_id", "defteam", "player_id", "condition", "points"]


@dataclass(frozen=True, slots=True)
class Opportunities:
    """Per term: the player opportunities and the defence's plays (both with `condition`)."""

    player: Mapping[str, pd.DataFrame]
    defence: Mapping[str, pd.DataFrame]
    totals: pd.DataFrame  # season, week, player_id, qb, carry, receiving points per play


def _frame(plays: pd.DataFrame, player: str, condition: str, points: str) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "season": plays["season"].to_numpy(),
            "week": plays["week"].to_numpy(),
            "game_id": plays["game_id"].to_numpy(),
            "defteam": plays["defteam"].to_numpy(),
            "player_id": plays[player].to_numpy(),
            "condition": plays[condition].to_numpy(dtype=float),
            "points": plays[points].to_numpy(dtype=float),
        },
        columns=_COLUMNS,
    )


def opportunities(plays: pd.DataFrame) -> Opportunities:
    dropbacks = plays[plays["dropback"]]
    runs = plays[plays["designed_run"]]
    qb = {t: _frame(dropbacks, "qb_id", t, "qb_points") for t in QB_TERMS}
    player = {**qb, "man_zone": on_field(plays), "box": _frame(runs, "rusher_player_id", "box_heavy", "carry_points")}
    defence = {
        **qb,
        "man_zone": _frame(dropbacks, "qb_id", "man", "qb_points"),
        "box": player["box"],
    }
    totals = pd.concat(
        [
            dropbacks[["season", "week", "qb_id", "qb_points"]].rename(columns={"qb_id": "player_id"}),
            runs[["season", "week", "rusher_player_id", "carry_points"]].rename(
                columns={"rusher_player_id": "player_id"}
            ),
            dropbacks[["season", "week", "receiver_player_id", "receiver_points"]].rename(
                columns={"receiver_player_id": "player_id"}
            ),
        ],
        ignore_index=True,
    ).fillna({"qb_points": 0.0, "carry_points": 0.0, "receiver_points": 0.0})
    return Opportunities(player, defence, totals[totals["player_id"].notna()])


def kind_shares(totals: pd.DataFrame) -> pd.DataFrame:
    """Per player: the share of his play-level points from dropbacks (QB), carries (RB) and
    receiving (WR, TE), negatives clipped at 0; 1 when he has no positive points."""
    sums = totals.groupby("player_id")[["qb_points", "carry_points", "receiver_points"]].sum().clip(lower=0.0)

    def share(own: str, other: str) -> pd.Series:
        whole = sums[own] + sums[other]
        return (sums[own] / whole.where(whole > 0)).fillna(1.0)

    return pd.DataFrame(
        {
            "QB": share("qb_points", "carry_points"),
            "RB": share("carry_points", "receiver_points"),
            "WR": share("receiver_points", "carry_points"),
            "TE": share("receiver_points", "carry_points"),
        }
    )


@dataclass(frozen=True, slots=True)
class WeekTerms:
    values: Mapping[tuple[str, str], TermValue]  # (player_id, term) -> value
    pooled_fully: Mapping[str, bool]  # term -> its split's moments pooled fully (QB, or WR/TE, or RB)


def _player_terms(  # noqa: PLR0913, PLR0917 - one term's inputs, named
    term: str,
    found: Splits,
    rates: DefenceRates,
    shares: pd.DataFrame,
    asked: Iterable[tuple[str, str, str | None]],
    allowed: tuple[DefenceRates, DefenceRates] | None,
) -> dict[tuple[str, str], TermValue]:
    values: dict[tuple[str, str], TermValue] = {}
    for pid, position, opponent in asked:
        if opponent is None or pid not in found.frame.index:
            values[(pid, term)] = FALLBACK
            continue
        row = cast("pd.Series[float]", found.frame.loc[pid])
        share = float(shares[position].get(pid, 1.0)) if pid in shares.index else 1.0
        if allowed is not None:
            pa, np_ = allowed
            values[(pid, term)] = play_action_multiplier(row, share, pa.of(opponent), np_.of(opponent), rates.league)
        else:
            values[(pid, term)] = mix_multiplier(row, share, rates.of(opponent), rates.league)
    return values


def week_terms(  # noqa: PLR0913, PLR0917 - one week's inputs, named
    ops: Opportunities,
    season: int,
    week: int,
    asked: Mapping[tuple[str, str], list[tuple[str, str | None]]],
    positions: Mapping[str, str],
    shrink: bool = True,
) -> WeekTerms:
    """`asked`: per (term, position), the (player_id, opponent) rows of the population it applies to.
    Each split's moments are fitted over the players of that position only (plan section 5)."""
    shares = kind_shares(history(ops.totals, season, week))
    values: dict[tuple[str, str], TermValue] = {}
    pooled: dict[str, bool] = {}
    for (term, position), rows in asked.items():
        own = history(ops.player[term], season, week)
        found = splits(own[own["player_id"].map(positions) == position], shrink)
        pooled[f"{term}|{position}"] = found.pooled_fully
        window = before(ops.defence[term], season, week)
        rates = defence_rates(window)
        allowed = None
        if term == "play_action":
            allowed = (
                defence_rates(window[window["condition"] == 1.0], "points"),
                defence_rates(window[window["condition"] == 0.0], "points"),
            )
        typed = [(pid, position, opponent) for pid, opponent in rows]
        values.update(_player_terms(term, found, rates, shares, typed, allowed))
    return WeekTerms(values, pooled)


def product(values: Mapping[tuple[str, str], TermValue], player_id: str, terms: Iterable[str]) -> float:
    return float(np.prod([values.get((player_id, t), FALLBACK).m for t in terms]))
