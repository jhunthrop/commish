"""The capsule gate's six-word spans (`capsules.spans`, the live review's M1) and the repair's
targets: a span on two pages fails both, names break a span, overlapping windows are quoted as one
phrase, and the repair keeps each span on its first page in board order."""

from datetime import UTC, datetime

from research.capsules.spans import name_words, page_runs, phrases_on_page, shared_spans
from research.capsules.store import WRITTEN_SOURCE, StoredCapsule
from research.nightly.capsule_gate import judge_capsules
from research.nightly.capsule_step import repair_targets

NAMES = name_words(["Puka Nacua", "Davante Adams", "Jaxon Smith-Njigba", "A.J. Brown"])
_AT = datetime(2026, 10, 14, tzinfo=UTC)


def _row(pid: str, full: str, compact: str = "Short note.", source: str = WRITTEN_SOURCE) -> StoredCapsule:
    return StoredCapsule(pid, "hash", compact, full, source, None, None, _AT)


def test_six_words_on_two_pages_fail_both() -> None:
    rows = {
        "a": _row("a", "The target share is the whole case for him this year."),
        "b": _row("b", "For Jaxon, the target share is the whole story."),
        "c": _row("c", "Nothing alike here at all, a different note entirely."),
    }
    gate = judge_capsules(["a", "b", "c"], rows, NAMES)
    assert [(s.span, s.player_ids) for s in gate.spans] == [("the target share is the whole", ("a", "b"))]
    assert set(gate.span_phrases) == {"a", "b"}
    assert not gate.ok
    assert "1 six-word spans on two pages (2 pages carry one)" in gate.summary()


def test_case_and_punctuation_fold_and_a_facts_block_is_not_judged() -> None:
    rows = {
        "a": _row("a", "Our number puts him at 231 points, which is plenty."),
        "b": _row("b", "OUR NUMBER, puts him: at 231 points!"),
        "c": _row("c", "Our number puts him at 231 points.", source="facts"),
    }
    gate = judge_capsules(["a", "b", "c"], rows, NAMES)
    assert {s.player_ids for s in gate.spans} == {("a", "b")}


def test_a_name_breaks_the_run() -> None:
    a = page_runs(["He sits behind Puka Nacua and Davante Adams on the chart."], NAMES)
    b = page_runs(["He sits behind Davante Adams and Puka Nacua on the chart."], NAMES)
    assert shared_spans({"a": a, "b": b}) == ()
    assert page_runs(["A reach at that spot is a real risk for you."], NAMES) != ()


def test_overlapping_windows_are_quoted_as_one_phrase() -> None:
    runs = page_runs(["The low end comes from seasons cut short by injury, nothing more."], NAMES)
    shared = frozenset({"comes from seasons cut short by", "from seasons cut short by injury"})
    assert phrases_on_page(runs, shared) == ("comes from seasons cut short by injury",)


def test_the_repair_keeps_each_span_on_its_first_page() -> None:
    order = ["a", "b", "c", "d"]
    assert repair_targets([("c", "a"), ("d", "b", "a")], order) == ["b", "c", "d"]
