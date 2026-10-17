# ruff: noqa: PLR2004 - the expected values are hand-counted from the plays written beside them
"""Round 4's play-level tallies (preregistration sections 2.2 to 2.4): each play is a target, a
designed rush and a dropback as the play table says, and the tallies of a game give the player's
counts of each kind of opportunity, the club's totals, the defence's pressure and the position
groups' targets by depth and location."""

from datetime import UTC, datetime

from research.model.weekly4.features.plays import (
    DEPTH_BUCKETS,
    Play,
    depth_bucket,
    is_designed_rush,
    is_dropback,
    is_target,
    tally,
)

_AT = datetime(2023, 10, 17, tzinfo=UTC)


def _play(**fields: object) -> Play:
    base: dict[str, object] = {
        "game_id": "2023_06_KC_DEN",
        "play_id": 1,
        "season": 2023,
        "week": 6,
        "as_of": _AT,
        "posteam": "KC",
        "defteam": "DEN",
        "down": 1,
        "ydstogo": 10,
        "yardline_100": 50,
        "play_type": "pass",
        "qb_dropback": True,
        "qb_scramble": False,
        "sack": False,
        "qb_hit": False,
        "two_point_attempt": False,
        "passer_player_id": "qb",
        "rusher_player_id": None,
        "receiver_player_id": "wr",
        "yards_gained": 8.0,
        "air_yards": 6.0,
        "complete_pass": True,
        "interception": False,
        "pass_touchdown": False,
        "rush_touchdown": False,
        "pass_location": "left",
        "run_location": None,
        "run_gap": None,
    }
    base.update(fields)
    return Play(**base)  # type: ignore[arg-type]


def test_a_completed_pass_is_a_target_and_a_dropback_and_a_scramble_a_dropback_only() -> None:
    target = _play()
    scramble = _play(play_type="run", qb_scramble=True, rusher_player_id="qb", receiver_player_id=None)
    run = _play(
        play_type="run", qb_dropback=False, rusher_player_id="rb", receiver_player_id=None, passer_player_id=None
    )
    sack = _play(sack=True, receiver_player_id=None)
    two_point = _play(two_point_attempt=True)
    assert (is_target(target), is_dropback(target), is_designed_rush(target)) == (True, True, False)
    assert (is_target(scramble), is_dropback(scramble), is_designed_rush(scramble)) == (False, True, False)
    assert (is_target(run), is_dropback(run), is_designed_rush(run)) == (False, False, True)
    assert (is_target(sack), is_dropback(sack)) == (False, True)
    assert not is_target(two_point) and not is_dropback(two_point)


def test_target_depth_buckets_are_behind_the_line_under_ten_ten_to_nineteen_and_twenty_on() -> None:
    assert DEPTH_BUCKETS == ("behind", "short", "intermediate", "deep")
    assert [depth_bucket(a) for a in (-2.0, 0.0, 9.0, 10.0, 19.0, 20.0, None)] == [
        "behind",
        "short",
        "short",
        "intermediate",
        "intermediate",
        "deep",
        None,
    ]


def test_a_games_tallies_count_the_player_the_club_and_the_defence() -> None:
    plays = [
        _play(play_id=1, yardline_100=15, air_yards=12.0, pass_location="middle"),
        _play(play_id=2, sack=True, qb_hit=True, receiver_player_id=None, air_yards=None),
        _play(
            play_id=3,
            play_type="run",
            qb_dropback=False,
            passer_player_id=None,
            rusher_player_id="rb",
            receiver_player_id=None,
            yardline_100=8,
            air_yards=None,
        ),
        _play(play_id=4, receiver_player_id="rb", air_yards=-3.0, complete_pass=False, pass_location="right"),
    ]
    found = tally(plays, {"wr": "WR", "rb": "RB", "qb": "QB"})
    wr = found.players[("wr", 6)]
    assert wr.club == "KC"
    assert (wr.counts.targets, wr.counts.air_yards, wr.counts.red_zone, wr.counts.inside_ten) == (1.0, 12.0, 1.0, 0.0)
    assert wr.receptions == 1.0 and wr.depth == (0.0, 0.0, 1.0, 0.0) and wr.middle == 1.0
    rb = found.players[("rb", 6)]
    assert (rb.counts.targets, rb.counts.carries, rb.counts.red_zone, rb.counts.inside_ten) == (1.0, 1.0, 1.0, 1.0)
    assert rb.receptions == 0.0 and rb.rush_attempts == 1.0 and rb.outside == 1.0
    assert found.players[("qb", 6)].counts.dropbacks == 3.0
    club = found.clubs[("KC", 6)]
    assert (club.targets, club.carries, club.dropbacks, club.red_zone, club.inside_ten) == (2.0, 1.0, 3.0, 2.0, 1.0)
    assert club.air_yards == 9.0
    pressure = found.defences[("DEN", 6)]
    assert (pressure.dropbacks, pressure.sacks, pressure.hits) == (3.0, 1.0, 1.0)
    groups = found.groups[("KC", 6)]
    assert groups["RB"].air == 1.0 and groups["RB"].ground == 1.0
    assert groups["WR"].depth == (0.0, 0.0, 1.0, 0.0) and groups["WR"].middle == 1.0
