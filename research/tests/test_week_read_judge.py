"""Lane 72, the judge (the re-review's F1): for a player who may not be started this week, a passing read
goes to a second, separate call with one question, and a yes refuses it. The judge's call is one of the
read's four. Its recorded verdicts on the re-review's thirteen start phrasings are each a yes, so each is
refused by the judge with the phrase list switched off, not by the list alone."""

import copy
import json
import re
from collections.abc import Iterator, Sequence
from pathlib import Path
from typing import Any, Self

import pytest

from research.capsules.gateway import Completion
from research.capsules.gateway_ledger import Usage
from research.capsules.throttle_waits import AskWaits, RunWaits
from research.capsules.week import rules
from research.capsules.week import validate as week_validate
from research.capsules.week.judge import QUESTION, judge_messages, says_start
from research.capsules.week.prompt import answer_json
from research.capsules.week.write import MAX_CALLS_PER_READ, write_week_read
from research.tests.test_week_read_rules import BYE_READ, REVIEW_START_PHRASINGS, STARTER_READ
from research.tests.week_read_fixtures import on_bye, starter

_JUDGE = Path(__file__).parent / "testdata" / "week_reads" / "judge.json"
_USAGE = Usage(300, 1, 301, 0.00005)


# The honest bye read the judge was recorded against (fix round 2), from before Lane 100 cut the read to 80
# words: the recording is the judge's verdict on this text, so its cases read it as recorded.
RECORDED_BYE_READ = (
    "Jahmyr Gibbs and the Lions are on their bye in week 6 of 2026, so he does not play and scores nothing "
    "for you this week. Keep him on your roster through the off week, because his 21.3 PPR points a game over "
    "5 games make him a weekly starter once Detroit plays again. Fill his spot with a back who has a game, and "
    "bring Gibbs straight back for week 7 against Green Bay."
)


def judged_text(phrase: str) -> str:
    """The recorded honest bye read with one start phrasing appended (the season named once)."""
    return f"{RECORDED_BYE_READ} {phrase.replace(' in week 7 of 2026', ' in week 7')}"


class _Script:
    """The gateway as the writer sees it: each ask, the writer's or the judge's, takes the next answer."""

    model = "m/x"

    def __init__(self, answers: Sequence[str]) -> None:
        self.answers: Iterator[str] = iter(answers)
        self.calls = 0
        self.asked: list[list[dict[str, str]]] = []
        self.waits = RunWaits()

    def ask_waits(self) -> AskWaits:
        return self.waits.ask()

    def complete(
        self, messages: list[dict[str, str]], max_tokens: int, min_words: int = 20, ask: AskWaits | None = None
    ) -> Completion:
        self.calls += 1
        self.asked.append(messages)
        return Completion(next(self.answers), _USAGE, "provider", "stop")

    def with_model(self, model: str) -> "Self":
        """The judge's view: the same script, its own call count (`GatewayClient.with_model`)."""
        view = copy.copy(self)
        view.model, view.calls = model, 0
        return view

    def sleep(self, seconds: float) -> None:
        raise AssertionError(f"no wait expected ({seconds} s)")


@pytest.mark.parametrize(
    ("answer", "start"), [("yes", True), ("Yes.", True), ("No.", False), ("no", False), ("maybe", True), ("", True)]
)
def test_the_verdict_is_yes_unless_plainly_no(answer: str, start: bool) -> None:
    assert says_start(answer) is start


def test_the_judge_asks_one_question_about_the_text_alone() -> None:
    messages = judge_messages(on_bye(), BYE_READ)
    assert messages[-1]["content"].endswith(QUESTION)
    assert BYE_READ in messages[-1]["content"] and "Jahmyr Gibbs" in messages[-1]["content"]
    assert "Facts for the week" not in messages[-1]["content"]


def test_a_read_the_judge_clears_is_written_with_the_judges_call_counted() -> None:
    gateway = _Script([answer_json(BYE_READ, "hold"), "no"])
    result = write_week_read(on_bye(), gateway)  # type: ignore[arg-type]
    assert result.source == "llm" and result.calls == 2  # noqa: PLR2004 - the draft and the judge
    assert gateway.asked[1][-1]["content"].endswith(QUESTION)


def test_a_yes_refuses_the_read_and_the_correction_says_why() -> None:
    gateway = _Script([answer_json(BYE_READ, "hold"), "yes", answer_json(BYE_READ, "hold"), "no"])
    result = write_week_read(on_bye(), gateway)  # type: ignore[arg-type]
    assert result.source == "llm" and result.calls == MAX_CALLS_PER_READ
    assert "A reader would take this read as telling them to start him" in gateway.asked[2][-1]["content"]


def test_the_judges_call_is_one_of_the_four() -> None:
    script = [answer_json(BYE_READ, "hold"), "yes"] * 2
    result = write_week_read(on_bye(), _Script(script))  # type: ignore[arg-type]
    assert result.source == "facts" and result.calls == MAX_CALLS_PER_READ


def test_a_player_who_may_start_is_never_judged() -> None:
    result = write_week_read(starter(), _Script([answer_json(STARTER_READ, "start")]))  # type: ignore[arg-type]
    assert result.source == "llm" and result.calls == 1


def _verdicts() -> list[dict[str, Any]]:
    verdicts: list[dict[str, Any]] = json.loads(_JUDGE.read_text())["verdicts"]
    return verdicts


# The recorded judge's two noes, each refused by the list (`test_week_read_rules`) and named in the report:
# advice for week 7 named as week 7 is not advice for this week, and a description of his role.
JUDGE_MISSES = ("Don't hesitate to start Gibbs in week 7 of 2026.", "He's a locked-in starter for you.")
_JUDGED_YES = tuple(phrase for phrase in REVIEW_START_PHRASINGS if phrase not in JUDGE_MISSES)


def test_the_recorded_judge_said_yes_to_every_this_week_start_phrasing_and_no_to_honest_reads() -> None:
    verdicts = _verdicts()
    assert [v["phrase"] for v in verdicts] == list(REVIEW_START_PHRASINGS)
    assert tuple(v["phrase"] for v in verdicts if not says_start(v["answer"])) == JUDGE_MISSES
    honest = json.loads(_JUDGE.read_text())["honest"]
    assert len(honest) == 3 and not any(says_start(v["answer"]) for v in honest)  # noqa: PLR2004 - three reads


@pytest.mark.parametrize("phrase", _JUDGED_YES)
def test_the_judge_refuses_each_phrasing_with_the_list_switched_off(
    phrase: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The writer's own path, the list never firing: the recorded verdict alone refuses the read. The
    recorded text runs past the 40 to 95 band (WEEK_BAND), so the cap is lifted here as the list is, and it
    keeps him "on your roster", so that rule is off too."""
    monkeypatch.setattr(rules, "start_advice_in", lambda sentence, name: None)
    monkeypatch.setattr(week_validate, "WEEK_BAND", (40, 100))
    # The recorded text predates B282's rule on addressing the member's roster (Lane 286): off here as the list.
    monkeypatch.setattr(rules, "_ADDRESSES_THE_MEMBER", re.compile(r"(?!)"))
    verdict = next(v for v in _verdicts() if v["phrase"] == phrase)
    text = judged_text(phrase)
    assert verdict["text"] == text
    gateway = _Script([answer_json(text, "hold"), verdict["answer"], answer_json(BYE_READ, "hold"), "no"])
    result = write_week_read(on_bye(), gateway)  # type: ignore[arg-type]
    assert result.text == BYE_READ, result.attempts
    assert result.attempts[0].violations and result.attempts[0].violations[0].startswith("A reader would take")


@pytest.mark.parametrize("phrase", JUDGE_MISSES)
def test_the_judges_misses_are_refused_by_the_list(phrase: str) -> None:
    assert any("recommends starting" in v for v in rules.week_rule_violations(judged_text(phrase), on_bye(), "hold"))
