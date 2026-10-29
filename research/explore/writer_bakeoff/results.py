"""THE BAKE-OFF'S RESULTS: the run's lanes and judged drafts as one JSON-ready record, beside production's
own reads of the week as the baseline."""

import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from typing import Any, Final

from research.capsules.narrative import ShapeMasks, club_spellings
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.render import render_week_facts_block
from research.capsules.week.sheet import WeekSheet
from research.capsules.week.store import StoredWeekRead
from research.explore.writer_bakeoff.run import Lane, Night, Rejudged, outcome_of
from research.explore.writer_bakeoff.tally import agreement, shape_duplicates, tally

SIDE_BY_SIDE: Final = 10
# Where a fall's reason starts quoting the read: the sentence it names, or the words it found.
_QUOTED: Final = re.compile(r',? in the sentence "|, "|: "')
BASELINE: Final = "production"
Json = dict[str, Any]


def spread(count: int, pick: int = SIDE_BY_SIDE) -> list[int]:
    """`pick` indices spread evenly over `count` items in order, the first and last among them."""
    if count <= pick:
        return list(range(count))
    return sorted({round(i * (count - 1) / (pick - 1)) for i in range(pick)})


def fall_reason(fallback: str | None) -> str:
    """A fall's reason without the sentence it quotes, so reasons tally."""
    if fallback is None:
        return "written"
    return _QUOTED.split(fallback)[0][:160]


def baseline_reads(night: Night) -> dict[str, StoredWeekRead]:
    """Production's stored read of the board week for each sheet's player."""
    return {s.player_id: read for s in night.sheets if (read := night.stored.get((s.player_id, s.week))) is not None}


def _baseline(night: Night, masks: ShapeMasks) -> Json:
    reads = baseline_reads(night)
    by_id = {s.player_id: s for s in night.sheets}
    written = {pid: r.body for pid, r in reads.items() if r.source == WRITTEN_SOURCE}
    held = [pid for pid in reads if not by_id[pid].may_start]
    return {
        "model": BASELINE,
        "reads": len(reads),
        "written": len(written),
        "written_rate": len(written) / len(reads) if reads else 0.0,
        "facts_rate": 1 - len(written) / len(reads) if reads else 0.0,
        "may_not_start": len(held),
        "may_not_start_written": sum(pid in written for pid in held),
        "shapes": asdict(shape_duplicates(written, masks)),
    }


def _lane(lane: Lane, masks: ShapeMasks, rejudged: Sequence[Rejudged]) -> Json:
    outcomes = [outcome_of(lane.model, sheet, result, seconds) for sheet, result, seconds in lane.reads.values()]
    written = {pid: result.text for pid, (_, result, _) in lane.reads.items() if result.source == WRITTEN_SOURCE}
    mine = [r for r in rejudged if r.writer == lane.model and r.second_refused is not None]
    agreed = agreement([(r.first_refused, bool(r.second_refused)) for r in mine])
    return {
        "tally": asdict(tally(lane.model, outcomes, lane.stopped)),
        "shapes": asdict(shape_duplicates(written, masks)),
        "falls": dict(Counter(fall_reason(o.fallback) for o in outcomes).most_common()),
        "second_judge": {
            **asdict(agreed),
            "first_pass_rate": agreed.first_pass_rate,
            "second_pass_rate": agreed.second_pass_rate,
            "errors": sum(r.writer == lane.model and r.second_refused is None for r in rejudged),
        },
    }


def _side_by_side(night: Night, lanes: Mapping[str, Lane]) -> list[Json]:
    stored = baseline_reads(night)
    rows = []
    for index in spread(len(night.sheets)):
        sheet: WeekSheet = night.sheets[index]
        row: Json = {
            "board_index": index,
            "player": sheet.name,
            "position": sheet.position,
            "team": sheet.team,
            "may_start": sheet.may_start,
            "facts_block": render_week_facts_block(sheet),
            "production": None if (r := stored.get(sheet.player_id)) is None else {"source": r.source, "text": r.body},
        }
        for model, lane in lanes.items():
            got = lane.reads.get(sheet.player_id)
            row[model] = None if got is None else {"source": got[1].source, "call": got[1].call, "text": got[1].text}
        rows.append(row)
    return rows


def _reads(lanes: Mapping[str, Lane]) -> list[Json]:
    return [
        {
            "model": lane.model,
            "player_id": pid,
            "player": sheet.name,
            "may_start": sheet.may_start,
            "source": result.source,
            "call": result.call,
            "fallback": result.fallback,
            "calls": result.calls,
            "retry_asks": result.retry_asks,
            "team": sheet.team,
            "opponent": None if sheet.game is None else sheet.game.opponent,
            "seconds": round(seconds, 3),
            "cost_usd": None if result.usage is None else result.usage.cost_usd,
            "text": result.text,
            "drafts": [{"body": a.body, "call": a.call, "violations": list(a.violations)} for a in result.attempts],
        }
        for lane in lanes.values()
        for pid, (sheet, result, seconds) in lane.reads.items()
    ]


def build_results(night: Night, lanes: Mapping[str, Lane], rejudged: Sequence[Rejudged], run: Json) -> Json:
    masks = ShapeMasks.of((s.name for s in night.sheets), club_spellings())
    weeks = Counter(s.week for s in night.sheets)
    return {
        "run": {
            **run,
            "instant": night.now.isoformat(),
            "board_week": night.board_week,
            "sheets": len(night.sheets),
            "sheets_by_week": {str(w): n for w, n in sorted(weeks.items())},
            "may_not_start_sheets": sum(not s.may_start for s in night.sheets),
        },
        "models": {model: _lane(lane, masks, rejudged) for model, lane in lanes.items()},
        "baseline": _baseline(night, masks),
        "side_by_side": _side_by_side(night, lanes),
        "rejudged": [asdict(r) for r in rejudged],
        "reads": _reads(lanes),
    }
