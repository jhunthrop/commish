"""The two records (Lane 114): ESPN's public weekly projection read and kept beside each frozen row,
the weekly record graded from the first week the shipped order was set with ESPN beside it, and the
draft record grading the preseason board against ADP on the season's points so far."""

import json
import os
import re
from collections.abc import Iterator, Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Final

import pytest
from sqlalchemy import Connection, Engine, insert

from research.capsules.site_words import list_file, site_list
from research.db.engine import make_engine
from research.db.schema import (
    ESPN_PROJECTION_ROWS,
    NFLVERSE_GAMES,
    PLAYER_WEEK_OBSERVATIONS,
    PLAYER_WEEK_TEAMS,
    PLAYERS,
    REGISTER_FREEZE_ROWS,
    REGISTER_GRADE_ROWS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.db.url import sqlalchemy_url
from research.errors import SchemaDriftError
from research.inseason import season_week
from research.inseason.season_week import SeasonWeekContext
from research.model.register.freeze import SERVED_SOURCE, SHIPPED_SOURCE, week_espn_read
from research.nightly.build.season import draft_json, weekly_json
from research.nightly.reads import draft_record, weekly_record
from research.nightly.reads.record import Score
from research.nightly.register_log import FrozenBy
from research.parity import databases
from research.pipeline.espn import projections
from research.pipeline.http import HttpResponse

_DATABASE: Final = "parity_test_lane114_records"
_FIRST_SHIPPED: Final = 7
_COUNTED_THROUGH: Final = 2
_SEASON: Final = 2026
_POOL: Final = Path(__file__).parent / "testdata" / "espn" / "pool_2026_w7.json"
# Week 1 (the draft board) and week 2 kick off and end; week 6 is set on the preseason board only;
# week 7 is the first set with the shipped order; week 8 kicks off with nothing set.
_KICKOFFS: Final = {
    1: datetime(2026, 9, 11, 0, 20, tzinfo=UTC),
    2: datetime(2026, 9, 18, 0, 15, tzinfo=UTC),
    6: datetime(2026, 10, 16, 0, 15, tzinfo=UTC),
    7: datetime(2026, 10, 23, 0, 15, tzinfo=UTC),
    8: datetime(2026, 10, 30, 0, 15, tzinfo=UTC),
}
_LAST: Final = {week: kickoff + timedelta(days=4) for week, kickoff in _KICKOFFS.items()}
_DRAFT_SET: Final = datetime(2026, 9, 8, 12, 0, tzinfo=UTC)
_WEEK6_SET: Final = datetime(2026, 10, 13, 12, 0, tzinfo=UTC)
_SET: Final = datetime(2026, 10, 22, 18, 0, tzinfo=UTC)
_GRADED: Final = datetime(2026, 10, 28, 22, 0, tzinfo=UTC)
_RUN: Final = datetime(2026, 10, 31, 9, 0, tzinfo=UTC)
# Four receivers: ours ranks them a, b, c, d and so do the finishes; ADP and ESPN rank them in reverse.
_IDS: Final = ("00-a", "00-b", "00-c", "00-d")
_ESPN_IDS: Final = {"00-a": "11", "00-b": "12", "00-c": "13", "00-d": "14"}
_CATCHES: Final = {"00-a": 10.0, "00-b": 8.0, "00-c": 6.0, "00-d": 4.0}
# Weeks 1 and 2 are one game each, DET at PIT at the week's last kickoff, a and b PIT's, c and d DET's.
# Each club's final and PIT's lines are dated half a day after it; week 2's DET lines land late (Lane
# 250, B254): past the thirty-six hours the draft record once waited, so the week is not complete then.
_CLUBS: Final = {"00-a": "PIT", "00-b": "PIT", "00-c": "DET", "00-d": "DET"}
_COUNTED: Final = (1, 2)
_IN: Final = timedelta(hours=12)
_WEEK2_DET_LINES: Final = _LAST[2] + timedelta(hours=60)


def _lines_dated(week: int, pid: str) -> datetime:
    return _WEEK2_DET_LINES if week == _COUNTED_THROUGH and _CLUBS[pid] == "DET" else _LAST[week] + _IN


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    try:
        with built.begin() as conn:
            _seed(conn)
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _freeze(week: int, at: datetime, source: str, place: int, pid: str) -> dict[str, Any]:
    return {
        "season": _SEASON, "week": week, "frozen_at": at, "board_source": source, "player_id": pid,
        "implementation": "python", "board_as_of": at - timedelta(hours=1), "board_points": 100.0 - place,
        "board_rank": place, "board_value_rank": place, "adp": float(5 - place), "model_version": "m",
        "espn_points": float(place) * 5 if week == _FIRST_SHIPPED else None,
    }  # fmt: skip


def _seed(conn: Connection) -> None:
    conn.execute(
        insert(PLAYERS), [{"id": pid, "name": pid, "position": "WR", "espn_id": _ESPN_IDS[pid]} for pid in _IDS]
    )
    conn.execute(
        insert(TEAM_WEEK_OBSERVATIONS),
        [
            {"season": _SEASON, "week": week, "team": team, "source": "nflverse_kickoff", "metric": "kickoff_instant",
             "value": 1.0, "as_of": at}
            for week in _KICKOFFS
            for team, at in (("PIT", _KICKOFFS[week]), ("DET", _LAST[week]))
        ],
    )  # fmt: skip
    conn.execute(
        insert(PLAYER_WEEK_OBSERVATIONS),
        [
            {"season": _SEASON, "week": week, "player_id": pid, "source": "nflverse_player_week",
             "metric": "receptions", "value": _CATCHES[pid], "as_of": _lines_dated(week, pid)}
            for week in _COUNTED
            for pid in _IDS
        ],
    )  # fmt: skip
    _seed_games(conn)
    rows = [_freeze(1, _DRAFT_SET, SERVED_SOURCE, place, pid) for place, pid in enumerate(_IDS, start=1)]
    rows += [_freeze(6, _WEEK6_SET, SERVED_SOURCE, place, pid) for place, pid in enumerate(_IDS, start=1)]
    for source in (SERVED_SOURCE, SHIPPED_SOURCE):
        rows += [_freeze(7, _SET, source, place, pid) for place, pid in enumerate(_IDS, start=1)]
    conn.execute(insert(REGISTER_FREEZE_ROWS), rows)
    conn.execute(
        insert(REGISTER_GRADE_ROWS),
        [
            {"season": _SEASON, "week": 7, "frozen_at": _SET, "graded_at": _GRADED, "board_source": SHIPPED_SOURCE,
             "player_id": pid, "actual_points": 40.0 - place * 10, "actual_rank": place, "board_rank": place,
             "implementation": "python", "model_version": "m"}
            for place, pid in enumerate(_IDS, start=1)
        ],
    )  # fmt: skip


def _seed_games(conn: Connection) -> None:
    """The game table's one game a counted week, both clubs' finals and each player's club."""
    conn.execute(
        insert(NFLVERSE_GAMES),
        [
            {"season": _SEASON, "week": week, "game_id": f"{_SEASON}_{week:02d}_DET_PIT", "game_type": "REG",
             "gameday": _LAST[week].date(), "kickoff_at": _LAST[week], "home_team": "PIT", "away_team": "DET",
             "location": "Home", "stadium_id": "PIT", "stadium": "PIT", "read_at": _DRAFT_SET}
            for week in _COUNTED
        ],
    )  # fmt: skip
    conn.execute(
        insert(TEAM_WEEK_OBSERVATIONS),
        [
            {"season": _SEASON, "week": week, "team": team, "source": "nflverse_kickoff", "metric": "game_result",
             "value": 1.0, "as_of": _LAST[week] + _IN}
            for week in _COUNTED
            for team in ("PIT", "DET")
        ],
    )  # fmt: skip
    conn.execute(
        insert(PLAYER_WEEK_TEAMS),
        [
            {"season": _SEASON, "week": week, "player_id": pid, "team": _CLUBS[pid], "as_of": _LAST[week] + _IN}
            for week in _COUNTED
            for pid in _IDS
        ],
    )


class _Pool:
    """Answers the player pool's read with the stored week 7 sample, and records what it was asked."""

    def __init__(self, status: int = 200, body: bytes | None = None) -> None:
        self.status = status
        self.body = _POOL.read_bytes() if body is None else body
        self.asked: list[tuple[str, Mapping[str, str] | None]] = []

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        self.asked.append((url, headers))
        return HttpResponse(self.status, self.body)

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        raise AssertionError("the pool is read whole")


def test_the_pool_parses_the_weeks_projection_and_leaves_out_another_seasons() -> None:
    parsed = projections.parse_pool(json.loads(_POOL.read_bytes()), 2026, 7)
    by_id = {p.espn_id: p.ppr_points for p in parsed}
    assert by_id["3117251"] == pytest.approx(21.92636838)  # McCaffrey's 2026 week 7, not his 2025 split
    assert by_id["4379399"] == 0.0  # James Cook on his bye: projected, and projected none
    assert "3116406" not in by_id  # Tyreek Hill: no 2026 split
    assert projections.parse_pool(json.loads(_POOL.read_bytes()), 2026, 8) == []


def test_a_changed_pool_is_refused() -> None:
    with pytest.raises(SchemaDriftError):
        projections.parse_pool({"teams": []}, 2026, 7)
    with pytest.raises(SchemaDriftError):
        projections.parse_pool({"players": [{"player": {"fullName": "no id"}}]}, 2026, 7)


def test_the_read_asks_for_the_weeks_projected_splits_on_ppr_defaults() -> None:
    url, headers = projections.pool_url(2026, 7), projections.pool_headers(7)
    assert "leaguedefaults/3?scoringPeriodId=7&view=kona_player_info" in url
    wanted = json.loads(headers["X-Fantasy-Filter"])["players"]
    assert wanted["filterStatsForSourceIds"]["value"] == [1]
    assert wanted["filterStatsForScoringPeriodIds"]["value"] == [7]


def test_the_pool_filter_carries_a_sort_beside_its_limit() -> None:
    # ESPN answers 400 FILTER_LIMIT_MISSING_SORT to a limit without a sort (checked 2026-10-22).
    wanted = json.loads(projections.pool_headers(7)["X-Fantasy-Filter"])["players"]
    assert "limit" in wanted
    sorts = {key: value for key, value in wanted.items() if key.startswith("sort")}
    assert sorts, "a limit needs a sort"
    assert all(isinstance(value, dict) and "sortPriority" in value for value in sorts.values())


def test_a_read_is_kept_and_the_freeze_takes_the_newest_at_or_before_it(engine: Engine) -> None:
    early, late = _SET - timedelta(hours=30), _SET - timedelta(minutes=30)
    with engine.connect() as conn:
        pool = _Pool()
        read = projections.read_week(conn, pool, _SEASON, 7, early)
        assert (read.listed, read.written, read.published) == (6, 6, True)  # four skill players, a K, a D/ST
        conn.execute(
            insert(ESPN_PROJECTION_ROWS),
            [{"season": _SEASON, "week": 7, "read_at": at, "espn_id": espn, "ppr_points": points}
             for at, espn, points in ((late, "11", 9.5), (_SET + timedelta(minutes=1), "11", 1.0))],
        )  # fmt: skip
        kept = week_espn_read(conn, _SEASON, 7, _SET)
        before = week_espn_read(conn, _SEASON, 7, early - timedelta(seconds=1))
        conn.rollback()
    assert kept.points == {"00-a": 9.5}  # the newest read at or before the freeze, through his ESPN id
    assert kept.read_at == late  # and its instant, which the freeze keeps beside it (Lane 146)
    assert (before.points, before.read_at) == ({}, None)


def test_a_failed_read_raises_and_stores_nothing(engine: Engine) -> None:
    with engine.connect() as conn:
        with pytest.raises(RuntimeError, match="answered 503"):
            projections.read_week(conn, _Pool(status=503), _SEASON, 7, _SET)
        conn.rollback()


def test_the_weekly_record_starts_at_the_first_shipped_week_and_grades_espn_beside_ours(engine: Engine) -> None:
    with engine.connect() as conn:
        weekly, _ = weekly_record.read_weekly(conn, _SEASON, _RUN)
    assert weekly is not None
    assert weekly.from_week == _FIRST_SHIPPED
    seven, eight = weekly.weeks[0], weekly.weeks[1]
    assert (seven.week, seven.status, eight.week, eight.status) == (7, "graded", 8, "missed")
    every = next(line for line in seven.lines if line.position == "All")
    assert every.ours.agreement == pytest.approx(1.0)
    espn = every.yardsticks["espn"]
    assert espn is not None
    assert espn.agreement == pytest.approx(-1.0)
    assert every.yardsticks["published"] is None  # the freeze kept none: no column
    assert weekly_record.drawn(weekly.to_date) == ("espn",)
    assert next((p.ours, p.yardsticks["espn"], p.finish) for p in seven.placed) == (1, 4, 1)
    out = weekly_json(weekly, FrozenBy({}), _SEASON)
    assert out["fromWeek"] == _FIRST_SHIPPED
    assert out["weeks"][0]["lines"][0]["adp"] is None  # ADP is no weekly yardstick
    assert out["toDate"][0]["oursOnEspn"]["agreement"] == 1.0
    assert out["method"].endswith("beside ESPN's projection on the same players.")
    assert out["weeks"][1]["note"] == weekly_record.MISSED_NOTE
    # Lane 235: the run's own sentences, scanned as written, never a weekly claim.
    written = [out["method"], out["weeks"][1]["note"], out["startersBasis"], out["honest"]]
    assert all("weekly" not in sentence.lower() for sentence in written if sentence is not None)


def test_before_any_shipped_week_the_weekly_record_starts_at_the_next_week_to_set(engine: Engine) -> None:
    with engine.connect() as conn:
        conn.execute(REGISTER_FREEZE_ROWS.delete().where(REGISTER_FREEZE_ROWS.c.board_source == SHIPPED_SOURCE))
        weekly, _ = weekly_record.read_weekly(conn, _SEASON, _WEEK6_SET + timedelta(days=4))
        conn.rollback()
    assert weekly is not None
    assert (weekly.from_week, weekly.weeks[0].status, weekly.weeks[0].at) == (7, "upcoming", _KICKOFFS[7])
    assert weekly.to_date == ()


def test_the_draft_record_grades_the_first_freeze_on_the_complete_weeks(engine: Engine) -> None:
    with engine.connect() as conn:
        mid_week_two = draft_record.read_draft(conn, _SEASON, _LAST[2] + timedelta(hours=36))
        draft = draft_record.read_draft(conn, _SEASON, _RUN)
    assert mid_week_two is not None
    assert draft is not None
    assert (mid_week_two.through_week, draft.through_week) == (1, 2)
    assert draft.set_at == _DRAFT_SET  # the board drafted from, not a later week's freeze
    every = next(line for line in draft.lines if line.position == "All")
    assert (every.ours.graded, every.ours.agreement, every.adp.agreement) == (4, 1.0, -1.0)
    assert [(p.week, p.ours, p.adp) for p in draft.progress] == [(1, 1.0, -1.0), (2, 1.0, -1.0)]
    out = draft_json(draft)
    assert out["throughWeek"] == _COUNTED_THROUGH
    assert out["honest"] is None  # ours led on every figure
    assert out["namedBasis"] == (
        "Top named counts how many of the season's top 36 WRs so far the order also ranked that high."
    )


def test_a_week_counts_for_the_draft_record_once_every_games_stats_are_in(engine: Engine) -> None:
    """Lane 250 (B254): the grade's completeness, not thirty-six hours after the last kickoff. Week 2
    at 36 hours has DET's lines missing, so it is not counted; the minute they land it is."""
    at_36h = _LAST[2] + timedelta(hours=36)
    with engine.connect() as conn:
        waiting = draft_record.complete_weeks(conn, _SEASON, at_36h)
        landed = draft_record.complete_weeks(conn, _SEASON, _WEEK2_DET_LINES)
        before = draft_record.complete_weeks(conn, _SEASON, _WEEK2_DET_LINES - timedelta(minutes=1))
        first_lines = draft_record.complete_weeks(conn, _SEASON, _LAST[1] + _IN - timedelta(minutes=1))
    assert (waiting, before, landed) == ([1], [1], [1, 2])
    assert first_lines == []


def test_a_later_week_never_counts_past_one_still_waiting(engine: Engine) -> None:
    """Through week N counts every week to N: week 1 missing its DET lines holds week 2 out too."""
    with engine.connect() as conn:
        conn.execute(
            PLAYER_WEEK_OBSERVATIONS.delete().where(
                PLAYER_WEEK_OBSERVATIONS.c.week == 1, PLAYER_WEEK_OBSERVATIONS.c.player_id.in_(("00-c", "00-d"))
            )
        )
        held = draft_record.complete_weeks(conn, _SEASON, _RUN)
        conn.rollback()
    assert held == []


def test_no_draft_record_before_the_first_freeze(engine: Engine) -> None:
    with engine.connect() as conn:
        conn.execute(REGISTER_FREEZE_ROWS.delete())
        nothing = draft_record.read_draft(conn, _SEASON, _RUN)
        conn.rollback()
    assert nothing is None


def test_the_in_season_pass_reads_espn_for_the_week_it_sets_next(engine: Engine) -> None:
    pool = _Pool()
    step = season_week.espn_projections_step(SeasonWeekContext(engine, pool, _SET - timedelta(hours=1), _SEASON, {}))
    with engine.begin() as conn:
        kept = conn.execute(ESPN_PROJECTION_ROWS.delete().returning(ESPN_PROJECTION_ROWS.c.week)).scalars().all()
    assert (step.step, step.status) == (season_week.ESPN_PROJECTIONS, "ok")
    assert "scoringPeriodId=7" in pool.asked[0][0]
    assert set(kept) == {7}
    assert season_week.STEPS.index(season_week.ESPN_PROJECTIONS) < season_week.STEPS.index("freeze")
    after = SeasonWeekContext(engine, _Pool(), _RUN + timedelta(days=200), _SEASON, {})
    assert season_week.espn_projections_step(after).status == "skipped"


def test_the_weekly_honest_line_says_where_espn_called_the_weeks_better() -> None:
    ours = Score(100, 0.4, 30.0, 50, 84)
    espn = Score(100, 0.5, 31.0, 52, 84)
    line = weekly_record.WeeklyLine("All", ours, {"espn": espn, "published": None}, {"espn": ours, "published": None})
    assert weekly_record.honest_line([line]) == (
        "ESPN's order matched the finish better, 0.50 against our 0.40. "
        "ESPN had more of the week's starters right in the standard lineup, 52 of 84 against our 50."
    )
    assert weekly_record.method(_FIRST_SHIPPED, [line]) == (
        "From week 7 we set our rest-of-season order before each week's first kickoff and graded it on the week's "
        "points, beside ESPN's projection on the same players."
    )
    assert weekly_record.method(_FIRST_SHIPPED, []) == (
        "From week 7 we set our rest-of-season order before each week's first kickoff and graded it on the week's "
        "points."
    )


_LEADS: Final = Score(100, 0.4, 30.0, 50, 84)
_BETTER: Final = Score(100, 0.5, 28.0, 52, 84)
_ESPN_CALLED_BETTER: Final = (
    "ESPN's order matched the finish better, 0.50 against our 0.40. "
    "ESPN put a typical player closer to his finish, 28.0 places off against our 30.0. "
    "ESPN had more of the week's starters right in the standard lineup, 52 of 84 against our 50."
)
_PUBLISHED_CALLED_BETTER: Final = (
    "The published projection's order matched the finish better, 0.50 against our 0.40. "
    "The published projection put a typical player closer to his finish, 28.0 places off against our 30.0. "
    "The published projection had more of the week's starters right in the standard lineup, 52 of 84 against "
    "our 50."
)
_METHOD_STEM: Final = (
    "From week 7 we set our rest-of-season order before each week's first kickoff and graded it on the week's points"
)
# The names the run never prints: the projection provider and the rival products (ESPN is the yardstick
# the record names by the site's own rule).
_UNNAMED: Final = re.compile(r"\b(?:tank01|tank|rapidapi|fantasypros|sleeper|yahoo|underdog|flock)\b", re.IGNORECASE)


def _line(position: str, espn: Score | None, published: Score | None) -> weekly_record.WeeklyLine:
    ours_on = {"espn": _LEADS if espn else None, "published": _LEADS if published else None}
    return weekly_record.WeeklyLine(position, _LEADS, {"espn": espn, "published": published}, ours_on)


def _every_sentence() -> dict[str, str | None]:
    """Every sentence the weekly record writes, each in each of its forms."""
    espn = [_line(position, _BETTER, None) for position in ("All", "QB", "RB", "WR", "TE")]
    both = [_line(position, _BETTER, _BETTER) for position in ("All", "QB", "RB", "WR", "TE")]
    behind = [_line("All", _LEADS, _LEADS)]
    return {
        "missed": weekly_record.MISSED_NOTE,
        "espn read after": weekly_record.ESPN_READ_AFTER_NOTE,
        "espn unread": weekly_record.ESPN_UNREAD_NOTE,
        "no yardstick": weekly_record.NO_YARDSTICK_NOTE,
        "method alone": weekly_record.method(_FIRST_SHIPPED, []),
        "method espn": weekly_record.method(_FIRST_SHIPPED, espn),
        "method both": weekly_record.method(_FIRST_SHIPPED, both),
        "honest espn": weekly_record.honest_line(espn),
        "honest both": weekly_record.honest_line(both),
        "honest none": weekly_record.honest_line(behind),
        "starters basis": weekly_record.starters_basis(both),
    }


def test_the_weekly_record_names_its_order_as_the_rest_of_season_order_never_weekly_rankings() -> None:
    """Lane 235, B222: the run's sentences are printed as written, so the writer never claims a weekly
    model; the order graded is our rest-of-season order, graded week by week. Every sentence the writer
    can produce, word for word, then each scanned for a weekly claim, the site's banned words and marks
    (shared/words/banned-words.json) and a name the run never prints."""
    assert _every_sentence() == {
        "missed": "Our rest-of-season order was not set before kickoff that week.",
        "espn read after": (
            "ESPN's projection this week was read after our rest-of-season order was set, still before the first "
            "kickoff."
        ),
        "espn unread": (
            "ESPN's projection was not read before this week's first kickoff, so the week is graded against the "
            "week's published projection alone."
        ),
        "no yardstick": (
            "No yardstick was read before this week's first kickoff, so the week is graded on its own order alone."
        ),
        "method alone": f"{_METHOD_STEM}.",
        "method espn": f"{_METHOD_STEM}, beside ESPN's projection on the same players.",
        "method both": (
            f"{_METHOD_STEM}, beside ESPN's projection and the week's published projection on the same players."
        ),
        "honest espn": _ESPN_CALLED_BETTER,
        "honest both": f"{_ESPN_CALLED_BETTER} {_PUBLISHED_CALLED_BETTER}",
        "honest none": None,
        "starters basis": (
            "Starters right counts a standard 12-team lineup, the week's top 12 QBs, 24 RBs, 36 WRs and 12 TEs, "
            "and how many of them the order also put there."
        ),
    }
    banned, _ = site_list(list_file())
    for sentence in (text for text in _every_sentence().values() if text is not None):
        assert re.search(r"\bweekly\b", sentence, re.IGNORECASE) is None, sentence
        assert banned.search(sentence) is None, sentence  # betting, trading, host, the em dash and its kin
        assert _UNNAMED.search(sentence) is None, sentence


def test_the_draft_all_line_combines_the_positions_and_never_pools_raw_points() -> None:
    """Review H1: quarterbacks out-project receivers on raw points, ADP's pick order does not. Within
    each position ADP called the finish and our board reversed it, so the All line must say ADP led,
    however our raw points line up across positions."""
    board = [
        {"player_id": "q1", "position": "QB", "board_points": 300.0, "adp": 20.0},
        {"player_id": "q2", "position": "QB", "board_points": 290.0, "adp": 10.0},
        {"player_id": "w1", "position": "WR", "board_points": 190.0, "adp": 1.0},
        {"player_id": "w2", "position": "WR", "board_points": 200.0, "adp": 2.0},
        {"player_id": "w3", "position": "WR", "board_points": 210.0, "adp": 3.0},
    ]
    totals = {"q1": 60.0, "q2": 90.0, "w1": 80.0, "w2": 70.0, "w3": 50.0}
    every, *positions = draft_record.lines_for(board, totals)
    assert [line.position for line in positions] == ["QB", "WR"]
    assert all(line.ours.agreement == -1.0 and line.adp.agreement == 1.0 for line in positions)
    assert (every.position, every.ours.graded) == ("All", len(board))
    assert (every.ours.agreement, every.adp.agreement) == (-1.0, 1.0)
    # Places off weighted by players graded: QB 1.0 over two players, WR 4/3 over three.
    assert every.ours.places_off == pytest.approx((1.0 * 2 + (4 / 3) * 3) / len(board))
    assert every.adp.places_off == 0.0
