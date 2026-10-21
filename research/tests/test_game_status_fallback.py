"""A week feed that lags (Lane 101, B75): a game the week's answer still has scheduled or under way, or leaves out, 3 h 30 m
past its kickoff is asked about on its own, its box score kept under its own source and read through the
same mapper, at most two a pass on what the pass's budget leaves; a refused answer fails the line.

The DB cases need PARITY_DATABASE_URL (a server where the harness may create `parity_*` databases)."""

import gzip
import json
import os
from collections.abc import Iterator, Mapping
from datetime import UTC, datetime, timedelta
from typing import Final, cast

import pytest
from sqlalchemy import Connection, Engine, func, insert, select

from research.db.engine import make_engine
from research.db.schema import CAPTURE_SNAPSHOTS, PROVIDER_GAMES, TEAM_WEEK_OBSERVATIONS
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.parity.replay import FIXTURES_ROOT
from research.pipeline.budget import FixedBudget
from research.pipeline.kickoffs import TeamKickoff
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource
from research.pipeline.tank01.client import Paths, Tank01Client, Tank01Error
from research.pipeline.tank01.game_status import (
    BOX_SCORE_SOURCE,
    FALLBACK_AFTER,
    FALLBACK_CAP,
    GIVE_UP_AFTER,
    REFUSAL_CAP,
    STATUS_SOURCE,
    capture_game_status,
    lagging_games,
    to_ask,
)
from research.pipeline.tank01.mapping import GameSummary, map_box_score_game, map_games

WEEK: Final = 6
SEASON: Final = 2026
SUNDAY_LATE: Final = datetime(2026, 10, 18, 17, 0, tzinfo=UTC)  # PIT@TB
MONDAY_NIGHT: Final = datetime(2026, 10, 20, 0, 15, tzinfo=UTC)  # WSH@SF, 8:15 pm Eastern
LATE_KICK: Final = datetime(2026, 10, 20, 4, 0, tzinfo=UTC)  # LAR@SEA, under 3 h 30 m old at both passes
PASS_AT: Final = datetime(2026, 10, 20, 6, 0, tzinfo=UTC)  # the 02:00 ET pass of B75
WEEK_FEED_ONLY: Final = 1
WEEK_AND_ONE_BOX_SCORE: Final = 2
FINAL: Final = 2.0
UNDER_WAY: Final = 1.0
SCHEDULED: Final = 0.0
WSH_SF: Final = "20261019_WSH@SF"
MIDNIGHT_ET_PASS: Final = datetime(2026, 10, 20, 4, 0, tzinfo=UTC)


def _k(team: str, at: datetime) -> TeamKickoff:
    return TeamKickoff(SEASON, WEEK, team, at)


KICKOFFS: Final = [
    _k("PIT", SUNDAY_LATE),
    _k("TB", SUNDAY_LATE),
    _k("WAS", MONDAY_NIGHT),
    _k("SF", MONDAY_NIGHT),
    _k("LA", LATE_KICK),
    _k("SEA", LATE_KICK),
]

WEEK_BODY: Final = [
    {"gameID": "20261018_PIT@TB", "home": "TB", "away": "PIT", "gameStatus": "Final/OT", "gameStatusCode": "2"},
    {"gameID": WSH_SF, "home": "SF", "away": "WSH", "gameStatus": "Scheduled", "gameStatusCode": "0"},
    {"gameID": "20261019_LAR@SEA", "home": "SEA", "away": "LAR", "gameStatus": "Live", "gameStatusCode": "1"},
]


def _recorded_box_score() -> dict[str, object]:
    """A box score recorded from the live provider (tank01-2026, week 1)."""
    path = FIXTURES_ROOT / "tank01-2026" / "box_20260913_WSH_at_PHI.json.gz"
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        body = json.load(handle)["body"]
    assert isinstance(body, dict)
    return body


def _as_wsh_sf(fields: Mapping[str, object]) -> dict[str, object]:
    """The recorded box score's shape, made the Monday night game's."""
    return {**_recorded_box_score(), "gameID": WSH_SF, "home": "SF", "away": "WSH", **fields}


def test_the_recorded_box_score_reads_its_game_and_status_through_the_mapper() -> None:
    game = map_box_score_game(_recorded_box_score(), 1)
    assert game is not None
    assert (game.game_id, game.home_nfl_team, game.away_nfl_team, game.status) == (
        "20260913_WSH@PHI",
        "PHI",
        "WSH",
        "final",
    )


@pytest.mark.parametrize(
    ("fields", "expected"),
    [
        ({"gameStatus": "Final/OT", "gameStatusCode": "2"}, "final"),
        ({"gameStatus": "Completed", "gameStatusCode": ""}, "final"),
        ({"gameStatus": "", "gameStatusCode": "2"}, "final"),
        ({"gameStatus": "Halftime", "gameStatusCode": "1"}, "in_progress"),
        ({"gameStatus": "Scheduled", "gameStatusCode": "0"}, "scheduled"),
    ],
)
def test_a_box_score_status_reads_code_then_words(fields: dict[str, str], expected: str) -> None:
    game = map_box_score_game(_as_wsh_sf(fields), WEEK)
    assert game is not None and game.status == expected


@pytest.mark.parametrize(
    "body",
    [
        [],
        "Final",
        None,
        {"gameID": WSH_SF, "home": "SF", "away": "WSH"},
        {"gameID": WSH_SF, "home": "SF", "away": "WSH", "gameStatus": " ", "gameStatusCode": ""},
        {"home": "SF", "away": "WSH", "gameStatus": "Final", "gameStatusCode": "2"},
        {"gameID": WSH_SF, "away": "WSH", "gameStatus": "Final", "gameStatusCode": "2"},
    ],
)
def test_an_answer_that_is_not_one_game_with_a_status_is_refused(body: object) -> None:
    assert map_box_score_game(body, WEEK) is None


def _games(at_status: Mapping[str, str] | None = None) -> list[GameSummary]:
    body = [{**g, **({} if at_status is None else {"gameStatusCode": at_status.get(str(g["gameID"]), g["gameStatusCode"])})}
            for g in WEEK_BODY]  # fmt: skip
    return map_games(body, WEEK)


def test_only_a_game_three_and_a_half_hours_past_its_kickoff_still_open_in_the_feed_lags() -> None:
    assert timedelta(hours=3, minutes=30) == FALLBACK_AFTER
    lagging = lagging_games(_games(), KICKOFFS, frozenset(), WEEK, PASS_AT)
    # PIT@TB is final in the feed; LAR@SEA kicked off two hours ago.
    assert [g.game_id for g in lagging] == [WSH_SF]
    # 3 h 29 m: not yet.
    at_3h29 = MONDAY_NIGHT + timedelta(hours=3, minutes=29)
    assert lagging_games(_games(), KICKOFFS, frozenset(), WEEK, at_3h29) == []
    # 3 h 30 m: asked.
    at_3h30 = MONDAY_NIGHT + timedelta(hours=3, minutes=30)
    assert len(lagging_games(_games(), KICKOFFS, frozenset(), WEEK, at_3h30)) == 1
    # The 00:00 ET pass (04:00Z) reaches the 8:15 pm ET kickoff before the 05:00Z nightly.
    assert [g.game_id for g in lagging_games(_games(), KICKOFFS, frozenset(), WEEK, MIDNIGHT_ET_PASS)] == [WSH_SF]


def test_a_held_final_a_missing_kickoff_or_a_given_up_game_never_lags() -> None:
    assert lagging_games(_games(), KICKOFFS, frozenset({("SF", WEEK)}), WEEK, PASS_AT) == []
    assert lagging_games(_games(), KICKOFFS, frozenset({("WAS", WEEK)}), WEEK, PASS_AT) == []
    no_sf = [k for k in KICKOFFS if k.team != "SF"]
    assert lagging_games(_games(), no_sf, frozenset(), WEEK, PASS_AT) == []
    past = LATE_KICK + GIVE_UP_AFTER + timedelta(minutes=1)
    assert lagging_games(_games(), KICKOFFS, frozenset(), WEEK, past) == []


def test_the_longest_waiting_game_comes_first() -> None:
    games = _games({"20261018_PIT@TB": "1"})
    lagging = lagging_games(games, KICKOFFS, frozenset(), WEEK, PASS_AT + timedelta(hours=2))
    assert [g.game_id for g in lagging] == ["20261018_PIT@TB", WSH_SF, "20261019_LAR@SEA"]


def test_at_most_two_a_pass_and_never_past_the_budget() -> None:
    lagging = lagging_games(_games({"20261018_PIT@TB": "1"}), KICKOFFS, frozenset(), WEEK, PASS_AT + timedelta(hours=2))
    assert len(to_ask(lagging, FixedBudget(10))) == FALLBACK_CAP
    assert [g.game_id for g in to_ask(lagging, FixedBudget(1))] == ["20261018_PIT@TB"]
    assert to_ask(lagging, FixedBudget(0)) == []


class _Client:
    """A Tank01 client answering the week's games and each game's box score from a table."""

    def __init__(self, box_scores: Mapping[str, object]) -> None:
        self.box_scores = box_scores
        self.week: object = WEEK_BODY
        self.calls: list[tuple[str, dict[str, str]]] = []

    def get(self, path: str, query: dict[str, str] | None = None) -> object:
        asked = dict(query or {})
        self.calls.append((path, asked))
        if path == Paths.GAMES_FOR_WEEK:
            return self.week
        assert path == Paths.BOX_SCORE
        answer = self.box_scores[asked["gameID"]]
        if isinstance(answer, Exception):
            raise answer
        return answer


def _seed(conn: Connection) -> None:
    rows = [
        {"season": SEASON, "week": k.week, "team": k.team, "source": ScheduleSource.KICKOFF,
         "metric": ScheduleMetric.KICKOFF_INSTANT, "as_of": k.at, "value": 1.0}
        for k in KICKOFFS
    ]  # fmt: skip
    conn.execute(insert(TEAM_WEEK_OBSERVATIONS), rows)


def _statuses(conn: Connection, at: datetime) -> dict[str, float]:
    t = TEAM_WEEK_OBSERVATIONS
    query = select(t.c.team, t.c.value).where(t.c.source == STATUS_SOURCE, t.c.as_of == at)
    return {str(r.team): float(r.value) for r in conn.execute(query)}


def _kept(conn: Connection, source: str) -> int:
    t = CAPTURE_SNAPSHOTS
    return int(conn.execute(select(func.count()).where(t.c.source == source)).scalar_one())


@pytest.fixture
def engine(request: pytest.FixtureRequest) -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    name = f"parity_lane101_{request.node.name.split('[')[0][-30:]}"
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(name)))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(name)


def test_the_lagging_game_is_asked_about_kept_and_its_final_written(engine: Engine) -> None:
    client = _Client({WSH_SF: _as_wsh_sf({"gameStatus": "Completed", "gameStatusCode": "2"})})
    with engine.begin() as conn:
        _seed(conn)
        result = capture_game_status(conn, cast(Tank01Client, client), SEASON, PASS_AT, FixedBudget(5))
        assert (result.requests, result.failed) == (WEEK_AND_ONE_BOX_SCORE, False)
        assert result.line == f"week 6, 6 clubs read, 4 final, 2 requests; {WSH_SF} box score final"
        assert client.calls[1] == (Paths.BOX_SCORE, {"gameID": WSH_SF})
        assert _statuses(conn, PASS_AT) == {"TB": 2.0, "PIT": 2.0, "SF": 2.0, "WAS": 2.0, "SEA": 1.0, "LA": 1.0}
        assert _kept(conn, BOX_SCORE_SOURCE) == 1
        # The next hour the final is held: the week's feed still says Scheduled, and nothing more is asked.
        later = capture_game_status(
            conn, cast(Tank01Client, client), SEASON, PASS_AT + timedelta(hours=1), FixedBudget(5)
        )
        assert later.requests == WEEK_FEED_ONLY and len(client.calls) == WEEK_AND_ONE_BOX_SCORE + WEEK_FEED_ONLY
        assert _kept(conn, BOX_SCORE_SOURCE) == 1


def test_a_box_score_still_open_is_written_as_it_says(engine: Engine) -> None:
    client = _Client({WSH_SF: _as_wsh_sf({"gameStatus": "Live - In Progress", "gameStatusCode": "1"})})
    with engine.begin() as conn:
        _seed(conn)
        result = capture_game_status(conn, cast(Tank01Client, client), SEASON, PASS_AT, FixedBudget(5))
        assert not result.failed and result.line.endswith(f"{WSH_SF} box score under way")
        assert _statuses(conn, PASS_AT)["SF"] == UNDER_WAY


def test_a_refused_answer_is_kept_and_fails_the_line(engine: Engine) -> None:
    client = _Client({WSH_SF: {"gameID": WSH_SF, "home": "SF", "away": "WSH"}})
    with engine.begin() as conn:
        _seed(conn)
        result = capture_game_status(conn, cast(Tank01Client, client), SEASON, PASS_AT, FixedBudget(5))
        assert result.failed and f"FAILED, {WSH_SF} box score refused" in result.line
        assert _kept(conn, BOX_SCORE_SOURCE) == 1
        # The week's read stands for every game, the refused one at the week's status.
        assert _statuses(conn, PASS_AT)["SF"] == SCHEDULED and _statuses(conn, PASS_AT)["TB"] == FINAL


def test_a_provider_failure_keeps_nothing_and_fails_the_line(engine: Engine) -> None:
    failure = Tank01Error("upstream", Paths.BOX_SCORE, "Tank01 returned HTTP 500 for /getNFLBoxScore.", 500)
    client = _Client({WSH_SF: failure})
    with engine.begin() as conn:
        _seed(conn)
        result = capture_game_status(conn, cast(Tank01Client, client), SEASON, PASS_AT, FixedBudget(5))
        assert (
            result.failed and result.requests == WEEK_AND_ONE_BOX_SCORE and f"FAILED, {WSH_SF} box score" in result.line
        )
        assert _kept(conn, BOX_SCORE_SOURCE) == 0
        assert _statuses(conn, PASS_AT)["SF"] == SCHEDULED


def test_a_spent_budget_asks_the_week_alone_and_says_so(engine: Engine) -> None:
    client = _Client({})
    with engine.begin() as conn:
        _seed(conn)
        result = capture_game_status(conn, cast(Tank01Client, client), SEASON, PASS_AT, FixedBudget(1))
        assert (result.requests, result.failed) == (WEEK_FEED_ONLY, False)
        assert result.line == "week 6, 6 clubs read, 2 final, 1 request; 1 lagging, not asked this pass"
        assert [path for path, _ in client.calls] == [Paths.GAMES_FOR_WEEK]


class _WeekWithout(_Client):
    """The week's answer with the Monday night game left out."""

    def get(self, path: str, query: dict[str, str] | None = None) -> object:
        if path == Paths.GAMES_FOR_WEEK:
            self.calls.append((path, dict(query or {})))
            return [g for g in WEEK_BODY if g["gameID"] != WSH_SF]
        return super().get(path, query)


def _seed_schedule(conn: Connection) -> None:
    rows = [
        {"game_id": str(g["gameID"]), "season": SEASON, "week": WEEK, "home_team": str(g["home"]),
         "away_team": str(g["away"]), "status": "scheduled"}
        for g in WEEK_BODY
    ]  # fmt: skip
    conn.execute(insert(PROVIDER_GAMES), rows)


def test_a_game_absent_from_the_week_feed_is_named_and_asked_about(engine: Engine) -> None:
    client = _WeekWithout({WSH_SF: _as_wsh_sf({"gameStatus": "Completed", "gameStatusCode": "2"})})
    with engine.begin() as conn:
        _seed(conn)
        _seed_schedule(conn)
        result = capture_game_status(conn, cast(Tank01Client, client), SEASON, PASS_AT, FixedBudget(5))
        assert (result.requests, result.failed) == (WEEK_AND_ONE_BOX_SCORE, False)
        assert result.line == (
            f"week 6, 6 clubs read, 4 final, 2 requests; {WSH_SF} absent from the week feed; {WSH_SF} box score final"
        )
        assert _statuses(conn, PASS_AT)["SF"] == FINAL and _statuses(conn, PASS_AT)["WAS"] == FINAL


def test_an_absent_game_whose_answer_fails_gets_no_status(engine: Engine) -> None:
    client = _WeekWithout({WSH_SF: {"gameID": WSH_SF, "home": "SF", "away": "WSH"}})
    with engine.begin() as conn:
        _seed(conn)
        _seed_schedule(conn)
        result = capture_game_status(conn, cast(Tank01Client, client), SEASON, PASS_AT, FixedBudget(5))
        assert result.failed and f"{WSH_SF} absent from the week feed" in result.line
        assert "SF" not in _statuses(conn, PASS_AT)


_REFUSED_BODY: Final = {"gameID": WSH_SF, "home": "SF", "away": "WSH"}
_FINAL: Final = {"gameStatus": "Final", "gameStatusCode": "2"}
# The late game final, so over the hours these passes span only the Monday night game waits.
_LATE_GAME_FINAL: Final = [{**g, **_FINAL} if g["gameID"] == "20261019_LAR@SEA" else g for g in WEEK_BODY]


def _refusing(cls: type[_Client] = _Client) -> _Client:
    client = cls({WSH_SF: _REFUSED_BODY})
    client.week = _LATE_GAME_FINAL
    return client


def _box_calls(client: _Client) -> int:
    return sum(1 for path, _ in client.calls if path == Paths.BOX_SCORE)


def test_a_box_score_refused_three_times_is_not_asked_again_and_alerts_once(engine: Engine) -> None:
    """B76 (Lane 116): at most three asks per asked game; every pass's line says FAILED with the count, and
    only the game's first refusal fails the pass's verdict, so the job's alert fires once, not hourly."""
    client = _refusing()
    passes = [PASS_AT + timedelta(hours=hour) for hour in range(REFUSAL_CAP + 2)]
    with engine.begin() as conn:
        _seed(conn)
        results = [capture_game_status(conn, cast(Tank01Client, client), SEASON, at, FixedBudget(5)) for at in passes]
        assert _kept(conn, BOX_SCORE_SOURCE) == REFUSAL_CAP
    assert REFUSAL_CAP == 3 and _box_calls(client) == REFUSAL_CAP  # noqa: PLR2004 - the ruling says three
    for count, asked in enumerate(results[:REFUSAL_CAP], start=1):
        assert asked.requests == WEEK_AND_ONE_BOX_SCORE
        assert f"FAILED, {WSH_SF} box score refused {count} of 3 times: it is not that game with a status" in asked.line
    assert [r.failed for r in results] == [True, False, False, False, False]
    for waiting in results[REFUSAL_CAP:]:
        assert waiting.requests == WEEK_FEED_ONLY
        assert waiting.line == (
            f"week 6, 6 clubs read, 4 final, 1 request; "
            f"FAILED, {WSH_SF} box score refused 3 times, not asked again, waiting on the final"
        )


def test_a_refusal_that_changes_still_counts_toward_the_cap(engine: Engine) -> None:
    """Lane 116: the cap is three asks per asked game, whatever each refused answer's digest."""

    class _Changing(_Client):
        def get(self, path: str, query: dict[str, str] | None = None) -> object:
            answer = super().get(path, query)
            return {**_REFUSED_BODY, "pass": len(self.calls)} if path == Paths.BOX_SCORE else answer

    client = _refusing(_Changing)
    with engine.begin() as conn:
        _seed(conn)
        for hour in range(REFUSAL_CAP + 2):
            capture_game_status(
                conn, cast(Tank01Client, client), SEASON, PASS_AT + timedelta(hours=hour), FixedBudget(5)
            )
    assert _box_calls(client) == REFUSAL_CAP


def test_an_answer_that_reads_starts_the_count_again(engine: Engine) -> None:
    """Refusals count in a row: an answer that reads (here under way) between them restarts the count, and the
    next refusal is a first again, failing the verdict."""
    client = _refusing()
    still_open = _as_wsh_sf({"gameStatus": "Live - In Progress", "gameStatusCode": "1"})
    answers: list[object] = [_REFUSED_BODY, _REFUSED_BODY, still_open, _REFUSED_BODY]
    results = []
    with engine.begin() as conn:
        _seed(conn)
        for hour, answer in enumerate(answers):
            client.box_scores = {WSH_SF: answer}
            at = PASS_AT + timedelta(hours=hour)
            results.append(capture_game_status(conn, cast(Tank01Client, client), SEASON, at, FixedBudget(5)))
    assert _box_calls(client) == len(answers)
    assert [r.failed for r in results] == [True, False, False, True]
    assert "refused 1 of 3 times" in results[-1].line


def test_a_capped_game_ends_when_its_final_comes_another_way(engine: Engine) -> None:
    client = _refusing()
    with engine.begin() as conn:
        _seed(conn)
        for hour in range(REFUSAL_CAP):
            capture_game_status(
                conn, cast(Tank01Client, client), SEASON, PASS_AT + timedelta(hours=hour), FixedBudget(5)
            )
        client.week = [{**g, **_FINAL} for g in WEEK_BODY]
        at = PASS_AT + timedelta(hours=REFUSAL_CAP)
        result = capture_game_status(conn, cast(Tank01Client, client), SEASON, at, FixedBudget(5))
        assert not result.failed and result.line == "week 6, 6 clubs read, 6 final, 1 request"
        assert _statuses(conn, at)["SF"] == FINAL


MOVED_FROM: Final = "20261018_WSH@SF"  # the id the stored schedule kept when the game moved a day


def test_a_stored_game_whose_clubs_the_answer_carries_under_a_new_id_is_superseded(engine: Engine) -> None:
    client = _Client({WSH_SF: _as_wsh_sf({"gameStatus": "Completed", "gameStatusCode": "2"})})
    with engine.begin() as conn:
        _seed(conn)
        _seed_schedule(conn)
        conn.execute(PROVIDER_GAMES.update().where(PROVIDER_GAMES.c.game_id == WSH_SF).values(game_id=MOVED_FROM))
        result = capture_game_status(conn, cast(Tank01Client, client), SEASON, PASS_AT, FixedBudget(5))
        assert (result.requests, result.failed) == (WEEK_AND_ONE_BOX_SCORE, False)
        assert result.line == (
            f"week 6, 6 clubs read, 4 final, 2 requests; {MOVED_FROM} superseded by {WSH_SF}; {WSH_SF} box score final"
        )
        # Never asked by its dead id.
        assert [q["gameID"] for path, q in client.calls if path == Paths.BOX_SCORE] == [WSH_SF]


def test_one_club_in_the_answer_under_another_id_supersedes_the_stored_game(engine: Engine) -> None:
    """A stored game is superseded when either club appears: here the stored row names a home club the
    answer does not carry, its away club playing in the answer's game."""
    client = _Client({WSH_SF: _as_wsh_sf({"gameStatus": "Completed", "gameStatusCode": "2"})})
    stale = {"game_id": "20261018_WSH@ARI", "season": SEASON, "week": WEEK, "home_team": "ARI",
             "away_team": "WSH", "status": "scheduled"}  # fmt: skip
    with engine.begin() as conn:
        _seed(conn)
        conn.execute(insert(PROVIDER_GAMES), [stale])
        result = capture_game_status(conn, cast(Tank01Client, client), SEASON, PASS_AT, FixedBudget(5))
        assert f"20261018_WSH@ARI superseded by {WSH_SF}" in result.line and "absent" not in result.line


_OTHER_GAME: Final = {"gameID": "20261019_LAR@SEA", "home": "SEA", "away": "LAR", **_FINAL}


@pytest.mark.parametrize(
    "answer",
    [
        pytest.param(_OTHER_GAME, id="another-game"),
        pytest.param({"home": "SF", "away": "WSH", **_FINAL}, id="no-game"),
        pytest.param({}, id="empty"),
    ],
)
def test_a_refused_answer_naming_another_game_or_none_counts_toward_the_asked_games_cap(
    engine: Engine, answer: dict[str, str]
) -> None:
    """B86: the cap keys on the game asked about (`asked_game_id`), so an answer that names another game
    or none is still that game's refusal, and three alike stop the asking."""
    client = _Client({WSH_SF: answer})
    client.week = _LATE_GAME_FINAL
    passes = [PASS_AT + timedelta(hours=hour) for hour in range(REFUSAL_CAP + 2)]
    with engine.begin() as conn:
        _seed(conn)
        results = [capture_game_status(conn, cast(Tank01Client, client), SEASON, at, FixedBudget(5)) for at in passes]
        asked = conn.execute(
            select(CAPTURE_SNAPSHOTS.c.asked_game_id).where(CAPTURE_SNAPSHOTS.c.source == BOX_SCORE_SOURCE)
        ).scalars()
        assert list(asked) == [WSH_SF] * REFUSAL_CAP
    assert _box_calls(client) == REFUSAL_CAP
    assert [r.failed for r in results] == [True, False, False, False, False]
    assert results[-1].line.endswith(
        f"FAILED, {WSH_SF} box score refused 3 times, not asked again, waiting on the final"
    )


def test_a_box_score_kept_before_the_column_counts_for_the_game_it_names(engine: Engine) -> None:
    """Rows kept before revision 0016 carry no asked game: they count for the game their answer names."""
    client = _refusing()
    rows = [
        {"source": BOX_SCORE_SOURCE, "captured_at": PASS_AT - timedelta(hours=hour), "digest": "same",
         "payload": _REFUSED_BODY, "asked_game_id": None}
        for hour in range(1, REFUSAL_CAP + 1)
    ]  # fmt: skip
    with engine.begin() as conn:
        _seed(conn)
        conn.execute(insert(CAPTURE_SNAPSHOTS), rows)
        result = capture_game_status(conn, cast(Tank01Client, client), SEASON, PASS_AT, FixedBudget(5))
    assert _box_calls(client) == 0
    assert result.line.endswith("refused 3 times, not asked again, waiting on the final")
    assert not result.failed


def test_a_stored_game_the_ingest_marked_superseded_is_never_absent(engine: Engine) -> None:
    """B77b: a row the schedule ingest marked superseded is not a game to play, so the status pass never
    names it, even when no club of it appears in this answer."""
    client = _WeekWithout({})
    client.week = _LATE_GAME_FINAL
    with engine.begin() as conn:
        _seed(conn)
        _seed_schedule(conn)
        conn.execute(
            PROVIDER_GAMES.update().where(PROVIDER_GAMES.c.game_id == WSH_SF).values(superseded_by="20261020_WSH@SF")
        )
        result = capture_game_status(conn, cast(Tank01Client, client), SEASON, PASS_AT, FixedBudget(5))
    assert WSH_SF not in result.line
    assert _box_calls(client) == 0
