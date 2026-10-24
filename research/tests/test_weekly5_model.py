# ruff: noqa: PLR2004 - synthetic seasons' counts and hand-computed values
"""Round 5's model on synthetic seasons (Lane 168): the trees' refits and their one-season exception, the
forward-chained windows (2.11), the projected set on the judged rows, the bands fitted on the band seasons
only, the candidate choice at four decimals (2.8), the damped spreadsheet (3.1), the why's Shapley values
summing to the point less the neutral point (2.10), the lock's one edit and the results template."""

from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from types import MappingProxyType

import numpy as np
import pandas as pd
import pytest

from research.errors import ConfigurationError
from research.model.weekly2.gates import Difference, Ordering
from research.model.weekly4.tuning import Cell, Constant
from research.model.weekly5 import lock, template
from research.model.weekly5.benchmarks import damped
from research.model.weekly5.board import COMPONENTS_CANDIDATE, RIVAL_CANDIDATE
from research.model.weekly5.judgment import Assessed, Comparison, choose
from research.model.weekly5.projected import numbered
from research.model.weekly5.system import Fitted, fit_round, judged_board, rival_specs, tree_specs
from research.model.weekly5.trees import TreeSpec, fit_trees, refits_for
from research.model.weekly5.why import attributions, shown
from research.tests import weekly5_synthetic as synthetic


@pytest.fixture(scope="module")
def built() -> synthetic.Built:
    return synthetic.build()


@pytest.fixture(scope="module")
def fitted(built: synthetic.Built) -> Iterator[Fitted]:
    yield fit_round(built.store, built.sources, synthetic.T, (COMPONENTS_CANDIDATE, RIVAL_CANDIDATE), synthetic.TINY)


def test_refits_are_the_band_seasons_and_the_judged_seasons() -> None:
    assert refits_for((2021, 2022)) == ((2021,), (2021, 2022))
    assert refits_for((2021, 2022, 2023)) == ((2021,), (2021, 2022), (2021, 2022, 2023))


def test_a_one_season_refit_takes_its_next_refits_cell_and_an_empty_count_is_zero() -> None:
    rng = np.random.default_rng(1)
    rows = pd.DataFrame({"season": np.repeat([2019, 2020, 2021], 80), "position": "TE", "x": rng.normal(size=240)})
    rows["y"] = np.where(rows["season"] == 2019, 0.0, rng.poisson(1.0, size=240))
    grid = (Cell(7, 0.0, 20, 5), Cell(7, 1.0, 20, 5))
    fit = fit_trees(rows, {("TE", "carries"): TreeSpec(("x",), "y", "poisson")}, refits_for((2019, 2020, 2021)), grid)
    key = ("TE", "carries")
    assert fit.cells[(2019,)][key] == fit.cells[(2019, 2020)][key]
    assert isinstance(fit.models[(2019,)][key], Constant)  # 2019's carries are all 0: the constant 0
    assert set(fit.losses) == {(2019, 2020), (2019, 2020, 2021)}


def test_every_tree_reads_the_feature_row_the_volumes_its_anchor_and_its_rates() -> None:
    specs = tree_specs()
    assert len(specs) == 16 and len(rival_specs()) == 12
    wr = specs[("WR", "targets")].features
    assert "exp_team_targets" in wr and "anchor_targets" in wr and "anchor_carries" not in wr and "rate_m_ppr" in wr
    assert "shrunk_receptions_per_target" in wr and "shrunk_passing_yards_per_attempt" not in wr
    rival = rival_specs()[("WR", "ppr")].features
    assert {"anchor_targets", "anchor_carries", "anchor_rushing_yards"} <= set(rival)


def test_the_windows_are_forward_chained(fitted: Fitted) -> None:
    t = synthetic.T
    assert fitted.models[2020].refit == (2018, 2019) and fitted.models[2019].refit == (2018,)
    assert fitted.models[2018].refit is None and fitted.models[2018].shares is None
    assert fitted.models[2020].team.trained_on == (2015, 2016, 2017, 2018, 2019)
    assert fitted.models[2018].team.trained_on == (2015, 2016, 2017)
    assert fitted.play.models[2020].trained_on == (2015, 2016, 2017, 2018, 2019)
    assert fitted.shared.shrinkage.window == t.player_fit_seasons
    assert set(fitted.bands) == {COMPONENTS_CANDIDATE, RIVAL_CANDIDATE}
    assert all(b.seasons == (2019,) for b in fitted.bands.values())  # the band season: the second fit season
    assert max(fitted.served["players"]) == 2019 and max(fitted.served["plays and teams"]) == 2019


def test_the_judged_board_numbers_only_the_projected_set(fitted: Fitted) -> None:
    for candidate in (COMPONENTS_CANDIDATE, RIVAL_CANDIDATE):
        scored = judged_board(fitted, synthetic.T, candidate)
        keep = numbered(scored)
        assert np.isfinite(scored.loc[keep, "point_ppr"]).all() and scored.loc[~keep, "point_ppr"].isna().all()
        assert (scored.loc[scored["withheld"] == 1, "point_ppr"]).isna().all()
        rate = keep & (scored["default_no_game_this_season"] == 1)
        assert (scored.loc[rate, "point_ppr"] == scored.loc[rate, "rate_m_ppr"]).all()


def test_the_why_sums_to_the_point_less_the_neutral_point(fitted: Fitted) -> None:
    data = fitted.data[2020]
    week = replace(data, rows=data.rows[data.rows["week"] == 6].reset_index(drop=True), cache={})
    found = attributions(week, fitted.models[2020], fitted.shared, COMPONENTS_CANDIDATE)
    numbered_rows = found[np.isfinite(found["point_ppr"])]
    groups = [c for c in found.columns if c.startswith("why_") and c.endswith("_ppr")]
    total = numbered_rows[groups].sum(axis=1)
    assert np.allclose(total, numbered_rows["point_ppr"] - numbered_rows["neutral_ppr"], atol=1e-6)
    row = numbered_rows.iloc[0].to_dict()
    assert 3 <= len(shown(row)) <= 7


def _assessed(value: float | None) -> Assessed:
    ordering = Ordering(Difference(value, 0.01, 12), MappingProxyType({}))
    return Assessed((), Comparison({}, {"form": ordering}, {}), (), {})


@pytest.mark.parametrize(
    ("components", "rival", "chosen"),
    [
        (0.03, 0.04, "rival"),
        (0.04, 0.03, "components"),
        (0.03001, 0.03004, "components"),
        (None, 0.01, "rival"),
        (0.01, None, "components"),
    ],
)
def test_the_choice_at_four_decimals_a_tie_to_the_components(
    components: float | None, rival: float | None, chosen: str
) -> None:
    found = choose({"components": _assessed(components), "rival": _assessed(rival)})
    assert found.chosen == chosen
    assert "four decimals" in found.rule


def test_the_damped_sheet_is_form_times_the_square_root_of_the_two_ratios() -> None:
    form = {"ppr": 16.0, "half": 12.0, "std": 8.0}
    found = damped(form, 1.21, 30.0, 25.0)
    assert found is not None and found["ppr"] == pytest.approx(16.0 * (1.21 * 30 / 25) ** 0.5)
    assert damped(form, 1.0, float("nan"), 25.0) == form
    assert damped(None, 1.0, 1.0, 1.0) is None


def test_the_lock_rewrites_its_three_assignments_and_nothing_else() -> None:
    text = lock.DECISIONS.read_text()
    found = lock.rewrite(text, {"spreadsheets": "damped", "margin": "0.025", "lock": "abc1234"})
    assert 'SPREADSHEETS: Final[Spreadsheets] = "damped"' in found
    assert "FORM_MARGIN: Final[float] = 0.025" in found and 'LOCK: Final[str | None] = "abc1234"' in found
    changed = [a for a, b in zip(text.splitlines(), found.splitlines(), strict=True) if a != b]
    assert len(changed) == 3
    for bad in ({"spreadsheets": "both of them"}, {"margin": "-0.1"}, {"margin": "x"}, {"lock": "not a sha"}):
        with pytest.raises(ConfigurationError):
            lock.rewrite(text, bad)


def test_the_template_follows_section_8_and_refuses_to_replace(tmp_path: Path) -> None:
    text = template.render(None, None)
    headings = [line for line in text.splitlines() if line.startswith("## ")]
    assert [h.split(". ")[0] for h in headings] == [f"## {i}" for i in range(1, 8)]
    path = template.write(tmp_path / "results.md", None, None)
    with pytest.raises(FileExistsError):
        template.write(path, None, None)
    template.write(path, None, None, replace=True)
