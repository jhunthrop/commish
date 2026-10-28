"""Lane 261, the writer bake-off's tallies: a read's outcome from the writer's attempts, the per-model sums,
the shape-duplicate rate with its masks, and the two judges' agreement. No gateway and no store."""

import pytest

from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway_ledger import Usage
from research.capsules.narrative import (
    CLUB_MARK,
    NUMBER_MARK,
    PLAYER_MARK,
    ShapeMasks,
    club_spellings,
    player_spellings,
)
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.judge import judge_violation
from research.capsules.week.validate import SHARED_SENTENCE
from research.capsules.week.write import WeekAttempt, WeekReadResult
from research.explore.writer_bakeoff.results import SIDE_BY_SIDE, spread
from research.explore.writer_bakeoff.run import NO_JUDGE_ASK, judged_drafts, outcome_of
from research.explore.writer_bakeoff.tally import ReadOutcome, agreement, p95, shape_duplicates, tally
from research.tests.week_read_fixtures import on_bye, starter

_MODEL = "test/model"


def _result(source: str, attempts: tuple[WeekAttempt, ...], fallback: str | None = None) -> WeekReadResult:
    usage = Usage(1000, 100, 1100, 0.002)
    return WeekReadResult(attempts[-1].body, source, "sit", _MODEL, usage, len(attempts), attempts, fallback)


def _outcome(*, written: bool = True, may_start: bool = True, seconds: float = 1.0, **counts: int) -> ReadOutcome:
    return ReadOutcome(
        model=_MODEL,
        player_id="p",
        name="P",
        may_start=may_start,
        source=WRITTEN_SOURCE if written else FACTS_SOURCE,
        fallback=None if written else "failed validation",
        calls=counts.get("calls", 1),
        prompt_tokens=100,
        completion_tokens=10,
        cost_usd=0.001,
        seconds=seconds,
        drafts=counts.get("drafts", 1),
        broken_drafts=counts.get("broken", 0),
        shape_broken_drafts=counts.get("shape", 0),
        judged=counts.get("judged", 0),
        judge_refused=counts.get("refused", 0),
    )


def test_a_bye_read_counts_its_refused_draft_and_the_draft_it_passed() -> None:
    sheet = on_bye()
    attempts = (
        WeekAttempt("draft one", "start", ("Word count 30 is outside the band.",)),
        WeekAttempt("draft two", "start", (judge_violation(sheet),)),
        WeekAttempt("draft three", "sit", ()),
    )
    result = _result(WRITTEN_SOURCE, attempts)
    assert judged_drafts(sheet, result) == [("draft two", True), ("draft three", False)]
    outcome = outcome_of(_MODEL, sheet, result, 2.5)
    assert (outcome.drafts, outcome.broken_drafts, outcome.judged, outcome.judge_refused) == (3, 1, 2, 1)
    assert not outcome.may_start
    assert outcome.cost_usd == pytest.approx(0.002)


def test_a_starter_is_never_judged_and_a_shape_break_is_counted_apart() -> None:
    sheet = starter()
    attempts = (
        WeekAttempt("one", "start", (f'{SHARED_SENTENCE}, in the sentence "x".',)),
        WeekAttempt("two", "start", ("The text opens without the call.", f"{SHARED_SENTENCE}.")),
    )
    result = _result(FACTS_SOURCE, attempts, "failed validation: the text opens without the call")
    assert judged_drafts(sheet, result) == []
    outcome = outcome_of(_MODEL, sheet, result, 1.0)
    assert (outcome.broken_drafts, outcome.shape_broken_drafts, outcome.written) == (2, 2, False)


def test_a_draft_left_without_the_judge_is_no_break_and_no_verdict() -> None:
    sheet = on_bye()
    result = _result(FACTS_SOURCE, (WeekAttempt("one", "sit", (NO_JUDGE_ASK,)),), "failed validation")
    outcome = outcome_of(_MODEL, sheet, result, 1.0)
    assert (outcome.broken_drafts, outcome.judged) == (0, 0)


def test_the_tally_sums_rates_latency_and_the_judge_on_may_not_start_sheets_only() -> None:
    outcomes = [
        _outcome(seconds=1.0, broken=1, drafts=2),
        _outcome(written=False, seconds=3.0, broken=2, shape=1, drafts=3),
        _outcome(may_start=False, seconds=2.0, judged=2, refused=1),
        _outcome(may_start=True, judged=5, refused=5),  # never counted: a starter is not judged
    ]
    got = tally(_MODEL, outcomes, budget_stopped=4)
    assert (got.reads, got.written, got.facts_blocks, got.budget_stopped) == (4, 3, 1, 4)
    assert got.written_rate == pytest.approx(0.75)
    assert (got.reads_with_a_break, got.broken_drafts, got.shape_broken_drafts) == (2, 3, 1)
    assert (got.may_not_start, got.may_not_start_written, got.judged, got.judge_passed) == (1, 1, 2, 1)
    assert got.judge_pass_rate == pytest.approx(0.5)
    assert got.mean_seconds == pytest.approx(1.75)
    assert got.p95_seconds == pytest.approx(3.0)
    assert got.cost_per_read == pytest.approx(0.001)


def test_an_empty_tally_has_no_judge_rate() -> None:
    got = tally(_MODEL, [])
    assert (got.reads, got.written_rate, got.judge_pass_rate, got.p95_seconds) == (0, 0.0, None, 0.0)


def test_p95_is_nearest_rank() -> None:
    twenty = [float(i) for i in range(1, 21)]
    assert p95(twenty) == twenty[-2]
    assert p95(twenty[:1]) == twenty[0]


def test_player_spellings_take_the_last_name_past_a_suffix() -> None:
    # The first name too (Lane 265 fix round 1): a read that calls him "Puka" is the same shape.
    assert set(player_spellings(["Marvin Harrison Jr.", "Puka Nacua"])) == {
        "Marvin Harrison Jr.",
        "Marvin",
        "Harrison",
        "Puka Nacua",
        "Puka",
        "Nacua",
    }


def test_a_shape_masks_names_clubs_and_numbers() -> None:
    masks = ShapeMasks.of(["Puka Nacua", "Ja'Marr Chase"], club_spellings())
    one = masks.shape("Puka Nacua faces the Chargers, 23rd of 32 against receivers.")
    two = masks.shape("Chase faces the Titans, 24th of 32 against receivers.")
    assert one == two
    assert one == f"{PLAYER_MARK} faces the {CLUB_MARK} {NUMBER_MARK} of {NUMBER_MARK} against receivers"
    assert masks.shape("Nacua's role in Los Angeles grows.") == f"{PLAYER_MARK} role in {CLUB_MARK} grows"
    assert "chase" in masks.shape("Keep the chase for points alive in week 8.")


def test_shape_duplicates_count_sentences_whose_shape_two_players_carry() -> None:
    masks = ShapeMasks.of(["Puka Nacua", "Ja'Marr Chase", "Bijan Robinson"], club_spellings())
    reads = {
        "a": "Start Puka Nacua against the Chargers this week. He has scored 18.4 points a game so far.",
        "b": "Start Ja'Marr Chase against the Titans this week. Short one.",
        "c": "Bijan Robinson leads the Falcons backfield again and should see twenty touches.",
    }
    got = shape_duplicates(reads, masks)
    assert (got.reads, got.sentences, got.duplicated) == (3, 4, 2)  # "Short one." is under six words
    assert got.rate == pytest.approx(0.5)
    assert got.top == ((f"start {PLAYER_MARK} against the {CLUB_MARK} this week", 2),)


def test_the_judges_agreement_and_each_pass_rate() -> None:
    got = agreement([(True, True), (False, False), (False, False), (True, False), (False, True)])
    assert (got.drafts, got.both_refused, got.both_passed, got.first_only_refused, got.second_only_refused) == (
        5,
        1,
        2,
        1,
        1,
    )
    assert got.first_pass_rate == pytest.approx(3 / 5)
    assert got.second_pass_rate == pytest.approx(3 / 5)
    assert agreement([]).first_pass_rate is None


def test_spread_takes_ten_in_board_order_with_both_ends() -> None:
    picked = spread(519)
    assert len(picked) == SIDE_BY_SIDE
    assert (picked[0], picked[-1]) == (0, 518)
    assert picked == sorted(picked)
    assert spread(4) == [0, 1, 2, 3]
