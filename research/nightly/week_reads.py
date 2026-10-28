"""THE WEEK READS PASS (Lane 72): every board player's week-ahead read, written when it is due.

Two modes on one pass (`run_week_read_step`):
- **Nightly**, after the capsule step, on the night's facts pass and its instant: every read the cadence
  says is due (`capsules.week.cadence`: a new week, a status or projection that moved, a read that fell to
  its facts block within its retry limits), at most `PAGES_PER_NIGHT`, board order first, under a dollar
  budget of `NIGHTLY_BUDGET_USD`.
- **Hourly**, after the in-season job's status capture (`research.inseason --task capture-harvest`): only
  the reads whose status moved (a projection move is the nightly's, Lane 66v), under `HOURLY_BUDGET_USD` a pass and
  `HOURLY_DAY_USD` across a Central day's passes (`player_week_read_runs`).

The writing is the season writer's pool (`GatewayClient.rolling`, its bucket and throttle waits), the model
checked against the gateway's list before any call (`capsule_step.checked_price`), and the run's dollar
budget a hard stop at the gateway (`run_budget`): no read starts once its worst case would pass what is
left, and a read the budget stopped writes nothing, so a written read is never overwritten by a facts
block for want of budget. Each read is told the sentences tonight's latest reads landed and held to every
sentence shape another page carries for its week, and lands in its own transaction. Then the demotion
(`week_read_demotion`) over every read of the board week.

Without AI_GATEWAY_API_KEY nothing is written, by name. The step is advisory: a page shows a board week's
read only while it stands (`nightly.build.pages.week_read_json`), so a failed step is reported and never
holds the night's board back (`ADVISORY`, read by `nightly.run`). A rewrite that falls to its facts block
replaces the written row, and the page then shows no week read.
"""

import os
from collections import deque
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, time
from typing import Final

import httpx
from sqlalchemy import Engine

from research.capsules.config import CAPSULE_CONFIG, writer_settings
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import GatewayClient
from research.capsules.gateway_ledger import ModelPrice
from research.capsules.narrative import sentences_verbatim
from research.capsules.run_budget import RunBudget
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.sweep import FactsPassMemo
from research.capsules.week.cadence import attempts_today, central_day, due_reason
from research.capsules.week.collect import collect_week_sheets, read_week_facts
from research.capsules.week.judge import JUDGE_MODEL, judge_model
from research.capsules.week.sheet import CENTRAL, WeekSheet
from research.capsules.week.store import (
    StoredWeekRead,
    WeekReadRun,
    hourly_spend_since,
    record_run,
    stored_week_reads,
    upsert_week_read,
)
from research.capsules.week.write import MAX_TOKENS, WeekReadResult, write_week_read
from research.nightly.capsule_step import checked_price
from research.nightly.steps import StepRecord
from research.nightly.week_read_demotion import demote_shared, read_shapes
from research.season import PRODUCT_SEASON

STEP: Final = "week-reads"
# The nightly's steps whose failure is reported and never fails the run.
ADVISORY: Final = frozenset({STEP})
NIGHTLY: Final = "nightly"
HOURLY: Final = "hourly"
# A night's reads: the whole board (about 536 pages) with room.
PAGES_PER_NIGHT: Final = 700
# THE DOLLARS (the coordinator's M3). On the recordings (fix round 2) and Lane 117's replay of 40 production reads
# a read averages under $0.002, so a full turnover of the board's 536 reads sits inside NIGHTLY_BUDGET_USD on
# average. The worst case is no such sum: a read may make MAX_ASKS_PER_READ asks, each at up to
# WORST_PROMPT_TOKENS in and MAX_TOKENS out, and a night of reads at that worst can cost more than
# NIGHTLY_BUDGET_USD. So the night is held by the pass's hard stop at NIGHTLY_BUDGET_USD (`step_budget`, the
# gateway's reservation), not by this sum: before a read starts the budget's check prices it at
# BUDGETED_CALLS_PER_READ asks at the worst (`worst_read_usd`), and a read cut by the stop falls to its facts
# block. An hourly pass writes only the reads a status moved (a projection move
# waits for the nightly, Lane 66v), held the same way at HOURLY_BUDGET_USD a pass and HOURLY_DAY_USD across a
# Central day's passes (the capture runs 18 times).
NIGHTLY_BUDGET_USD: Final = 1.40
HOURLY_BUDGET_USD: Final = 0.05
HOURLY_DAY_USD: Final = 1.00  # 0.60 before the game-day status passes (Lane 263)
# The heaviest prompt a week read's ask carries (a correction with its ledger and every line's stamp), for a
# read's worst case against what is left of the budget. Measured on Lane 117's replay of 40 production
# sheets of week 7 after the four-rule prompt: 8,506 prompt tokens at 17,643 characters, the fewest
# characters a token 1.87 (the recordings of Lane 72 had peaked at 3,630).
WORST_PROMPT_TOKENS: Final = 9_000
# The asks the budget's check prices a read at before it starts (the coordinator's ruling, Lane 117 fix round
# 3): two at the heaviest prompt, a draft and its one retry. A read may make more (MAX_ASKS_PER_READ); the gateway's reservation is the
# hard stop for those in flight.
BUDGETED_CALLS_PER_READ: Final = 2
# The fewest characters a prompt token took on that replay, for counting a built prompt (the tests).
MIN_CHARS_PER_TOKEN: Final = 1.8
# The recordings' dearest call, for a budget in calls when the price list cannot be read.
WORST_CALL_USD: Final = 0.00065
Log = Callable[[str], None]


@dataclass(slots=True)
class WeekReadSpend:
    due: dict[str, int] = field(default_factory=dict)
    written: int = 0
    facts_blocks: int = 0
    budget_stopped: int = 0
    landed: int = 0
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    demoted: int = 0
    left: int = 0
    # Each read that fell to its facts block, "<name>: <why>" (Lane 66v): the pass's own record of why.
    fell: list[str] = field(default_factory=list)

    def add(self, result: WeekReadResult) -> None:
        self.landed += 1
        self.written += result.source == WRITTEN_SOURCE
        self.facts_blocks += result.source == FACTS_SOURCE
        self.calls += result.calls
        usage = result.usage
        if usage is not None:
            self.prompt_tokens += usage.prompt_tokens or 0
            self.completion_tokens += usage.completion_tokens or 0
            self.cost_usd += usage.cost_usd or 0.0

    def fell_to_facts(self, name: str, why: str) -> None:
        self.fell.append(f"{name}: {why}")

    def line(self) -> str:
        due = ", ".join(f"{reason} {count}" for reason, count in sorted(self.due.items())) or "none"
        fell = "" if not self.fell else f"; {len(self.fell)} fell to their facts blocks: {'; '.join(self.fell)}"
        return (
            f"{sum(self.due.values())} reads due ({due}), {self.written} written, {self.facts_blocks} facts blocks, "
            f"{self.budget_stopped} stopped by the budget, {self.left} left for later, {self.calls} calls, "
            f"{self.prompt_tokens} prompt and {self.completion_tokens} completion tokens, ${self.cost_usd:.6f}, "
            f"{self.demoted} demoted for a sentence on two pages{fell}"
        )


def worst_read_usd(price: ModelPrice) -> float:
    """A read's worst case in dollars for the budget's check before it starts: `BUDGETED_CALLS_PER_READ` asks at
    the heaviest prompt and the whole completion allowance."""
    per_in = (price.input_usd_per_million or 0.0) / 1_000_000
    per_out = (price.output_usd_per_million or 0.0) / 1_000_000
    return BUDGETED_CALLS_PER_READ * (WORST_PROMPT_TOKENS * per_in + MAX_TOKENS * per_out)


def step_budget(price: ModelPrice, usd: float) -> RunBudget:
    """The pass's hard stop in dollars; with no list price, in calls at the recorded worst call's cost."""
    if price.input_usd_per_million is None or price.output_usd_per_million is None:
        return RunBudget.of(calls=int(usd / WORST_CALL_USD))
    return RunBudget.of(usd=usd, price=price)


class _Board:
    """The week's sentence shapes as reads land: who carries each, and tonight's newest sentences to quote."""

    def __init__(self, stored: Mapping[tuple[str, int], StoredWeekRead]) -> None:
        self.carriers: dict[int, dict[str, set[str]]] = {}
        self.recent: dict[int, deque[str]] = {}
        for (player_id, week), read in stored.items():
            self._hold(player_id, week, read)

    def _hold(self, player_id: str, week: int, read: StoredWeekRead) -> None:
        by_shape = self.carriers.setdefault(week, {})
        for held in by_shape.values():
            held.discard(player_id)
        for shape in read_shapes(read):
            by_shape.setdefault(shape, set()).add(player_id)

    def taken(self, sheet: WeekSheet) -> frozenset[str]:
        held = self.carriers.get(sheet.week, {})
        return frozenset(shape for shape, ids in held.items() if ids - {sheet.player_id})

    def avoid(self, week: int) -> tuple[str, ...]:
        return tuple(self.recent.get(week, ()))

    def land(self, read: StoredWeekRead) -> None:
        self._hold(read.player_id, read.week, read)
        if read.source == WRITTEN_SOURCE:
            recent = self.recent.setdefault(read.week, deque(maxlen=CAPSULE_CONFIG.repetition.max_quoted_sentences))
            recent.extend(sentences_verbatim(read.body))


def stored_row(
    sheet: WeekSheet, result: WeekReadResult, reason: str, before: StoredWeekRead | None, at: datetime
) -> StoredWeekRead:
    """The row a written (or fallen) read is kept as: the facts' stamps, what the cadence compares, the
    writer's call, and the attempt counted on `at`'s Central day."""
    return StoredWeekRead(
        sheet.player_id, sheet.season, sheet.week, result.source, result.text, result.model, sheet.written_at,
        sheet.facts_at, sheet.stamps(), None if sheet.projection is None else sheet.projection.points,
        sheet.status.status, reason, result.call, central_day(at), attempts_today(before, at) + 1,
    )  # fmt: skip


@dataclass(frozen=True, slots=True)
class _Night:
    sheets: tuple[WeekSheet, ...]
    stored: Mapping[tuple[str, int], StoredWeekRead]
    board_week: int


def _read_night(engine: Engine, now: datetime, facts: FactsPassMemo) -> _Night | None:
    with engine.connect() as conn:
        subjects = facts(conn, now)
        week_facts = read_week_facts(conn, PRODUCT_SEASON, subjects, now)
        if week_facts is None:
            return None
        weeks = sorted({cw.week for cw in week_facts.weeks.values()} | {week_facts.board_week})
        stored = stored_week_reads(conn, PRODUCT_SEASON, weeks)
        sheets = tuple(collect_week_sheets(week_facts, subjects, stored))
        return _Night(sheets, stored, week_facts.board_week)


def _write(  # noqa: PLR0913 - the pass's parts
    engine: Engine,
    gateway: GatewayClient,
    night: _Night,
    due: Sequence[tuple[WeekSheet, str]],
    *,
    room: Callable[[], bool],
    spend: WeekReadSpend,
    judge: str = JUDGE_MODEL,
) -> None:
    """The due reads on the writer's pool, each landed in its own transaction, tallied on `spend`."""
    board = _Board(night.stored)

    def start(item: tuple[WeekSheet, str]) -> Callable[[GatewayClient], WeekReadResult]:
        sheet = item[0]
        avoid, taken = board.avoid(sheet.week), board.taken(sheet)
        return lambda scoped: write_week_read(sheet, scoped, avoid, taken, judge)

    def land(item: tuple[WeekSheet, str], result: WeekReadResult) -> None:
        spend.add(result)
        if result.fallback == "the run's budget is spent":
            spend.budget_stopped += 1
            return
        sheet, reason = item
        if result.source == FACTS_SOURCE and result.fallback is not None:
            spend.fell_to_facts(sheet.name, result.fallback)
        row = stored_row(sheet, result, reason, night.stored.get((sheet.player_id, sheet.week)), sheet.written_at)
        with engine.begin() as conn:
            upsert_week_read(conn, row)
        board.land(row)

    if gateway.rolling(due, start, land, stop=lambda: not room()):
        spend.budget_stopped += len(due) - spend.landed


def _room(budget: RunBudget, worst: float) -> Callable[[], bool]:
    """Whether another read may start: its worst case fits what is left (the gateway's reservation is the
    hard stop for the reads in flight)."""
    return lambda: budget.max_usd is None or budget.spent_usd + worst <= budget.max_usd


def record_spend(engine: Engine, now: datetime, mode: str, spend: WeekReadSpend, budget: RunBudget | None) -> None:
    """The pass's row on `player_week_read_runs`: the budget's own tally of calls and dollars when it ran
    (every call it reserved, a raised read's included), else what the landed reads billed."""
    calls = spend.calls if budget is None else max(spend.calls, budget.calls_made)
    cost = spend.cost_usd if budget is None else max(spend.cost_usd, budget.spent_usd)
    with engine.begin() as conn:
        record_run(conn, WeekReadRun(now, mode, calls, cost, spend.written, spend.facts_blocks, spend.demoted))


def _day_start(now: datetime) -> datetime:
    return datetime.combine(central_day(now), time(), CENTRAL)


def _budget_usd(engine: Engine, now: datetime, hourly: bool) -> float:
    if not hourly:
        return NIGHTLY_BUDGET_USD
    with engine.connect() as conn:
        spent = hourly_spend_since(conn, _day_start(now))
    return max(0.0, min(HOURLY_BUDGET_USD, HOURLY_DAY_USD - spent))


def run_week_read_step(
    engine: Engine, now: datetime, log: Log, facts: FactsPassMemo, *, hourly: bool = False
) -> StepRecord:
    """The pass's record: what was due, written, demoted and spent; skipped by name without the key, and
    an hourly pass skipped once the day's hourly dollars are spent."""
    mode = HOURLY if hourly else NIGHTLY
    key = os.environ.get(CAPSULE_CONFIG.gateway.api_key_variable, "").strip()
    if not key:
        return StepRecord(STEP, "skipped", f"{CAPSULE_CONFIG.gateway.api_key_variable} is not set, nothing written")
    usd = _budget_usd(engine, now, hourly)
    if usd <= 0:
        return StepRecord(STEP, "skipped", f"the hourly passes' ${HOURLY_DAY_USD:.2f} for the day is spent")
    night = _read_night(engine, now, facts)
    if night is None:
        return StepRecord(STEP, "skipped", "no game is left to kick off this season")
    due = [
        (sheet, reason)
        for sheet in night.sheets
        if (reason := due_reason(sheet, night.stored.get((sheet.player_id, sheet.week)), now, hourly=hourly))
        is not None
    ]
    spend = WeekReadSpend()
    for _, reason in due:
        spend.due[reason] = spend.due.get(reason, 0) + 1
    spend.left = max(0, len(due) - PAGES_PER_NIGHT)
    budget: RunBudget | None = None
    settings = writer_settings(os.environ)
    try:
        with httpx.Client() as http:
            price = checked_price(http, key, settings)
            judge = judge_model(os.environ)
            checked_price(http, key, replace(settings, model=judge))  # the judge's model is listed too
            budget = step_budget(price, usd)
            room = _room(budget, worst_read_usd(price))
            gateway = GatewayClient.for_run(key, http, settings).with_budget(budget)
            _write(engine, gateway, night, due[:PAGES_PER_NIGHT], room=room, spend=spend, judge=judge)
        spend.demoted = demote_shared(engine, night.sheets, night.board_week, now)
    finally:
        # Whatever the pass spent is on the day's ledger even when it raised (the re-review's F6).
        record_spend(engine, now, mode, spend, budget)
    line = (
        f"{mode}, board week {night.board_week}, {len(night.sheets)} board players with a week ahead, "
        f"{budget.line()}; {spend.line()}"
    )
    log(f"{STEP}: {line}")
    return StepRecord(STEP, "ran", line)
