# ruff: noqa: PLR2004 - the expected values are hand-computed numbers, each read beside its case
"""Weekly round 3's placement and number (preregistration sections 2 and 3: each player on his
club's game at its own instant, a bye or no club giving no number, x = m with no game this season,
the filter, and the stamps on every row) and its commands' refusals (the lock, the one judgment, the
scratch copy, the closed seasons, the stop rule)."""

import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import MappingProxyType

import pytest
from sqlalchemy import create_engine, text

from research.errors import ConfigurationError
from research.model.register.freeze import IMPLEMENTATION
from research.model.ros.model import OpportunityLine
from research.model.ros.reads import StaleBoard, StalePlayer, stale_entry
from research.model.weekly2.board import WeekPlayer
from research.model.weekly2.designation import WeekStatus
from research.model.weekly2.gates import GateLine
from research.model.weekly2.guard import ClosedSeasonError, closed_seasons, guard_queries
from research.model.weekly2.round import claim_judgment, preregistration_committed
from research.model.weekly3 import round as round3
from research.model.weekly3.allowance import Allowance
from research.model.weekly3.gates import DEVELOPMENT_CHECK, ROUND_THREE
from research.model.weekly3.instant import Schedule
from research.model.weekly3.number import Fitted, week_number
from research.model.weekly3.season import NO_CLUB, NO_GAME_THIS_SEASON, NO_GAME_THIS_WEEK, _Instant, place
from research.model.weekly3.snapshot import PriorSeason, Snapshot
from research.model.weekly3.stage import COLUMNS, SNAP_COLUMNS, ClubMeans, RedZone, StageOne, UsageLine
from research.model.weekly3.work import KINDS_BY_POSITION, PlayerGame, Work

_SUN = datetime(2023, 10, 22, 17, 0, tzinfo=UTC)
_THU = datetime(2023, 10, 20, 0, 15, tzinfo=UTC)
_T_SUN = _SUN - timedelta(milliseconds=1)
_T_THU = _THU - timedelta(milliseconds=1)
_RATE = MappingProxyType({"ppr": 12.0, "half": 10.0, "std": 8.0})


def _player(pid: str = "p1") -> WeekPlayer:
    return WeekPlayer(pid, "WR", None, _RATE, None, 3, 36.0, None, None, "clear")


def _schedule() -> Schedule:
    kickoffs = {(7, "KC"): _SUN, (7, "LAC"): _SUN, (7, "JAX"): _THU, (7, "NO"): _THU}
    pairing = {(7, "KC"): "LAC", (7, "LAC"): "KC", (7, "JAX"): "NO", (7, "NO"): "JAX"}
    pairing |= {(w, "KC"): "DEN" for w in (4, 5, 6)} | {(w, "JAX"): "DEN" for w in (4, 5, 6)}
    home = dict.fromkeys(kickoffs, 1.0)
    return Schedule(2023, MappingProxyType(kickoffs), MappingProxyType(home), MappingProxyType(pairing))


def _games(club: str) -> tuple[PlayerGame, ...]:
    return tuple(PlayerGame(w, club, Work(5.0, 1.0, 0.0, 0.7, 1.0), frozenset()) for w in (4, 5, 6))


def _snapshot(moment: datetime, games: dict[str, tuple[PlayerGame, ...]], statuses: dict[str, WeekStatus]) -> Snapshot:
    clubs = {pid: played[-1].club for pid, played in games.items()}
    rows = {(c, w): {"pace_seconds_per_play": 28.0, "pass_rate": 0.6} for c in ("KC", "JAX") for w in (4, 5, 6)}
    return Snapshot(
        2023,
        7,
        moment,
        MappingProxyType(games),
        MappingProxyType(clubs),
        MappingProxyType({k: MappingProxyType(v) for k, v in rows.items()}),
        MappingProxyType(statuses),
        (),
    )


def _flat(club: str) -> object:
    del club
    return lambda position, kind: Allowance(1.0, 4, None)


def _instants(
    games: dict[str, tuple[PlayerGame, ...]], thursday: dict[str, WeekStatus], sunday: dict[str, WeekStatus]
) -> dict[datetime, _Instant]:
    return {
        _T_THU: _Instant(_snapshot(_T_THU, games, thursday), _flat),  # type: ignore[arg-type]
        _T_SUN: _Instant(_snapshot(_T_SUN, games, sunday), _flat),  # type: ignore[arg-type]
    }


def _stale(team: str | None) -> StaleBoard:
    players = {} if team is None else {"p1": StalePlayer("WR", team, stale_entry(_RATE, 16.0))}
    return StaleBoard(2023, _THU, MappingProxyType(players))


_PRIOR = PriorSeason(MappingProxyType({}), None)  # type: ignore[arg-type]


def test_a_player_is_placed_on_his_clubs_game_at_its_own_instant_and_seen_at_thursday() -> None:
    instants = _instants({"p1": _games("KC")}, {}, {"p1": "questionable"})
    found = place(_player(), _stale(None), instants, _PRIOR, _schedule())
    assert (found.club, found.moment) == ("KC", _T_SUN)
    assert found.own.status == "questionable"
    assert found.thursday.status == "clear"
    assert found.own.features is not None
    assert found.thursday.features is not None


def test_a_filing_stamped_between_thursday_and_his_kickoff_withholds_him() -> None:
    instants = _instants({"p1": _games("KC")}, {}, {"p1": "withheld"})
    found = place(_player(), _stale(None), instants, _PRIOR, _schedule())
    assert found.own.status == "withheld"
    assert found.thursday.status == "clear"


def test_a_player_with_no_game_this_season_takes_the_boards_club_and_the_rate() -> None:
    instants = _instants({}, {}, {})
    found = place(_player(), _stale("JAX"), instants, _PRIOR, _schedule())
    assert (found.club, found.moment) == ("JAX", _T_THU)
    assert found.own.features is None
    assert found.defaults == frozenset({NO_GAME_THIS_SEASON})


def test_no_club_and_a_bye_give_no_game() -> None:
    assert place(_player(), _stale(None), _instants({}, {}, {}), _PRIOR, _schedule()).defaults == frozenset({NO_CLUB})
    found = place(_player(), _stale("BUF"), _instants({}, {}, {}), _PRIOR, _schedule())
    assert (found.moment, found.defaults) == (None, frozenset({NO_GAME_THIS_WEEK}))


def _fitted() -> Fitted:
    lines = {}
    for position, kinds in KINDS_BY_POSITION.items():
        for kind in kinds:
            columns = SNAP_COLUMNS if kind == "snap_share" else COLUMNS
            lines[f"{position}|{kind}"] = UsageLine(kind, columns, (0.0,) * len(columns), 10, len(columns))
    keys = [f"{p}|{f}" for p in KINDS_BY_POSITION for f in ("ppr", "half", "std")]
    return Fitted(
        StageOne(MappingProxyType(lines), ClubMeans(28.0, 0.6)),
        MappingProxyType(dict.fromkeys(keys, RedZone(0.0, 1.0))),
        MappingProxyType(dict.fromkeys(keys, OpportunityLine(0.0, 1.0, 0.5, 0.0, 1.0))),
    )


@pytest.mark.parametrize(
    ("sunday", "numbered", "flagged"),
    [({}, True, False), ({"p1": "questionable"}, True, True), ({"p1": "withheld"}, False, False)],
)
def test_the_number_is_withheld_flagged_or_clear_and_stamped(
    sunday: dict[str, WeekStatus], numbered: bool, flagged: bool
) -> None:
    placed = place(_player(), _stale(None), _instants({"p1": _games("KC")}, {}, sunday), _PRIOR, _schedule())
    found = week_number(2023, 7, placed, _fitted(), "commish_weekly_v3", "research@abc12345")
    assert (found.number is not None) is numbered
    assert found.questionable is flagged
    if found.number is not None:
        assert dict(found.number) == dict(_RATE)  # all-zero lines: this game adds nothing to m
    assert (found.model_name, found.model_version, found.implementation) == (
        "commish_weekly_v3",
        "research@abc12345",
        IMPLEMENTATION,
    )
    assert IMPLEMENTATION == "python"


def test_a_bye_has_no_number() -> None:
    placed = place(_player(), _stale("BUF"), _instants({}, {}, {}), _PRIOR, _schedule())
    assert week_number(2023, 7, placed, _fitted(), "commish_weekly_v3", "v").number is None


def test_no_game_this_season_is_the_rate() -> None:
    placed = place(_player(), _stale("JAX"), _instants({}, {}, {}), _PRIOR, _schedule())
    found = week_number(2023, 7, placed, _fitted(), "commish_weekly_v3", "v")
    assert found.number == _RATE


# --- the commands -------------------------------------------------------------------------------


def test_the_lock_is_the_preregistrations_commit() -> None:
    assert round3.PREREGISTRATION_COMMIT == "e58ae444"
    assert round3.JUDGMENT_PREFIXES == ("lane47_",)


def test_the_judgment_is_refused_without_the_lock() -> None:
    with pytest.raises(ConfigurationError, match="e58ae444"):
        round3.thresholds_for("judge", committed=lambda: False, exists=lambda _: False)


def test_the_judgment_is_taken_once() -> None:
    for taken in (round3.JUDGMENT_CLAIM, round3.JUDGMENT_RECORD):

        def exists(path: Path, found: Path = taken) -> bool:
            return path == found

        with pytest.raises(ConfigurationError, match="once"):
            round3.thresholds_for("judge", committed=lambda: True, exists=exists, record=_passed)
    found = round3.thresholds_for("judge", committed=lambda: True, exists=lambda _: False, record=_passed)
    assert found == ROUND_THREE


def test_the_development_check_runs_the_check_constant() -> None:
    assert round3.thresholds_for("develop", committed=lambda: False) == DEVELOPMENT_CHECK


def test_the_claim_is_made_in_its_fixed_place(tmp_path: Path) -> None:
    claim = tmp_path / "taken.json"
    claim_judgment(tmp_path / "out.json", "v", claim)
    with pytest.raises(ConfigurationError, match="once"):
        claim_judgment(tmp_path / "elsewhere.json", "v", claim)


@pytest.mark.parametrize(
    ("command", "url", "admitted"),
    [
        ("judge", "postgres://commish:commish@localhost:5433/lane47_weekly", True),
        ("judge", "postgres://commish:commish@localhost:5433/lane48_weekly", False),
        ("develop", "postgres://commish:commish@localhost:5433/lane48_weekly", True),
        ("develop", "postgres://commish:commish@localhost:5432/lane48_weekly", False),
        ("develop", "postgres://commish:commish@localhost:5440/lane48_weekly", False),
        ("develop", "postgres://commish:commish@localhost:5433/commish", False),
        ("develop", "postgres://commish:commish@example.com:5433/lane48_weekly", False),
    ],
)
def test_the_round_runs_only_on_its_scratch_copy(command: str, url: str, admitted: bool) -> None:
    if admitted:
        round3.check_round_scratch(command, url)
    else:
        with pytest.raises(ConfigurationError):
            round3.check_round_scratch(command, url)


@pytest.mark.parametrize(("t", "season"), [(ROUND_THREE, 2025), (ROUND_THREE, 2026), (DEVELOPMENT_CHECK, 2024)])
def test_the_guarded_connection_refuses_a_closed_season(t: object, season: int) -> None:
    engine = create_engine("sqlite://")
    with engine.connect() as conn:
        guard_queries(conn, closed_seasons(t))  # type: ignore[arg-type]
        with pytest.raises(ClosedSeasonError):
            conn.execute(text("select :season as s"), {"season": season})
        assert conn.execute(text("select :season as s"), {"season": 2023}).scalar_one() == 2023


def _line(gate: str, subject: str, passed: bool) -> GateLine:
    return GateLine(gate, subject, passed, "")


def test_the_stop_rule_ends_the_round_when_g2_pooled_fails() -> None:
    lines = [_line("G1", "pooled vs ADP", True), _line("G2", "pooled vs recent form", False)]
    assert round3.decision("develop", lines).startswith("STOP RULE")
    lines = [_line("G1", "pooled vs ADP", False), _line("G2", "pooled vs recent form", True)]
    assert "judgment may run" in round3.decision("develop", lines)


def test_the_decision_rule_ships_only_on_every_line() -> None:
    assert "ships" in round3.decision("judge", [_line("G1", "x", True)])
    assert round3.decision("judge", [_line("G1", "x", True), _line("G5", "isolation", False)]).endswith("nothing ships")


def test_the_judgment_prints_the_2024_caveat_item_six_first() -> None:
    caveat = round3.EXPOSURE_CAVEAT
    assert caveat.index("(6)") < caveat.index("(1)")
    assert "2024" in caveat


def _shallow_clone() -> bool:
    """CI checks the tree out one commit deep, so the lock is not in its history."""
    found = subprocess.run(
        ["git", "rev-parse", "--is-shallow-repository"],
        cwd=Path(__file__).resolve().parents[2],
        capture_output=True,
        text=True,
        check=False,
    )
    return found.stdout.strip() == "true"


def test_the_lock_is_in_this_trees_history() -> None:
    if _shallow_clone():
        pytest.skip("a shallow clone holds no history to find the lock in")
    assert preregistration_committed(round3.PREREGISTRATION_COMMIT)


def _record(passed: bool) -> dict[str, object]:
    return {
        "gates": [
            {"gate": "G1", "subject": "pooled vs ADP", "passed": True},
            {"gate": "G2", "subject": "pooled vs recent form", "passed": passed},
        ]
    }


def _passed() -> dict[str, object]:
    return _record(True)


def test_the_judgment_is_refused_when_the_check_failed_g2_pooled() -> None:
    with pytest.raises(ConfigurationError, match="stop rule"):
        round3.thresholds_for("judge", committed=lambda: True, exists=lambda _: False, record=lambda: _record(False))


def test_the_judgment_is_refused_without_a_development_record() -> None:
    with pytest.raises(ConfigurationError, match="no development check record"):
        round3.thresholds_for("judge", committed=lambda: True, exists=lambda _: False, record=lambda: None)
    with pytest.raises(ConfigurationError, match="names no G2"):
        round3.thresholds_for("judge", committed=lambda: True, exists=lambda _: False, record=lambda: {"gates": []})


def test_the_committed_round_three_check_stops_the_judgment() -> None:
    record = round3.development_record()
    assert record is not None
    found = round3.stop_rule_refusal(record)
    assert found is not None
    assert "stop rule" in found
    with pytest.raises(ConfigurationError, match="stop rule"):
        round3.thresholds_for("judge", committed=lambda: True, exists=lambda _: False)
