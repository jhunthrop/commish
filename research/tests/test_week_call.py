"""Lane 302 (B304): the week read's call is decided in code from his status and his place in our order, the writer
told it as a fact, a different call in the answer refused with its correction, the decided call stored, and a read
whose call moved written again."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.cadence import CALL_CHANGED, HOURLY_REASONS, STATUS_REWRITES_A_DAY, due_reason
from research.capsules.week.call import HOLD, NONE, SIT, START, STARTER_LINE, week_call
from research.capsules.week.prompt import call_section, week_correction, week_prompt
from research.capsules.week.report_day import status_report_issued
from research.capsules.week.rules import week_rule_violations
from research.capsules.week.sheet import BoardPlace, Status, WeekSheet
from research.capsules.week.store import StoredWeekRead
from research.capsules.week.write import MAX_ASKS_WITH_RETRY, write_week_read
from research.tests.test_week_read_writer import _answer, _StubGateway
from research.tests.week_read_fixtures import BOARD, REPORT, WRITTEN_AT, on_bye, starter

_LINES = {"QB": 12, "RB": 29, "WR": 30, "TE": 13, "K": 12, "DEF": 12}


def _ranked(position: str, position_rank: int) -> WeekSheet:
    return replace(starter(), position=position, board=BoardPlace(40, position_rank, 120.0, "rest_of_season", 6, BOARD))


def _status(status: str | None, seen: datetime = REPORT) -> WeekSheet:
    return replace(starter(), status=Status(status, seen))


def test_the_starter_line_is_twelve_teams_one_quarterback_and_one_flex() -> None:
    assert dict(STARTER_LINE) == _LINES
    # The flex's twelve slots are split among the backs, receivers and tight ends, and no more.
    assert sum(STARTER_LINE.values()) - 12 * 8 == 12  # noqa: PLR2004 - the flex slots


@pytest.mark.parametrize("position", sorted(_LINES))
def test_his_rank_at_the_line_is_a_start_and_one_past_it_a_sit(position: str) -> None:
    line = _LINES[position]
    assert week_call(_ranked(position, line)).call == START
    assert week_call(_ranked(position, 1)).call == START
    assert week_call(_ranked(position, line + 1)).call == SIT


def test_the_call_names_his_place_in_the_order_it_comes_from() -> None:
    start = week_call(_ranked("RB", 18))
    assert start.words == (
        "The call is start: he is RB18 in our rest-of-season order, among the running backs a lineup starts."
    )
    preseason = replace(_ranked("RB", 30), board=BoardPlace(60, 30, None, "preseason", None, BOARD))
    assert week_call(preseason).words == (
        "The call is sit: he is RB30 in our preseason order, past the running backs a lineup starts."
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


def test_questionable_is_a_hold_before_and_after_the_report() -> None:
    before = REPORT - timedelta(days=1)
    assert week_call(_status("questionable", before)).call == HOLD
    assert week_call(_status("questionable")).call == HOLD


def test_doubtful_is_a_hold_before_the_report_and_a_sit_on_it() -> None:
    issued = status_report_issued(starter().game.kickoff)  # type: ignore[union-attr]
    held = week_call(_status("doubtful", issued - timedelta(minutes=1)))
    assert held.call == HOLD
    assert "game status report is still to come" in held.words
    assert week_call(_status("doubtful", issued)).call == SIT


def test_no_place_in_our_order_is_no_lineup_call() -> None:
    assert week_call(replace(starter(), board=None)).call == NONE
    assert week_call(replace(_ranked("FB", 1))).call == NONE


def test_the_same_sheet_gives_the_same_call() -> None:
    sheets = [_ranked("WR", rank) for rank in range(1, 60)]
    assert [week_call(s) for s in sheets] == [week_call(s) for s in sheets]


def test_the_writer_is_given_the_call_to_argue_in_the_ask_and_the_correction() -> None:
    sheet = _ranked("RB", 18)
    section = call_section(sheet)
    assert '"call" is "start"' in section and "RB18 in our rest-of-season order" in section
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
        'The answer\'s call is "start", but the call for him this week is "sit". The call is sit: he is WR31 in our '
        'rest-of-season order, past the receivers a lineup starts. Give "call" as "sit" and write the read that '
        "argues it."
    ]
    assert not [v for v in week_rule_violations(_SIT_READ, sheet, SIT) if "the call for him this week" in v]


def test_a_sit_read_that_tells_a_manager_to_start_him_is_refused() -> None:
    sheet = _ranked("WR", 31)
    read = _SIT_READ.replace("Sit him this week.", "Start him anyway.")
    assert any("when the call is sit" in v for v in week_rule_violations(read, sheet, SIT))
    # A hold may say when it turns to a start.
    held = replace(sheet, status=Status("questionable", REPORT))
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
    crossed = _ranked("WR", 30)
    assert due_reason(crossed, _stored(crossed, SIT), _NOW) == CALL_CHANGED
    assert due_reason(crossed, _stored(crossed, SIT), _NOW, hourly=True) == CALL_CHANGED
    assert CALL_CHANGED in HOURLY_REASONS
    assert due_reason(crossed, _stored(crossed, START), _NOW) is None


def test_a_call_rewrite_that_keeps_falling_is_capped_like_a_status_rewrite() -> None:
    crossed = _ranked("WR", 30)
    day = datetime(2026, 10, 16, 23, 0, tzinfo=UTC)
    capped = replace(_stored(crossed, SIT, attempts=STATUS_REWRITES_A_DAY + 1), attempt_day=day.date())
    assert due_reason(crossed, capped, day) is None
