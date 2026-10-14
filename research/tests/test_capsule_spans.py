"""The capsule gate's six-word spans (`capsules.spans`, the live review's M1) and the repair's
targets, as the coordinator ruled them: a span on any number of pages is counted and queued but never
fails the run, a whole sentence on two pages does, a span a fact sheet prints is exempt; names break a
span, overlapping windows are quoted as one phrase, and the repair keeps each span on its first page."""

from datetime import UTC, datetime

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.spans import SpanRules, name_words, page_runs, phrases_on_page, shared_spans, sheet_spans
from research.capsules.store import WRITTEN_SOURCE, StoredCapsule
from research.nightly.capsule_gate import judge_capsules, repair_targets

NAMES = name_words(["Puka Nacua", "Davante Adams", "Jaxon Smith-Njigba", "A.J. Brown"])
RULES = SpanRules(NAMES)
LINE = CAPSULE_CONFIG.unwritten_line_preseason
_AT = datetime(2026, 10, 14, tzinfo=UTC)


def _row(pid: str, full: str, compact: str = "Short note.", source: str = WRITTEN_SOURCE) -> StoredCapsule:
    return StoredCapsule(pid, "hash", compact, full, source, None, None, _AT)


def test_a_span_on_two_pages_is_queued_and_counted_but_does_not_fail_the_run() -> None:
    rows = {
        "a": _row("a", "The target share is the whole case for him this year."),
        "b": _row("b", "For Jaxon, the target share is the whole story."),
        "c": _row("c", "Nothing alike here at all, a different note entirely."),
    }
    gate = judge_capsules(["a", "b", "c"], rows, RULES, LINE)
    assert [(s.span, s.player_ids) for s in gate.spans] == [("the target share is the whole", ("a", "b"))]
    assert set(gate.span_phrases) == {"a", "b"}
    assert gate.ok
    assert repair_targets([s.player_ids for s in gate.spans], ["a", "b", "c"]) == ["b"]
    assert "1 six-word spans on two pages or more (2 pages carry one, 1 queued for repair, never a failure)" in (
        gate.summary()
    )


def test_a_span_on_three_pages_is_counted_and_never_fails_the_run() -> None:
    rows = {pid: _row(pid, f"Note {pid}: the target share is the whole case.") for pid in ("a", "b", "c")}
    gate = judge_capsules(["a", "b", "c"], rows, RULES, LINE)
    assert {s.player_ids for s in gate.spans} == {("a", "b", "c")}
    assert gate.ok
    assert gate.queued == len(rows) - 1  # every carrier but the first


def test_a_whole_sentence_on_two_pages_still_fails_the_run() -> None:
    rows = {pid: _row(pid, f"Page {pid}. If he is on your roster, let him go.") for pid in ("a", "b")}
    gate = judge_capsules(["a", "b"], rows, RULES, LINE)
    assert [s.player_ids for s in gate.shared] == [("a", "b")]
    assert not gate.ok


def test_a_span_the_fact_sheet_prints_is_exempt() -> None:
    sheet = "- Last season's usage (2025): red-zone share of his own touches 10.2%, WR124 among 223."
    rules = SpanRules(NAMES, sheet_spans([sheet], NAMES))
    lead = {"a": "Alpha", "b": "Bravo", "c": "Charlie"}
    rows = {pid: _row(pid, f"{word}: red-zone share of his own touches.") for pid, word in lead.items()}
    gate = judge_capsules(["a", "b", "c"], rows, rules, LINE)
    assert gate.spans == ()
    assert gate.exempt_spans > 0
    assert judge_capsules(["a", "b", "c"], rows, RULES, LINE).spans != ()


def test_case_and_punctuation_fold_and_a_facts_block_is_not_judged() -> None:
    rows = {
        "a": _row("a", "Our number puts him at 231 points, which is plenty."),
        "b": _row("b", "OUR NUMBER, puts him: at 231 points!"),
        "c": _row("c", "Our number puts him at 231 points.", source="facts"),
    }
    gate = judge_capsules(["a", "b", "c"], rows, RULES, LINE)
    assert {s.player_ids for s in gate.spans} == {("a", "b")}


def test_a_name_breaks_the_run() -> None:
    a = page_runs(["He sits behind Puka Nacua and Davante Adams on the chart."], NAMES)
    b = page_runs(["He sits behind Davante Adams and Puka Nacua on the chart."], NAMES)
    assert shared_spans({"a": a, "b": b}) == ()
    assert page_runs(["A reach at that spot is a real risk for you."], NAMES) != ()


def test_a_dated_week_breaks_the_run() -> None:
    a = page_runs(["The dud came in week 3 of 2026 is what people remember."], NAMES)
    b = page_runs(["His touchdown in week 3 of 2026 is what people remember now."], NAMES)
    assert shared_spans({"a": a, "b": b}) == ()


def test_overlapping_windows_are_quoted_as_one_phrase() -> None:
    runs = page_runs(["The low end comes from seasons cut short by injury, nothing more."], NAMES)
    shared = frozenset({"comes from seasons cut short by", "from seasons cut short by injury"})
    assert phrases_on_page(runs, shared) == ("comes from seasons cut short by injury",)


def test_the_repair_keeps_each_span_on_its_first_page() -> None:
    order = ["a", "b", "c", "d"]
    assert repair_targets([("c", "a"), ("d", "b", "a")], order) == ["b", "c", "d"]
