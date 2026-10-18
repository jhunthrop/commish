"""The unwritten line by voice (the coordinator's Lane 17 ruling): 2% before the season's first
kickoff, 3% from it on, the run's date deciding, and the line in use named in the gate's summary."""

from datetime import UTC, datetime, timedelta

from research.capsules.config import CAPSULE_CONFIG, UnwrittenLine
from research.capsules.facts.season_so_far import is_in_season
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.spans import SpanRules
from research.capsules.store import WRITTEN_SOURCE, StoredCapsule
from research.nightly.capsule_gate import judge_capsules

KICKOFF = datetime(2026, 9, 10, 0, 20, tzinfo=UTC)
_AT = datetime(2026, 10, 14, tzinfo=UTC)
# 100 pages, 3 of them unwritten: 3.0%, over the preseason line and on the in-season one.
UNWRITTEN = 3
IDS = [f"p{i}" for i in range(100)]
ROWS = {
    pid: StoredCapsule(
        pid, "h", "c", f"Note {pid}.", FACTS_SOURCE if i < UNWRITTEN else WRITTEN_SOURCE, None, None, _AT
    )
    for i, pid in enumerate(IDS)
}


def _line(as_of: datetime) -> UnwrittenLine:
    return CAPSULE_CONFIG.unwritten_line(in_season=is_in_season(KICKOFF, as_of))


def test_the_run_date_picks_the_line() -> None:
    assert _line(KICKOFF - timedelta(seconds=1)).share_max == CAPSULE_CONFIG.unwritten_line_preseason.share_max
    assert _line(KICKOFF).share_max == CAPSULE_CONFIG.unwritten_line_in_season.share_max


def test_three_percent_unwritten_fails_preseason_and_passes_in_season() -> None:
    rules = SpanRules(frozenset())
    before = judge_capsules(IDS, ROWS, rules, _line(KICKOFF - timedelta(days=1)))
    during = judge_capsules(IDS, ROWS, rules, _line(_AT))
    assert not before.ok
    assert during.ok
    assert "3.0% unwritten, the preseason line 2%" in before.summary()
    assert "3.0% unwritten, the in-season line 3%" in during.summary()
    # Lane 73 ruling 4: the basis is a full-board night under the call ceiling and the demotion, not
    # Lane 17's 80-page sample; the 3% itself does not move.
    assert "a full-board night (536 pages, every sheet moved) under the call ceiling and the demotion" in (
        during.summary()
    )
    assert "80-page" not in during.summary()
    assert CAPSULE_CONFIG.unwritten_line_in_season.share_max == 0.03  # noqa: PLR2004
