"""NO SENTENCE SHAPE ON TWO WEEK READS (Lane 62's rule, on shapes per the Lane 72 review's M4).

A written week read's sentence whose shape, with every player name, club and number a placeholder
(`capsules.week.validate.sentence_shapes`, six words or more), another written read of the same week carries keeps its first
carrier in board order; every other carrier becomes its facts block, no model call made, unless the pass
rewrote it over a written read, which it gets back (`demote_shared_keeping`, Lane 275 fix round 2). Every read of
the board week is covered (H1): a read whose player has no sheet tonight (a club whose board-week game
has kicked off, now writing its next week) is demoted to the facts block its own row can state.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, Engine, select

from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.narrative import ShapeMasks
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.week.cadence import kept_read
from research.capsules.week.render import render_week_facts_block
from research.capsules.week.sheet import STATUS_WORDS, WeekSheet, points_text
from research.capsules.week.store import StoredWeekRead, stored_week_reads, upsert_week_read
from research.capsules.week.validate import sentence_shapes
from research.db.schema import PLAYERS
from research.nightly.capsule_demotion import Target, demotion_targets
from research.nightly.capsule_gate import SharedSentence
from research.season import PRODUCT_SEASON

DEMOTED: Final = "demoted"


def read_shapes(read: StoredWeekRead, masks: ShapeMasks) -> set[str]:
    """A written read's held sentence shapes."""
    return set() if read.source != WRITTEN_SOURCE else set(sentence_shapes(read.body, masks))


def shared_week_sentences(reads: Mapping[str, StoredWeekRead], masks: ShapeMasks) -> tuple[SharedSentence, ...]:
    """Every sentence shape two written reads carry, the most carried first."""
    pages: dict[str, list[str]] = {}
    for player_id, read in reads.items():
        for shape in read_shapes(read, masks):
            pages.setdefault(shape, []).append(player_id)
    shared = [SharedSentence(shape, tuple(sorted(ids))) for shape, ids in pages.items() if len(ids) > 1]
    return tuple(sorted(shared, key=lambda s: (-len(s.player_ids), s.sentence)))


def week_demotions(shared: Sequence[SharedSentence], board_order: Sequence[str]) -> tuple[Target, ...]:
    """The reads to demote, each once with its shape: every carrier but the first in board order."""
    return demotion_targets(shared, board_order)


def stored_facts_block(read: StoredWeekRead) -> str:
    """The facts block a row states without its sheet: the week, the status and the published projection."""
    lines = [f"Week: {read.week} of {read.season}"]
    lines.append(f"Status: {'no designation' if read.status is None else STATUS_WORDS.get(read.status, read.status)}")
    if read.projection_points is not None:
        lines.append(f"Published projection: {points_text(read.projection_points)} points (PPR)")
    return "\n".join(lines)


def _demoted(read: StoredWeekRead, block: str, at: datetime) -> StoredWeekRead:
    return StoredWeekRead(
        read.player_id, read.season, read.week, FACTS_SOURCE, block, None, max(at, read.written_at), read.facts_at,
        read.stamps, read.projection_points, read.status, DEMOTED, read.call, read.attempt_day, read.attempts,
    )  # fmt: skip


def player_names(conn: Connection, ids: Iterable[str]) -> list[str]:
    """The names of the players `ids` names, for masking their stored reads (`week_masks`)."""
    wanted = sorted(set(ids))
    if not wanted:
        return []
    return [str(name) for name in conn.execute(select(PLAYERS.c.name).where(PLAYERS.c.id.in_(wanted))).scalars()]


@dataclass(frozen=True, slots=True)
class WeekDemotion:
    """A demotion's outcome, (player, week) each: the reads written as their facts blocks, and the reads put
    back to the written read the pass rewrote (Lane 275 fix round 2)."""

    demoted: frozenset[tuple[str, int]]
    restored: frozenset[tuple[str, int]]


def demote_shared(
    engine: Engine, sheets: Sequence[WeekSheet], board_week: int, at: datetime, masks: ShapeMasks
) -> frozenset[tuple[str, int]]:
    """Every written read of the board week and of tonight's weeks but the first carrier in board order
    (`sheets`' order, then the rest by player) of a shape another carries (`masks`, every board player's
    name, so a carrier with no sheet tonight is masked too), written as its facts block. Returns the reads
    demoted, (player, week)."""
    return demote_shared_keeping(engine, sheets, board_week, at, masks, kept={}).demoted


def _others_shapes(reads: Mapping[str, StoredWeekRead], player_id: str, masks: ShapeMasks) -> set[str]:
    return {shape for pid, read in reads.items() if pid != player_id for shape in read_shapes(read, masks)}


def _restorable(
    read: StoredWeekRead, earlier: StoredWeekRead | None, reads: Mapping[str, StoredWeekRead], masks: ShapeMasks
) -> StoredWeekRead | None:
    """The written read the pass rewrote for a demoted carrier, when it carries no shape another read does now;
    None when there was none, the carrier is that read itself, or it shares a shape too."""
    if earlier is None or earlier.source != WRITTEN_SOURCE or earlier.body == read.body:
        return None
    return None if read_shapes(earlier, masks) & _others_shapes(reads, read.player_id, masks) else earlier


def demote_shared_keeping(  # noqa: PLR0913 - the pass's parts
    engine: Engine,
    sheets: Sequence[WeekSheet],
    board_week: int,
    at: datetime,
    masks: ShapeMasks,
    *,
    kept: Mapping[tuple[str, int], StoredWeekRead],
) -> WeekDemotion:
    """`demote_shared`, keeping a written read (Lane 275 fix round 2, the founder: "we should always show a
    read"): a demoted carrier the pass rewrote over a written read (`kept`, the rows the pass started from) gets
    that read back, its fall counted (`cadence.kept_read`), unless that read shares a shape too; only a carrier
    with no written read before it, or whose earlier read shares a shape, becomes its facts block."""
    by_id = {(sheet.player_id, sheet.week): sheet for sheet in sheets}
    order = list(dict.fromkeys(sheet.player_id for sheet in sheets))
    weeks = sorted({board_week, *(sheet.week for sheet in sheets)})
    demoted: set[tuple[str, int]] = set()
    restored: set[tuple[str, int]] = set()
    with engine.begin() as conn:
        stored = stored_week_reads(conn, PRODUCT_SEASON, weeks)
        for week in weeks:
            reads = {pid: read for (pid, w), read in stored.items() if w == week}
            week_order = [*order, *sorted(pid for pid in reads if pid not in order)]
            for player_id, _ in week_demotions(shared_week_sentences(reads, masks), week_order):
                read = reads[player_id]
                sheet = by_id.get((player_id, week))
                earlier = _restorable(read, kept.get((player_id, week)), reads, masks)
                if earlier is not None:
                    # Only a status rewrite's demotion counts toward the day's status cap (Lane 293 review, H1).
                    moved = sheet is None or earlier.status != sheet.status.status
                    row = kept_read(earlier, at, status_fall=moved)
                    restored.add((player_id, week))
                else:
                    block = stored_facts_block(read) if sheet is None else render_week_facts_block(sheet)
                    row = _demoted(read, block, at)
                    demoted.add((player_id, week))
                upsert_week_read(conn, row)
                reads[player_id] = row
    return WeekDemotion(frozenset(demoted), frozenset(restored))
