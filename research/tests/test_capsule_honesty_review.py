"""Lane 29 fix round 1: the task review's findings, each on the sentences the reviewer ran. True
sentences pass, the missed claims fail."""

from typing import Any

import pytest

from research.capsules import __main__ as cli
from research.capsules.claims import ClaimLedger, claim_violations
from research.capsules.prompt import IN_SEASON_RULES, PRESEASON_RULES
from research.capsules.prose_checks import unfinished_ending
from research.capsules.pull_figures import adp_figures_off_page
from research.capsules.requeue import QueueResult
from research.capsules.season_voice import SeasonClock
from research.capsules.sentences import phrase_pattern, split_sentences
from research.capsules.validate import banned_term_in
from research.nightly.config import TEAMS

OCTOBER = SeasonClock(2026, 5, (1, 2, 3, 5), (4,))
JEFFERSON = ClaimLedger(OCTOBER, touchdowns=3, first_game=(1, 29.2), adp=11.7, board_rank=11)
NO_TOUCHDOWNS = ClaimLedger(OCTOBER, touchdowns=0, first_game=(1, 10.6), adp=4.1, board_rank=3)
ADP_45 = ClaimLedger(OCTOBER, touchdowns=1, first_game=(1, 8.0), adp=45.0, board_rank=30)
NO_ADP = ClaimLedger(OCTOBER, touchdowns=0, first_game=(1, 2.0), adp=None, board_rank=500)


def _rules(text: str, ledger: ClaimLedger) -> list[str]:
    return [violation.split(":")[0] for violation in claim_violations(text, ledger)]


# H1: a year before "ADP" is a season, not an ADP figure.
@pytest.mark.parametrize(
    "text", ["His 2026 ADP of 11.7 was where drafters took him.", "The 2025 ADP was a different story."]
)
def test_a_year_before_adp_is_not_an_adp_figure(text: str) -> None:
    assert adp_figures_off_page(text, 11.7) == []
    assert _rules(text, JEFFERSON) == []


def test_a_year_before_adp_still_lets_the_figure_after_it_be_read() -> None:
    assert "an ADP comparison the wrong way round" in _rules("His 2026 ADP of 11.7 is above our 11.", JEFFERSON)


# H2: the missing-ADP rule binds only when the page has no ADP.
@pytest.mark.parametrize(
    "text",
    [
        "Drafters took him at 45, and he did not play in week 3 of 2026.",
        "Drafters never expected this many targets when they took him at 45.2.",
        "Drafters passed on him until 45.2.",
        "Nobody drafted him expecting this.",
    ],
)
def test_a_player_with_an_adp_is_never_held_to_the_missing_adp_rule(text: str) -> None:
    assert "a claim about drafters from a missing ADP" not in _rules(text, ADP_45)


def test_the_missing_adp_message_speaks_only_of_a_missing_adp() -> None:
    (violation,) = claim_violations("Drafters never spent a pick on him.", NO_ADP)
    assert "has no ADP for him" in violation and "an ADP for him, and" not in violation


# M1: "before" and "after" in their time sense are not pick order.
@pytest.mark.parametrize(
    "text",
    [
        "Drafters took him at ADP 11.7 before the season, and we have him at pick 11.",
        "His ADP of 11.7 came before the season, and our pick 11 says the same.",
        "ADP 11.7 was set before week 1, and our rank 11 still holds.",
    ],
)
def test_time_words_between_the_figures_are_not_a_comparison(text: str) -> None:
    assert "an ADP comparison the wrong way round" not in _rules(text, JEFFERSON)


def test_a_comparison_beside_the_second_figure_is_still_read() -> None:
    assert "an ADP comparison the wrong way round" in _rules("The 11.7 ADP is above our 11.", JEFFERSON)
    assert _rules("His 11.7 ADP sits behind our 11.", JEFFERSON) == []


# M2: the scoring rule's misses.
@pytest.mark.parametrize(
    "text",
    [
        "There is no doubt Slowik is feeding him scores.",
        "He is the one Miami turns to when it gets close and Slowik keeps feeding him touchdowns.",
        "His touchdowns carried him through three games.",
        "The touchdowns came in bunches.",
    ],
)
def test_the_scoring_claims_the_review_found_missed_now_fail(text: str) -> None:
    assert "unbacked scoring claim" in _rules(text, NO_TOUCHDOWNS)


def test_a_touchdown_claim_tied_to_a_week_is_refused_the_sheet_has_no_weekly_figure() -> None:
    rules = _rules("He found the end zone in week 3 of 2026.", JEFFERSON)
    assert "unbacked scoring claim" in rules
    assert _rules("He has not found the end zone in week 3 of 2026.", JEFFERSON) == []
    assert _rules("He finds the end zone, three touchdowns in four games.", JEFFERSON) == []


@pytest.mark.parametrize(
    "text",
    [
        "The touchdowns have not come.",
        "The touchdowns were the whole preseason case and they have not shown up.",
        "Bench him until he is back at full practice and scores his first touchdown of 2026.",
        "Only tells you he can get open, not that anyone is throwing him scores.",
    ],
)
def test_the_true_sentences_about_no_touchdowns_still_pass(text: str) -> None:
    assert "unbacked scoring claim" not in _rules(text, NO_TOUCHDOWNS)


# M3: one splitter, one phrase pattern.
def test_one_sentence_splitter_and_one_phrase_pattern() -> None:
    assert split_sentences("Hold him. Start him!  ") == ["Hold him.", "Start him!"]
    assert phrase_pattern("the run-up to").search("since the run up to week 6") is not None


# L1: the fade verdict after a preposition.
@pytest.mark.parametrize("text", ["He is a fade for me.", "He is a fade in every league."])
def test_a_fade_verdict_after_a_preposition_fails(text: str) -> None:
    assert banned_term_in(text) == "fade"


def test_a_fade_thrown_to_a_football_place_passes() -> None:
    assert banned_term_in("Allen threw him a fade to the corner of the end zone.") is None
    assert banned_term_in("He won on a fade route in week 3 of 2026.") is None


# L2: "capable of" ends a sentence.
def test_a_sentence_may_end_on_capable_of() -> None:
    assert unfinished_ending("That is the kind of role he is capable of.") is None
    assert unfinished_ending("He clears the expectation by about.") is not None


# L3: the team count is the board's, and in season a round is history.
def test_the_round_line_is_built_from_the_boards_teams_and_is_history_in_season() -> None:
    for rules in (IN_SEASON_RULES, PRESEASON_RULES):
        assert f"divided by {TEAMS}" in rules
    assert "only history" in IN_SEASON_RULES
    assert "only history" not in PRESEASON_RULES


# L5: the queue command refuses an empty list and fails when it stamps fewer rows than it named.
def _run(monkeypatch: pytest.MonkeyPatch, argv: list[str], result: QueueResult | None = None) -> int:
    monkeypatch.setattr(cli, "database_url_from_env", lambda: "postgresql+psycopg://x/y")

    class _Engine:
        def begin(self) -> Any:
            class _Ctx:
                def __enter__(self) -> object:
                    return object()

                def __exit__(self, *exc: object) -> None:
                    return None

            return _Ctx()

    monkeypatch.setattr(cli, "make_engine", lambda url: _Engine())
    monkeypatch.setattr(cli, "queue_slugs", lambda conn, slugs, at: result)
    return cli.main(argv)


def test_the_queue_refuses_an_empty_list(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(SystemExit) as raised:
        _run(monkeypatch, ["queue", "--slugs", ","])
    assert raised.value.code == 2  # noqa: PLR2004 - argparse's usage error


def test_the_queue_fails_naming_the_pages_it_did_not_stamp(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    short = QueueResult(stamped=1, named=2, unstamped=("tre-harris",))
    assert _run(monkeypatch, ["queue", "--slugs", "puka-nacua,tre-harris"], short) == 1
    assert "tre-harris" in capsys.readouterr().out
    whole = QueueResult(stamped=2, named=2, unstamped=())
    assert _run(monkeypatch, ["queue", "--slugs", "puka-nacua,tre-harris"], whole) == 0
