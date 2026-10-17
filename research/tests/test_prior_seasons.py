"""A player page's earlier seasons (Lane 66h): each summed as this season's block sums its weeks, the
regular season only, newest first, a season he did not play left out."""

from research.nightly.build.player_season import (
    PRIOR_SEASONS,
    SeasonContext,
    SeasonStore,
    prior_seasons,
)
from research.nightly.config import RUN_FORMATS

PPR = next(f for f in RUN_FORMATS if f.scoring == "ppr")
CARRIED = frozenset({"receptions", "receiving_yards", "receiving_touchdowns", "targets"})


def _store(lines: dict[int, dict[str, float]], snaps: dict[int, dict[str, float]]) -> SeasonStore:
    return SeasonStore({"p1": lines}, {"p1": snaps}, {}, dict.fromkeys(range(1, 23), CARRIED), frozenset())


def _context(prior: dict[int, SeasonStore]) -> SeasonContext:
    empty = SeasonStore({}, {}, {}, {}, frozenset())
    return SeasonContext(2026, 18, 5, {}, {}, empty, prior)


def test_a_prior_season_sums_its_regular_season_weeks_in_the_page_format() -> None:
    catch = {"receptions": 5.0, "receiving_yards": 74.0, "receiving_touchdowns": 0.0, "targets": 9.0}
    score = {"receptions": 9.0, "receiving_yards": 125.0, "receiving_touchdowns": 1.0, "targets": 12.0}
    snaps = {"offensive_snaps": 40.0, "team_offensive_snaps": 50.0}
    s2025 = _store({1: catch, 2: score, 19: score}, {1: snaps, 2: snaps, 19: snaps})
    s2024 = _store({3: catch}, {3: snaps})
    out = prior_seasons("p1", PPR, "WR", _context({2024: s2024, 2025: s2025, 2023: _store({}, {})}))
    assert [season["season"] for season in out] == [2025, 2024]
    newest = out[0]
    assert newest["games"] == 2
    # 5 + 7.4 and 9 + 12.5 + 6: the playoff week 19 is left out.
    assert newest["totals"]["points"] == 39.9
    assert newest["pointsPerGame"] == 20.0
    assert newest["totals"]["receptions"] == 14.0
    assert newest["totals"]["snapShare"] == 0.8
    assert PRIOR_SEASONS == 3
