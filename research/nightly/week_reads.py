"""THE WEEK READS PASS (Lane 72, Lane 256): every board player's read for the coming week, written in one pass
when the week rolls over, then rewritten only for a move in his week.

Two modes on one pass (`run_week_read_step`), both on the board week alone (`collect.board_week`):
- **Nightly**, after the capsule step, on the night's facts pass and its instant. Nothing is written for the
  board week until its roll-over is due (`capsules.week.rollover`: the weeks before it final, the board from it
  published and its projection held; on a normal week the Wednesday 05:30 UTC nightly, Tuesday night). The
  roll-over pass then writes every board player's read for the week, from that one facts instant, under
  `NIGHTLY_BUDGET_USD`, which covers the whole board; a read that falls to its facts block (or is demoted for a
  sentence another page carries) is asked again within the pass, `ROLLOVER_ROUNDS` in all, and any still
  unwritten are named in the step line and asked again on the next nightly. After it, a nightly writes only
  what the cadence says moved (`capsules.week.cadence`: a status, the published projection the card prints,
  a read still unwritten, a player new to the board).
- **Hourly**, after the in-season job's status capture (`research.inseason --task capture-harvest`): only
  the reads whose status moved, under `HOURLY_BUDGET_USD` a pass and `HOURLY_DAY_USD` across a Central day's
  passes (`player_week_read_runs`).

A player whose board-week game has kicked off has his next week ahead, which is not the board week, so no read
is written for a game under way, and none for the week after it before that week rolls over.

The writing is the season writer's pool (`GatewayClient.rolling`, its bucket and throttle waits), the model
checked against the gateway's list before any call (`capsule_step.checked_price`), and the run's dollar
budget a hard stop at the gateway (`run_budget`): no read starts once its worst case would pass what is
left, and a read the budget stopped writes nothing, so a written read is never overwritten by a facts
block for want of budget. Each read is told the sentences the pass's latest reads landed and held to every
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
from datetime import UTC, datetime, time
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
from research.capsules.week.cadence import UNWRITTEN, attempts_today, central_day, due_reason
from research.capsules.week.collect import collect_week_sheets, read_week_facts
from research.capsules.week.judge import JUDGE_MODEL, judge_model
from research.capsules.week.rollover import Rollover
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
# THE DOLLARS (the coordinator's M3, sized for the roll-over by Lane 256). Measured on the week-reads step lines of
# the eight nightly reports of 2026-10-20 to 2026-10-27: $2.581886 over 1,619 reads attempted, $0.0016 a read on
# average and $0.0021 on the dearest night (2026-10-23), with 572 of the 1,619 (35%) falling to their facts
# blocks. The roll-over writes the whole board (536 players at most this season) and asks each fallen read again
# within the pass (`ROLLOVER_ROUNDS`), about 1.48 attempts a read at that fall rate: 536 x 1.48 x $0.0021 =
# $1.66, and with half again for margin $2.49, so NIGHTLY_BUDGET_USD is $2.50. A mid-week night writes only
# what moved and spends a fraction of it. The worst case is no such sum: a read may make MAX_ASKS_PER_READ
# asks, each at up to WORST_PROMPT_TOKENS in and MAX_TOKENS out, so the night is held by the pass's hard stop
# at NIGHTLY_BUDGET_USD (`step_budget`, the gateway's reservation), not by this sum: before a read starts the
# budget's check prices it at BUDGETED_CALLS_PER_READ asks at the worst (`worst_read_usd`), and a read cut by
# the stop writes nothing and is asked again the next night. An hourly pass writes only the reads a status
# moved (a projection move waits for the nightly, Lane 66v), held the same way at HOURLY_BUDGET_USD a pass and
# HOURLY_DAY_USD across a Central day's passes (the capture runs 18 times).
NIGHTLY_BUDGET_USD: Final = 2.50
# The asks of a read within the roll-over pass: its first, then two more for a read that fell to its facts block
# or was demoted for a shared sentence; one still unwritten is asked again on the next nightly.
ROLLOVER_ROUNDS: Final = 3
HOURLY_BUDGET_USD: Final = 0.05
HOURLY_DAY_USD: Final = 1.50  # 0.60 before the game-day status passes (Lane 263): headroom over $0.93 of waves
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
    rounds: int = 0
    # Each read that fell to its facts block, "<name>: <why>" (Lane 66v): the pass's own record of why.
    fell: list[str] = field(default_factory=list)
    # The players the pass was due to write whose read is still not written at its end (Lane 256).
    unwritten: list[str] = field(default_factory=list)

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
        unwritten = (
            "every due read written"
            if not self.unwritten
            else f"{len(self.unwritten)} still unwritten, asked again on the next pass: {', '.join(self.unwritten)}"
        )
        return (
            f"{sum(self.due.values())} reads due ({due}), {self.written} written, {self.facts_blocks} facts blocks, "
            f"{self.budget_stopped} stopped by the budget, {self.rounds} rounds, {unwritten}, {self.calls} calls, "
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
    """The pass's facts: every board player's sheet for the board week from one instant, the week's stored
    reads, and whether its roll-over is due."""

    sheets: tuple[WeekSheet, ...]
    stored: Mapping[tuple[str, int], StoredWeekRead]
    board_week: int
    rollover: Rollover


def _read_night(engine: Engine, now: datetime, facts: FactsPassMemo) -> _Night | None:
    with engine.connect() as conn:
        subjects = facts(conn, now)
        week_facts = read_week_facts(conn, PRODUCT_SEASON, subjects, now)
        if week_facts is None:
            return None
        week = week_facts.board_week
        stored = stored_week_reads(conn, PRODUCT_SEASON, [week])
        # The board week alone: a player whose game of it has kicked off has his next week ahead, written when
        # that week rolls over (Lane 256), never trickled in before it.
        sheets = tuple(s for s in collect_week_sheets(week_facts, subjects, stored) if s.week == week)
        return _Night(sheets, stored, week, week_facts.rollover)


def _write(  # noqa: PLR0913 - the pass's parts
    engine: Engine,
    gateway: GatewayClient,
    stored: Mapping[tuple[str, int], StoredWeekRead],
    due: Sequence[tuple[WeekSheet, str]],
    *,
    room: Callable[[], bool],
    spend: WeekReadSpend,
    judge: str = JUDGE_MODEL,
) -> None:
    """The due reads on the writer's pool, each landed in its own transaction, tallied on `spend`."""
    board = _Board(stored)
    landed = spend.landed

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
        row = stored_row(sheet, result, reason, stored.get((sheet.player_id, sheet.week)), sheet.written_at)
        with engine.begin() as conn:
            upsert_week_read(conn, row)
        board.land(row)

    if gateway.rolling(due, start, land, stop=lambda: not room()):
        spend.budget_stopped += len(due) - (spend.landed - landed)


def _reread(engine: Engine, week: int) -> dict[tuple[str, int], StoredWeekRead]:
    with engine.connect() as conn:
        return stored_week_reads(conn, PRODUCT_SEASON, [week])


def _unwritten(
    night: _Night, due: Sequence[tuple[WeekSheet, str]], stored: Mapping[tuple[str, int], StoredWeekRead]
) -> list[WeekSheet]:
    """The sheets the pass was due to write whose read is not written: a facts block, demoted, or none."""
    rows = ((sheet, stored.get((sheet.player_id, sheet.week))) for sheet, _ in due)
    return [sheet for sheet, row in rows if row is None or row.source != WRITTEN_SOURCE]


def _write_rounds(  # noqa: PLR0913 - the pass's parts
    engine: Engine,
    gateway: GatewayClient,
    night: _Night,
    due: Sequence[tuple[WeekSheet, str]],
    now: datetime,
    *,
    room: Callable[[], bool],
    spend: WeekReadSpend,
    rounds: int,
    judge: str = JUDGE_MODEL,
) -> None:
    """The due reads, then the demotion over the board week, then again for every due read still unwritten, at
    most `rounds` times while the budget has room; those still unwritten are named on `spend`."""
    stored: Mapping[tuple[str, int], StoredWeekRead] = night.stored
    batch = list(due)
    while batch and spend.rounds < rounds and room():
        spend.rounds += 1
        _write(engine, gateway, stored, batch, room=room, spend=spend, judge=judge)
        spend.demoted += demote_shared(engine, night.sheets, night.board_week, now)
        stored = _reread(engine, night.board_week)
        batch = [(sheet, UNWRITTEN) for sheet in _unwritten(night, due, stored)]
    spend.unwritten = [sheet.name for sheet in _unwritten(night, due, stored)]


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


def _due(night: _Night, now: datetime, hourly: bool) -> list[tuple[WeekSheet, str]]:
    """Every board-week read the cadence says is due, in board order; an hourly pass (the game-day status
    passes among them) soonest kickoff first, so when its budget stops the reads the 13:00 starters are written
    before the 16:25 ones (Lane 263). Stable: board order within a kickoff."""
    due = [
        (sheet, reason)
        for sheet in night.sheets
        if (reason := due_reason(sheet, night.stored.get((sheet.player_id, sheet.week)), now, hourly=hourly))
        is not None
    ]
    return sorted(due, key=lambda item: _kickoff_of(item[0])) if hourly else due


def _kickoff_of(sheet: WeekSheet) -> datetime:
    return datetime.max.replace(tzinfo=UTC) if sheet.game is None else sheet.game.kickoff


def left_unread(due: Sequence[tuple[WeekSheet, str]], stopped: int) -> str | None:
    """What the budget left of an hourly pass's reads: how many, and the soonest kickoff among them (the reads
    stopped are the tail of the kickoff-ordered `due`), else None."""
    if stopped <= 0:
        return None
    left = due[len(due) - stopped :]
    soonest = min(_kickoff_of(sheet) for sheet, _ in left)
    return f"{len(left)} reads left unread, the next kickoff among them {soonest.astimezone(CENTRAL):%a %H:%M} Central"


def run_week_read_step(  # noqa: PLR0913 - the pass's parts
    engine: Engine, now: datetime, log: Log, facts: FactsPassMemo, *, hourly: bool = False, last_pass: bool = False
) -> StepRecord:
    """The pass's record: what was due, written, demoted and spent; skipped by name without the key, before the
    board week's roll-over is due, and for an hourly pass once the day's hourly dollars are spent."""
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
    head = f"{mode}, board week {night.board_week}, {night.rollover.line()}"
    if not night.rollover.ready:
        line = f"{head}; nothing written before it"
        log(f"{STEP}: {line}")
        return StepRecord(STEP, "skipped", line)
    due = _due(night, now, hourly)
    spend = WeekReadSpend()
    for _, reason in due:
        spend.due[reason] = spend.due.get(reason, 0) + 1
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
            rounds = 1 if hourly else ROLLOVER_ROUNDS
            _write_rounds(engine, gateway, night, due, now, room=room, spend=spend, rounds=rounds, judge=judge)
    finally:
        # Whatever the pass spent is on the day's ledger even when it raised (the re-review's F6).
        record_spend(engine, now, mode, spend, budget)
    line = f"{head}, {len(night.sheets)} board players with a week {night.board_week} ahead, {budget.line()}; {spend.line()}"
    if (left := left_unread(due, spend.budget_stopped)) is not None:
        line += f"; {left}"
        if last_pass:
            log(f"{STEP} WARNING: {left} at the game-day window's last pass")
    log(f"{STEP}: {line}")
    return StepRecord(STEP, "ran", line)
