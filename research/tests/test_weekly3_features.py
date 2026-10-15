# ruff: noqa: PLR2004 - the expected values are hand-computed numbers, each read beside its case
"""Weekly round 3's stage-1 inputs and the missing-input table (preregistration section 2 item 2,
"Missing inputs"): the means, the last three over the games he has, the no-prior-season indicator,
the two zero-filled rows, vacated volume and its last-three rule, the club's pace over the games that
carry it, and the neutral game."""

from datetime import UTC, datetime
from types import MappingProxyType

import pytest

from research.model.weekly2.designation import WeekStatus
from research.model.weekly3.allowance import NO_GAME, Allowance
from research.model.weekly3.features import (
    CLUB_GAME_WITHOUT_PACE,
    FEWER_THAN_THREE,
    NEUTRAL_HOME,
    NO_FILING,
    NO_PRIOR_SEASON,
    TEAMMATE_NOT_IN_LAST_THREE,
    Features,
    game_features,
    neutral,
)
from research.model.weekly3.instant import Schedule
from research.model.weekly3.snapshot import Snapshot
from research.model.weekly3.work import (
    KINDS,
    NO_RED_ZONE_ROW,
    NO_SNAP_ROW,
    ONES,
    ZERO,
    Kind,
    PlayerGame,
    Work,
    player_games,
)
from research.pipeline.observations import PlayerWeekObservation, PlayerWeekTeam

_T = datetime(2023, 10, 22, 16, 59, 59, 999000, tzinfo=UTC)
_STAMP = datetime(2023, 10, 10, tzinfo=UTC)


def _work(targets: float) -> Work:
    return Work(targets, 1.0, 0.0, 0.5, 1.0)


def _games(club: str, targets: list[tuple[int, float]]) -> tuple[PlayerGame, ...]:
    return tuple(PlayerGame(week, club, _work(t), frozenset()) for week, t in targets)


def _schedule(weeks: tuple[int, ...] = (1, 2, 3, 4, 5, 6)) -> Schedule:
    pairing = {(w, "KC"): "DEN" for w in weeks} | {(w, "DEN"): "KC" for w in weeks}
    pairing[(7, "KC")] = "LAC"
    home = {(7, "KC"): 1.0}
    return Schedule(2023, MappingProxyType({}), MappingProxyType(home), MappingProxyType(pairing))


def _snapshot(
    games: dict[str, tuple[PlayerGame, ...]],
    statuses: dict[str, WeekStatus] | None = None,
    team_rows: dict[tuple[str, int], dict[str, float]] | None = None,
) -> Snapshot:
    clubs = {pid: played[-1].club for pid, played in games.items() if played}
    rows = team_rows or {("KC", w): {"pace_seconds_per_play": 28.0, "pass_rate": 0.6} for w in range(1, 7)}
    return Snapshot(
        2023,
        7,
        _T,
        MappingProxyType(games),
        MappingProxyType(clubs),
        MappingProxyType({k: MappingProxyType(v) for k, v in rows.items()}),
        MappingProxyType(statuses or {}),
        (),
    )


def _flat(position: str, kind: Kind) -> Allowance:
    del position
    return Allowance(1.2 if kind == "targets" else 1.0, 4, None)


def _features(snapshot: Snapshot, prior: dict[str, Work] | None = None, pid: str = "me") -> Features:
    found = game_features(pid, "WR", "KC", snapshot, prior or {}, _schedule(), _flat, KINDS[:4])
    assert found is not None
    return found


def test_the_means_and_the_last_three_over_his_games_before_w() -> None:
    snap = _snapshot({"me": _games("KC", [(1, 2.0), (2, 4.0), (4, 6.0), (5, 8.0), (6, 10.0)])})
    found = _features(snap, {"me": _work(3.0)})
    assert found.season_mean.targets == 6.0
    assert found.last_three.targets == 8.0  # weeks 4, 5, 6: the bye in week 3 is skipped
    assert found.prior.targets == 3.0
    assert not found.no_prior
    assert found.allowance.targets == 1.2
    assert found.allowance.snap_share == 1.0
    assert found.home == 1.0
    assert (found.pace, found.pass_rate) == (28.0, 0.6)


def test_fewer_than_three_games_take_the_games_he_has() -> None:
    found = _features(_snapshot({"me": _games("KC", [(5, 3.0), (6, 5.0)])}))
    assert found.last_three.targets == 4.0
    assert FEWER_THAN_THREE in found.defaults


def test_no_prior_season_is_zero_with_the_indicator() -> None:
    found = _features(_snapshot({"me": _games("KC", [(4, 1.0), (5, 1.0), (6, 1.0)])}))
    assert found.prior == ZERO
    assert found.no_prior
    assert NO_PRIOR_SEASON in found.defaults
    assert NO_FILING in found.defaults  # no filing for week 7: clear, counted


def test_a_player_with_no_game_this_season_has_no_inputs() -> None:
    snap = _snapshot({"other": _games("KC", [(6, 1.0)])})
    assert game_features("me", "WR", "KC", snap, {}, _schedule(), _flat, KINDS[:4]) is None


def test_a_line_week_without_a_play_by_play_or_snap_row_is_zero_filled_and_marked() -> None:
    edge = PlayerWeekTeam(2023, 6, "me", "KC", _STAMP)
    targets = PlayerWeekObservation(2023, 6, "me", "nflverse_player_week", "targets", 7.0, _STAMP)
    stray = PlayerWeekObservation(2023, 6, "me", "nflverse_ftn_charting", "targets", 99.0, _STAMP)
    (game,) = player_games([targets, stray], [edge])["me"]
    assert game.work == Work(7.0, 0.0, 0.0, 0.0, 0.0)
    assert game.defaults == frozenset({NO_RED_ZONE_ROW, NO_SNAP_ROW})


def test_snap_share_and_red_zone_from_their_rows() -> None:
    edge = PlayerWeekTeam(2023, 6, "me", "KC", _STAMP)
    rows = [
        PlayerWeekObservation(2023, 6, "me", "nflverse_snap_counts", "offensive_snaps", 45.0, _STAMP),
        PlayerWeekObservation(2023, 6, "me", "nflverse_snap_counts", "team_offensive_snaps", 60.0, _STAMP),
        PlayerWeekObservation(2023, 6, "me", "nflverse_pbp_player", "red_zone_targets", 2.0, _STAMP),
        PlayerWeekObservation(2023, 6, "me", "nflverse_pbp_player", "red_zone_carries", 1.0, _STAMP),
    ]
    (game,) = player_games(rows, [edge])["me"]
    assert game.work.snap_share == 0.75
    assert game.work.red_zone == 3.0
    assert game.defaults == frozenset()


def test_vacated_volume_sums_withheld_teammates_who_played_in_the_clubs_last_three() -> None:
    games = {
        "me": _games("KC", [(4, 1.0), (5, 1.0), (6, 1.0)]),
        "out": _games("KC", [(1, 2.0), (2, 2.0), (5, 6.0), (6, 10.0)]),  # last three: 2, 6, 10
        "doubtful_gone": _games("KC", [(1, 9.0), (2, 9.0)]),  # played none of weeks 4, 5, 6
        "questionable": _games("KC", [(6, 50.0)]),
        "other_club": _games("DEN", [(6, 50.0)]),
    }
    statuses: dict[str, WeekStatus] = {
        "out": "withheld",
        "doubtful_gone": "withheld",
        "questionable": "questionable",
        "other_club": "withheld",
    }
    found = _features(_snapshot(games, statuses))
    assert found.vacated.targets == pytest.approx(6.0)
    assert found.vacating == 1
    assert TEAMMATE_NOT_IN_LAST_THREE in found.defaults


def test_pace_is_the_mean_over_the_clubs_games_that_carry_it() -> None:
    rows = {("KC", w): {"pace_seconds_per_play": 30.0, "pass_rate": 0.5} for w in range(1, 6)}
    rows[("KC", 6)] = {"pass_rate": 0.8}
    found = _features(_snapshot({"me": _games("KC", [(6, 1.0)])}, team_rows=rows))
    assert found.pace == 30.0
    assert found.pass_rate == pytest.approx((0.5 * 5 + 0.8) / 6)
    assert CLUB_GAME_WITHOUT_PACE in found.defaults


def test_a_club_with_no_pace_at_all_has_none_for_the_fit_populations_mean() -> None:
    found = _features(_snapshot({"me": _games("KC", [(6, 1.0)])}, team_rows={("KC", 6): {}}))
    assert (found.pace, found.pass_rate) == (None, None)


def test_an_opponent_with_no_game_marks_its_default() -> None:
    def none_yet(position: str, kind: Kind) -> Allowance:
        del position, kind
        return Allowance(1.0, 0, NO_GAME)

    snap = _snapshot({"me": _games("KC", [(6, 1.0)])})
    found = game_features("me", "WR", "KC", snap, {}, _schedule(), none_yet, KINDS[:4])
    assert found is not None
    assert found.allowance == ONES
    assert NO_GAME in found.defaults


def test_the_neutral_game_keeps_his_season_and_club_and_resets_the_rest() -> None:
    games = {"me": _games("KC", [(4, 1.0), (5, 2.0), (6, 9.0)]), "out": _games("KC", [(6, 5.0)])}
    found = _features(_snapshot(games, {"out": "withheld"}), {"me": _work(2.0)})
    base = neutral(found)
    assert base.last_three == found.season_mean
    assert (base.vacated, base.allowance, base.home) == (ZERO, ONES, NEUTRAL_HOME)
    assert (base.season_mean, base.prior, base.no_prior) == (found.season_mean, found.prior, found.no_prior)
    assert (base.pace, base.pass_rate) == (found.pace, found.pass_rate)
