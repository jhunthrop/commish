"""Lane 72's recorded fixture run, replayed: three players from the scratch copy of the store in week 6 of
2026 (a starter, a Questionable player and a player on bye), each written by the writer's own path
against the gateway's recorded answers, in order. No live call is made here.

The guards: every read lands written in the calls it took live; it names the published projection as
published wherever there is one and never as ours; it carries no betting, trading or provider word, no
rival product and no tip; the bye read says he does not play and recommends nothing for the week; no
sentence sits on two of the reads; every fact was stamped at or before the write; and the caption is the
page's."""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.gateway import Completion
from research.capsules.gateway_ledger import Usage
from research.capsules.narrative import held_sentences
from research.capsules.throttle_waits import AskWaits, RunWaits
from research.capsules.voice_rules import gate_hits
from research.capsules.week.caption import written_caption
from research.capsules.week.rules import WEEK_NEVER_WORDS, week_rule_violations
from research.capsules.week.sheet import WeekSheet, week_name_ledger
from research.capsules.week.validate import validate_week_read
from research.capsules.week.write import write_week_read
from research.tests.week_read_fixtures import sheet_from_json

_FIXTURE = Path(__file__).parent / "testdata" / "week_reads" / "recorded.json"
_RECORDED: list[dict[str, Any]] = json.loads(_FIXTURE.read_text())["players"]
_NAMES = [p["sheet"]["name"] for p in _RECORDED]


class _Replay:
    """The gateway as recorded: each ask takes the next recorded answer."""

    model = "zai/glm-5.3-flash"

    def __init__(self, answers: list[dict[str, Any]]) -> None:
        self.answers: Iterator[dict[str, Any]] = iter(answers)
        self.calls = 0
        self.waits = RunWaits()

    def ask_waits(self) -> AskWaits:
        return self.waits.ask()

    def complete(
        self, messages: list[dict[str, str]], max_tokens: int, min_words: int = 20, ask: AskWaits | None = None
    ) -> Completion:
        self.calls += 1
        answer = next(self.answers)
        usage = None if answer["usage"] is None else Usage(**answer["usage"])
        return Completion(answer["content"], usage, answer["provider"], "stop")

    def sleep(self, seconds: float) -> None:
        raise AssertionError(f"the replay never waits ({seconds} s)")


def _sheet(name: str) -> tuple[WeekSheet, dict[str, Any]]:
    player = next(p for p in _RECORDED if p["sheet"]["name"] == name)
    return sheet_from_json(player["sheet"]), player


def test_the_fixture_is_a_starter_a_questionable_player_and_a_player_on_bye() -> None:
    sheets = [sheet_from_json(p["sheet"]) for p in _RECORDED]
    assert any(s.can_play and s.status.status is None and s.projection is not None for s in sheets)
    assert any(s.status.status == "questionable" for s in sheets)
    assert any(s.bye and not s.can_play for s in sheets)


@pytest.mark.parametrize("name", _NAMES)
def test_the_writer_reproduces_the_recorded_read(name: str) -> None:
    sheet, player = _sheet(name)
    gateway = _Replay(player["answers"])
    result = write_week_read(sheet, gateway, tuple(player["avoid"]), frozenset(player["taken"]))  # type: ignore[arg-type]
    assert result.source == "llm", result.attempts
    assert result.text == player["read"]
    assert result.calls == player["calls"]


@pytest.mark.parametrize("name", _NAMES)
def test_the_recorded_read_keeps_every_guard(name: str) -> None:
    sheet, player = _sheet(name)
    read = player["read"]
    assert validate_week_read(read, sheet, frozenset(player["taken"])).ok
    assert gate_hits(read, week_name_ledger(sheet)) == []
    assert not any(rule.pattern.search(read) for rule in WEEK_NEVER_WORDS)
    assert week_rule_violations(read, sheet) == []
    if sheet.projection is not None and not sheet.bye:
        assert "published" in read.lower()
    assert "our projection" not in read.lower() and "our number" not in read.lower()
    assert all(stamp <= sheet.written_at.isoformat() for stamp in sheet.stamps().values())


def test_the_bye_read_says_he_does_not_play_and_recommends_nothing_for_the_week() -> None:
    sheet = next(sheet_from_json(p["sheet"]) for p in _RECORDED if p["sheet"]["bye"])
    read = next(p["read"] for p in _RECORDED if p["sheet"]["bye"])
    assert "doesn't play" in read or "does not play" in read or "bye" in read
    assert not any("recommends" in v for v in week_rule_violations(read, sheet))


def test_no_sentence_sits_on_two_of_the_reads() -> None:
    held = [held_sentences((p["read"],), CAPSULE_CONFIG.shared_sentence_min_words) for p in _RECORDED]
    for i, mine in enumerate(held):
        for theirs in held[i + 1 :]:
            assert not (mine & theirs)


def test_the_caption_is_the_write_in_central_time_for_the_week() -> None:
    sheet, _ = _sheet(_NAMES[0])
    assert written_caption(sheet.written_at, sheet.week) == "Written Sat 12:30 pm Central, for week 6"
