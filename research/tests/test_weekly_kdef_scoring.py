"""Lane 157, the judged scoring (Amendment 7 item 8) and ESPN's archived projection re-scored from its own
components (item 9; B132 M1: ESPN's 50-plus figure is never added to its 50-59 and 60-plus parts)."""

import json
from pathlib import Path
from typing import Final

import numpy as np
import pytest

from research.model.weekly_kdef import scoring
from research.pipeline.espn import kdef_archive

_POOL: Final = Path(__file__).parent / "testdata" / "espn" / "pool_2026_w7.json"
_AUBREY: Final = "3953687"
_SEAHAWKS: Final = "-16026"
_ESPN_TOTAL: Final = 8.15622939


def _archived(espn_id: str) -> kdef_archive.ArchivedProjection:
    parsed = {p.espn_id: p for p in kdef_archive.parse_archive(json.loads(_POOL.read_bytes()), 2026, 7)}
    return parsed[espn_id]


def test_espns_kicker_total_is_rebuilt_from_its_components_under_its_own_defaults() -> None:
    kicker = _archived(_AUBREY)
    c = kdef_archive.components("K", kicker.stats)
    assert {"fg_made_50_plus", "fg_made_50_59"} <= set(c)  # the fixture carries the figure and a part
    own = scoring.espn_kicker_points(c, xp_missed_points=scoring.ESPN_XP_MISSED_POINTS)
    assert own == pytest.approx(_ESPN_TOTAL, abs=1e-6)
    judged = scoring.espn_kicker_points(c)
    assert judged == pytest.approx(_ESPN_TOTAL - c["xp_missed"], abs=1e-6)  # a missed extra point is -1, never 0
    value, rescored = scoring.espn_points("K", c, kicker.applied_total)
    assert value == pytest.approx(judged) and rescored


def test_the_50_plus_figure_is_never_added_to_its_parts() -> None:
    parts = {"fg_made_50_59": 0.3, "fg_made_60_plus": 0.1}
    assert scoring.espn_made_50_plus({**parts, "fg_made_50_plus": 0.4}) == pytest.approx(0.4)
    assert scoring.espn_made_50_plus(parts) == pytest.approx(0.4)
    assert scoring.espn_made_50_plus({"fg_made_50_59": 0.3}) == pytest.approx(0.3)
    assert scoring.espn_made_50_plus({}) is None
    base = {"fg_made_0_39": 1.0, "fg_made_40_49": 0.5, "fg_missed": 0.2, "xp_made": 2.0, "xp_missed": 0.1}
    both = scoring.espn_kicker_points({**base, **parts, "fg_made_50_plus": 0.4})
    split = scoring.espn_kicker_points({**base, **parts})
    assert both == pytest.approx(split)
    assert both == pytest.approx(3.0 + 2.0 + 2.0 - 0.2 + 2.0 - 0.1)


def test_a_kicker_split_missing_a_component_keeps_its_total() -> None:
    assert scoring.espn_points("K", {"fg_made_0_39": 1.0}, 7.5) == (7.5, False)


def test_espns_dst_components_score_under_the_judged_table_with_a_block_at_zero() -> None:
    defense = _archived(_SEAHAWKS)
    c = kdef_archive.components("DEF", defense.stats)
    judged = scoring.espn_defense_points(c)
    assert judged is not None
    # ESPN's default prices a blocked kick at 2; the house table has no block value.
    assert judged == pytest.approx(defense.applied_total - 2 * c["blocked_kicks"], abs=0.01)
    assert scoring.espn_points("DEF", {"sacks": 1.0}, 4.0) == (4.0, False)


def test_the_kickers_judged_scoring() -> None:
    line = {name: np.array([0.0]) for name in scoring.KICKER_COMPONENTS}
    line |= {"fg_made_30_39": np.array([1.0]), "fg_made_40_49": np.array([1.0]), "fg_made_50_59": np.array([1.0])}
    line |= {"fg_made_60_plus": np.array([1.0]), "fg_missed_20_29": np.array([1.0]), "fg_blocked": np.array([1.0])}
    line |= {"xp_made": np.array([3.0]), "xp_missed": np.array([1.0])}
    assert scoring.kicker_points(line)[0] == pytest.approx(3 + 4 + 5 + 5 - 1 - 1 + 3 - 1)
    assert scoring.kicker_points(line, fg_points=scoring.FLAT_FG_POINTS)[0] == pytest.approx(12 - 2 + 3 - 1)


@pytest.mark.parametrize(
    ("allowed", "points"),
    [
        (0, 5),
        (1, 4),
        (6, 4),
        (7, 3),
        (13, 3),
        (14, 1),
        (17, 1),
        (18, 0),
        (27, 0),
        (28, -1),
        (34, -1),
        (35, -3),
        (45, -3),
        (46, -5),
        (60, -5),
    ],
)
def test_the_points_allowed_bands_are_the_domains(allowed: int, points: int) -> None:
    assert scoring.points_allowed_points(np.array([allowed]))[0] == points


@pytest.mark.parametrize(
    ("yards", "points"), [(99, 5), (100, 3), (199, 3), (299, 2), (349, 0), (350, -1), (499, -5), (549, -6), (550, -7)]
)
def test_the_yards_allowed_bands_are_the_domains(yards: int, points: int) -> None:
    assert scoring.yards_allowed_points(np.array([yards]))[0] == points


def test_the_defenses_judged_scoring() -> None:
    line = {"points_allowed": np.array([10.0]), "yards_allowed": np.array([320.0])}
    line |= {"sacks": np.array([3.0]), "interceptions": np.array([1.0]), "fumble_recoveries": np.array([1.0])}
    line |= {"defensive_touchdowns": np.array([1.0]), "return_touchdowns": np.array([1.0])}
    line |= {"safeties": np.array([1.0]), "blocks": np.array([2.0])}
    assert scoring.defense_points(line)[0] == pytest.approx(3 + 0 + 3 + 2 + 2 + 6 + 6 + 2 + 0)
