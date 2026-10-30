"""Lane 302 (B304): the week read's call is decided in code from his status and his place this week, the writer
told it as a fact, a different call in the answer refused with its correction, the decided call stored, and a read
whose call moved written again."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week import collect
from research.capsules.week.cadence import (
    CALL_CHANGED,
    HOURLY_REASONS,
    STATUS_REWRITES_A_DAY,
    due_reason,
    kept_read,
)
from research.capsules.week.call import (
    CALL_MARGIN,
    HOLD,
    NONE,
    SIT,
    START,
    STARTER_LINE,
    call_flipped,
    week_call,
    week_ranks,
)
from research.capsules.week.collect import board_week_ranks
from research.capsules.week.prompt import call_section, week_correction, week_prompt
from research.capsules.week.report_day import status_report_issued
from research.capsules.week.rules import week_rule_violations
from research.capsules.week.sheet import BoardPlace, PublishedProjection, Status, WeekSheet
from research.capsules.week.start_advice import sit_advice_in
from research.capsules.week.store import StoredWeekRead
from research.capsules.week.validate import validate_week_read
from research.capsules.week.write import MAX_ASKS_WITH_RETRY, write_week_read
from research.tests.test_week_read_writer import _answer, _StubGateway
from research.tests.week_read_fixtures import BOARD, KICKOFF, REPORT, WRITTEN_AT, on_bye, starter

_LINES = {"QB": 12, "RB": 29, "WR": 30, "TE": 13, "K": 12, "DEF": 12}


def _ranked(position: str, week_rank: int | None, *, board_rank: int = 40) -> WeekSheet:
    """A sheet at `position` placed `week_rank` this week, and `board_rank` in our rest-of-season order."""
    board = BoardPlace(120, board_rank, 120.0, "rest_of_season", 6, BOARD)
    return replace(starter(), position=position, board=board, week_rank=week_rank)


def _status(status: str | None, seen: datetime = REPORT, *, week_rank: int = 10) -> WeekSheet:
    return replace(_ranked("WR", week_rank), status=Status(status, seen))


_ISSUED = status_report_issued(KICKOFF)
_BEFORE = _ISSUED - timedelta(minutes=1)


def test_the_starter_line_is_twelve_teams_one_quarterback_and_one_flex() -> None:
    assert dict(STARTER_LINE) == _LINES
    # The flex's twelve slots are split among the backs, receivers and tight ends, and no more.
    assert sum(STARTER_LINE.values()) - 12 * 8 == 12  # noqa: PLR2004 - the flex slots


def test_the_week_ranks_his_position_by_the_weeks_points_ties_sharing_a_place() -> None:
    ranks = week_ranks([("a", "RB", 20.1), ("b", "RB", 18.0), ("c", "RB", 18.0), ("d", "RB", 9.5), ("e", "WR", 3.0)])
    assert ranks == {"a": 1, "b": 2, "c": 2, "d": 4, "e": 1}


@pytest.mark.parametrize("position", sorted(_LINES))
def test_his_place_at_the_line_is_a_start_and_one_past_it_a_sit(position: str) -> None:
    line = _LINES[position]
    assert week_call(_ranked(position, line)).call == START
    assert week_call(_ranked(position, 1)).call == START
    assert week_call(_ranked(position, line + 1)).call == SIT


def test_his_place_this_week_decides_over_our_order() -> None:
    assert week_call(_ranked("RB", 40, board_rank=3)).call == SIT
    assert week_call(_ranked("RB", 3, board_rank=40)).call == START


def test_the_call_names_his_place_this_week_without_the_points() -> None:
    assert week_call(_ranked("RB", 18)).words == (
        "The call is start: he ranks 18th among running backs this week, so he belongs in a lineup."
    )
    assert week_call(_ranked("RB", 30)).words == (
        "The call is sit: he ranks 30th among running backs this week, past the running backs a lineup starts."
    )


@pytest.mark.parametrize("position", sorted(_LINES))
def test_with_no_projection_the_call_reads_our_order_and_says_so(position: str) -> None:
    line = _LINES[position]
    assert week_call(_ranked(position, None, board_rank=line)).call == START
    assert week_call(_ranked(position, None, board_rank=line + 1)).call == SIT
    preseason = replace(_ranked("RB", None), board=BoardPlace(60, 30, None, "preseason", None, BOARD))
    assert week_call(preseason).words == (
        "The call is sit: with no ranking for him this week, the call reads our preseason order, where he is RB30, "
        "past the running backs a lineup starts."
    )


def test_his_bye_is_a_sit_whatever_his_rank() -> None:
    decided = week_call(on_bye())
    assert decided.call == SIT
    assert "bye in week 6" in decided.words


@pytest.mark.parametrize("status", ["out", "injured_reserve", "suspended", "pup", "nfi"])
def test_a_status_that_keeps_him_off_the_field_is_a_sit(status: str) -> None:
    decided = week_call(_status(status))
    assert decided.call == SIT
    assert "does not play in week 6" in decided.words


def test_questionable_inside_the_line_is_a_hold_before_the_report_and_a_start_on_it() -> None:
    held = week_call(_status("questionable", _BEFORE))
    assert held.call == HOLD
    assert held.words == (
        "The call is hold: he ranks 10th among receivers this week, but he is Questionable before week 6's game "
        "status report."
    )
    assert week_call(_status("questionable", _ISSUED)).call == START
    assert week_call(_status("questionable", _BEFORE, week_rank=30)).call == HOLD


def test_questionable_or_doubtful_past_the_line_is_a_sit() -> None:
    for status in ("questionable", "doubtful"):
        for seen in (_BEFORE, _ISSUED):
            assert week_call(_status(status, seen, week_rank=31)).call == SIT, (status, seen)


def test_doubtful_inside_the_line_is_a_hold_before_and_after_the_report() -> None:
    assert week_call(_status("doubtful", _BEFORE)).call == HOLD
    assert week_call(_status("doubtful", _ISSUED, week_rank=30)).call == HOLD


def test_no_place_at_all_is_no_lineup_call_or_a_hold_for_a_listed_player() -> None:
    nowhere = replace(_ranked("WR", None), board=None)
    assert week_call(nowhere).call == NONE
    assert week_call(_ranked("FB", 1)).call == NONE
    assert week_call(replace(nowhere, status=Status("questionable", _BEFORE))).call == HOLD
    assert week_call(replace(nowhere, status=Status("doubtful", _ISSUED))).call == HOLD


def test_the_same_sheet_gives_the_same_call() -> None:
    sheets = [_ranked("WR", rank) for rank in range(1, 60)]
    assert [week_call(s) for s in sheets] == [week_call(s) for s in sheets]


def test_the_writer_is_given_the_call_to_argue_in_the_ask_and_the_correction() -> None:
    sheet = _ranked("RB", 18)
    section = call_section(sheet)
    assert '"call" is "start"' in section and "18th among running backs this week" in section
    assert section in week_prompt(sheet, ())
    assert section in week_correction(sheet, "A draft.", (), ())


_SIT_READ = (
    "Puka Nacua carries no designation on the Tuesday-night list for week 6 of 2026. He sits behind the receivers "
    "a lineup starts in our rest-of-season order. Arizona is an ordinary matchup, but the role is too "
    "thin to count on. Sit him this week."
)


def test_an_answer_whose_call_is_not_the_decided_one_is_refused_with_its_correction() -> None:
    sheet = _ranked("WR", 31)
    refused = [v for v in week_rule_violations(_SIT_READ, sheet, START) if "the call for him this week" in v]
    assert refused == [
        'The answer\'s call is "start", but the call for him this week is "sit". The call is sit: he ranks 31st '
        'among receivers this week, past the receivers a lineup starts. Give "call" as "sit" and write the read '
        "that argues it."
    ]
    assert not [v for v in week_rule_violations(_SIT_READ, sheet, SIT) if "the call for him this week" in v]


def test_a_sit_read_that_tells_a_manager_to_start_him_is_refused() -> None:
    sheet = _ranked("WR", 31)
    read = _SIT_READ.replace("Sit him this week.", "Start him anyway.")
    assert any("when the call is sit" in v for v in week_rule_violations(read, sheet, SIT))
    # A hold may say when it turns to a start.
    held = replace(_ranked("WR", 10), status=Status("questionable", _BEFORE))
    assert not any("when the call is sit" in v for v in week_rule_violations(read, held, HOLD))


def test_the_stored_call_is_the_decided_one_written_or_fallen() -> None:
    sheet = _ranked("WR", 31)
    result = write_week_read(sheet, _StubGateway([_answer(_SIT_READ, START), _answer(_SIT_READ, SIT)]))  # type: ignore[arg-type]
    assert (result.source, result.call, result.calls) == (WRITTEN_SOURCE, SIT, 2)
    assert any("the call for him this week" in v for v in result.attempts[0].violations)
    fallen = write_week_read(sheet, _StubGateway([_answer(_SIT_READ, START)] * MAX_ASKS_WITH_RETRY))  # type: ignore[arg-type]
    assert fallen.source == FACTS_SOURCE
    assert fallen.call == SIT


_NOW = WRITTEN_AT + timedelta(hours=2)


def _stored(sheet: WeekSheet, call: str, attempts: int = 1) -> StoredWeekRead:
    return StoredWeekRead(
        sheet.player_id, sheet.season, sheet.week, WRITTEN_SOURCE, _SIT_READ, "stub/writer", WRITTEN_AT, None, {},
        None, sheet.status.status, "first", call, _NOW.date(), attempts,
    )  # fmt: skip


def test_a_read_whose_call_moved_is_due_nightly_and_hourly() -> None:
    crossed = _ranked("WR", 28)
    assert due_reason(crossed, _stored(crossed, SIT), _NOW) == CALL_CHANGED
    assert due_reason(crossed, _stored(crossed, SIT), _NOW, hourly=True) == CALL_CHANGED
    assert CALL_CHANGED in HOURLY_REASONS
    assert due_reason(crossed, _stored(crossed, START), _NOW) is None


def test_a_start_or_sit_flips_on_his_place_only_past_the_margin() -> None:
    """The review's M2: a player at the line never reads start, sit, start on tenths. WR line 30, margin 3."""
    assert CALL_MARGIN == 3  # noqa: PLR2004 - the ruling's margin, its reason at the constant
    # A stored start: sit only at 3 places past the line.
    assert not call_flipped(_ranked("WR", 31), START)
    assert not call_flipped(_ranked("WR", 32), START)
    assert call_flipped(_ranked("WR", 33), START)
    # A stored sit: start only 3 places inside it (30 is 1, 29 is 2, 28 is 3).
    assert not call_flipped(_ranked("WR", 30), SIT)
    assert not call_flipped(_ranked("WR", 29), SIT)
    assert call_flipped(_ranked("WR", 28), SIT)
    # The same call never flips.
    assert not call_flipped(_ranked("WR", 50), SIT)


def test_a_move_a_status_drives_flips_at_once() -> None:
    at_line = _ranked("WR", 31)
    assert call_flipped(replace(at_line, status=Status("out", REPORT)), START)
    assert call_flipped(replace(_ranked("WR", 30), status=Status("doubtful", REPORT)), START)
    assert call_flipped(replace(_ranked("WR", 30), status=Status("questionable", _ISSUED)), HOLD)
    assert call_flipped(replace(_ranked("WR", 31), bye=True), START)


def test_a_call_rewrite_that_keeps_falling_is_capped_like_a_status_rewrite() -> None:
    crossed = _ranked("WR", 28)
    day = datetime(2026, 10, 16, 23, 0, tzinfo=UTC)
    capped = replace(_stored(crossed, SIT, attempts=STATUS_REWRITES_A_DAY + 1), attempt_day=day.date())
    assert due_reason(crossed, capped, day) is None


def _subject(universe: str, provider: str, position: str) -> SimpleNamespace:
    identity = SimpleNamespace(id=provider, position=position)
    return SimpleNamespace(universe_id=universe, facts=SimpleNamespace(identity=identity))


def test_the_board_weeks_places_rank_every_board_player_with_a_projection_that_week(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`collect.board_week_ranks`: the peers are every subject with a published projection for the board week, his
    sheet read tonight or not; another week's projection and a player with none take no place."""
    projected = {("p1", 6): 12.0, ("p2", 6): 19.5, ("p3", 7): 30.0}
    facts = SimpleNamespace(
        board_week=6, projections={k: PublishedProjection(v, REPORT, None, None) for k, v in projected.items()}
    )
    monkeypatch.setattr(collect, "_takes_the_field", lambda _facts, _subject: True)
    subjects = [_subject("u1", "p1", "RB"), _subject("u2", "p2", "RB"), _subject("u3", "p3", "RB")]
    assert board_week_ranks(facts, subjects) == {"u2": 1, "u1": 2}  # type: ignore[arg-type]


def test_a_player_who_takes_no_field_holds_no_place(monkeypatch: pytest.MonkeyPatch) -> None:
    """The review's L3: a bye club's projected defense and a player ruled out take no starter place from anyone."""
    clubs = {"p1": "ATL", "p2": "DET", "p3": "ATL", "p4": "ATL"}
    monkeypatch.setattr(collect, "call_for", lambda _clubs, pid: SimpleNamespace(club=clubs[pid]))
    monkeypatch.setattr(collect, "_board_game", lambda _facts, club: None if club == "DET" else object())
    projected = {("p1", 6): 12.0, ("p2", 6): 19.5, ("p3", 6): 15.0, ("p4", 6): 9.0}
    facts = SimpleNamespace(
        board_week=6,
        context=SimpleNamespace(clubs={}),
        statuses={"p3": Status("out", REPORT)},
        projections={k: PublishedProjection(v, REPORT, None, None) for k, v in projected.items()},
    )
    subjects = [_subject(f"u{n}", f"p{n}", "RB") for n in range(1, 5)]
    assert board_week_ranks(facts, subjects) == {"u1": 1, "u4": 2}  # type: ignore[arg-type]


_BENCHING = (
    "Bench Puka Nacua for week 6 of 2026, because his role is thinner than it looks. Arizona is an ordinary "
    "matchup for receivers. He carries no designation on the Tuesday-night list. Sit him this week and play a "
    "steadier receiver instead."
)


def test_a_start_read_that_tells_a_manager_to_sit_or_bench_him_is_refused() -> None:
    """The review's M1 probe: a decided start whose read benches him."""
    refused = [v for v in week_rule_violations(_BENCHING, _ranked("WR", 5), START) if "when the call is start" in v]
    assert len(refused) == 2  # noqa: PLR2004 - "Bench Puka Nacua" and "Sit him"
    assert "Argue the start" in refused[0]


@pytest.mark.parametrize(
    ("sentence", "said"),
    [
        ("Sit him this week.", "Sit him"),
        ("Bench Nacua for week 6.", "Bench Nacua"),
        ("Keep him out of your lineup.", "Keep him out of your lineup"),
        ("Leave him on the bench.", "Leave him on the bench"),
        ("Start someone else over him.", "Start someone else over"),
        ("He sits first among Los Angeles receivers.", None),
        ("Don't sit him.", None),
        ("Never bench Nacua.", None),
    ],
)
def test_the_sit_phrases_are_read_and_a_negation_is_not_one(sentence: str, said: str | None) -> None:
    assert sit_advice_in(sentence, "Puka Nacua") == said


def test_a_hold_read_settles_the_week_only_with_what_it_waits_on() -> None:
    held = replace(_ranked("WR", 10), status=Status("questionable", _BEFORE))
    assert week_call(held).call == HOLD
    for flat in ("Start him this week.", "Bench him this week."):
        assert any("with nothing to wait on" in v for v in week_rule_violations(flat, held, HOLD)), flat
    for waits in ("If he's cleared, start him.", "Bench him until Friday's report clears him."):
        assert not any("with nothing to wait on" in v for v in week_rule_violations(waits, held, HOLD)), waits


def test_his_place_this_week_is_never_quoted() -> None:
    """The review's L4: the place is the call's alone, so a read that states it is refused as a figure the sheet
    does not carry, and the ask says so."""
    sheet = _ranked("WR", 18)
    quoted = "Puka Nacua ranks 18th among receivers this week."
    assert any("states his place this week" in v for v in validate_week_read(quoted, sheet, call=START).violations)
    in_our_order = "Puka Nacua is WR18 in our rest-of-season order."
    assert not any("states his place this week" in v for v in week_rule_violations(in_our_order, sheet, START))
    assert "never quote it" in call_section(sheet)


def test_a_missing_call_is_told_the_decided_one() -> None:
    assert any('Give "call" as "sit"' in v for v in week_rule_violations(_SIT_READ, _ranked("WR", 31), None))


def test_a_kept_read_keeps_the_call_its_body_argues() -> None:
    """The review's L1: a written read kept over a fallen call rewrite keeps its own call, never the new one."""
    sheet = _ranked("WR", 28)
    before = _stored(sheet, SIT)
    assert kept_read(before, _NOW).call == SIT
