"""Lane 300's angles on the real tables (the review's H3): the usage read, the depth-chart move and the sheets with
the angles on, against a migrated scratch database seeded the way the week's roll-over reads it (the wiring seed of
`test_week_read_wiring`, with usage rows on top). Needs PARITY_DATABASE_URL (a server where the harness may create
`parity_*` databases); skipped without it."""

import os
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import Any, Final, cast

import pytest
from sqlalchemy import Engine, insert

from research.capsules.sweep import Subject
from research.capsules.week import angles as angles_module
from research.capsules.week.angle_candidates import AngleFigure, Measure
from research.capsules.week.collect import collect_week_sheets, read_week_facts
from research.capsules.week.depth_moves import depth_moves
from research.capsules.week.usage_reads import usage_by_player
from research.capsules.week.validate import validate_week_read
from research.db.engine import make_engine
from research.db.schema import (
    NFLVERSE_DEPTH_CHART_WEEKS,
    PLAYER_WEEK_OBSERVATIONS,
    PLAYER_WEEK_TEAMS,
    PLAYERS,
    PROVIDER_GAMES,
    PROVIDER_PLAYERS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.tests.test_week_read_wiring import _AFTER_THURSDAY_KICKOFF, _SEASON, _WEDNESDAY_RUN, _WEEK, _seed

_DATABASE: Final = "parity_lane300_week_read_angles"
_EARLY: Final = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
_LATER: Final = datetime(2026, 10, 21, 12, 0, tzinfo=UTC)
# Ten Seattle and Houston backs over weeks 1 to 6, carrying 1 to 10 of their club's 25 carries a game, 40 snaps
# of 60 and 2 of 30 targets: the tenth leads the board on his carry share, 10 of 25.
_BACKS: Final = tuple((f"00-10000{n:02d}", f"Back Number{n}", "SEA" if n % 2 else "HOU", n) for n in range(1, 11))
# The traded receiver: Rams weeks 1 to 3 (the store's "LA"), Chiefs weeks 4 to 6, no row in week 2, a 0-snap week 5.
_TRADED: Final = "00-2000001"
_MATE: Final = "00-2000002"


def _row(  # noqa: PLR0913, PLR0917 - a row's columns
    week: int, player: str, source: str, metric: str, value: float, at: datetime = _EARLY
) -> dict[str, Any]:
    return {"season": _SEASON, "week": week, "player_id": player, "source": source, "metric": metric, "value": value,
            "as_of": at}  # fmt: skip


def _usage_rows(week: int, player: str, *, snaps: float, carries: float, targets: float) -> list[dict[str, Any]]:
    return [
        _row(week, player, "nflverse_snap_counts", "offensive_snaps", snaps),
        _row(week, player, "nflverse_snap_counts", "team_offensive_snaps", 60),
        _row(week, player, "nflverse_player_week", "carries", carries),
        _row(week, player, "nflverse_player_week", "team_carries", 25),
        _row(week, player, "nflverse_player_week", "targets", targets),
        _row(week, player, "nflverse_player_week", "team_targets", 30),
        _row(week, player, "nflverse_pbp_player", "pbp_carries", carries),
        _row(week, player, "nflverse_pbp_player", "pbp_targets", targets),
    ]


def _seed_usage(engine: Engine) -> None:
    rows: list[dict[str, Any]] = []
    teams: list[dict[str, Any]] = []
    for pid, _name, club, n in _BACKS:
        for week in range(1, 7):
            rows += _usage_rows(week, pid, snaps=40, carries=n, targets=2)
            teams.append({"season": _SEASON, "week": week, "player_id": pid, "team": club, "as_of": _EARLY})
    for week, club in ((1, "LA"), (3, "LA"), (4, "KC"), (5, "KC"), (6, "KC")):
        snaps = 0 if week == 5 else 50  # noqa: PLR2004 - his 0-snap week
        if snaps:
            rows += _usage_rows(week, _TRADED, snaps=snaps, carries=0, targets=6)
            rows += [_row(week, _TRADED, "nflverse_pbp_player", "air_yards", 60),
                     _row(week, _TRADED, "nflverse_pbp_player", "air_yard_targets", 6),
                     _row(week, _TRADED, "nflverse_pbp_player", "red_zone_targets", 1)]  # fmt: skip
        else:
            rows.append(_row(week, _TRADED, "nflverse_snap_counts", "offensive_snaps", 0))
        teams.append({"season": _SEASON, "week": week, "player_id": _TRADED, "team": club, "as_of": _EARLY})
        # A teammate on the same club each week: the club's air yards and red-zone chances are the two summed.
        rows += [_row(week, _MATE, "nflverse_pbp_player", "air_yards", 140),
                 _row(week, _MATE, "nflverse_pbp_player", "pbp_targets", 4),
                 _row(week, _MATE, "nflverse_pbp_player", "red_zone_carries", 3)]  # fmt: skip
        teams.append({"season": _SEASON, "week": week, "player_id": _MATE, "team": club, "as_of": _EARLY})
    # A newer statement of week 6's targets replaces the older one.
    rows.append(_row(6, _TRADED, "nflverse_player_week", "targets", 9, _LATER))
    people = [(pid, name, "RB") for pid, name, _club, _n in _BACKS]
    people += [(_TRADED, "Traded Receiver", "WR"), (_MATE, "Mate Back", "RB")]
    with engine.begin() as conn:
        conn.execute(insert(PLAYERS), [{"id": pid, "name": name, "position": pos} for pid, name, pos in people])
        conn.execute(insert(PLAYER_WEEK_OBSERVATIONS), rows)
        conn.execute(insert(PLAYER_WEEK_TEAMS), teams)
        conn.execute(
            insert(PROVIDER_PLAYERS),
            [{"id": pid, "name": name, "position": "RB", "team": club} for pid, name, club, _n in _BACKS],
        )


def _chart(  # noqa: PLR0913, PLR0917 - a row's columns
    week: int, team: str, slot: str, order: int, pid: str, at: datetime, position: str
) -> dict[str, Any]:
    return {"season": _SEASON, "week": week, "team": team, "slot": slot, "depth_order": order, "player_id": pid,
            "as_of": at, "position": position}  # fmt: skip


def _seed_charts(engine: Engine) -> None:
    week6, week7, bye = (datetime(2026, 10, d, 12, 0, tzinfo=UTC) for d in (14, 21, 26))
    rows = [
        # Seattle's backs swap on week 7's chart; a third appears on it alone.
        _chart(6, "SEA", "RB_1", 1, "00-3000001", week6, "RB"), _chart(6, "SEA", "RB_1", 2, "00-3000002", week6, "RB"),
        _chart(7, "SEA", "RB_1", 1, "00-3000002", week7, "RB"), _chart(7, "SEA", "RB_1", 2, "00-3000001", week7, "RB"),
        _chart(7, "SEA", "RB_1", 3, "00-3000003", week7, "RB"),
        # A back listed at RB and FB: first at RB on both charts, first then second at FB.
        _chart(6, "SEA", "FB_1", 1, "00-3000004", week6, "FB"), _chart(7, "SEA", "FB_1", 2, "00-3000004", week7, "FB"),
        _chart(6, "SEA", "RB_2", 4, "00-3000004", week6, "RB"), _chart(7, "SEA", "RB_2", 4, "00-3000004", week7, "RB"),
        # Houston on its bye: the snapshot after week 7 is filed under week 9, its next game.
        _chart(7, "HOU", "WR_1", 1, "00-3000011", week7, "WR"), _chart(7, "HOU", "WR_1", 2, "00-3000012", week7, "WR"),
        _chart(9, "HOU", "WR_1", 1, "00-3000012", bye, "WR"), _chart(9, "HOU", "WR_1", 2, "00-3000011", bye, "WR"),
    ]  # fmt: skip
    people = sorted({(r["player_id"], r["position"]) for r in rows})
    with engine.begin() as conn:
        conn.execute(
            insert(PLAYERS), [{"id": pid, "name": f"Chart {pid}", "position": pos} for pid, pos in dict(people).items()]
        )
        conn.execute(insert(NFLVERSE_DEPTH_CHART_WEEKS), rows)


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    _seed(built)
    _seed_usage(built)
    _seed_charts(built)
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


@pytest.fixture
def angles_on() -> Iterator[None]:
    held = angles_module.ANGLES_ON
    setattr(angles_module, "ANGLES_ON", True)  # noqa: B010 (a Final switch, set for the test)
    yield
    setattr(angles_module, "ANGLES_ON", held)  # noqa: B010


def test_the_usage_read_sums_his_weeks_under_the_club_of_each_week(engine: Engine) -> None:
    with engine.connect() as conn:
        usage = usage_by_player(conn, _SEASON, _WEDNESDAY_RUN)
    weeks = usage[_TRADED]
    # Week 2 has no row and week 5 no snap: neither is a week of his.
    assert [(w.week, w.team) for w in weeks] == [(1, "LAR"), (3, "LAR"), (4, "KC"), (6, "KC")]
    first = weeks[0]
    assert (first.snaps, first.team_snaps, first.targets, first.team_targets) == (50, 60, 6, 30)
    # The club's air yards and red-zone chances are every player the store places on the club that week.
    assert (first.air_yards, first.team_air_yards, first.red_zone, first.team_red_zone) == (60, 200, 1, 4)
    assert weeks[-1].targets == 9  # noqa: PLR2004 - the newer statement
    # A player with only play-by-play rows has the play-by-play counts he touched and none of the shares.
    mate = usage[_MATE][0]
    assert mate.snaps is None and mate.air_yards == 140 and mate.red_zone == 3  # noqa: PLR2004


def test_the_usage_read_sees_only_statements_made_by_the_instant(engine: Engine) -> None:
    with engine.connect() as conn:
        usage = usage_by_player(conn, _SEASON, datetime(2026, 10, 21, 0, 0, tzinfo=UTC))
    assert usage[_TRADED][-1].targets == 6  # noqa: PLR2004 - before the newer statement


def test_the_depth_move_compares_the_newest_snapshot_with_the_chart_before(engine: Engine) -> None:
    with engine.connect() as conn:
        moves = depth_moves(conn, _SEASON, _WEDNESDAY_RUN)
    assert moves[("00-3000001", "RB")] == 1.0 and moves[("00-3000002", "RB")] == 2.0  # noqa: PLR2004
    assert ("00-3000003", "RB") not in moves  # on the newest chart alone
    # Each position on its own: the back moved at FB, not at RB.
    assert moves[("00-3000004", "FB")] == 1.0 and ("00-3000004", "RB") not in moves
    # A club on its bye: its snapshot filed under week 9 is the newest, week 7's the chart before.
    assert moves[("00-3000012", "WR")] == 2.0 and moves[("00-3000011", "WR")] == 1.0  # noqa: PLR2004


def _subject(pid: str, name: str, club: str) -> Subject:
    identity = SimpleNamespace(id=pid, name=name, position="RB", team=club)
    facts = SimpleNamespace(identity=identity, depth=SimpleNamespace(depth_chart=None))
    return cast("Subject", SimpleNamespace(facts=facts, universe_id=pid))


@pytest.mark.usefixtures("angles_on")
def test_the_sheets_carry_angles_from_the_stored_usage(engine: Engine) -> None:
    """The angles on the real rows: the tenth back leads on his carry share (10 of 25, the board's highest), stated
    as the sheet prints it, with its figure bound to its measure; a read in its words passes the validator."""
    subjects = [_subject(pid, name, club) for pid, name, club, _n in _BACKS]
    with engine.connect() as conn:
        facts = read_week_facts(conn, _SEASON, subjects, _WEDNESDAY_RUN)
    assert facts is not None and facts.board_week == _WEEK
    sheets = {s.name: s for s in collect_week_sheets(facts, subjects, {})}
    top = sheets["Back Number10"]
    carries = next(a for a in top.angles if a.key == "carry_share")
    assert carries.text == (
        "Carries: 40% of the Texans' carries in his games this season, the highest among running backs "
        "(far out of the ordinary for a running back)."
    )
    assert carries.figures == (AngleFigure(40.0, Measure.CARRIES),)
    assert carries.basis is not None and (carries.basis.games, carries.basis.count) == (6, 60)
    read = (
        "Back Number10 takes 40% of the Texans' carries, the highest among the running backs we rank, in week 8 of "
        "2026. Seattle comes to Houston on Sunday. Start him."
    )
    result = validate_week_read(read, top, call="start")
    assert not any("usage fact" in v for v in result.violations), result.violations
    # A back on 1 carry a game (6 of his own) is on a thin basis: no carry angle reaches his sheet.
    assert all(a.key != "carry_share" for a in sheets["Back Number1"].angles)


_RAMS_BACK: Final = ("00-1000099", "Rams Back", "LAR")


@pytest.mark.usefixtures("angles_on")
def test_after_thursdays_kickoff_the_peers_still_count_the_club_that_played(engine: Engine) -> None:
    """The review's M1: after Thursday night the Rams have no sheet for week 8, and their back, who carries 12 of
    25, still sits among the peers, so Houston's back is "the 2nd-highest", never the highest of a partial week."""
    pid, name, club = _RAMS_BACK
    with engine.begin() as conn:
        # The Rams' and Arizona's weeks 1 to 5, so the Rams' slate reads and his season block is built.
        conn.execute(
            insert(PROVIDER_GAMES),
            [
                {"game_id": f"2026090{week}_ARI@LAR", "season": _SEASON, "week": week, "home_team": "LAR",
                 "away_team": "ARI", "game_date": date(2026, 9, 6) + timedelta(days=7 * (week - 1)),
                 "kickoff_et": "1:00p", "status": "scheduled"}
                for week in range(1, 6)
            ],
        )  # fmt: skip
        conn.execute(
            insert(TEAM_WEEK_OBSERVATIONS),
            [
                {"season": _SEASON, "week": week, "team": team, "source": "nflverse_kickoff", "metric": "game_result",
                 "value": 1, "as_of": _EARLY}
                for week in range(1, 6) for team in ("LA", "ARI")
            ],
        )  # fmt: skip
        conn.execute(insert(PLAYERS).values(id=pid, name=name, position="RB"))
        conn.execute(insert(PROVIDER_PLAYERS).values(id=pid, name=name, position="RB", team=club))
        conn.execute(
            insert(PLAYER_WEEK_OBSERVATIONS),
            [r for week in range(1, 7) for r in _usage_rows(week, pid, snaps=40, carries=12, targets=2)],
        )
        conn.execute(
            insert(PLAYER_WEEK_TEAMS),
            [{"season": _SEASON, "week": w, "player_id": pid, "team": "LA", "as_of": _EARLY} for w in range(1, 7)],
        )
    subjects = [*(_subject(p, n, c) for p, n, c, _ in _BACKS), _subject(pid, name, club)]
    with engine.connect() as conn:
        facts = read_week_facts(conn, _SEASON, subjects, _AFTER_THURSDAY_KICKOFF)
    assert facts is not None and facts.board_week == _WEEK
    sheets = {s.name: s for s in collect_week_sheets(facts, subjects, {})}
    assert name not in sheets
    carries = next(a for a in sheets["Back Number10"].angles if a.key == "carry_share")
    assert carries.places == (("the 2nd-highest", "among running backs"),)
