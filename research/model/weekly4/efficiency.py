"""EFFICIENCY AGAINST EXPECTED, FITTED AND APPLIED (preregistration section 2.3).

The shrunk terms the point reads, per position and kind (`COMPONENTS`):

- **yards over expected per opportunity** (targets, carries, dropbacks' passing yards), shrunk in the
  normal form toward the **role prior**, the position mean plus a linear term in the charted signals
  (NGS and PFR, each with its missing indicator), fitted by weighted least squares on the fit rows'
  week-W yards over expected per opportunity (weight: the opportunities), the xFP forward-chained;
- **the catch rate over expected**, in its beta-binomial form: the prior rate is his expected rate
  plus the position's mean catch rate over expected, tau^2 from the same moment fit;
- **the touchdown rate over expected**, in its gamma-Poisson form: a factor on his expected
  touchdowns with the position's mean factor as the prior mean;
- **the scramble rate** of a dropback without a sack (the simulation's "starter's shrunk scramble
  rate", 2.6), in the normal form toward the position mean.

The moments are fitted per position, kind and component on the fit seasons, one unit per
player-season; a cell whose tau^2 comes out at or below zero pools fully and is reported.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly4.shrinkage import (
    MomentFit,
    beta_binomial_rate,
    gamma_poisson_factor,
    moment_fit,
    normal_posterior,
)

COMPONENTS: Final = (
    ("target", "yards"),
    ("target", "catch"),
    ("target", "td"),
    ("carry", "yards"),
    ("carry", "td"),
    ("dropback", "yards"),
    ("dropback", "scramble"),
)
_NEUTRAL: Final = MappingProxyType({"yards": 0.0, "catch": 0.0, "td": 1.0, "scramble": 0.0})
_SUMS: Final = ("h_n", "h_catch", "h_xcatch", "h_yards_over", "h_td", "h_xtd", "h_scrambles", "h_not_sacked")


@dataclass(frozen=True, slots=True)
class RolePrior:
    """Per position, a weighted least-squares line: intercept, charted features, missing indicators."""

    features: tuple[str, ...]
    coefficients: Mapping[str, tuple[float, ...]]  # position -> coefficients

    def design(self, frame: pd.DataFrame) -> np.ndarray:
        columns = [np.ones(len(frame))]
        for name in self.features:
            columns.append(frame[name].fillna(0.0).to_numpy(dtype=float))
            columns.append(frame[f"default_no_{name}"].fillna(1.0).to_numpy(dtype=float))
        return np.column_stack(columns)

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        x = self.design(frame)
        found = np.zeros(len(frame))
        positions = frame["position"].to_numpy()
        for position, beta in self.coefficients.items():
            mine = positions == position
            found[mine] = x[mine] @ np.asarray(beta)
        return found


def fit_role_prior(rows: pd.DataFrame, outcome: pd.DataFrame, features: Sequence[str]) -> RolePrior:
    """Per position: the week's yards over expected per opportunity on the charted signals, weighted
    by the week's opportunities (rows with none are left out)."""
    prior = RolePrior(tuple(features), {})
    x = prior.design(rows)
    n = outcome["n"].to_numpy(dtype=float)
    y = np.where(n > 0, outcome["yards_over"].to_numpy(dtype=float) / np.maximum(n, 1.0), 0.0)
    coefficients: dict[str, tuple[float, ...]] = {}
    for position in sorted(rows["position"].unique()):
        mine = (rows["position"].to_numpy() == position) & (n > 0)
        if not mine.any():
            continue
        root = np.sqrt(n[mine])
        beta, *_ = np.linalg.lstsq(x[mine] * root[:, None], y[mine] * root, rcond=None)
        coefficients[str(position)] = tuple(float(b) for b in beta)
    return RolePrior(tuple(features), MappingProxyType(coefficients))


@dataclass(frozen=True, slots=True)
class Efficiency:
    cells: Mapping[tuple[str, str, str], MomentFit]  # (position, kind, component)
    role_priors: Mapping[str, RolePrior]  # kind -> the role prior of its yards
    noise: Mapping[tuple[str, str], float] = field(default_factory=dict)  # (position, kind) -> yards noise

    def cell(self, position: str, kind: str, component: str) -> MomentFit:
        found = self.cells.get((position, kind, component))
        return found if found is not None else MomentFit(_NEUTRAL[component], 0.0, 0.0, 0)

    @property
    def pooled_fully(self) -> list[str]:
        return sorted("|".join(key) for key, fit in self.cells.items() if fit.pooled_fully)


def _units(plays: pd.DataFrame, positions: Mapping[str, str]) -> pd.DataFrame:
    kept = plays.assign(position=plays["player_id"].map(positions), sq=plays["h_yards_over"] ** 2)
    kept = kept[kept["position"].notna()]
    kept = kept.assign(xvar=kept["h_xcatch"] * (1.0 - kept["h_xcatch"]))
    return kept.groupby(["position", "kind", "player_id", "season"], as_index=False)[[*_SUMS, "sq", "xvar"]].sum()


def _yards_fit(u: pd.DataFrame) -> MomentFit:
    n = u["h_n"].to_numpy()
    mean_each = u["h_yards_over"].to_numpy() / n
    within = float(np.sum(u["sq"] - n * mean_each**2) / max(float(np.sum(n - 1.0)), 1.0))
    return moment_fit(mean_each, n, within, float(u["h_yards_over"].sum() / n.sum()))


def _catch_fit(u: pd.DataFrame) -> MomentFit:
    n = u["h_n"].to_numpy()
    observed = (u["h_catch"].to_numpy() - u["h_xcatch"].to_numpy()) / n
    noise = float(u["xvar"].sum() / n.sum())
    return moment_fit(observed, n, noise, float((u["h_catch"].sum() - u["h_xcatch"].sum()) / n.sum()))


def _td_fit(u: pd.DataFrame) -> MomentFit:
    expected = u["h_xtd"].to_numpy()
    mean = float(u["h_td"].sum() / max(expected.sum(), 1e-9))
    observed = np.where(expected > 0, u["h_td"].to_numpy() / np.maximum(expected, 1e-9), 0.0)
    return moment_fit(observed, expected, mean, mean)


def _scramble_fit(u: pd.DataFrame) -> MomentFit:
    n = u["h_not_sacked"].to_numpy()
    mean = float(u["h_scrambles"].sum() / max(n.sum(), 1e-9))
    observed = np.where(n > 0, u["h_scrambles"].to_numpy() / np.maximum(n, 1e-9), 0.0)
    return moment_fit(observed, n, mean * (1.0 - mean), mean)


_FITS: Final = MappingProxyType({"yards": _yards_fit, "catch": _catch_fit, "td": _td_fit, "scramble": _scramble_fit})


def fit_efficiency(
    plays: pd.DataFrame, positions: Mapping[str, str], role_priors: Mapping[str, RolePrior] | None = None
) -> Efficiency:
    """The moment fits of every (position, kind, component) on the fit seasons' plays (`h_` columns)."""
    units = _units(plays, positions)
    cells: dict[tuple[str, str, str], MomentFit] = {}
    noise: dict[tuple[str, str], float] = {}
    for (position, kind), group in units.groupby(["position", "kind"]):
        for k, component in COMPONENTS:
            if k == kind:
                fit = _FITS[component](group)
                cells[(str(position), str(kind), component)] = fit
                if component == "yards":
                    noise[(str(position), str(kind))] = fit.noise
    return Efficiency(MappingProxyType(cells), MappingProxyType(dict(role_priors or {})), MappingProxyType(noise))


def apply_efficiency(rows: pd.DataFrame, efficiency: Efficiency) -> pd.DataFrame:
    """Each row's shrunk terms, from its decayed history (`<kind>_<stat>`), its week's expected catch
    rate (`target_wx_catch`) and its role priors (`role_prior_<kind>`)."""
    found = pd.DataFrame(index=rows.index)
    positions = rows["position"].to_numpy()

    def per_position(compute: Callable[[pd.DataFrame, str], np.ndarray]) -> np.ndarray:
        values = np.full(len(rows), np.nan)
        for position in np.unique(positions):
            mine = positions == position
            values[mine] = compute(rows[mine], str(position))
        return values

    for kind in ("target", "carry", "dropback"):
        if f"{kind}_n" not in rows:
            continue

        def yards(part: pd.DataFrame, position: str, kind: str = kind) -> np.ndarray:
            n = part[f"{kind}_n"].to_numpy(dtype=float)
            observed = np.where(n > 0, part[f"{kind}_yards_over"].to_numpy() / np.maximum(n, 1e-9), 0.0)
            prior = part[f"role_prior_{kind}"].to_numpy(dtype=float)
            return normal_posterior(observed, n, prior, efficiency.cell(position, kind, "yards").k)

        found[f"{kind}_yoe"] = per_position(yards)
        if kind in ("target", "carry"):

            def td(part: pd.DataFrame, position: str, kind: str = kind) -> np.ndarray:
                fit = efficiency.cell(position, kind, "td")
                return gamma_poisson_factor(part[f"{kind}_td"].to_numpy(), part[f"{kind}_xtd"].to_numpy(), fit)

            found[f"{kind}_td_factor"] = per_position(td)
    if "target_n" in rows:
        found["target_catch_factor"] = per_position(
            lambda part, position: _catch_factor(part, efficiency.cell(position, "target", "catch"))
        )
    if "dropback_n" in rows:

        def scrambles(part: pd.DataFrame, position: str) -> np.ndarray:
            fit = efficiency.cell(position, "dropback", "scramble")
            n = part["dropback_not_sacked"].to_numpy(dtype=float)
            observed = np.where(n > 0, part["dropback_scrambles"].to_numpy() / np.maximum(n, 1e-9), 0.0)
            return normal_posterior(observed, n, np.full(len(part), fit.mean), fit.k)

        found["dropback_scramble_rate"] = per_position(scrambles)
    return found


def _catch_factor(part: pd.DataFrame, fit: MomentFit) -> np.ndarray:
    """The posterior catch rate over his historical expected rate; with no target, the prior's."""
    n = part["target_n"].to_numpy(dtype=float)
    week = part["target_wx_catch"].to_numpy(dtype=float)
    expected = np.where(n > 0, part["target_xcatch"].to_numpy() / np.maximum(n, 1e-9), week)
    expected = np.clip(expected, 1e-6, 1.0)
    rate = beta_binomial_rate(part["target_catch"].to_numpy(), n, np.clip(expected + fit.mean, 1e-6, 1.0), fit)
    return rate / expected
