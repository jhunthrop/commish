"""Lane 156, the weekly kicker and team-defense sub-round's data (Amendment 7 items 3 and 9 of the round
4 preregistration): the play table's kick columns and their one-time fill, ESPN's archived K and D/ST
projections and their components, the D/ST ESPN ids on the synthetic defense rows, the K and D/ST rows of
the ESPN pool fixture, and the input rule's three new read kinds, through which a week-W kicking row and a
week-W `points_allowed` are refused with `InputRuleError`."""

import json
import os
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Final

import pytest
from sqlalchemy import Connection, Engine, func, insert, select, text, update

from research.db.engine import make_engine
from research.db.schema import (
    ESPN_KDEF_ARCHIVE_ROWS,
    ESPN_PROJECTION_ROWS,
    NFLVERSE_KICKING_WEEKS,
    NFLVERSE_PBP_PLAYS,
    NFLVERSE_TEAM_DEFENSE_WEEKS,
    PLAYER_WEEK_OBSERVATIONS,
    PLAYERS,
)
from research.db.schema.nflverse import DEFENSE_COUNT_COLUMNS, KICKING_COLUMNS
from research.db.url import sqlalchemy_url
from research.errors import SchemaDriftError
from research.model.weekly3 import ledger
from research.model.weekly3.ledger import InputRuleError, ReadKind
from research.model.weekly4.features import admitted, kdef_weeks
from research.model.weekly4.features.admitted import (
    ADMITTED,
    DEFENSE_WEEKS,
    KICKING_WEEKS,
    PLAYS,
    Pair,
    admit_read,
)
from research.model.weekly4.features.charted import wednesday_pass_after
from research.parity import databases
from research.pipeline.crosswalk import seed_team_defense_universe
from research.pipeline.espn import kdef_archive, projections
from research.pipeline.http import HttpResponse
from research.pipeline.nflverse import pbp_plays
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.kdef_lines import KDEF_LINE_SOURCE
from research.pipeline.nflverse.team_codes import (
    ESPN_PRO_TEAM_IDS,
    is_defense_id,
    team_defense_espn_id,
    team_defense_universe_ids,
)
from research.tests.nflverse_fixtures import FixtureFetcher, fixture_rows

_POOL: Final = Path(__file__).parent / "testdata" / "espn" / "pool_2026_w7.json"
_PLAYS_FILE: Final = "play_by_play_2022.csv.gz"
_DATABASE: Final = "parity_test_lane156"
_NEW_KINDS: Final[tuple[ReadKind, ...]] = ("kicking", "team_defense", "kicks")
_AUBREY: Final = "3953687"
_SEAHAWKS: Final = "-16026"
_KICKER: Final = "00-0033000"
# Week 7 of 2023: Thursday night's kickoff, and the instant one millisecond before it.
_KICKOFF: Final = datetime(2023, 10, 20, 0, 15, tzinfo=UTC)
_T: Final = _KICKOFF - timedelta(milliseconds=1)
_READ_AT: Final = datetime(2026, 10, 23, 15, 0, tzinfo=UTC)
_EXTRA_POINT_YARDS: Final = 33
_BARE_TOTAL: Final = 5.0
_CLUBS: Final = 32
_GOAL: Final = ("2022_03_CIN_NYJ", 657)
_ARCHIVED_SEASON: Final = 2024
_WEEK: Final = 7
_KICKS_WEEK: Final = 4


# The play table's kick columns.


def _plays() -> pbp_plays.PlayRows:
    rows = pbp_plays.PlayRows()
    for row in fixture_rows(_PLAYS_FILE):
        rows.add(row)
    return rows


def _by_play() -> dict[tuple[str, int], dict[str, object]]:
    return {(str(r["game_id"]), int(str(r["play_id"]))): r for r in _plays().rows}


def test_a_field_goal_carries_its_distance_result_and_kicker() -> None:
    goal = _by_play()[_GOAL]
    assert (goal["kick_distance"], goal["field_goal_result"], goal["kicker_player_id"]) == (50, "made", "00-0029621")
    assert goal["extra_point_result"] is None and goal["two_point_conv_result"] is None


def test_an_extra_point_and_a_touchdown_carry_their_columns() -> None:
    plays = _by_play()
    assert plays[("2022_01_PHI_DET", 312)]["extra_point_result"] == "good"
    assert plays[("2022_01_PHI_DET", 312)]["kick_distance"] == _EXTRA_POINT_YARDS
    touchdown = plays[("2022_01_PHI_DET", 288)]
    assert touchdown["td_team"] == "DET" and touchdown["return_touchdown"] is False and touchdown["safety"] is False


def test_every_kick_column_is_read_from_the_file_and_declared_last() -> None:
    names = [c.name for c in NFLVERSE_PBP_PLAYS.columns]
    assert names[-len(pbp_plays.KICK_COLUMNS) :] == list(pbp_plays.KICK_COLUMNS)
    assert set(pbp_plays.KICK_COLUMNS) <= set(pbp_plays.STREAM_COLUMNS)


def _a_play(**changes: str) -> dict[str, str]:
    base = next(r for r in fixture_rows(_PLAYS_FILE) if r["game_id"] == "2022_03_CIN_NYJ" and r["play_id"] == "657")
    return {**base, **changes}


@pytest.mark.parametrize(
    ("column", "word"),
    [("field_goal_result", "good"), ("extra_point_result", "made"), ("two_point_conv_result", "converted")],
)
def test_a_result_outside_its_vocabulary_is_refused(column: str, word: str) -> None:
    with pytest.raises(SchemaDriftError, match=column):
        pbp_plays.map_play(_a_play(**{column: word}))


def test_a_fractional_kick_distance_is_refused() -> None:
    with pytest.raises(SchemaDriftError, match="kick_distance"):
        pbp_plays.map_play(_a_play(kick_distance="50.5"))


# ESPN's archived K and D/ST projections, and the pool fixture's K and D/ST rows.


def _pool() -> object:
    return json.loads(_POOL.read_bytes())


def test_the_live_pool_keeps_a_kicker_and_a_dst_beside_the_skill_players() -> None:
    by_id = {p.espn_id: p.ppr_points for p in projections.parse_pool(_pool(), 2026, 7)}
    assert by_id[_AUBREY] == pytest.approx(8.15622939)
    assert by_id[_SEAHAWKS] == pytest.approx(4.82694327)
    assert by_id["3117251"] == pytest.approx(21.92636838)  # the skill rows unchanged


def test_the_archive_parse_keeps_only_kickers_and_dst_with_their_components() -> None:
    parsed = {p.espn_id: p for p in kdef_archive.parse_archive(_pool(), 2026, 7)}
    assert set(parsed) == {_AUBREY, _SEAHAWKS}
    kicker, defense = parsed[_AUBREY], parsed[_SEAHAWKS]
    assert (kicker.position, defense.position) == ("K", "DEF")
    assert kicker.applied_total == pytest.approx(8.15622939)
    k = kdef_archive.components("K", kicker.stats)
    assert k["fg_made"] == pytest.approx(k["fg_made_0_39"] + k["fg_made_40_49"] + k["fg_made_50_plus"])
    assert k["fg_attempted"] == pytest.approx(k["fg_made"] + k["fg_missed"])
    d = kdef_archive.components("DEF", defense.stats)
    bands = [v for name, v in d.items() if name.startswith("points_allowed_")]
    assert sum(bands) == pytest.approx(1.0, abs=1e-6)
    yards = [v for name, v in d.items() if name.startswith("yards_allowed_")]
    assert sum(yards) == pytest.approx(1.0, abs=1e-6)
    assert {"sacks", "interceptions", "fumble_recoveries", "points_allowed", "yards_allowed"} <= set(d)


def test_espns_total_re_scores_from_the_dst_components_under_its_defaults() -> None:
    """The mapping is ESPN's: its own defaults (sack 1, takeaway, block and safety 2, touchdown 6, the
    points-allowed bands 5/4/3/1/0/0/-1/-3/-5 and the yards bands 5/3/2/0/-1/-3/-5/-6/-7) applied to the
    mapped components give back its total."""
    defense = next(p for p in kdef_archive.parse_archive(_pool(), 2026, 7) if p.position == "DEF")
    d = kdef_archive.components("DEF", defense.stats)
    points = (
        d["sacks"]
        + 2 * (d["interceptions"] + d["fumble_recoveries"] + d["blocked_kicks"] + d["safeties"])
        + 6
        * (
            d["defensive_touchdowns"]
            + d["blocked_kick_return_touchdowns"]
            + d["kickoff_return_touchdowns"]
            + d["punt_return_touchdowns"]
        )
    )
    pa = (5, 4, 3, 1, 0, 0, -1, -3, -5)
    pa_names = ("0", "1_6", "7_13", "14_17", "18_21", "22_27", "28_34", "35_45", "46_plus")
    ya = (5, 3, 2, 0, -1, -3, -5, -6, -7)
    ya_names = ("0_99", "100_199", "200_299", "300_349", "350_399", "400_449", "450_499", "500_549", "550_plus")
    points += sum(w * d.get(f"points_allowed_{n}", 0.0) for w, n in zip(pa, pa_names, strict=True))
    points += sum(w * d.get(f"yards_allowed_{n}", 0.0) for w, n in zip(ya, ya_names, strict=True))
    assert points == pytest.approx(defense.applied_total, abs=0.01)


def test_a_changed_archive_answer_is_refused() -> None:
    with pytest.raises(SchemaDriftError):
        kdef_archive.parse_archive({"teams": []}, 2024, 8)
    foreign = {"players": [{"player": {"id": -16031, "defaultPositionId": 16, "stats": [_split(2024, 8)]}}]}
    with pytest.raises(SchemaDriftError, match="D/ST id space"):
        kdef_archive.parse_archive(foreign, 2024, 8)
    malformed = {"players": [{"player": {"id": 1, "defaultPositionId": 5, "stats": [_split(2024, 8, "x")]}}]}
    with pytest.raises(SchemaDriftError, match="malformed stats"):
        kdef_archive.parse_archive(malformed, 2024, 8)


def _split(season: int, week: int, value: object = 1.0) -> dict[str, object]:
    return {
        "appliedTotal": 5.0,
        "seasonId": season,
        "scoringPeriodId": week,
        "statSourceId": 1,
        "statSplitTypeId": 1,
        "stats": {"83": value},
    }


def test_a_split_with_no_components_keeps_its_total() -> None:
    bare = {
        "players": [{"player": {"id": -16026, "defaultPositionId": 16, "stats": [{**_split(2023, 1), "stats": {}}]}}]
    }
    (only,) = kdef_archive.parse_archive(bare, 2023, 1)
    assert only.applied_total == _BARE_TOTAL and only.stats == {}
    assert kdef_archive.components("DEF", only.stats) == {}


def test_the_archive_asks_for_the_kicker_and_dst_slots_on_the_live_reads_url() -> None:
    headers = kdef_archive.archive_headers(8)
    wanted = json.loads(headers["X-Fantasy-Filter"])["players"]
    assert wanted["filterSlotIds"] == {"value": [17, 16]}
    assert wanted["filterStatsForScoringPeriodIds"] == {"value": [8]}
    assert "sortPercOwned" in wanted


class _Answer:
    def __init__(self, body: bytes) -> None:
        self.body = body
        self.asked: list[str] = []

    def get(self, url: str, headers: Mapping[str, str] | None = None) -> HttpResponse:
        self.asked.append(url)
        return HttpResponse(200, self.body)

    def stream(self, url: str, headers: Mapping[str, str] | None = None) -> tuple[int, Iterator[bytes]]:
        raise AssertionError("the pool is read whole")


def test_a_season_outside_the_judged_two_is_refused_before_any_request() -> None:
    fetcher = _Answer(b"{}")
    for season in (2022, 2025, 2026):
        with pytest.raises(ValueError, match="judged seasons"):
            kdef_archive.read_archive_week(None, fetcher, season, 8, _READ_AT)  # type: ignore[arg-type]
    assert fetcher.asked == []


# The D/ST ESPN ids.


def test_each_club_has_its_dst_espn_id_in_nflverses_spelling() -> None:
    assert team_defense_espn_id("SEA") == _SEAHAWKS
    assert team_defense_espn_id("LA") == "-16014"  # the Rams, LAR to the product
    assert team_defense_espn_id("WAS") == "-16028"
    assert team_defense_espn_id("OAK") == "-16013"  # a historical spelling folds onto today's club
    ids = {team_defense_espn_id(u.removeprefix("team-def:")) for u in team_defense_universe_ids()}
    assert len(ids) == len(ESPN_PRO_TEAM_IDS) == _CLUBS
    assert all(is_defense_id(i) for i in ids) and not is_defense_id(_AUBREY)


# The input rule's new kinds.


def _row(table: str, week: int, as_of: datetime = _T - timedelta(days=2)) -> kdef_weeks.StampedRow:
    return kdef_weeks.StampedRow(table, 2023, week, as_of, {})


def test_every_new_kind_has_its_list_and_none_admits_the_kickoffs_outcomes() -> None:
    for kind in _NEW_KINDS:
        assert ADMITTED[kind]
        assert ("nflverse_kickoff", "points_allowed") not in ADMITTED[kind]
        assert ("nflverse_kickoff", "game_result") not in ADMITTED[kind]
    assert (DEFENSE_WEEKS, "points_allowed") in ADMITTED["team_defense"]
    assert (KDEF_LINE_SOURCE, "points_allowed") in ADMITTED["team_defense"]
    assert (KICKING_WEEKS, "fg_made_50_59") in ADMITTED["kicking"]
    assert (PLAYS, "kick_distance") in ADMITTED["kicks"]


@dataclass(frozen=True)
class _Guard:
    """One guard case: a week-W row fed through one new kind with the pair it carries. `own` is a case
    whose pair the kind's list admits, so only the week and stamp rule refuses it; every other case is
    refused by the allow-list first."""

    name: str
    kind: ReadKind
    pair: Pair
    own: bool


# A week-W kicking row (the table's and the live line's), a week-W points allowed (the table's, the live
# line's, the kickoff's), and the kick play's own week-W pair, each through each new kind.
_WEEK_W_PAIRS: Final[tuple[tuple[str, Pair], ...]] = (
    ("kicking-row", (KICKING_WEEKS, "fg_made")),
    ("kicking-line", (KDEF_LINE_SOURCE, "field_goals_made")),
    ("points-allowed-row", (DEFENSE_WEEKS, "points_allowed")),
    ("points-allowed-line", (KDEF_LINE_SOURCE, "points_allowed")),
    ("points-allowed-kickoff", ("nflverse_kickoff", "points_allowed")),
    ("kick-play", (PLAYS, "field_goal_result")),
)
_GUARDS: Final = tuple(
    _Guard(f"{name}-through-{kind}", kind, pair, pair in ADMITTED[kind])
    for kind in _NEW_KINDS
    for name, pair in _WEEK_W_PAIRS
)
_AS_OFS: Final = (_T - timedelta(days=3), _T, _KICKOFF + timedelta(hours=30))


def _feed(guard: _Guard, as_of: datetime) -> None:
    admit_read(guard.kind, [guard.pair], [_row(guard.pair[0], 7, as_of)], 2023, 7, _T)


def _rule_off(monkeypatch: pytest.MonkeyPatch, kind: ReadKind, *, allow_list: bool) -> None:
    """The mutation: the week and stamp rule switched off for one kind, and with `allow_list` its list too."""
    rule = ledger._row_breaks
    monkeypatch.setattr(ledger, "_row_breaks", lambda k, *a: None if k == kind else rule(k, *a))
    if allow_list:
        refused = admitted.refused_pairs
        monkeypatch.setattr(admitted, "refused_pairs", lambda k, p: [] if k == kind else refused(k, p))


def test_every_new_kind_has_an_own_week_w_case() -> None:
    assert {g.kind for g in _GUARDS if g.own} == set(_NEW_KINDS)


@pytest.mark.parametrize("guard", _GUARDS, ids=lambda g: g.name)
def test_a_week_w_row_is_refused_through_every_new_kind(guard: _Guard) -> None:
    for as_of in _AS_OFS:
        with pytest.raises(InputRuleError, match=None if guard.own else "allow-list refuses"):
            _feed(guard, as_of)


@pytest.mark.parametrize("guard", _GUARDS, ids=lambda g: g.name)
def test_each_guard_case_fails_once_its_kinds_rule_is_off(guard: _Guard, monkeypatch: pytest.MonkeyPatch) -> None:
    """The guard proves itself: with the rule off for its kind alone it admits the row (so the case above
    would fail), and the rule of every other kind still refuses it."""
    _rule_off(monkeypatch, guard.kind, allow_list=not guard.own)
    for as_of in _AS_OFS:
        _feed(guard, as_of)
        for other in _NEW_KINDS:
            if other != guard.kind:
                with pytest.raises(InputRuleError):
                    _feed(_Guard(guard.name, other, guard.pair, own=False), as_of)


@pytest.mark.parametrize("guard", [g for g in _GUARDS if g.own], ids=lambda g: g.name)
def test_an_own_case_is_held_by_the_week_rule_not_the_list(guard: _Guard, monkeypatch: pytest.MonkeyPatch) -> None:
    refused = admitted.refused_pairs
    monkeypatch.setattr(admitted, "refused_pairs", lambda k, p: [] if k == guard.kind else refused(k, p))
    for as_of in _AS_OFS:
        with pytest.raises(InputRuleError, match="input rule refuses"):
            _feed(guard, as_of)


def test_an_earlier_weeks_rows_are_admitted_by_their_own_kind() -> None:
    assert admit_read("kicking", [(KICKING_WEEKS, "fg_made")], [_row(KICKING_WEEKS, 6)], 2023, 7, _T).rows == 1
    stamp = admit_read("team_defense", [(DEFENSE_WEEKS, "points_allowed")], [_row(DEFENSE_WEEKS, 6)], 2023, 7, _T)
    assert stamp.rows == 1
    assert admit_read("kicks", [(PLAYS, "field_goal_result")], [_row(PLAYS, 6)], 2023, 7, _T).rows == 1
    with pytest.raises(InputRuleError, match="allow-list refuses"):
        admit_read("kicking", [(DEFENSE_WEEKS, "points_allowed")], [_row(DEFENSE_WEEKS, 6)], 2023, 7, _T)


def test_a_week_row_is_stamped_at_the_wednesday_pass_after_its_week() -> None:
    passes = {5: wednesday_pass_after(datetime(2023, 10, 10, 0, 15, tzinfo=UTC)), 6: _T + timedelta(hours=1)}
    rows = [kdef_weeks.WeekRow(KICKING_WEEKS, 2023, week, {}) for week in (5, 6)]
    admitted = kdef_weeks.restamp_weeks(rows, passes, _T)
    assert [(r.week, r.as_of) for r in admitted] == [(5, passes[5])]  # week 6's pass is after t_g
    assert passes[5] == datetime(2023, 10, 11, 22, 0, tzinfo=UTC)  # Wednesday 18:00 New York
    with pytest.raises(InputRuleError, match="no kickoff"):
        kdef_weeks.restamp_weeks([kdef_weeks.WeekRow(KICKING_WEEKS, 2023, 4, {})], passes, _T)


# The database-backed reads and writes.


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def _clear(conn: Connection) -> None:
    conn.execute(
        text(
            "truncate research.nflverse_pbp_plays, research.espn_kdef_archive_rows, research.espn_projection_rows, "
            "research.nflverse_kicking_weeks, research.nflverse_team_defense_weeks, "
            "research.player_week_observations, research.players cascade"
        )
    )


def test_a_stored_plays_empty_kick_columns_are_filled_once_and_never_rewritten(engine: Engine) -> None:
    client = NflverseClient(FixtureFetcher())
    with engine.begin() as conn:
        _clear(conn)
        first = pbp_plays.ingest_pbp_plays(conn, client, 2022)
        # As a play stored before revision 0020 holds them, and one stored value that differs.
        conn.execute(update(NFLVERSE_PBP_PLAYS).values(dict.fromkeys(pbp_plays.KICK_COLUMNS)))
        play = NFLVERSE_PBP_PLAYS.c
        conn.execute(
            update(NFLVERSE_PBP_PLAYS)
            .where(play.game_id == _GOAL[0], play.play_id == _GOAL[1])
            .values(kick_distance=49)
        )
        filled = pbp_plays.ingest_pbp_plays(conn, client, 2022)
        again = pbp_plays.ingest_pbp_plays(conn, client, 2022)
        goal = conn.execute(
            select(play.kick_distance, play.field_goal_result).where(play.game_id == _GOAL[0], play.play_id == _GOAL[1])
        ).one()
        with_kicks = conn.execute(
            select(func.count()).where(
                play.kick_distance.is_not(None) | play.td_team.is_not(None) | play.safety.is_not(None)
            )
        ).scalar_one()
    assert first.written == first.plays
    assert 0 < filled.written == with_kicks and again.written == 0
    assert tuple(goal) == (49, "made")  # the stored distance kept, the empty result filled


def test_the_archive_is_stored_once_with_its_stamp_caveat(engine: Engine) -> None:
    body = _POOL.read_bytes().replace(b'"seasonId": 2026', b'"seasonId": 2024')
    fetcher = _Answer(body)
    with engine.begin() as conn:
        _clear(conn)
        week = kdef_archive.read_archive_week(conn, fetcher, 2024, 7, _READ_AT)
        again = kdef_archive.read_archive_week(conn, fetcher, 2024, 7, _READ_AT)
        rows = conn.execute(select(ESPN_KDEF_ARCHIVE_ROWS).order_by(ESPN_KDEF_ARCHIVE_ROWS.c.espn_id)).mappings().all()
        held = kdef_archive.archived_weeks(conn)
    assert (week.kickers, week.defenses, week.written, again.written) == (1, 1, 2, 0)
    assert {r["espn_id"]: r["position"] for r in rows} == {_SEAHAWKS: "DEF", _AUBREY: "K"}
    assert {r["stamp"] for r in rows} == {kdef_archive.ARCHIVE_STAMP}
    assert all(r["read_at"] == _READ_AT and r["season"] == _ARCHIVED_SEASON for r in rows)
    assert held == frozenset({(2024, 7)})


def test_the_defense_rows_take_their_espn_ids_and_join_espns_projection(engine: Engine) -> None:
    with engine.begin() as conn:
        _clear(conn)
        conn.execute(insert(PLAYERS).values(id="team-def:SEA", name="team-def:SEA", position="DEF", latest_team="SEA"))
        filled = seed_team_defense_universe(conn)
        again = seed_team_defense_universe(conn)
        conn.execute(
            insert(ESPN_PROJECTION_ROWS).values(
                season=2026, week=7, read_at=_READ_AT, espn_id=_SEAHAWKS, ppr_points=4.8
            )
        )
        joined = (
            conn.execute(
                text(
                    "select p.id from research.espn_projection_rows r join research.players p on p.espn_id = r.espn_id"
                )
            )
            .scalars()
            .all()
        )
        ids = conn.execute(select(func.count()).where(PLAYERS.c.espn_id.like("-160%"))).scalar_one()
    assert (filled, again, ids) == (32, 0, 32)
    assert joined == ["team-def:SEA"]


def _kicking(week: int) -> dict[str, object]:
    return {"season": 2023, "week": week, "player_id": _KICKER, "team": "LV", **dict.fromkeys(KICKING_COLUMNS, 1)}


def _defense(week: int) -> dict[str, object]:
    counts = dict.fromkeys(DEFENSE_COUNT_COLUMNS, 0)
    return {
        "season": 2023,
        "week": week,
        "team": "LV",
        "opponent_team": "KC",
        "def_sacks": 2.5,
        **counts,
        "points_allowed": 17,
    }


def test_the_replay_reads_return_earlier_weeks_at_their_passes(engine: Engine) -> None:
    passes = {week: wednesday_pass_after(_KICKOFF - timedelta(days=7 * (7 - week))) for week in range(1, 8)}
    with engine.begin() as conn:
        _clear(conn)
        conn.execute(insert(PLAYERS).values(id=_KICKER, name="A Kicker", position="K"))
        conn.execute(insert(NFLVERSE_KICKING_WEEKS).values([_kicking(w) for w in (5, 6, 7)]))
        conn.execute(insert(NFLVERSE_TEAM_DEFENSE_WEEKS).values([_defense(w) for w in (5, 6, 7)]))
        kicking, kicking_stamp = kdef_weeks.kicking_weeks_at(conn, 2023, 7, _T, passes)
        defense, defense_stamp = kdef_weeks.defense_weeks_at(conn, 2023, 7, _T, passes)
    assert [(r.week, r.as_of) for r in kicking] == [(5, passes[5]), (6, passes[6])]
    assert [r.values["points_allowed"] for r in defense] == [17, 17]
    assert {(r.values["team"], r.values["opponent_team"]) for r in defense} == {("LV", "KC")}
    assert kicking_stamp.kind == "kicking" and defense_stamp.kind == "team_defense"
    assert kicking_stamp.newest is not None and kicking_stamp.newest.week == _WEEK - 1


def test_the_live_lines_and_the_kick_plays_read_earlier_weeks_at_their_stamps(engine: Engine) -> None:
    stamp = _T - timedelta(days=2)
    late = _T + timedelta(hours=1)
    with engine.begin() as conn:
        _clear(conn)
        conn.execute(insert(PLAYERS).values(id=_KICKER, name="A Kicker", position="K"))
        seed_team_defense_universe(conn)
        conn.execute(
            insert(PLAYER_WEEK_OBSERVATIONS).values(
                [
                    _observation(6, _KICKER, "field_goals_made", 2.0, stamp),
                    _observation(6, "team-def:KC", "points_allowed", 20.0, stamp),
                    _observation(6, "team-def:KC", "points_allowed", 21.0, late),  # restated after t_g
                ]
            )
        )
        pbp_plays.ingest_pbp_plays(conn, NflverseClient(FixtureFetcher()), 2022)
        kicking, _ = kdef_weeks.live_kicking_lines(conn, 2023, 7, _T)
        defense, _ = kdef_weeks.live_defense_lines(conn, 2023, 7, _T)
        kicks, kicks_stamp = kdef_weeks.kicks_at(conn, 2022, _KICKS_WEEK, datetime(2022, 10, 1, tzinfo=UTC))
    assert [(r.player_id, r.value) for r in kicking] == [(_KICKER, 2.0)]
    assert [(r.metric, r.value) for r in defense] == [("points_allowed", 20.0)]
    assert kicks and all(r.week < _KICKS_WEEK for r in kicks) and kicks_stamp.kind == "kicks"
    assert {r.values["field_goal_result"] for r in kicks if r.values["play_type"] == "field_goal"} == {"made"}


def _observation(week: int, player: str, metric: str, value: float, as_of: datetime) -> dict[str, object]:
    return {
        "season": 2023,
        "week": week,
        "player_id": player,
        "source": KDEF_LINE_SOURCE,
        "metric": metric,
        "value": value,
        "as_of": as_of,
    }
