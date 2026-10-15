"""Capsule honesty, round 2 (Lane 29, the live review of 2026-10-15): the defects the gate let
through on the first in-season run, each a rule tested on the sentences the review read off the
public pages. Every violation a rule raises is handed back to the writer as a sentence correction."""

import json

import httpx
import pytest

from research.capsules.claims import ClaimLedger, claim_violations
from research.capsules.config import WriterSettings
from research.capsules.corrections import soft_correction_for
from research.capsules.gateway import GatewayClient, GenerationError
from research.capsules.prompt import IN_SEASON_RULES, PRESEASON_RULES
from research.capsules.prose_checks import label_copies, label_violation, unfinished_ending, unfinished_violation
from research.capsules.pull_figures import adp_figures_off_page, capsule_findings
from research.capsules.render_words import SHEET_LABELS
from research.capsules.season_voice import SeasonClock
from research.capsules.validate import banned_term_in
from research.capsules.voice_rules import gate_hits, voice_rule_hits

# The pages as the review read them on 2026-10-15 (through week 5 of 2026).
OCTOBER = SeasonClock(2026, 5, (1, 4, 5), (2, 3))
# De'Von Achane: 10.6 in week 1 of 2026, 12.3 in week 2, 1.7 in week 3, 0 touchdowns, then IR.
ACHANE = ClaimLedger(SeasonClock(2026, 5, (1, 2, 3), (4, 5)), touchdowns=0, first_game=(1, 10.6), adp=4.1)
# Justin Jefferson: our pick 11, ADP 11.7.
JEFFERSON = ClaimLedger(
    SeasonClock(2026, 5, (1, 2, 3, 5), (4,)), touchdowns=3, first_game=(1, 29.2), adp=11.7, board_rank=11
)
# Troy Franklin: ADP 177.1, round 15 of a 12-team draft.
FRANKLIN = ClaimLedger(OCTOBER, touchdowns=1, first_game=(1, 8.0), adp=177.1, board_rank=150)
# A deep player with no ADP (Charlie Kolar, CJ Williams, Marlin Klein).
NO_ADP = ClaimLedger(OCTOBER, touchdowns=0, first_game=(1, 2.0), adp=None, board_rank=500)
# A cut completion is tried once more, never a third time.
CALLS_WITH_THE_RETRY = 2
ROUND = "a round his ADP does not make"
PUKA = (
    "The availability math was always the tax: 11 of 17 games in 2024, 16 of 17 in 2025. He has already spent two "
    "weeks on your bench this year. Our number still clears the historical expectation for this draft slot by about"
)


def _rules(text: str, ledger: ClaimLedger) -> list[str]:
    return [violation.split(":")[0] for violation in claim_violations(text, ledger)]


# H1: a read that ends mid-sentence.


@pytest.mark.parametrize(
    "text",
    [
        PUKA,
        "Our number still clears the historical expectation for this draft slot by about.",
        "Hold him through the bye and start him in week 7 of 2026, when the matchup is the",
        "He is a starter and",
    ],
)
def test_a_read_that_ends_mid_sentence_fails(text: str) -> None:
    assert unfinished_ending(text) is not None
    assert soft_correction_for(unfinished_violation(text)) is not None


@pytest.mark.parametrize(
    "text",
    [
        "Start him without hesitation.",
        "Hold him through the bye. Is he a starter again?",
        'He is "the guy."',
        "The week 7 of 2026 bye is the only week he costs you (his club's).",
        "Let him go and use the spot on someone you can start!",
    ],
)
def test_a_finished_read_passes(text: str) -> None:
    assert unfinished_ending(text) is None


def test_the_page_gate_refuses_a_stored_read_that_ends_mid_sentence() -> None:
    findings = capsule_findings("p", ("Start him.", PUKA), (("projected points", 344.0),), (), OCTOBER)
    assert "capsule_unfinished:p:full" in findings
    assert not any(
        f.startswith("capsule_unfinished")
        for f in capsule_findings(
            "p",
            ("Start him.", "Our preseason number was 344 points. Start him."),
            (("projected points", 344.0),),
            (),
            OCTOBER,
        )
    )


def _answer(content: str, finish: str) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "choices": [{"message": {"content": content}, "finish_reason": finish}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 1600, "total_tokens": 1610, "cost": 0.001},
        },
    )


def test_a_completion_cut_at_its_token_limit_is_retried_then_refused() -> None:
    """The cause of H1: the client read a completion the gateway marked `finish_reason: length` as
    a whole answer, so a correction cut at its token limit was graded and kept."""
    cut = " ".join(["word"] * 40) + " by about"
    calls: list[int] = []

    def answer(request: httpx.Request) -> httpx.Response:
        calls.append(len(json.loads(request.content)["messages"]))
        return _answer(cut, "length")

    client = GatewayClient.for_run(
        "k", httpx.Client(transport=httpx.MockTransport(answer)), WriterSettings("m/x", 2, 600), sleep=lambda _: None
    )
    with pytest.raises(GenerationError, match="token limit") as raised:
        client.complete([{"role": "user", "content": "x"}], 1600)
    assert len(calls) == CALLS_WITH_THE_RETRY
    assert raised.value.billed is not None and raised.value.billed.cost_usd == pytest.approx(0.002)


def test_a_completion_cut_once_and_whole_on_the_retry_is_kept() -> None:
    whole = " ".join(["word"] * 40) + "."
    answers = iter([_answer(whole[:-10], "length"), _answer(whole, "stop")])
    client = GatewayClient.for_run(
        "k",
        httpx.Client(transport=httpx.MockTransport(lambda _: next(answers))),
        WriterSettings("m/x", 2, 600),
        sleep=lambda _: None,
    )
    assert client.complete([{"role": "user", "content": "x"}], 1600).content == whole


# H2: claims the page's own facts contradict.


@pytest.mark.parametrize(
    "text",
    [
        "New play caller Bobby Slowik is funneling him scores.",
        "The worry under the touchdowns is the efficiency.",
        "He finds the end zone when it matters.",
        "Miami keeps feeding him touchdowns.",
    ],
)
def test_a_scoring_claim_with_no_touchdowns_this_season_fails(text: str) -> None:
    assert "unbacked scoring claim" in _rules(text, ACHANE)


@pytest.mark.parametrize(
    "text",
    [
        "Zero touchdowns through three games is the worry.",
        "He has no touchdowns yet, and the efficiency is the problem.",
        "He has not found the end zone in week 1, 2 or 3 of 2026.",
        "He scored 12 touchdowns in 2025, and none so far this year.",
        "He scored 10.6 points in week 1 of 2026.",
        "Last season he found the end zone eight times.",
        # Touchdowns as a factor or a wait, read on the live board on 2026-10-15: not a claim he is scoring.
        "The 1.1x touchdown share costs him about 0.7 points a game on top of that.",
        "Until the touchdowns show up, there is nothing to start.",
        "Only tells you he can get open, not that anyone is throwing him scores.",
        "Bench him until he is back at full practice and scores his first touchdown of 2026.",
        "He owns 3% of TEN's red-zone carries and targets, so nobody is feeding him near the goal line.",
        "Otherwise move on and use the spot on someone who can reach the end zone.",
    ],
)
def test_no_touchdowns_said_plainly_or_history_passes(text: str) -> None:
    assert "unbacked scoring claim" not in _rules(text, ACHANE)


def test_a_scoring_claim_backed_by_touchdowns_passes() -> None:
    assert _rules("He finds the end zone, three touchdowns in four games.", JEFFERSON) == []


def test_a_scoring_claim_is_a_season_claim_only_in_season() -> None:
    preseason = ClaimLedger(SeasonClock(2026))
    assert claim_violations("The worry under the touchdowns is the efficiency.", preseason) == []


@pytest.mark.parametrize(
    "text",
    [
        "Nobody expected the 2026 season to open with 1.7 points in week 3 of 2026.",
        "The season opened with 1.7 points.",
        "He opened the 2026 season with a 12.3-point game.",
    ],
)
def test_opened_means_week_one_or_his_first_game(text: str) -> None:
    assert "the wrong opening week" in _rules(text, ACHANE)


@pytest.mark.parametrize(
    "text",
    [
        "He opened the 2026 season with 10.6 points in week 1 of 2026.",
        "The 10.6-point game to open the season was fine.",
        "He opened the season as the starter.",
        "He opened 2025 with 22.1 points.",
        # Live, 2026-10-15: the opener's own clause is read, not the figures beside it.
        "Seventeen targets and 9.1 points a game, with a zero in week 4 of 2026 after the 10.6 he put up in the "
        "season opener of 2026.",
        "Two dead weeks to open the year, then 14.5, 18 and 14.8 in weeks 3 through 5 of 2026.",
    ],
)
def test_a_true_opener_passes(text: str) -> None:
    assert "the wrong opening week" not in _rules(text, ACHANE)


def test_a_reversed_adp_comparison_fails() -> None:
    jefferson = (
        "The 8.8 ADP drafters actually paid, after moving up 2.8 picks, is above our 11.7, and he has not been worth "
        "that yet."
    )
    rules = _rules(jefferson, JEFFERSON)
    assert "our number and his ADP swapped" in rules
    assert "an ADP comparison the wrong way round" in rules
    assert adp_figures_off_page(jefferson, 11.7) == ["8.8 ADP"]
    assert banned_term_in(jefferson) == "paid"


@pytest.mark.parametrize(
    "text",
    [
        "His 11.7 ADP sits behind our 11, so drafters took him a pick later than we would.",
        "We have him at pick 11, ahead of his 11.7 ADP.",
        "Our 271 points beat his ADP of 11.7 by a lot.",
    ],
)
def test_an_adp_comparison_the_right_way_round_passes(text: str) -> None:
    assert _rules(text, JEFFERSON) == []


def test_a_round_named_from_an_adp_is_the_adp_over_the_teams_rounded_up() -> None:
    franklin = "We put 103 points on him for 2026, seventh round money at ADP 177.1."
    assert "a round his ADP does not make" in _rules(franklin, FRANKLIN)
    assert banned_term_in(franklin) == "money"
    assert _rules("Drafters took him in the fifteenth round, at ADP 177.1.", FRANKLIN) == []
    assert _rules("He went as a 15th-round pick, ADP 177.1.", FRANKLIN) == []
    assert (
        _rules("He was drafted in 2025 at round 3 of the NFL draft, and drafters have him at ADP 177.1.", FRANKLIN)
        == []
    )
    # An NFL draft round beside a missing ADP, read on ten live pages: not a round from an ADP.
    assert ROUND not in _rules("He is a sixth-round rookie, and no ADP was there for him.", NO_ADP)
    assert ROUND not in _rules("He was a sixth-round pick in 2025, and there is no ADP for him.", NO_ADP)


@pytest.mark.parametrize(
    "text",
    [
        "There is no ADP for him, which tells you nobody spent a pick on him.",
        "Drafters never spent a pick on him.",
        "No ADP means no league drafted him.",
    ],
)
def test_a_missing_adp_supports_no_claim_about_drafters(text: str) -> None:
    assert "a claim about drafters from a missing ADP" in _rules(text, NO_ADP)


@pytest.mark.parametrize(
    "text",
    ["He has no ADP.", "A rookie who went undrafted, he is a bench piece at best.", "Let him go."],
)
def test_no_adp_said_plainly_passes(text: str) -> None:
    assert _rules(text, NO_ADP) == []


# H2: a facts label copied into prose.


@pytest.mark.parametrize(
    "text",
    [
        "Every game through week 5 of 2026 is in our records.",
    ],
)
def test_a_facts_label_copied_into_prose_fails(text: str) -> None:
    found = label_copies(text)
    assert found
    assert soft_correction_for(label_violation(found[0], text)) is not None


def test_the_label_list_is_the_renderers_and_plain_prose_passes() -> None:
    assert "where most outcomes fall" in SHEET_LABELS and "on file" not in SHEET_LABELS
    assert label_copies("He has been listed questionable since before week 6 of 2026, so sit him.") == []
    assert label_copies("He has no ADP.") == []


# H3: trading and betting words.


@pytest.mark.parametrize(
    ("text", "word"),
    [
        ("Hold him and cash in the spikes when they land.", "cash in"),
        ("The role has to grow for any of it to cash in.", "cash in"),
        ("He is the one real asset in that room.", "asset"),
        ("Rostering him now, that is a wasted asset.", "asset"),
        ("He is a fade everyone hoped would bounce back.", "fade"),
        ("The draft investment is thin.", "investment"),
        ("The talent investment is real.", "investment"),
        ("That is seventh round money.", "money"),
        ("The 8.8 ADP drafters actually paid is history.", "paid"),
    ],
)
def test_the_reviews_trading_words_fail_and_carry_fantasy_words(text: str, word: str) -> None:
    assert banned_term_in(text) == word
    assert any(hit.rule == "trading word" for hit in gate_hits(text, ()))


@pytest.mark.parametrize(
    "text",
    [
        "He won on a fade route in week 3 of 2026.",
        "He caught a fade in the end zone.",
        "Spend the spot on a starter.",
    ],
)
def test_football_senses_pass(text: str) -> None:
    assert banned_term_in(text) is None


def test_every_claim_violation_has_a_sentence_correction() -> None:
    texts = [
        ("The worry under the touchdowns is the efficiency.", ACHANE),
        ("The season opened with 1.7 points.", ACHANE),
        ("The 11.7 ADP is above our 11.", JEFFERSON),
        ("Our 11.7 is where we have him.", JEFFERSON),
        ("Seventh round at ADP 177.1.", FRANKLIN),
        ("Drafters never spent a pick on him.", NO_ADP),
    ]
    for text, ledger in texts:
        violations = claim_violations(text, ledger)
        assert violations, text
        assert all(soft_correction_for(v) is not None for v in violations), violations


def test_the_writer_is_told_what_a_missing_adp_means_and_the_page_facts_rules() -> None:
    for rules in (IN_SEASON_RULES, PRESEASON_RULES):
        assert "No ADP means only that we have no ADP for him" in rules
        assert "one short clause" in rules
        assert "round 15" in rules
        assert all(f'"{label}"' in rules for label in SHEET_LABELS)
    assert "with 0 touchdowns he has not scored" in IN_SEASON_RULES
    assert "no ADP on file" not in IN_SEASON_RULES


@pytest.mark.parametrize(
    "text",
    [
        "He has been on every injury report since the run-up to the next game, and Wednesday was a non-participant, "
        "so even before you get to the role, he may not help you this week or in week 7 of 2026, his bye.",
        "He has been on every report since the run-up to week 6 of 2026.",
    ],
)
def test_the_run_up_label_the_sheet_no_longer_prints_is_a_worn_phrase(text: str) -> None:
    """Harris's unfilled template and the stock line on 122 pages: the sheet now prints an injury status
    as data ("designation Q since before week 6 of 2026"), and "the run-up to" is a worn phrase."""
    assert "the run-up to" in [hit.found for hit in voice_rule_hits(text, ())]
    assert "the run-up to" not in SHEET_LABELS


@pytest.mark.parametrize(
    ("text", "ledger", "rule"),
    [
        (
            "He is still listed first among PHI running backs, and Tank Bigsby is the man behind him, so nobody has "
            "taken the job.",
            JEFFERSON,
            "a claim about drafters from a missing ADP",
        ),
        (
            "The target room is crowded, worth about 0.9 a game against him, and 24.8% of his projected scoring was "
            "touchdown points, worth another 0.9.",
            ACHANE,
            "unbacked scoring claim",
        ),
        (
            "That is why 8.8 points a game sits well above the 46 points we gave him for the full 2026 season back "
            "before the season opened.",
            ACHANE,
            "the wrong opening week",
        ),
    ],
)
def test_the_writers_own_sentences_from_the_sample_that_are_no_such_claim(
    text: str, ledger: ClaimLedger, rule: str
) -> None:
    """Lane 29's 80-page sample: three sentences a first cut of the rules misread."""
    assert rule not in _rules(text, ledger)
