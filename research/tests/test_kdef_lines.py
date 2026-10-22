"""Kicker and team-defense weekly lines in the shape the API's one stat read takes (Lane 70a).

The mapping from `nflverse_kicking_weeks` and `nflverse_team_defense_weeks` rows to stat line
observations is checked on hand-made rows; the write against a migrated scratch database: keyed so a
defense resolves through the crosswalk to `DST-<abbr>`, stamped as its club's lines that week,
idempotent, and a club-week with no stored line waits. The weekly pass's step is checked for its
place, its verdicts and its report."""

import os
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import cast

import pytest
from sqlalchemy import Connection, Engine, insert, text

from research.db.engine import make_engine
from research.db.schema import (
    NFLVERSE_KICKING_WEEKS,
    NFLVERSE_TEAM_DEFENSE_WEEKS,
    PLAYER_CROSSWALK,
    PLAYER_WEEK_TEAMS,
    PLAYERS,
    PROVIDER_PLAYERS,
)
from research.db.schema.nflverse import KICKING_COLUMNS
from research.db.url import sqlalchemy_url
from research.inseason import season_week
from research.inseason.season_week import KICKING_DEFENSE, STEPS, SeasonWeekContext, run_season_week
from research.parity import databases
from research.pipeline.crosswalk import seed_team_defense_universe
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.client import NflverseClient, NflverseError
from research.pipeline.nflverse.kdef_lines import (
    KDEF_LINE_SOURCE,
    ClubWeek,
    KdefLinesReport,
    KdefRefresh,
    defense_lines,
    ingest_kdef_lines,
    kicking_lines,
)
from research.pipeline.nflverse.kicking_weeks import KickingWeekIngestReport
from research.pipeline.nflverse.participation import NflverseSource
from research.pipeline.nflverse.team_defense_weeks import TeamDefenseWeekIngestReport
from research.pipeline.observations import PlayerWeekObservation

_SEASON = 2026
_STAMP = datetime(2026, 9, 15, tzinfo=UTC)
_LATE_STAMP = datetime(2026, 9, 16, tzinfo=UTC)
_KICKER = "00-0033000"
_DATABASE = "parity_test_kdef_lines"


def _kicking_row(week: int = 1, team: str = "BAL", **counts: int) -> dict[str, object]:
    return {
        "season": _SEASON,
        "week": week,
        "player_id": _KICKER,
        "team": team,
        **dict.fromkeys(KICKING_COLUMNS, 0),
        **counts,
    }


def _defense_row(
    week: int = 1, team: str = "LA", points_allowed: int | None = 17, **counts: float
) -> dict[str, object]:
    base: dict[str, object] = {
        "season": _SEASON,
        "week": week,
        "team": team,
        "opponent_team": "SF",
        "def_sacks": 0.0,
        "def_interceptions": 0,
        "fumble_recovery_opp": 0,
        "def_tds": 0,
        "def_safeties": 0,
        "def_punt_blocks": 0,
        "def_pat_blocks": 0,
        "def_fg_blocks": 0,
        "special_teams_tds": 0,
        "passing_yards_allowed": 0,
        "rushing_yards_allowed": 0,
        "sack_yards_lost_allowed": 0,
        "points_allowed": points_allowed,
    }
    return base | counts


def _values(rows: Sequence[PlayerWeekObservation]) -> dict[str, float]:
    return {row.metric: row.value for row in rows}


_KICKER_EXPECTED = {
    "field_goals_made": 3.0,
    "field_goals_attempted": 4.0,
    "field_goals_missed": 1.0,
    "field_goals_made_40_49": 1.0,
    "field_goals_made_50_59": 1.0,
    "field_goals_made_60_plus": 0.0,
    "field_goals_missed_50_59": 1.0,
    "extra_points_made": 2.0,
    "extra_points_missed": 1.0,
}
_DEFENSE_EXPECTED = {
    "sacks": 3.5,
    "defensive_interceptions": 2.0,
    "defensive_fumbles_recovered": 1.0,
    "defensive_touchdowns": 1.0,
    "return_touchdowns": 1.0,
    "safeties": 1.0,
    "blocked_kicks": 2.0,
    "points_allowed": 17.0,
    # Net yards: the opponent's passing and rushing yards less the yards its passers lost to sacks.
    "yards_allowed": 250.0 + 90.0 - 21.0,
    "passing_yards_allowed": 250.0,
    "sack_yards_lost_allowed": -21.0,
}


def test_a_kickers_week_carries_made_and_missed_by_distance_and_extra_points() -> None:
    row = _kicking_row(
        fg_made=3, fg_att=4, fg_missed=1, fg_made_30_39=1, fg_made_40_49=1, fg_made_50_59=1, fg_missed_50_59=1,
        pat_made=2, pat_att=3, pat_missed=1,
    )  # fmt: skip
    lines = kicking_lines([row], {ClubWeek(1, "BAL"): _STAMP})
    values = _values(lines.observations)
    assert {metric: values[metric] for metric in _KICKER_EXPECTED} == _KICKER_EXPECTED
    assert {(o.player_id, o.season, o.week, o.source, o.as_of) for o in lines.observations} == {
        (_KICKER, _SEASON, 1, KDEF_LINE_SOURCE, _STAMP)
    }
    assert lines.lines == 1
    assert lines.waiting == ()


def test_a_defense_line_is_keyed_to_its_defense_and_carries_the_raw_events() -> None:
    row = _defense_row(
        def_sacks=3.5, def_interceptions=2, fumble_recovery_opp=1, def_tds=1, special_teams_tds=1,
        def_safeties=1, def_punt_blocks=1, def_fg_blocks=1, passing_yards_allowed=250,
        rushing_yards_allowed=90, sack_yards_lost_allowed=-21,
    )  # fmt: skip
    lines = defense_lines([row], {ClubWeek(1, "LAR"): _STAMP})
    values = _values(lines.observations)
    assert {o.player_id for o in lines.observations} == {"team-def:LA"}
    assert {metric: values[metric] for metric in _DEFENSE_EXPECTED} == _DEFENSE_EXPECTED


def test_a_relocated_clubs_old_code_lands_on_todays_defense() -> None:
    lines = defense_lines([_defense_row(team="STL")], {ClubWeek(1, "LAR"): _STAMP})
    assert {o.player_id for o in lines.observations} == {"team-def:LA"}


def test_points_allowed_not_yet_known_is_left_out_never_written_as_zero() -> None:
    lines = defense_lines([_defense_row(points_allowed=None)], {ClubWeek(1, "LAR"): _STAMP})
    assert "points_allowed" not in _values(lines.observations)
    assert "yards_allowed" in _values(lines.observations)


def test_a_club_week_with_no_stored_line_waits() -> None:
    lines = kicking_lines([_kicking_row(week=2)], {ClubWeek(1, "BAL"): _STAMP})
    assert lines.observations == []
    assert lines.lines == 0
    assert lines.waiting == (ClubWeek(2, "BAL"),)


def test_the_lines_are_a_source_of_their_own_never_the_published_weekly_stats() -> None:
    assert KDEF_LINE_SOURCE != NflverseSource.PLAYER_WEEK
    assert KDEF_LINE_SOURCE == "nflverse_kdef_week"


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    try:
        with built.begin() as conn:
            seed_team_defense_universe(conn)
            conn.execute(insert(PLAYERS).values(id=_KICKER, name="A Kicker", position="K", latest_team="BAL"))
            conn.execute(
                insert(PROVIDER_PLAYERS),
                [
                    {"id": "4000", "name": "A Kicker", "position": "K", "team": "BAL"},
                    {"id": "DST-LAR", "name": "Los Angeles Rams", "position": "DEF", "team": "LAR"},
                ],
            )
            conn.execute(
                insert(PLAYER_CROSSWALK),
                [
                    {"provider_player_id": "4000", "player_id": _KICKER, "method": "espn_id", "resolved_at": _STAMP},
                    {"provider_player_id": "DST-LAR", "player_id": "team-def:LA", "method": "team_defense",
                     "resolved_at": _STAMP},
                ],
            )  # fmt: skip
            conn.execute(
                insert(PLAYER_WEEK_TEAMS),
                [
                    {"season": _SEASON, "week": 1, "player_id": _KICKER, "team": "BAL", "as_of": _STAMP},
                    # A second edge stands in for the Rams' lines that week, stamped a day later.
                    {"season": _SEASON, "week": 1, "player_id": _KICKER, "team": "LA", "as_of": _LATE_STAMP},
                ],
            )
            conn.execute(insert(NFLVERSE_KICKING_WEEKS), [_kicking_row(fg_made=2, fg_att=2, fg_made_40_49=2)])
            conn.execute(insert(NFLVERSE_KICKING_WEEKS), [_kicking_row(week=2, pat_made=1, pat_att=1)])
            conn.execute(insert(NFLVERSE_TEAM_DEFENSE_WEEKS), [_defense_row(def_sacks=4.0)])
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def test_the_write_is_stamped_as_the_clubs_lines_and_a_rerun_writes_nothing(engine: Engine) -> None:
    with engine.begin() as conn:
        first = ingest_kdef_lines(conn, _SEASON)
    assert (first.kicker_lines, first.defense_lines) == (1, 1)
    assert first.waiting == 1
    assert first.written > 0
    assert first.by_week == {1: (1, 1)}
    with engine.begin() as conn:
        again = ingest_kdef_lines(conn, _SEASON)
        stamps = set(
            conn.execute(
                text("select distinct as_of from research.player_week_observations where source = :s"),
                {"s": KDEF_LINE_SOURCE},
            ).scalars()
        )
    assert again.written == 0
    assert stamps == {_STAMP, _LATE_STAMP}


def test_a_defense_line_resolves_to_the_leagues_defense_id(engine: Engine) -> None:
    """The API's read: the line's universe id through the crosswalk to the provider id."""
    with engine.begin() as conn:
        ingest_kdef_lines(conn, _SEASON)
        rows = conn.execute(
            text(
                "select c.provider_player_id, pp.position, o.metric, o.value "
                "from research.player_week_observations o "
                "join research.player_crosswalk c on c.player_id = o.player_id "
                "join research.provider_players pp on pp.id = c.provider_player_id "
                "where o.season = :season and o.source = :source and o.metric in ('sacks', 'field_goals_made')"
            ),
            {"season": _SEASON, "source": KDEF_LINE_SOURCE},
        ).all()
    assert {(r.provider_player_id, r.position, r.metric, r.value) for r in rows} == {
        ("DST-LAR", "DEF", "sacks", 4.0),
        ("4000", "K", "field_goals_made", 2.0),
    }


class _Conn:
    def commit(self) -> None:
        return None


class _FakeEngine:
    @contextmanager
    def connect(self) -> Iterator[Connection]:
        yield cast(Connection, _Conn())


def _context(skip: frozenset[str]) -> SeasonWeekContext:
    return SeasonWeekContext(
        cast(Engine, _FakeEngine()), cast(Fetcher, None), datetime(2026, 10, 16, tzinfo=UTC), _SEASON, {}, skip
    )


_ONLY_KDEF = frozenset(STEPS) - {KICKING_DEFENSE}


def test_the_step_sits_after_the_stats_it_stamps_from() -> None:
    assert STEPS.index(KICKING_DEFENSE) > STEPS.index("stats-ingest")
    assert STEPS[-5:] == ("props-snapshot", "grade", "freeze", "espn-fill", "scoreboard")


def test_the_weekly_pass_refreshes_the_tables_then_the_lines_and_reports_each_week(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    refresh = KdefRefresh(
        kicking=KickingWeekIngestReport(_SEASON, 1200, 64, 64, 0),
        defense=TeamDefenseWeekIngestReport(_SEASON, 64, 64, 0, 2),
        lines=KdefLinesReport(
            kicker_lines=64, defense_lines=62, written=1500, waiting=2, by_week={5: (32, 30), 6: (32, 32)}
        ),
    )
    monkeypatch.setattr(season_week, "refresh_kdef_season", lambda conn, client, season: refresh)
    step = next(r for r in run_season_week(_context(_ONLY_KDEF)) if r.step == KICKING_DEFENSE)
    assert step.status == "ok"
    assert step.summary == (
        "2026: kicking weeks 64 written of 64 kicker rows (0 unknown to the universe), team defense weeks 64 "
        "written (0 unpaired, 2 without points allowed), 64 kicker and 62 defense lines, 1500 new observations, "
        "2 club-weeks waiting on their stat lines"
    )
    assert step.detail == ("week 5: 32 kicker lines, 30 defense lines", "week 6: 32 kicker lines, 32 defense lines")


def test_a_rerun_that_writes_nothing_is_skipped_with_its_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    refresh = KdefRefresh(
        kicking=KickingWeekIngestReport(_SEASON, 1200, 64, 0, 0),
        defense=TeamDefenseWeekIngestReport(_SEASON, 64, 0, 0, 0),
        lines=KdefLinesReport(kicker_lines=64, defense_lines=64, written=0, waiting=0, by_week={}),
    )
    monkeypatch.setattr(season_week, "refresh_kdef_season", lambda conn, client, season: refresh)
    step = next(r for r in run_season_week(_context(_ONLY_KDEF)) if r.step == KICKING_DEFENSE)
    assert step.status == "skipped"
    assert step.summary.startswith("nothing new, 2026: ")


def test_a_season_nflverse_has_not_published_is_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    def unpublished(conn: Connection, client: NflverseClient, season: int) -> KdefRefresh:
        raise NflverseError("not_found", "stats_player_week_2026.csv", "no asset")

    monkeypatch.setattr(season_week, "refresh_kdef_season", unpublished)
    step = next(r for r in run_season_week(_context(_ONLY_KDEF)) if r.step == KICKING_DEFENSE)
    assert step.status == "skipped"
    assert step.summary == "nflverse has not published kicking or team stats for 2026 yet (stats_player_week_2026.csv)"
