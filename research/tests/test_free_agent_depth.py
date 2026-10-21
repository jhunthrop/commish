"""A free agent's depth facts (Lane 127, B103): his own record (the seasons he played, his injuries) whatever
his club, none of a club's (its depth chart, play caller, offence, schedule), and the record says "a free
agent" once, never a depth-chart line. A player on a club keeps his club's facts; a board free agent is in
no club's depth-chart room, never his old club's by last season's archive."""

from dataclasses import replace
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

from research.capsules.facts.depth_collect import DepthOptions, _depth_for, _depth_rows, _Pass
from research.capsules.facts.depth_model import EMPTY_DEPTH, PriorSeason
from research.capsules.facts.depth_reads import DepthSlot
from research.capsules.facts.depth_role import DepthRow
from research.capsules.render_depth import render_depth_section
from research.free_agent import FREE_AGENT_WORDS

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

_AS_OF = datetime(2026, 10, 20, tzinfo=UTC)
_HIM, _TEAMMATE = "00-him", "00-teammate"
_PRIOR = PriorSeason(2025, 180.4, 16, 20, 90)


def _pass(team_by_player_id: dict[str, str | None]) -> _Pass:
    options = DepthOptions(2026, (2025, 2024, 2023), {_HIM: "WR", _TEAMMATE: "WR"}, team_by_player_id, _AS_OF)
    room = (DepthRow(_HIM, "KC", "WR", 1.0, 2026, _AS_OF), DepthRow(_TEAMMATE, "KC", "WR", 2.0, 2026, _AS_OF))
    return _Pass(
        options=options,
        names={_HIM: "Him", _TEAMMATE: "Teammate"},
        injury_reports={},
        roster_statuses={},
        covered=frozenset(),
        week_scores={},
        headlines={2025: {_HIM: _PRIOR}},
        captures=(),
        pedigree={},
        colleges={},
        opening_day=None,
        rows_by_room={("KC", "WR"): room},
        weekly_shares={},
        competition_by_team={},
        scoring_usage={},
        play_callers=(),
        prior_team_rows={},
        week_one_team_rows={},
        games=(),
        indoors={},
        adp_history={},
    )


def test_a_free_agent_keeps_his_own_record_and_carries_no_club_fact() -> None:
    free = _depth_for(_HIM, None, _pass({_HIM: None}))
    assert free.prior_seasons == (_PRIOR,)
    assert (free.coaching, free.depth_chart, free.target_competition, free.team_context, free.schedule) == (
        None,
        None,
        None,
        None,
        None,
    )
    on_club = _depth_for(_HIM, "KC", _pass({_HIM: "KC"}))
    assert on_club.depth_chart is not None and on_club.depth_chart.slot == 1.0
    assert on_club.prior_seasons == (_PRIOR,)


def test_a_board_free_agent_is_in_no_rooms_list_by_his_old_club() -> None:
    slots = {_HIM: DepthSlot(1.0, _AS_OF), _TEAMMATE: DepthSlot(2.0, _AS_OF)}
    archive = {_HIM: "KC", _TEAMMATE: "KC"}
    options = _pass({_HIM: None, _TEAMMATE: "KC"}).options
    rooms = _depth_rows(slots, options, archive)
    assert [row.player_id for row in rooms[("KC", "WR")]] == [_TEAMMATE]
    # Not on the board: placed by the archive, as before.
    rooms = _depth_rows(slots, replace(options, team_by_player_id={_TEAMMATE: "KC"}), archive)
    assert [row.player_id for row in rooms[("KC", "WR")]] == [_HIM, _TEAMMATE]


def _facts(team: str | None, depth: object) -> "PlayerFacts":
    identity = SimpleNamespace(name="Him", position="WR", team=team)
    return cast("PlayerFacts", SimpleNamespace(identity=identity, depth=depth, season=None, product_season=2026))


def test_the_record_says_a_free_agent_once_and_draws_no_depth_chart_line() -> None:
    record = render_depth_section(_facts(None, _depth_for(_HIM, None, _pass({_HIM: None}))))
    assert record is not None
    assert record.count(FREE_AGENT_WORDS) == 1
    assert "Depth chart" not in record
    assert "Season by season: 2025" in record
    # Even with nothing else held, the free agent's line is the record.
    bare = render_depth_section(_facts(None, EMPTY_DEPTH))
    assert bare is not None and bare.count(FREE_AGENT_WORDS) == 1
    on_club = render_depth_section(_facts("KC", _depth_for(_HIM, "KC", _pass({_HIM: "KC"}))))
    assert on_club is not None and FREE_AGENT_WORDS not in on_club and "Depth chart" in on_club
