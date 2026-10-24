"""EVERYTHING 3.2 REPORTS WITHOUT GATING, for the chosen candidate on the checked or judged season.

The ablations (each a `board.Variant` on the judged rows, the fitted models unchanged): without the game
terms (round 4's game group neutral), without weather (the weather group neutral), without the charted
features (NaN with their indicators), without the team volume inputs (the eight volumes at the week's
club-game mean, in the trees only), without the anchors (NaN, as before his first game), without the rate m
(out of the trees' inputs; the rate-m rows keep it), without the touchdown share input (his modelled
target and carry shares in place of the red-zone and inside-ten shares), with the efficiency windows at
round 4's share decay (d = 0.5, the chosen k), and round 3's input rule with the game figures hidden; the
weather sensitivity view in the judgment only (round 4's `weather_noise`, seed 2024). Beside them: every
2.12 default count, `no_play_evidence` by position and week and the population rows it removes, each
component tree's validation loss against the season anchor, each shrunk quantity's loss against its
unshrunk season-to-date rate and round 4's share decay, the chosen (d, k), the residual bands, the team
model's residual by season, the Questionable play chance and its calibration, and the retractable-roof
club-games per season.
"""

from collections.abc import Sequence
from dataclasses import asdict, replace
from typing import Any, Final

import numpy as np
import pandas as pd

from research.model.weekly2.statistics import JudgedRow
from research.model.weekly4.reporting import weather_noise
from research.model.weekly4.scoring import Row
from research.model.weekly4.team_model import TEAM_TARGETS, predict_team
from research.model.weekly5 import bands as band_module
from research.model.weekly5.board import Variant, board
from research.model.weekly5.columns import FEATURE_INPUTS, VOLUME_INPUTS
from research.model.weekly5.gates import RoundFive
from research.model.weekly5.judgment import compare, numbers_of, ordering_payload
from research.model.weekly5.projected import no_play_evidence, numbered
from research.model.weekly5.shrinkage import ROUND_FOUR_DECAY, fit_payload
from research.model.weekly5.system import Fitted
from research.model.weekly5.trees import cells_payload

ABLATIONS: Final = {
    "without_game_terms": Variant(groups=frozenset({"game"})),
    "without_weather": Variant(groups=frozenset({"weather"})),
    "without_charted_features": Variant(no_charted=True),
    "without_team_volume_inputs": Variant(volumes_neutral=True),
    "without_anchors": Variant(no_anchors=True),
    "without_rate_m": Variant(no_rate_m=True),
    "without_touchdown_share_input": Variant(volume_share_touchdowns=True),
    "efficiency_at_round_four_share_decay": Variant(decay=ROUND_FOUR_DECAY),
    "round_three_input_rule_figure_hidden": Variant(hide_figure=True),
}


def _comparison(rows: Sequence[Row], t: RoundFive) -> dict[str, Any]:
    found = compare(rows, t)
    return {
        "against": {b: ordering_payload(o) for b, o in found.against.items()},
        "places_off_pooled": dict(found.places),
    }


def ablations(fitted: Fitted, t: RoundFive, candidate: str, rows: Sequence[Row], judged: bool) -> dict[str, Any]:
    variants = dict(ABLATIONS)
    if judged:
        variants["weather_sensitivity"] = Variant(transform=weather_noise)
    s = t.judgment_season
    found: dict[str, Any] = {}
    for name, variant in variants.items():
        scored = board(fitted.data[s], fitted.models[s], fitted.shared, candidate, variant)
        numbers = numbers_of(scored)
        moved = [replace(r, sources={**r.sources, "model": numbers.get((r.week, r.player_id))}) for r in rows]
        found[name] = _comparison(moved, t)
    return found


def default_counts(scored: pd.DataFrame, rows: Sequence[Row], t: RoundFive) -> dict[str, Any]:
    """Every 2.12 default over the judged weeks' rows and over the population."""
    judged = scored[scored["week"].isin(t.weeks)]
    numbered_rows = judged[numbered(judged)]
    no_carry = (numbered_rows["position"] == "QB") & ~np.isfinite(numbered_rows["anchor_carries"].to_numpy(dtype=float))
    counts: dict[str, Any] = {
        "rows": len(judged),
        "numbered": len(numbered_rows),
        "no_play_evidence": int((~numbered(judged) & (judged["withheld"].fillna(0) == 0)).sum()),
        "rate_m_no_game_this_season": int((numbered_rows["default_no_game_this_season"].fillna(0) == 1).sum()),
        "qb_without_a_carry_this_season": int(no_carry.sum()),
    }
    for column in ("no_share", "rival_no_form"):
        if column in numbered_rows:
            counts[column] = int(numbered_rows[column].fillna(0).sum())
    population = {(r.week, r.player_id) for r in rows}
    removed = judged[~numbered(judged)]
    counts["population_rows_without_a_number"] = sum(
        (int(w), str(p)) in population for w, p in zip(removed["week"], removed["player_id"], strict=True)
    )
    indicators = [c for c in judged.columns if c.startswith("default_")]
    counts["store_defaults"] = {c.removeprefix("default_"): int(numbered_rows[c].fillna(0).sum()) for c in indicators}
    return counts


def fit_defaults(fitted: Fitted, t: RoundFive) -> dict[str, Any]:
    """2.12's defaults on each fit season's fit rows (lined, weeks 4 to 17): no game this season, a quarterback
    with no carry, a quantity at n_eff = 0, and every store indicator."""
    found: dict[str, Any] = {}
    for season in t.player_fit_seasons:
        rows = fitted.data[season].rows
        rows = rows[(rows["lined"] == 1) & rows["week"].isin(t.fit_weeks)]
        indicators = [c for c in rows.columns if c.startswith("default_")]
        found[str(season)] = {
            "rows": len(rows),
            "no_game_this_season": int(rows["default_no_game_this_season"].fillna(0).sum()),
            "store_defaults": {c.removeprefix("default_"): int(rows[c].fillna(0).sum()) for c in indicators},
        }
    return found


def team_residuals(fitted: Fitted) -> dict[str, dict[str, float]]:
    """The team model's mean residual (realised less expected) by season and target."""
    found: dict[str, dict[str, float]] = {}
    for season, data in sorted(fitted.data.items()):
        predicted = predict_team(data.teams, fitted.models[season].team)
        found[str(season)] = {
            target: float(np.nanmean(data.teams[target].to_numpy(dtype=float) - predicted[f"exp_{target}"].to_numpy()))
            for target in TEAM_TARGETS
        }
    return found


def questionable(fitted: Fitted, t: RoundFive) -> dict[str, Any]:
    """The share of Questionable filings at t_g followed by a line, by position: the fit seasons' and the
    judged weeks' (its calibration)."""

    def chance(frame: pd.DataFrame) -> dict[str, Any]:
        q = frame[frame["questionable"] == 1]
        return {
            str(p): {"n": len(g), "played": float(g["lined"].mean()) if len(g) else None}
            for p, g in q.groupby("position")
        }

    fit = pd.concat([fitted.data[s].rows for s in t.player_fit_seasons])
    judged = fitted.data[t.judgment_season].rows
    return {"fit_rows": chance(fit), "judged": chance(judged[judged["week"].isin(t.weeks)])}


def no_play(fitted: Fitted, t: RoundFive, r3_rows: Sequence[JudgedRow]) -> dict[str, Any]:
    """`no_play_evidence` by position and week, and the population rows it removes."""
    judged = fitted.data[t.judgment_season].rows
    judged = judged[judged["week"].isin(t.weeks)]
    population = {(r.week, r.player_id) for r in r3_rows}
    missing = judged[(judged["withheld"].fillna(0) == 0) & ~numbered(judged)]
    removed = [
        (int(w), str(p))
        for w, p in zip(missing["week"], missing["player_id"], strict=True)
        if (int(w), str(p)) in population
    ]
    return {
        "by_position_and_week": no_play_evidence(judged).to_dict("records"),
        "population_rows_removed": len(removed),
    }


def fitted_payload(fitted: Fitted) -> dict[str, Any]:
    """The fit's record: round 4's components' cells (for the reproduction), this round's cells and constants."""
    trees = fitted.shared.trees
    rival = fitted.shared.rival
    return {
        "play_model_cells": {k: {str(s): asdict(c) for s, c in v.items()} for k, v in fitted.play.cells.items()},
        "team_model_cells": {k: {str(s): asdict(c) for s, c in v.items()} for k, v in fitted.team.cells.items()},
        "share_cells": {"-".join(map(str, k)): asdict(m.cell) for k, m in fitted.shares.models.items()},
        "share_fold_losses": {"-".join(map(str, k)): dict(v) for k, v in fitted.shares.losses.items()},
        "shrinkage": fit_payload(fitted.shared.shrinkage),
        "fumbles_lost_per_touch": dict(fitted.shared.fumbles),
        "component_tree_cells": None if trees is None else cells_payload(trees),
        "component_tree_validation": None
        if trees is None
        else {"|".join(k): dict(v) for k, v in trees.validation.items()},
        "rival_cells": None if rival is None else cells_payload(rival),
        "bands": {c: band_module.payload(b) for c, b in fitted.bands.items()},
        "input_columns": {"feature_row": list(FEATURE_INPUTS), "volumes": list(VOLUME_INPUTS)},
        "seconds": dict(fitted.seconds),
    }


def reported(  # noqa: PLR0913, PLR0917 - the reported views' every input, named
    fitted: Fitted,
    t: RoundFive,
    candidate: str,
    scored: pd.DataFrame,
    rows: Sequence[Row],
    r3_rows: Sequence[JudgedRow],
    judged: bool,
) -> dict[str, Any]:
    return {
        "ablations": ablations(fitted, t, candidate, rows, judged),
        "defaults": default_counts(scored, rows, t),
        "defaults_fit_rows": fit_defaults(fitted, t),
        "no_play_evidence": no_play(fitted, t, r3_rows),
        "team_residual_by_season": team_residuals(fitted),
        "questionable": questionable(fitted, t),
        "retractable_club_games": {
            str(s): int(d.teams["roof"].isin(["open", "closed"]).sum()) for s, d in sorted(fitted.data.items())
        },
    }
