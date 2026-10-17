"""THE NIGHTLY'S WEEK READS (Lane 72): every board player's week-ahead read, written when it is due.

After the capsule step, on the night's facts pass (`FactsPassMemo`) and its instant:

1. **The sheets**: each board player's week (`capsules.week.collect`), his read due when the cadence says
   (`capsules.week.cadence`: no read for his week, the last fell to its facts block, his status changed,
   or the published projection moved by more than a point). At most `PAGES_PER_NIGHT` a night, board
   order first.
2. **The writing**: the season writer's pool (`GatewayClient.rolling`, its bucket and throttle waits), the
   model checked against the gateway's list before any call (`capsule_step.checked_price`). Each read is
   told the sentences tonight's latest reads landed and held to every sentence another page carries for
   its week (`capsules.week.validate`), and lands in its own transaction.
3. **The demotion** (Lane 62's rule): a sentence still on two written reads of one week keeps its first
   carrier in board order and the others become their facts blocks, no model call made.

Without AI_GATEWAY_API_KEY nothing is written, by name. The step is advisory: a page without a week read
shows the read before it or none, so a failed step is reported and never holds the night's board back
(`ADVISORY`, read by `nightly.run`).
"""

import os
from collections import deque
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Final

import httpx
from sqlalchemy import Engine

from research.capsules.config import CAPSULE_CONFIG, writer_settings
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import GatewayClient
from research.capsules.narrative import held_sentences, sentences_verbatim
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.sweep import FactsPassMemo
from research.capsules.week.cadence import due_reason
from research.capsules.week.collect import collect_week_sheets, read_week_facts
from research.capsules.week.sheet import WeekSheet, render_week_facts_block
from research.capsules.week.store import StoredWeekRead, stored_week_reads, upsert_week_read
from research.capsules.week.write import WeekReadResult, write_week_read
from research.nightly.capsule_demotion import Target, demotion_targets
from research.nightly.capsule_gate import SharedSentence
from research.nightly.capsule_step import checked_price
from research.nightly.steps import StepRecord
from research.season import PRODUCT_SEASON

STEP: Final = "week-reads"
# The nightly's steps whose failure is reported and never fails the run.
ADVISORY: Final = frozenset({STEP})
# A night's reads: the whole board (about 536 pages) with room, the hard ceiling on a night's spend
# at `write.MAX_CALLS_PER_READ` calls each.
PAGES_PER_NIGHT: Final = 700
DEMOTED: Final = "demoted"
Log = Callable[[str], None]


@dataclass(slots=True)
class WeekReadSpend:
    due: dict[str, int] = field(default_factory=dict)
    written: int = 0
    facts_blocks: int = 0
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    demoted: int = 0
    left: int = 0

    def add(self, result: WeekReadResult) -> None:
        self.written += result.source == WRITTEN_SOURCE
        self.facts_blocks += result.source == FACTS_SOURCE
        self.calls += result.calls
        usage = result.usage
        if usage is not None:
            self.prompt_tokens += usage.prompt_tokens or 0
            self.completion_tokens += usage.completion_tokens or 0
            self.cost_usd += usage.cost_usd or 0.0

    def line(self) -> str:
        due = ", ".join(f"{reason} {count}" for reason, count in sorted(self.due.items())) or "none"
        return (
            f"{sum(self.due.values())} reads due ({due}), {self.written} written, {self.facts_blocks} facts blocks, "
            f"{self.left} left for tomorrow, {self.calls} calls, {self.prompt_tokens} prompt and "
            f"{self.completion_tokens} completion tokens, ${self.cost_usd:.6f}, {self.demoted} demoted for a "
            "sentence on two pages"
        )


# --- the week's sentences ---------------------------------------------------------------------------


def week_sentences(read: StoredWeekRead) -> set[str]:
    """A written read's sentences held to uniqueness (normalized, four words or more)."""
    if read.source != WRITTEN_SOURCE:
        return set()
    return held_sentences((read.body,), CAPSULE_CONFIG.shared_sentence_min_words)


def shared_week_sentences(reads: Mapping[str, StoredWeekRead]) -> tuple[SharedSentence, ...]:
    """Every held sentence two written reads carry, the most carried first."""
    pages: dict[str, list[str]] = {}
    for player_id, read in reads.items():
        for sentence in week_sentences(read):
            pages.setdefault(sentence, []).append(player_id)
    shared = [SharedSentence(sentence, tuple(sorted(ids))) for sentence, ids in pages.items() if len(ids) > 1]
    return tuple(sorted(shared, key=lambda s: (-len(s.player_ids), s.sentence)))


def week_demotions(shared: Sequence[SharedSentence], board_order: Sequence[str]) -> tuple[Target, ...]:
    """The reads to demote, each once with its sentence: every carrier but the first in board order."""
    return demotion_targets(shared, board_order)


class _Board:
    """The week's sentences as reads land: who carries each, and tonight's newest to quote."""

    def __init__(self, stored: Mapping[tuple[str, int], StoredWeekRead]) -> None:
        self.carriers: dict[int, dict[str, set[str]]] = {}
        self.recent: dict[int, deque[str]] = {}
        for (player_id, week), read in stored.items():
            self._hold(player_id, week, read)

    def _hold(self, player_id: str, week: int, read: StoredWeekRead) -> None:
        by_sentence = self.carriers.setdefault(week, {})
        for held in by_sentence.values():
            held.discard(player_id)
        for sentence in week_sentences(read):
            by_sentence.setdefault(sentence, set()).add(player_id)

    def taken(self, sheet: WeekSheet) -> frozenset[str]:
        held = self.carriers.get(sheet.week, {})
        return frozenset(s for s, ids in held.items() if ids - {sheet.player_id})

    def avoid(self, week: int) -> tuple[str, ...]:
        return tuple(self.recent.get(week, ()))

    def land(self, read: StoredWeekRead) -> None:
        self._hold(read.player_id, read.week, read)
        if read.source == WRITTEN_SOURCE:
            recent = self.recent.setdefault(read.week, deque(maxlen=CAPSULE_CONFIG.repetition.max_quoted_sentences))
            recent.extend(sentences_verbatim(read.body))


def stored_row(sheet: WeekSheet, result: WeekReadResult, reason: str) -> StoredWeekRead:
    """The row a written (or fallen) read is kept as, with the facts' stamps and what the cadence compares."""
    return StoredWeekRead(
        sheet.player_id,
        sheet.season,
        sheet.week,
        result.source,
        result.text,
        result.model,
        sheet.written_at,
        sheet.facts_at,
        sheet.stamps(),
        None if sheet.projection is None else sheet.projection.points,
        sheet.status.status,
        reason,
    )


@dataclass(frozen=True, slots=True)
class _Night:
    sheets: tuple[WeekSheet, ...]
    stored: Mapping[tuple[str, int], StoredWeekRead]


def _read_night(engine: Engine, now: datetime, facts: FactsPassMemo) -> _Night | None:
    with engine.connect() as conn:
        subjects = facts(conn, now)
        week_facts = read_week_facts(conn, PRODUCT_SEASON, subjects, now)
        if week_facts is None:
            return None
        weeks = sorted({cw.week for cw in week_facts.weeks.values()})
        stored = stored_week_reads(conn, PRODUCT_SEASON, weeks)
        return _Night(tuple(collect_week_sheets(week_facts, subjects, stored)), stored)


def _write(
    engine: Engine, gateway: GatewayClient, night: _Night, due: Sequence[tuple[WeekSheet, str]]
) -> WeekReadSpend:
    spend = WeekReadSpend()
    board = _Board(night.stored)

    def start(item: tuple[WeekSheet, str]) -> Callable[[GatewayClient], WeekReadResult]:
        sheet = item[0]
        avoid, taken = board.avoid(sheet.week), board.taken(sheet)
        return lambda scoped: write_week_read(sheet, scoped, avoid, taken)

    def land(item: tuple[WeekSheet, str], result: WeekReadResult) -> None:
        row = stored_row(item[0], result, item[1])
        with engine.begin() as conn:
            upsert_week_read(conn, row)
        board.land(row)
        spend.add(result)

    gateway.rolling(due, start, land)
    return spend


def demote_shared(engine: Engine, sheets: Sequence[WeekSheet], at: datetime) -> int:
    """Every written read of a week but the first in board order (`sheets`' order) carrying a sentence
    another one carries, written as its facts block (no model call). Returns how many."""
    order = [sheet.player_id for sheet in sheets]
    by_id = {(sheet.player_id, sheet.week): sheet for sheet in sheets}
    demoted = 0
    with engine.begin() as conn:
        stored = stored_week_reads(conn, PRODUCT_SEASON, sorted({sheet.week for sheet in sheets}))
        for week in sorted({key[1] for key in stored}):
            reads = {pid: read for (pid, w), read in stored.items() if w == week}
            for player_id, _ in week_demotions(shared_week_sentences(reads), order):
                sheet = by_id.get((player_id, week))
                if sheet is None:
                    continue
                read = reads[player_id]
                block = render_week_facts_block(sheet)
                upsert_week_read(conn, _demoted(read, block, at))
                demoted += 1
    return demoted


def _demoted(read: StoredWeekRead, block: str, at: datetime) -> StoredWeekRead:
    return StoredWeekRead(
        read.player_id, read.season, read.week, FACTS_SOURCE, block, None, max(at, read.written_at), read.facts_at,
        read.stamps, read.projection_points, read.status, DEMOTED,
    )  # fmt: skip


def run_week_read_step(engine: Engine, now: datetime, log: Log, facts: FactsPassMemo) -> StepRecord:
    """The step's record: what was due, written, demoted and spent; skipped by name without the key."""
    key = os.environ.get(CAPSULE_CONFIG.gateway.api_key_variable, "").strip()
    if not key:
        return StepRecord(STEP, "skipped", f"{CAPSULE_CONFIG.gateway.api_key_variable} is not set, nothing written")
    night = _read_night(engine, now, facts)
    if night is None:
        return StepRecord(STEP, "skipped", "no game is left to kick off this season")
    due = [
        (sheet, reason)
        for sheet in night.sheets
        if (reason := due_reason(sheet, night.stored.get((sheet.player_id, sheet.week)))) is not None
    ]
    settings = writer_settings(os.environ)
    with httpx.Client() as http:
        checked_price(http, key, settings)
        gateway = GatewayClient.for_run(key, http, settings)
        spend = _write(engine, gateway, night, due[:PAGES_PER_NIGHT])
    for _, reason in due:
        spend.due[reason] = spend.due.get(reason, 0) + 1
    spend.left = max(0, len(due) - PAGES_PER_NIGHT)
    spend.demoted = demote_shared(engine, night.sheets, datetime.now(UTC))
    line = f"{len(night.sheets)} board players with a week ahead; {spend.line()}"
    log(f"{STEP}: {line}")
    return StepRecord(STEP, "ran", line)
