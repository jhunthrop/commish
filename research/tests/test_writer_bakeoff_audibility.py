"""Lane 281, the audibility tally and the v1 arm: opener classes, the two distances, the lean, the cut to first
drafts (a corrected read carries no voice), the ship bar, and the v1 arm restoring Lane 266's prompt. No
gateway and no store."""

from collections import Counter
from typing import Any

import pytest

from research.capsules.narrative import ShapeMasks, club_spellings
from research.capsules.week import prompt, rules, voices, write
from research.explore.writer_bakeoff import voices_v1
from research.explore.writer_bakeoff.audibility import (
    CALL,
    CLUB,
    FIGURE,
    HIM,
    STATUS,
    audibility,
    corrected,
    ks_distance,
    opener_class,
    tv_distance,
    voiced,
)
from research.explore.writer_bakeoff.v2_compare import QUIET_VOICES, bar

_MASKS = ShapeMasks.of(("Puka Nacua", "Ja'Marr Chase"), club_spellings())


def _read(pid: str, text: str, voice: str = "matchup", drafts: int = 1, **more: Any) -> dict[str, Any]:
    return {
        "player_id": pid,
        "player": "Puka Nacua",
        "voice": voice,
        "source": "llm",
        "text": text,
        "drafts": [{}] * drafts,
        "retry_asks": 0,
        "opponent": "ARI",
        **more,
    }


@pytest.mark.parametrize(
    ("sentence", "kind"),
    [
        ("Start Nacua against the Cardinals this week.", CALL),
        ("You start Nacua and don't look back.", CALL),
        ("25.9 PPR points a game says it all.", FIGURE),
        ("The Cardinals rank 26th of 32 against receivers.", CLUB),
        ("Puka Nacua carries no designation on the injury list.", STATUS),
        ("He is Questionable on Friday's report.", STATUS),
        ("Nacua leads the Rams' receivers again.", HIM),
    ],
)
def test_an_opener_is_read_from_its_first_masked_words(sentence: str, kind: str) -> None:
    assert opener_class(sentence, _MASKS) == kind


def test_the_distances_run_from_nothing_to_everything() -> None:
    assert tv_distance(Counter(a=2), Counter(a=5)) == 0.0
    assert tv_distance(Counter(a=1), Counter(b=1)) == 1.0
    assert ks_distance([10, 12], [10, 12]) == 0.0
    assert ks_distance([5, 6], [20, 21]) == 1.0


def test_a_corrected_read_carries_no_voice() -> None:
    first = _read("a", "Start Nacua. He plays. Keep him.")
    fixed = _read("b", "Start Nacua. He plays. Keep him.", drafts=2)
    rescued = _read("c", "Start Nacua. He plays. Keep him.", retry_asks=1)
    fell = _read("d", "Facts.", source="facts")
    assert [corrected(r) for r in (first, fixed, rescued)] == [False, True, True]
    assert voiced([first, fixed, rescued, fell]) == [first]


def test_a_voice_that_sounds_like_no_voice_scores_nothing_and_one_apart_scores_high() -> None:
    off = [_read(f"p{i}", "Puka Nacua carries no designation this week. He plays. Start him.") for i in range(4)]
    same = [_read(f"p{i}", "Puka Nacua carries no designation this week. He plays. Start him.") for i in range(4)]
    apart = [
        _read(f"p{i}", "Start him against an Arizona defense 26th of 32 against receivers at home indoors today. Go.")
        for i in range(4)
    ]
    quiet = audibility(same, off, _MASKS)["matchup"]
    loud = audibility(apart, off, _MASKS)["matchup"]
    assert quiet.score == 0.0 and quiet.lean_gain == 0.0
    assert loud.opener_distance == 1.0 and loud.lean_on == 1.0 and loud.score > quiet.score
    assert loud.status_openers_off == 1.0 and loud.status_openers_on == 0.0


def test_corrected_reads_are_counted_apart_and_left_out() -> None:
    off = [_read("p0", "Puka Nacua carries no designation. He plays. Start him.")]
    on = [
        _read("p0", "Start him against Arizona. He plays. Go."),
        _read("p0", "Puka Nacua carries no designation. He plays. Start him.", drafts=3),
    ]
    tally = audibility(on, off, _MASKS)["matchup"]
    assert (tally.voiced_reads, tally.corrected_reads) == (1, 1)


def test_the_bar_holds_every_test_and_each_quiet_voice() -> None:
    def arm(written: float, judged: float, shape: float) -> dict[str, float]:
        return {"written_rate": written, "judge_pass_rate": judged, "shape_rate": shape}

    loud, quiet = {"score": 0.4}, {"score": 0.2}
    pooled = {"v1": arm(0.80, 1.0, 0.01), "v2": arm(0.785, 1.0, 0.01)}
    assert all(
        bar(pooled, {"v1": dict.fromkeys(QUIET_VOICES, quiet), "v2": dict.fromkeys(QUIET_VOICES, loud)}).values()
    )
    one_quiet = {"v1": dict.fromkeys(QUIET_VOICES, quiet), "v2": {**dict.fromkeys(QUIET_VOICES, loud), "story": quiet}}
    missed = bar({"v1": arm(0.80, 1.0, 0.01), "v2": arm(0.77, 0.9, 0.02)}, one_quiet)
    assert [k for k, ok in missed.items() if not ok] == [
        "written rate not down more than 2 points",
        "judge pass not down",
        "shape-duplicate rate not up",
        "audibility up, story",
    ]


def test_the_v1_arm_restores_lane_266s_prompt_and_drops_the_new_rules(monkeypatch: pytest.MonkeyPatch) -> None:
    for module, name in (
        (voices, "VOICES"),
        (voices, "_HEADER"),
        (prompt, "WEEK_RULES"),
        (write, "WEEK_RULES"),
        (rules, "_first_sentence_violation"),
        (rules, "_other_club_violations"),
    ):
        monkeypatch.setattr(module, name, getattr(module, name))
    voices_v1.use_v1()
    system = write.messages_for("the ask")[0]["content"]
    assert voices_v1.V1_OPENING_RULE in system and prompt.OPENING_RULE not in system
    assert prompt.OTHER_CLUB_RULE not in system
    assert [v.key for v in voices.VOICES] == [v.key for v in voices_v1.v1_voices()]
    assert {v.key: v.brief for v in voices.VOICES}["story"] == voices_v1.V1_BRIEFS["story"]
    assert rules._first_sentence_violation(["word " * 60]) == []
