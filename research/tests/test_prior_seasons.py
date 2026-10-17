"""A player page's earlier seasons (Lane 66h): each summed as this season's block sums its weeks, the
regular season only, newest first, a season he did not play left out."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import Connection

from research.nightly.build import player_season
from research.nightly.build.player_season import (
    PRIOR_SEASONS,
    SeasonContext,
    SeasonStore,
    prior_seasons,
)
from research.nightly.config import RUN_FORMATS
from research.nightly.reads.schedule import Game

NOW = datetime(2026, 10, 17, 12, tzinfo=UTC)

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
    # 5 + 7.4 and 9 + 12.5 + 6: the playoff week 19 is left out.
    summed = {
        "games": newest["games"],
        "points": newest["totals"]["points"],
        "per_game": newest["pointsPerGame"],
        "receptions": newest["totals"]["receptions"],
        "snap_share": newest["totals"]["snapShare"],
    }
    assert summed == {"games": 2, "points": 39.9, "per_game": 20.0, "receptions": 14.0, "snap_share": 0.8}
    assert len(_context({}).prior) < PRIOR_SEASONS


def test_only_the_page_path_reads_the_seasons_before(monkeypatch: pytest.MonkeyPatch) -> None:
    read: list[int] = []

    def store(_conn: Connection, season: int, _ids: object, _as_of: datetime) -> SeasonStore:
        read.append(season)
        return SeasonStore({}, {}, {}, {}, frozenset())

    monkeypatch.setattr(player_season, "read_season_store", store)
    monkeypatch.setattr(
        player_season.schedule_read, "slates_by_club", lambda _conn, _season: {"KC": [Game(1, "BUF", True, NOW)]}
    )
    monkeypatch.setattr(player_season.schedule_read, "clubs_of", lambda _games: [])
    conn = Connection.__new__(Connection)
    writers = player_season.season_context(conn, 2026, ["p1"], NOW)
    assert (writers.prior, read) == ({}, [2026])
    page = player_season.season_context(conn, 2026, ["p1"], NOW, prior=True)
    assert sorted(page.prior) == [2023, 2024, 2025]
