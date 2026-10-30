"""Lane 307: the week read's writer is Claude Sonnet 5.5 on the analyst-playbook prompt, every draft checked against
its facts by the same model before the validator reads it, and a read carries no semicolon, em dash or en dash.

The check pass fixes only what fails and the validator reads the checked read; a draft that stops mid-sentence is
asked again and never checked; a refused check leaves the draft to the validator as written, unless the refusal is
the budget's, which ends the read."""

import copy
from collections.abc import Iterator, Sequence
from typing import Self

import pytest

from research.capsules.config import RETRY_WRITER_MODEL, WEEK_WRITER_MODEL, week_writer_settings
from research.capsules.gateway import Completion, GenerationError
from research.capsules.run_budget import BudgetSpentError
from research.capsules.throttle_waits import AskWaits, RunWaits
from research.capsules.week.prompt import CHECK_RULES, answer_json, check_messages
from research.capsules.week.rules import body_rule_violations, week_rule_violations
from research.capsules.week.write import WEEK_WRITER_VERSION, finished, write_week_read
from research.tests.test_week_read_rules import STARTER_READ
from research.tests.week_read_fixtures import starter

# A draft with a figure no fact states (the opponent's rank misread as 27th): the check pass puts back the 26th.
_SLIP = STARTER_READ.replace("26th of 32", "27th of 32")
_CUT = STARTER_READ.removesuffix(" Start him with confidence.") + " Start him with"


class _Checked:
    """A scripted gateway whose check asks take answers of their own (`checks`), the writer's asks the script."""

    model = "anthropic/claude-sonnet-5.5"

    def __init__(self, script: Sequence[Completion], checks: Sequence[Completion | GenerationError]) -> None:
        self.script: Iterator[Completion] = iter(script)
        self.checks: Iterator[Completion | GenerationError] = iter(checks)
        self.calls = 0
        self.checked: list[str] = []
        self.waits = RunWaits()

    def ask_waits(self) -> AskWaits:
        return self.waits.ask()

    def complete(
        self, messages: list[dict[str, str]], max_tokens: int, min_words: int = 20, ask: AskWaits | None = None
    ) -> Completion:
        self.calls += 1
        if messages[0]["content"] == CHECK_RULES:
            self.checked.append(messages[1]["content"])
            item = next(self.checks)
            if isinstance(item, GenerationError):
                raise item
            return item
        return next(self.script)

    def with_model(self, model: str) -> Self:
        view = copy.copy(self)
        view.model, view.calls = model, 0
        return view

    def sleep(self, seconds: float) -> None:
        raise AssertionError(f"no wait expected ({seconds} s)")


def _draft(text: str) -> Completion:
    return Completion(answer_json(text, "start"), None, "provider", "stop")


def _check(text: str) -> Completion:
    return Completion(text, None, "provider", "stop")


def test_the_check_pass_fixes_a_figure_and_the_checked_read_is_written() -> None:
    gateway = _Checked([_draft(_SLIP)], [_check(STARTER_READ)])
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert (result.source, result.text, result.calls) == ("llm", STARTER_READ, 2)
    # The check reads the facts the draft was written from, and the draft.
    assert "Facts" not in gateway.checked[0] and "FACTS:\n" in gateway.checked[0] and _SLIP in gateway.checked[0]


def test_a_check_that_stops_mid_sentence_leaves_the_draft_to_the_validator() -> None:
    gateway = _Checked([_draft(STARTER_READ)], [_check("Puka Nacua gets Arizona at home and")])
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert (result.source, result.text) == ("llm", STARTER_READ)


def test_a_draft_that_stops_mid_sentence_is_asked_again_and_never_checked() -> None:
    gateway = _Checked([_draft(_CUT), _draft(STARTER_READ)], [_check(STARTER_READ)])
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert (result.source, result.text) == ("llm", STARTER_READ)
    assert len(gateway.checked) == 1 and gateway.checked[0].endswith(f"READ:\n{STARTER_READ}")


def test_a_refused_check_lets_the_validator_read_the_draft() -> None:
    refused = GenerationError("Gateway refused the request: HTTP 400", False)
    gateway = _Checked([_draft(STARTER_READ)], [refused])
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert (result.source, result.text) == ("llm", STARTER_READ)


def test_the_budgets_refusal_at_the_check_ends_the_read() -> None:
    gateway = _Checked([_draft(STARTER_READ)], [BudgetSpentError("the run's budget is spent")])
    result = write_week_read(starter(), gateway)  # type: ignore[arg-type]
    assert (result.source, result.fallback) == ("facts", "the run's budget is spent")


def test_the_check_ask_carries_the_facts_and_the_read() -> None:
    system, user = check_messages(starter(), STARTER_READ)
    assert system["content"] == CHECK_RULES and "keep the call" in CHECK_RULES
    assert user["content"].startswith("FACTS:\nPlayer: Puka Nacua") and user["content"].endswith(STARTER_READ)


@pytest.mark.parametrize(("text", "done"), [("Start him.", True), ('He said "go."', True), ("Start him with", False)])
def test_a_draft_is_finished_on_closing_punctuation(text: str, done: bool) -> None:
    assert finished(text) is done


@pytest.mark.parametrize(
    ("mark", "name"), [(";", "a semicolon"), (chr(0x2014), "an em dash"), (chr(0x2013), "an en dash")]
)
def test_a_semicolon_or_a_dash_is_refused_at_the_write_and_on_the_stored_read(mark: str, name: str) -> None:
    text = STARTER_READ.replace(", and the Cardinals rank", f"{mark} the Cardinals rank")
    assert any(f"carries {name}" in v for v in week_rule_violations(text, starter(), "start"))
    assert any(f"carries {name}" in v for v in body_rule_violations(text, 2026))
    assert not any("carries a" in v for v in week_rule_violations(STARTER_READ, starter(), "start"))


def test_the_week_writer_is_sonnet_unless_its_setting_names_another() -> None:
    assert week_writer_settings({}).model == WEEK_WRITER_MODEL == "anthropic/claude-sonnet-5.5"
    assert week_writer_settings({}).retry_model == RETRY_WRITER_MODEL
    assert week_writer_settings({"WEEK_WRITER_MODEL": "m/other"}).model == "m/other"
    # The season writer's setting never moves the week writer.
    assert week_writer_settings({"CAPSULE_MODEL": "m/season"}).model == WEEK_WRITER_MODEL
    assert WEEK_WRITER_VERSION == 2  # noqa: PLR2004 - Lane 307's writer
