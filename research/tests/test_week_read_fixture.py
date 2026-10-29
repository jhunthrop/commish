"""Lane 72's recorded fixture run, replayed: three players from the scratch copy of the store in week 6 of
2026 (a starter, a Questionable player and a player on bye), with the gateway's recorded answers. No live
call is made here.

Lane 100 (B17, B44) holds the read to one paragraph in the 40 to 95 band (WEEK_BAND, Lane 117) that quotes
only the page's cells, at most three of them. Every recorded read is longer and retells the cells (a figure the page draws in no
cell among them), so each is now the guard's case: refused by name, and the writer replayed against the
recorded answers falls to its facts block. A read the rules take is shown on each sheet by a hand-written
read (`HAND_WRITTEN`, written for this test and never a recording), through the writer's own path.

Lane 96 (B16) refuses each recording's "Tuesday's report" too, no report having been issued by the write; the
hand-written reads name the list as the sheet does, "the Tuesday-night list". The guards that stand for the
recorded reads: no weekly number called ours (Lane 275 refuses the published projection each recording
names, the card's Wk cell carrying it); no betting, trading or provider word, no rival product and no tip; the bye read says he does not play
and recommends nothing for the week; no sentence sits on two of the reads; every fact was stamped at or
before the write; and the caption is the page's."""

import copy
import json
from collections.abc import Iterator, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any, Final, Self

import pytest

from research.capsules.gateway import Completion
from research.capsules.gateway_ledger import Usage
from research.capsules.narrative import ShapeMasks
from research.capsules.page_figures import FIGURE_OFF_PAGE
from research.capsules.sentences import split_sentences
from research.capsules.throttle_waits import AskWaits, RunWaits
from research.capsules.validate import word_count
from research.capsules.voice_rules import gate_hits
from research.capsules.week.caption import written_caption
from research.capsules.week.prompt import answer_json, parse_week_answer
from research.capsules.week.render import render_week_sheet
from research.capsules.week.rules import CALLS, MAX_FIGURES, WEEK_NEVER_WORDS, stated_figures, week_rule_violations
from research.capsules.week.sheet import WeekSheet, week_name_ledger
from research.capsules.week.validate import WEEK_BAND, sentence_shapes, validate_week_read
from research.capsules.week.write import write_week_read
from research.tests.week_read_fixtures import main_sheet, sheet_from_json

_FIXTURE = Path(__file__).parent / "testdata" / "week_reads" / "recorded.json"
# The player page shots' stand-in read at the cap (Lane 121, B98), checked here against the recorded sheet.
_LONG_READ = _FIXTURE.with_name("long_bye_read.json")
_RECORDED: list[dict[str, Any]] = json.loads(_FIXTURE.read_text())["players"]
_NAMES = [p["sheet"]["name"] for p in _RECORDED]
# Lane 66v: CeeDee Lamb's recorded read quotes the published projection as 19.4, the old sheet's toFixed of
# 19.45, where the card prints 19.5 (the API's cents then tenth).
_LAMB: Final = "CeeDee Lamb"
# The recordings whose every answer is a writer's read (Gibbs's include the judge's), replayed whole.
_ALL_READS: Final = ("Puka Nacua", _LAMB)
# A read for each sheet the rules take, hand-written for this test (never a recording), and its call.
HAND_WRITTEN: Final[dict[str, tuple[str, str]]] = {
    "Puka Nacua": (
        "Puka Nacua carries no designation on the Tuesday-night list and tops the Rams' receiver depth chart for week 6 "
        "of 2026, at home against the Cardinals. Arizona ranks 28th of 32 against receivers, and the game is "
        "indoors under a fixed roof. He comes off 37.7 points in his last game. Start him.",
        "start",
    ),
    "Jahmyr Gibbs": (
        "The Lions are off in week 6 of 2026, so Gibbs does not play and scores nothing this week. There is no "
        "designation for him on the Tuesday-night list, and he still leads the Detroit backfield ahead of Sione Vaki. "
        "Keep him rostered, fill his spot with a back who plays, and he is back for week 7 at home against "
        "Green Bay.",
        "sit",
    ),
    _LAMB: (
        "CeeDee Lamb is Questionable on the Tuesday-night list, so his Sunday night in Green Bay is not settled yet. "
        "He brings 22.6 PPR points a game into week 6 of 2026. Green Bay sits 15th "
        "of 32 against receivers, and he leads the Dallas depth chart ahead of George Pickens. Wait on his status "
        "before the 7:20 pm Central kickoff, and if he's cleared, start him.",
        "hold",
    ),
}


class _Replay:
    """The gateway as recorded: each ask takes the next recorded answer."""

    model = "zai/glm-5.3-flash"

    def __init__(self, answers: Sequence[dict[str, Any]]) -> None:
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

    def with_model(self, model: str) -> "Self":
        """The judge's view: the same script, its own call count (`GatewayClient.with_model`)."""
        view = copy.copy(self)
        view.model, view.calls = model, 0
        return view

    def sleep(self, seconds: float) -> None:
        raise AssertionError(f"the replay never waits ({seconds} s)")


def _call(player: dict[str, Any]) -> str | None:
    """The last writer answer's call (a judge's answer is one word and carries none)."""
    calls = (parse_week_answer(answer["content"]).call for answer in reversed(player["answers"]))
    return next((call for call in calls if call is not None), None)


def _sheet(name: str) -> tuple[WeekSheet, dict[str, Any]]:
    player = next(p for p in _RECORDED if p["sheet"]["name"] == name)
    return sheet_from_json(player["sheet"]), player


def test_the_fixture_is_a_starter_a_questionable_player_and_a_player_on_bye() -> None:
    sheets = [sheet_from_json(p["sheet"]) for p in _RECORDED]
    assert any(s.can_play and s.status.status is None and s.projection is not None for s in sheets)
    assert any(s.status.status == "questionable" for s in sheets)
    assert any(s.bye and not s.can_play for s in sheets)


@pytest.mark.parametrize("name", _NAMES)
def test_under_lane_100_every_recorded_read_is_refused_by_name(name: str) -> None:
    """Each recording states more figures than the read may (B44), and each quotes a figure the page draws
    in no cell (B17): the opponent's points allowed, his touchdowns, a projection the card does not print.
    Each also runs past the cap of 95 words (Lane 117 fix round 3), counted as the validator counts."""
    sheet, player = _sheet(name)
    violations = validate_week_read(player["read"], sheet, frozenset(player["taken"]), _call(player)).violations
    assert any("40-95 word band" in v for v in violations), violations
    assert any(f"state at most {MAX_FIGURES}" in v for v in violations), violations
    assert any("draws in no cell" in v for v in violations), violations
    # Lane 96 (B16): each names "Tuesday's report", where no game status report was issued by the write.
    assert any("names Tuesday's report, a report the facts do not name" in v for v in violations), violations


@pytest.mark.parametrize("name", _ALL_READS)
def test_replayed_against_its_recording_the_writer_falls_to_the_facts_block(name: str) -> None:
    """The writer's own path on the recorded answers: every draft is handed back, and within the asks the
    recording took live (a second draft over the cap ends it sooner, Lane 117) the read is his facts block."""
    sheet, player = _sheet(name)
    gateway = _Replay(player["answers"])
    result = write_week_read(sheet, gateway, tuple(player["avoid"]), frozenset(player["taken"]))  # type: ignore[arg-type]
    assert result.source == "facts" and result.calls <= player["calls"]
    assert result.fallback is not None and result.fallback.startswith("failed validation")
    assert all(attempt.violations for attempt in result.attempts)


@pytest.mark.parametrize("name", _NAMES)
def test_the_recorded_read_keeps_the_guards_that_stand(name: str) -> None:
    sheet, player = _sheet(name)
    read = player["read"]
    assert gate_hits(read, week_name_ledger(sheet)) == []
    assert not any(rule.pattern.search(read) for rule in WEEK_NEVER_WORDS)
    assert "our projection" not in read.lower() and "our number" not in read.lower()
    assert all(datetime.fromisoformat(stamp) <= sheet.written_at for stamp in sheet.stamps().values())


@pytest.mark.parametrize("name", _NAMES)
def test_a_hand_written_read_of_each_sheet_is_one_the_rules_take(name: str) -> None:
    """One paragraph in the 40 to 95 band, only the cells' figures and at most three, through the writer's own
    path in one call (and the judge's no for a player who may not be started)."""
    sheet, player = _sheet(name)
    read, call = HAND_WRITTEN[name]
    taken = frozenset(player["taken"])
    result = validate_week_read(read, sheet, taken, call)
    assert result.ok, result.violations
    assert len(read.split()) <= WEEK_BAND[1] and "\n" not in read
    assert sum(len(stated_figures(s, sheet.season)) for s in split_sentences(read)) <= MAX_FIGURES
    answers = [{"content": answer_json(read, call), "usage": None, "provider": "replay"}]
    if not sheet.may_start:
        answers.append({"content": "no", "usage": None, "provider": "replay"})
    written = write_week_read(sheet, _Replay(answers), tuple(player["avoid"]), taken)  # type: ignore[arg-type]
    assert (written.source, written.text, written.call, written.calls) == ("llm", read, call, len(answers))
    assert written.call in CALLS and (written.call != "start" or sheet.may_start)


def test_the_player_page_shots_full_read_is_one_the_writer_takes() -> None:
    """Lane 121 (B98): the stand-in read the player page shots draw at the cap (web/scripts/inseason-fixture
    saturday-run.ts) passes the writer's validator on Gibbs's sheet, at the band's top, and lands through the
    writer's own path, so the box a full read grows to is shot on a read the nightly would publish."""
    stand_in: dict[str, str] = json.loads(_LONG_READ.read_text())
    sheet, player = _sheet(stand_in["name"])
    read, call = stand_in["body"], stand_in["call"]
    taken = frozenset(player["taken"])
    result = validate_week_read(read, sheet, taken, call)
    assert result.ok, result.violations
    assert word_count(read) == WEEK_BAND[1] and "\n" not in read
    answers = [{"content": answer_json(read, call), "usage": None, "provider": "replay"}]
    if not sheet.may_start:
        answers.append({"content": "no", "usage": None, "provider": "replay"})
    written = write_week_read(sheet, _Replay(answers), tuple(player["avoid"]), taken)  # type: ignore[arg-type]
    assert (written.source, written.text, written.call) == ("llm", read, call)


def test_a_recorded_figure_the_card_does_not_print_is_refused() -> None:
    sheet, player = _sheet(_LAMB)
    assert "19.5 points in PPR scoring" in render_week_sheet(sheet)
    result = validate_week_read(player["read"], sheet, frozenset(player["taken"]), _call(player))
    assert any(v.startswith(f'{FIGURE_OFF_PAGE}: "19.4", where the sheet prints 19.5') for v in result.violations)


def test_a_recorded_read_naming_the_published_projection_is_refused_by_name() -> None:
    """Lane 275: Lamb's recording names the published projection with its figure, the card's Wk cell's alone;
    at the card's 19.5 it is refused for naming it and stating its figure, never for a figure off the page."""
    sheet, player = _sheet(_LAMB)
    left = week_rule_violations(player["read"].replace("19.4", "19.5"), sheet, _call(player))
    assert any("names the published projection" in v for v in left), left
    assert any("states the published projection's figure" in v for v in left), left


def test_the_bye_read_says_he_does_not_play_and_recommends_nothing_for_the_week() -> None:
    sheet = next(sheet_from_json(p["sheet"]) for p in _RECORDED if p["sheet"]["bye"])
    for read in (next(p["read"] for p in _RECORDED if p["sheet"]["bye"]), HAND_WRITTEN["Jahmyr Gibbs"][0]):
        assert "doesn't play" in read or "does not play" in read or "bye" in read
        assert not any("recommends" in v for v in week_rule_violations(read, sheet, "hold"))


@pytest.mark.parametrize("reads", [[p["read"] for p in _RECORDED], [read for read, _ in HAND_WRITTEN.values()]])
def test_no_sentence_shape_sits_on_two_of_the_reads(reads: list[str]) -> None:
    masks = ShapeMasks.of((*(p["sheet"]["name"] for p in _RECORDED), *HAND_WRITTEN))
    held = [set(sentence_shapes(read, masks)) for read in reads]
    for i, mine in enumerate(held):
        for theirs in held[i + 1 :]:
            assert not (mine & theirs)


def test_the_caption_is_the_write_in_central_time_for_the_week() -> None:
    sheet, _ = _sheet(_NAMES[0])
    assert written_caption(sheet.written_at, sheet.week) == "Written Sat Oct 17, 1:12 pm CT, for week 6"


@pytest.fixture(autouse=True)
def _main_sheet() -> Iterator[None]:
    """These tests pin main's sheet, its lines and the reads written from it (Lane 300 turned the angles on; the
    angles' sheet is `test_week_read_angles`'s)."""
    with main_sheet():
        yield
