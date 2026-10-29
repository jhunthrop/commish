"""THE WEEK READS PASS (Lane 72, Lane 256): every board player's read for the coming week, written in one pass
when the week rolls over, then rewritten only for a move in his week.

Two modes on one pass (`run_week_read_step`), both on the board week alone (`collect.board_week`):
- **Nightly**, after the capsule step, on the night's facts pass and its instant. Nothing is written for the
  board week until its roll-over is due (`capsules.week.rollover`: the weeks before it final, the board from it
  published and its projection held; on a normal week the Wednesday 05:30 UTC nightly, Tuesday night). The
  roll-over pass then writes every board player's read for the week, from that one facts instant, under
  `NIGHTLY_BUDGET_USD`, which covers the whole board; a read that falls to its facts block (or is demoted for a
  sentence another page carries) is asked again within the pass, `ROLLOVER_ROUNDS` in all, and any still
  unwritten are counted at the head of the step line, the step's status "partial", each named on a line of
  its own, and asked again on the next nightly. After it, a nightly writes only
  what the cadence says moved (`capsules.week.cadence`: a status, a read still unwritten, a player new to the
  board, a written read the current rules refuse; a move of the published projection leaves the read
  standing, Lane 275), in the same rounds: a rewrite that falls keeps the written read and is asked again
  within the pass like a first read that fell (Lane 293).
- **Hourly**, after the in-season job's status capture (`research.inseason --task capture-harvest`): the
  reads whose status moved, then every read still unwritten (Lane 276, asked each hour until one is written),
  under `HOURLY_BUDGET_USD` a pass and `HOURLY_DAY_USD` across a Central day's passes (`player_week_read_runs`).
  The retries never draw on the status share of the day (`HOURLY_STATUS_RESERVE_USD`), so a late game day's
  status rewrite always has dollars; a pass the dollars stop says so in its line, and the game-day alert counts
  the status rewrites alone.

A player whose board-week game has kicked off has his next week ahead, which is not the board week, so no read
is written for a game under way, and none for the week after it before that week rolls over.

The writing is the season writer's pool (`GatewayClient.rolling`, its bucket and throttle waits), and a read
the writer's asks could not write is asked once more of the retry writer (`config.RETRY_WRITER_MODEL`, Lane
276) before it falls to its facts block; every model is checked against the gateway's list before any call
(`capsule_step.checked_price`), and the run's dollar budget, reserved at the dearest model's price, a hard stop
at the gateway (`run_budget`): no read starts once its worst case would pass what is
left, and a read the budget stopped writes nothing, so a written read is never overwritten by a facts
block for want of budget. Each read is told the sentences the pass's latest reads landed and held to every
sentence shape another page carries for its week, and lands in its own transaction. Then the demotion
(`week_read_demotion`) over every read of the board week.

Without AI_GATEWAY_API_KEY nothing is written, by name. The step is advisory: a page shows a board week's
read whenever one is written (`nightly.build.pages.week_read_json`), so a failed step is reported and never
holds the night's board back (`ADVISORY`, read by `nightly.run`). A rewrite that falls to its facts block
never replaces a written read (Lane 275 fix round 1, `landed_row`): the written row stays, its attempt counted,
and the step line counts it held; only a read with nothing written yet stores its facts block.
"""

import os
from collections import deque
from collections.abc import Callable, Mapping, Sequence, Set
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, time
from typing import Final

import httpx
from sqlalchemy import Engine

from research.capsules.config import CAPSULE_CONFIG, WriterSettings, writer_settings
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import GatewayClient
from research.capsules.gateway_ledger import ModelPrice, fetch_price
from research.capsules.narrative import ShapeMasks, sentences_verbatim
from research.capsules.run_budget import RunBudget
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.sweep import FactsPassMemo
from research.capsules.week.cadence import (
    PRIORITY,
    STATUS_CHANGED,
    STATUS_REWRITES_A_DAY,
    UNWRITTEN,
    attempts_today,
    central_day,
    due_reason,
    falls_since_written,
    kept_read,
)
from research.capsules.week.collect import collect_week_sheets, read_week_facts
from research.capsules.week.judge import JUDGE_MODEL, judge_model
from research.capsules.week.rollover import Rollover
from research.capsules.week.sheet import CENTRAL, WeekSheet
from research.capsules.week.store import (
    StoredWeekRead,
    WeekReadRun,
    hourly_spend_since,
    record_run,
    replace_week_read,
    stored_week_reads,
)
from research.capsules.week.validate import week_masks
from research.capsules.week.write import MAX_TOKENS, WeekReadResult, write_week_read
from research.nightly.capsule_step import checked_price
from research.nightly.steps import StepRecord
from research.nightly.week_read_demotion import demote_shared_keeping, player_names, read_shapes
from research.season import PRODUCT_SEASON

STEP: Final = "week-reads"
# A pass that ended with due reads still unwritten (the budget's stop, or every round spent): never a failure.
PARTIAL: Final = "partial"
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
# moved, held the same way at HOURLY_BUDGET_USD a pass and
# HOURLY_DAY_USD across a Central day's passes (the capture runs 18 times).
NIGHTLY_BUDGET_USD: Final = 2.50
# The asks of a read within a nightly pass: its first, then two more for a read that fell to its facts block or
# was demoted for a shared sentence, a rewrite held over the written read among them (Lane 293: the 2026-10-29
# nightly's rule-stale rewrites fell at 153 of 407 in one round, the held rows never asked again); one still not
# landed is asked again on the next nightly. A status rewrite's falls count toward `cadence.STATUS_REWRITES_A_DAY`.
ROLLOVER_ROUNDS: Final = 3
HOURLY_BUDGET_USD: Final = 0.05
HOURLY_DAY_USD: Final = 1.50  # 0.60 before the game-day status passes (Lane 263): headroom over $0.93 of waves
# THE STATUS SHARE (Lane 276 review, H1): the part of HOURLY_DAY_USD the hourly retries of fallen reads never
# draw on, so a late game day's status rewrite always has dollars. A game day's status rewrites: Lane 263's three
# inactives waves of about 100 board starters, GAME_DAY_STATUS_READS. Each is admitted at its worst case
# (`worst_read_usd` at GLM's list price, 2 x (9,000 x $0.15 + 600 x $0.50) / 1M = $0.0033): 300 x $0.0033 =
# $0.99, so the share is $1.00 and the retries take the rest, at most $0.50 a Central day (the day expected for
# them, about $0.46, fits). The note (re-review N3): a wave's cost is not its admission price; Lane 263's measured
# $0.93 and the retry writer on the status falls, about 20% x $0.0013 x 300 = $0.08, are $1.01, so the share is
# a floor, and the status rewrites also draw on whatever the retries left of their $0.50. The retries stop once the day's hourly spend, status rewrites' and retries' together,
# reaches HOURLY_DAY_USD less this share; status rewrites draw on the whole day.
GAME_DAY_STATUS_READS: Final = 300
HOURLY_STATUS_RESERVE_USD: Final = 1.00
# The heaviest prompt a week read's ask carries (a correction with its ledger and every line's stamp), for a
# read's worst case against what is left of the budget. Measured on Lane 117's replay of 40 production
# sheets of week 7 after the four-rule prompt: 8,506 prompt tokens at 17,643 characters, the fewest
# characters a token 1.87 (the recordings of Lane 72 had peaked at 3,630).
WORST_PROMPT_TOKENS: Final = 9_000
# The asks the budget's check prices a read at before it starts (the coordinator's ruling, Lane 117 fix round
# 3): two at the heaviest prompt, a draft and its one retry. A read may make more (MAX_ASKS_PER_READ); the gateway's reservation is the
# hard stop for those in flight.
BUDGETED_CALLS_PER_READ: Final = 2
# The characters a prompt token takes, for counting a built prompt (the tests), measured by Lane 286 (B282)
# against the gateway's own count: the heaviest correction (`test_week_read_writer.heaviest_correction`, 21,861
# characters) sent once to each writer with one token out took 5,768 prompt tokens on GLM-5.3 Flash (3.79
# characters a token) and 5,797 on the retry writer, deepseek 1017 (3.77); the copy's heaviest real one
# (Tyquan Thornton's, 21,761 characters) took 5,732 and 5,769. Rounded down from the fewer. Lane 117's 1.8 put
# main's heaviest real correction over the bound when the gateway counted it at about half of it (Lane 282).
CHARS_PER_TOKEN: Final = 3.7
# The recordings' dearest call, for a budget in calls when the price list cannot be read.
WORST_CALL_USD: Final = 0.00065
Log = Callable[[str], None]


@dataclass(slots=True)
class WeekReadSpend:
    due: dict[str, int] = field(default_factory=dict)
    written: int = 0
    facts_blocks: int = 0
    # The fallen rewrites that kept the written read they would have replaced (Lane 275 fix round 1).
    held: int = 0
    # The reads whose rewrite landed this pass and still stands, (player, week) (Lane 275 fix round 2).
    written_reads: set[tuple[str, int]] = field(default_factory=set)
    # The reads another pass replaced while this one asked (re-review N1): never asked again this pass.
    superseded: set[tuple[str, int]] = field(default_factory=set)
    budget_stopped: int = 0
    landed: int = 0
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    # The reads the demotion wrote as their facts blocks, each counted once however many rounds demote it.
    demoted_reads: set[tuple[str, int]] = field(default_factory=set)
    rounds: int = 0
    # Each read that fell to its facts block, "<name>: <why>" (Lane 66v): the pass's own record of why.
    fell: list[str] = field(default_factory=list)
    # The players the pass was due to write whose read is still not written at its end (Lane 256).
    unwritten: list[str] = field(default_factory=list)
    # The retry writer's model (None when the setting turns it off), its drafts asked and the reads it wrote.
    retry_model: str | None = None
    retry_asks: int = 0
    rescued: int = 0

    def add(self, result: WeekReadResult) -> None:
        self.landed += 1
        self.retry_asks += result.retry_asks
        self.rescued += result.rescued
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

    @property
    def demoted(self) -> int:
        return len(self.demoted_reads)

    @property
    def status(self) -> str:
        """The step's status: "partial" while a read it was due to write is still unwritten."""
        return PARTIAL if self.unwritten else "ran"

    def line(self, tail: str | None = None) -> str:
        """The pass's tally, then `tail` (an hourly pass's reads left unread), then the unwritten reads' names
        one a line; their count is the step line's head (`head`), said once."""
        due = ", ".join(f"{reason} {count}" for reason, count in sorted(self.due.items())) or "none"
        fell = "" if not self.fell else f"; {len(self.fell)} fell to their facts blocks: {'; '.join(self.fell)}"
        body = (
            f"{sum(self.due.values())} reads due ({due}), {self.written} written, {self.facts_blocks} facts blocks "
            f"({self.held} held over the written read), "
            f"{self.budget_stopped} stopped by the budget, {self.rounds} rounds, {self.retry_line()}, "
            f"{self.calls} calls, "
            f"{self.prompt_tokens} prompt and {self.completion_tokens} completion tokens, ${self.cost_usd:.6f}, "
            f"{self.demoted} demoted for a sentence on two pages{fell}{'' if tail is None else f'; {tail}'}"
        )
        if not self.unwritten:
            return f"every due read written; {body}"
        names = "".join(f"\n  {name}" for name in self.unwritten)
        return f"{body}; unwritten, asked again on the next pass:{names}"

    def head(self) -> str:
        """The count the step line leads with, before the night's facts."""
        return "" if not self.unwritten else f"{len(self.unwritten)} still unwritten; "

    def retry_line(self) -> str:
        if self.retry_model is None:
            return "the retry writer off"
        return f"{self.retry_asks} asked of the retry writer {self.retry_model}, {self.rescued} rescued"


def dearest_price(prices: Sequence[ModelPrice]) -> ModelPrice:
    """The dearest list price in and out across the pass's models, so a call is never reserved below its
    model's; a model with no list price leaves the pass's budget in calls (`step_budget`)."""
    ins = [p.input_usd_per_million for p in prices]
    outs = [p.output_usd_per_million for p in prices]
    dearest_in = None if None in ins else max(i for i in ins if i is not None)
    dearest_out = None if None in outs else max(o for o in outs if o is not None)
    models = "+".join(p.model for p in prices)
    return ModelPrice(models, dearest_in, dearest_out, "the dearest of the pass's models' list prices", True)


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
    """The week's sentence shapes as reads land (masked with every board player's name, `week_masks`): who carries
    each, and tonight's newest sentences to quote."""

    def __init__(self, stored: Mapping[tuple[str, int], StoredWeekRead], masks: ShapeMasks | None = None) -> None:
        # No masks: the clubs' alone, the word shape holding every name (the writer bake-off's harness).
        self.masks = ShapeMasks.of(()) if masks is None else masks
        self.carriers: dict[int, dict[str, set[str]]] = {}
        self.recent: dict[int, deque[str]] = {}
        for (player_id, week), read in stored.items():
            self._hold(player_id, week, read)

    def _hold(self, player_id: str, week: int, read: StoredWeekRead) -> None:
        by_shape = self.carriers.setdefault(week, {})
        for held in by_shape.values():
            held.discard(player_id)
        for shape in read_shapes(read, self.masks):
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
    writer's call, and its attempts on `at`'s Central day (`_attempts`)."""
    return StoredWeekRead(
        sheet.player_id, sheet.season, sheet.week, result.source, result.text, result.model, sheet.written_at,
        sheet.facts_at, sheet.stamps(), None if sheet.projection is None else sheet.projection.points,
        sheet.status.status, reason, result.call, central_day(at), _attempts(result, before, at),
    )  # fmt: skip


def _attempts(result: WeekReadResult, before: StoredWeekRead | None, at: datetime) -> int:
    """A written read's attempts restart at its write (Lane 275 fix round 2, `cadence.falls_since_written`); a
    facts block counts its day's chain of falls, for the unwritten retry's limits."""
    return 1 if result.source == WRITTEN_SOURCE else attempts_today(before, at) + 1


def keeps_written(result: WeekReadResult, before: StoredWeekRead | None) -> bool:
    """Whether a landed read keeps the written read it would replace: the rewrite fell to its facts block over
    a written row (a first read that falls has nothing to keep and stores its facts block)."""
    return result.source == FACTS_SOURCE and before is not None and before.source == WRITTEN_SOURCE


def landed_row(
    sheet: WeekSheet, result: WeekReadResult, reason: str, before: StoredWeekRead | None, at: datetime
) -> StoredWeekRead:
    """What a landed read stores: the new row, or the written read kept over a fallen rewrite."""
    if before is not None and keeps_written(result, before):
        return kept_read(before, at)
    return stored_row(sheet, result, reason, before, at)


@dataclass(frozen=True, slots=True)
class _Night:
    """The pass's facts: every board player's sheet for the board week from one instant, the week's stored
    reads, and whether its roll-over is due."""

    sheets: tuple[WeekSheet, ...]
    stored: Mapping[tuple[str, int], StoredWeekRead]
    board_week: int
    rollover: Rollover
    # The week's shapes' masks: every board player's name and every stored read's player's, with every
    # sheet's (the Lane 265 review's M1: a read whose player has no sheet tonight is masked by name too).
    masks: ShapeMasks


def _read_night(engine: Engine, now: datetime, facts: FactsPassMemo) -> _Night | None:
    with engine.connect() as conn:
        subjects = facts(conn, now)
        week_facts = read_week_facts(conn, PRODUCT_SEASON, subjects, now)
        if week_facts is None:
            return None
        week = week_facts.board_week
        stored = stored_week_reads(conn, PRODUCT_SEASON, [week])
        # The board week's sheets alone (`collect.read_week_facts`): a player whose game of it has kicked off
        # has his next week ahead, written when that week rolls over (Lane 256), never trickled in before it.
        sheets = tuple(collect_week_sheets(week_facts, subjects, stored))
        board = [subject.facts.identity.name for subject in subjects]
        masks = week_masks(sheets, (*board, *player_names(conn, (pid for pid, _ in stored))))
        return _Night(sheets, stored, week, week_facts.rollover, masks)


def _write(  # noqa: PLR0913 - the pass's parts
    engine: Engine,
    gateway: GatewayClient,
    stored: Mapping[tuple[str, int], StoredWeekRead],
    due: Sequence[tuple[WeekSheet, str]],
    *,
    room: Callable[[], bool],
    spend: WeekReadSpend,
    masks: ShapeMasks,
    judge: str = JUDGE_MODEL,
) -> None:
    """The due reads on the writer's pool, each landed in its own transaction, tallied on `spend` (whose
    `retry_model` is the retry writer the reads may ask)."""
    board = _Board(stored, masks)
    landed: set[str] = set()
    retry = spend.retry_model

    def start(item: tuple[WeekSheet, str]) -> Callable[[GatewayClient], WeekReadResult]:
        sheet = item[0]
        avoid, taken = board.avoid(sheet.week), board.taken(sheet)
        return lambda scoped: write_week_read(sheet, scoped, avoid, taken, judge, retry_model=retry)

    def land(item: tuple[WeekSheet, str], result: WeekReadResult) -> None:
        spend.add(result)
        sheet, reason = item
        landed.add(sheet.player_id)
        if result.fallback == "the run's budget is spent":
            spend.budget_stopped += 1
            return
        if result.source == FACTS_SOURCE and result.fallback is not None:
            spend.fell_to_facts(sheet.name, result.fallback)
        before = stored.get((sheet.player_id, sheet.week))
        row = landed_row(sheet, result, reason, before, sheet.written_at)
        key = (sheet.player_id, sheet.week)
        with engine.begin() as conn:
            stood = replace_week_read(conn, row, before)
        if not stood:
            # Another pass replaced the row this one read (the nightly and an hourly pass overlapping, re-review N1):
            # nothing written over it, the read counted held and left to the cadence.
            spend.held += 1
            spend.written_reads.discard(key)
            spend.superseded.add(key)
            return
        spend.held += keeps_written(result, before)
        if row.source == WRITTEN_SOURCE and not keeps_written(result, before):
            spend.written_reads.add(key)
        else:
            spend.written_reads.discard(key)
        board.land(row)

    if gateway.rolling(due, start, land, stop=lambda: not room()):
        spend.budget_stopped += len({sheet.player_id for sheet, _ in due} - landed)


def _reread(engine: Engine, week: int) -> dict[tuple[str, int], StoredWeekRead]:
    with engine.connect() as conn:
        return stored_week_reads(conn, PRODUCT_SEASON, [week])


# The day's status-rewrite falls (`cadence.STATUS_REWRITES_A_DAY`) a nightly's rounds leave for the hourly passes
# (Lane 293 fix round 1): the nightly runs at 00:30 CT, so a status rewrite it asks twice and loses twice still has
# one hourly retry that Central day.
STATUS_FALLS_LEFT_FOR_HOURLY: Final = 1


def status_reask_allowed(row: StoredWeekRead, now: datetime) -> bool:
    """Whether a written read held over a fallen status rewrite is asked again in the pass's next round: while its
    falls on `now`'s Central day leave `STATUS_FALLS_LEFT_FOR_HOURLY` of the day's status rewrites."""
    return falls_since_written(row, now) < STATUS_REWRITES_A_DAY - STATUS_FALLS_LEFT_FOR_HOURLY


def asked_again(
    due: Sequence[tuple[WeekSheet, str]],
    stored: Mapping[tuple[str, int], StoredWeekRead],
    spend: WeekReadSpend,
) -> list[tuple[WeekSheet, str]]:
    """The due reads the next round asks again: every one whose read did not land and stand this pass. One with
    nothing written is asked as `UNWRITTEN`; a written read kept over a rewrite that fell, or that the demotion
    restored, is asked under its own reason (Lane 293: on 2026-10-29 the nightly's 404 rule-stale rewrites ran one
    round, and the 153 that fell kept the old reads, the held rows counting as written), a status rewrite while
    `status_reask_allowed` on the sheet's instant (the one its fall was counted on, `landed_row`). One another pass
    replaced meanwhile is left to the cadence."""
    again = []
    for sheet, reason in due:
        key = (sheet.player_id, sheet.week)
        row = stored.get(key)
        if key in spend.written_reads or key in spend.superseded:
            continue
        if row is None or row.source != WRITTEN_SOURCE:
            again.append((sheet, UNWRITTEN))
        elif reason != STATUS_CHANGED or status_reask_allowed(row, sheet.written_at):
            again.append((sheet, reason))
    return again


def _not_landed(due: Sequence[tuple[WeekSheet, str]], landed: Set[tuple[str, int]]) -> list[WeekSheet]:
    """The sheets whose due rewrite did not land and stand this pass (the step line's unwritten, and its
    partial): a facts block, none, or a written read the pass kept, held over a fall or a shared shape or left
    by the budget's stop (Lane 275 fix round 2: a held read is shown, never counted written; the Lane 265
    re-review's M1: a read the budget left unasked or cut is among them)."""
    return [sheet for sheet, _ in due if (sheet.player_id, sheet.week) not in landed]


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
    most `rounds` times while the budget has room; those that did not land and stand, the budget's among them, are
    named on `spend`. A pass whose budget has no room for its first read asks nothing and counts every due read as
    stopped by it (Lane 276), so its line says why."""
    stored: Mapping[tuple[str, int], StoredWeekRead] = night.stored
    batch = list(due)
    if batch and not room():
        spend.budget_stopped += len(batch)
    done = 0
    while batch and done < rounds and room():
        done += 1
        _write(engine, gateway, stored, batch, room=room, spend=spend, masks=night.masks, judge=judge)
        demotion = demote_shared_keeping(engine, night.sheets, night.board_week, now, night.masks, kept=night.stored)
        spend.demoted_reads |= demotion.demoted
        spend.held += len(demotion.restored)
        spend.written_reads -= demotion.demoted | demotion.restored
        stored = _reread(engine, night.board_week)
        batch = asked_again(due, stored, spend)
    spend.rounds = max(spend.rounds, done)
    spend.unwritten += [sheet.name for sheet in _not_landed(due, spend.written_reads)]


def _room(budget: RunBudget, worst: float) -> Callable[[], bool]:
    """Whether another read may start: its worst case fits what is left (the gateway's reservation is the
    hard stop for the reads in flight)."""
    return lambda: budget.max_usd is None or budget.spent_usd + worst <= budget.max_usd


def combined(budgets: Sequence[RunBudget]) -> RunBudget | None:
    """The pass's budgets as one tally (its limit the first's, the pass's own): calls made and dollars spent."""
    if not budgets:
        return None
    first = budgets[0]
    return RunBudget(
        first.max_calls, first.max_usd, first.price,
        sum(b.calls_made for b in budgets), sum(b.spent_usd for b in budgets),
    )  # fmt: skip


def record_spend(engine: Engine, now: datetime, mode: str, spend: WeekReadSpend, budget: RunBudget | None) -> None:
    """The pass's row on `player_week_read_runs`: the budget's own tally of calls and dollars when it ran
    (every call it reserved, a raised read's included), else what the landed reads billed."""
    calls = spend.calls if budget is None else max(spend.calls, budget.calls_made)
    cost = spend.cost_usd if budget is None else max(spend.cost_usd, budget.spent_usd)
    with engine.begin() as conn:
        record_run(conn, WeekReadRun(now, mode, calls, cost, spend.written, spend.facts_blocks, spend.demoted))


def _day_start(now: datetime) -> datetime:
    return datetime.combine(central_day(now), time(), CENTRAL)


def _hourly_spent(engine: Engine, now: datetime) -> float:
    with engine.connect() as conn:
        return hourly_spend_since(conn, _day_start(now))


def _budget_usd(engine: Engine, now: datetime, hourly: bool) -> float:
    if not hourly:
        return NIGHTLY_BUDGET_USD
    return max(0.0, min(HOURLY_BUDGET_USD, HOURLY_DAY_USD - _hourly_spent(engine, now)))


def retry_share_usd(spent_today: float) -> float:
    """What the hourly retries may still spend today: the day's hourly dollars less the status share
    (`HOURLY_STATUS_RESERVE_USD`) and what the day's hourly passes already spent."""
    return max(0.0, HOURLY_DAY_USD - HOURLY_STATUS_RESERVE_USD - spent_today)


def _due(night: _Night, now: datetime, hourly: bool) -> list[tuple[WeekSheet, str]]:
    """Every board-week read the cadence says is due, in board order within the cadence's `PRIORITY` (a rule-stale
    rewrite last, so a budget stop leaves those for the next night); an hourly pass (the game-day status
    passes among them) soonest kickoff first, so when its budget stops the reads the 13:00 starters are written
    before the 16:25 ones (Lane 263), and a status that moved before a read still unwritten (Lane 276), so the
    hourly retries never take the dollars a status rewrite needs. Stable: board order within a kickoff."""
    due = [
        (sheet, reason)
        for sheet in night.sheets
        if (reason := due_reason(sheet, night.stored.get((sheet.player_id, sheet.week)), now, hourly=hourly))
        is not None
    ]
    if hourly:
        return sorted(due, key=lambda item: (item[1] == UNWRITTEN, _kickoff_of(item[0])))
    return sorted(due, key=lambda item: PRIORITY.index(item[1]))


def _kickoff_of(sheet: WeekSheet) -> datetime:
    return datetime.max.replace(tzinfo=UTC) if sheet.game is None else sheet.game.kickoff


def left_unread(due: Sequence[tuple[WeekSheet, str]], stopped: int) -> str | None:
    """What the budget left of an hourly pass's reads: how many, and the soonest kickoff among them (the reads
    stopped are the tail of the kickoff-ordered `due`), else None."""
    stopped = min(stopped, len(due))
    if stopped <= 0:
        return None
    left = due[len(due) - stopped :]
    soonest = min(_kickoff_of(sheet) for sheet, _ in left)
    return f"{len(left)} reads left unread, the next kickoff among them {soonest.astimezone(CENTRAL):%a %H:%M} Central"


# The line the alert "Research game-day reads left unread" matches (`infra/research-alerts.sh`; a test holds the two).
WARNING_MARKER: Final = f"{STEP} WARNING:"


def _warn_spent_day(engine: Engine, now: datetime, log: Log, facts: FactsPassMemo) -> None:
    """At a game-day window's last pass with the day's dollars spent, nothing was written: every due read is left."""
    night = _read_night(engine, now, facts)
    if night is None or not night.rollover.ready:
        return
    due = [item for item in _due(night, now, True) if item[1] != UNWRITTEN]
    if (left := left_unread(due, len(due))) is not None:
        log(f"{WARNING_MARKER} {left} at the game-day window's last pass, the day's hourly dollars spent")


def _split(due: Sequence[tuple[WeekSheet, str]]) -> tuple[list[tuple[WeekSheet, str]], list[tuple[WeekSheet, str]]]:
    """An hourly pass's due reads: the status rewrites, and the retries of reads still unwritten (Lane 276)."""
    return [item for item in due if item[1] != UNWRITTEN], [item for item in due if item[1] == UNWRITTEN]


def _left_line(
    status_due: Sequence[tuple[WeekSheet, str]],
    status_stopped: int,
    retries_stopped: int,
    usd: float,
    *,
    retries_by_pass: bool = False,
) -> str | None:
    """What the budget left of an hourly pass: its status rewrites (the game-day alert's count), then the retries
    it kept from asking, named for the budget that bound them: the pass's own dollars (`retries_by_pass`) or the
    retries' share of the day (Lane 276 review, H1, M2; re-review N2)."""
    parts = []
    if (status := left_unread(status_due, status_stopped)) is not None:
        low = f", with less than the pass's ${HOURLY_BUDGET_USD:.2f} left of the day's ${HOURLY_DAY_USD:.2f}"
        parts.append(status + (low if usd < HOURLY_BUDGET_USD else ""))
    if retries_stopped > 0 and retries_by_pass:
        parts.append(f"{retries_stopped} unwritten reads not asked, the pass's ${HOURLY_BUDGET_USD:.2f} spent")
    elif retries_stopped > 0:
        parts.append(
            f"{retries_stopped} unwritten reads not asked, the retries' share of the day's hourly "
            f"${HOURLY_DAY_USD:.2f} spent (${HOURLY_STATUS_RESERVE_USD:.2f} kept for status rewrites)"
        )
    return "; ".join(parts) or None


@dataclass(frozen=True, slots=True)
class _CheckedRetry:
    """The retry writer the pass may ask (None when off or unlisted) and its list price."""

    model: str | None
    prices: tuple[ModelPrice, ...]


def _checked_retry(http: httpx.Client, key: str, settings: WriterSettings, log: Log) -> _CheckedRetry:
    """The retry writer's model checked against the gateway's list (Lane 276 review, H2): one the list does not
    carry, or carries with no price (re-review N4: the pass would fall to a budget in calls), turns the retry
    writer off for this pass, by a warning naming its setting, and never fails the pass."""
    if settings.retry_model is None:
        return _CheckedRetry(None, ())
    price = fetch_price(http, key, settings.retry_model)
    unpriced = price.input_usd_per_million is None or price.output_usd_per_million is None
    if price.listed is False or (price.listed and unpriced):
        variable = CAPSULE_CONFIG.gateway.retry_model_variable
        why = "does not carry" if price.listed is False else "carries with no price"
        log(
            f"{STEP}: retry writer WARNING: {variable} names {settings.retry_model}, which the gateway's model list "
            f"{why}; the retry writer is off for this pass"
        )
        return _CheckedRetry(None, ())
    return _CheckedRetry(settings.retry_model, (price,))


class _Pass:
    """One pass's writing, in parts (an hourly pass's status rewrites, then its retries) on budgets of their own."""

    def __init__(self, engine: Engine, night: _Night, now: datetime, spend: WeekReadSpend, judge: str) -> None:
        self.engine, self.night, self.now, self.spend, self.judge = engine, night, now, spend, judge

    def write(
        self, gateway: GatewayClient, due: Sequence[tuple[WeekSheet, str]], room: Callable[[], bool], rounds: int
    ) -> None:
        _write_rounds(
            self.engine, gateway, self.night, due, self.now, room=room, spend=self.spend, rounds=rounds,
            judge=self.judge,
        )  # fmt: skip


def _retry_budget(  # noqa: PLR0913 - the pass's parts
    engine: Engine, now: datetime, usd: float, first: RunBudget, *, spend: WeekReadSpend, price: ModelPrice
) -> tuple[RunBudget, bool]:
    """The retries' budget after an hourly pass's status rewrites: the smaller of what the pass's dollars and the
    retries' share of the day leave, and whether the pass's was the smaller (re-review N2). The status rewrites'
    spend so far is the budget's dollars, or what they billed when the budget is in calls (N4)."""
    status_spent = first.spent_usd if first.max_usd is not None else spend.cost_usd
    day_share = retry_share_usd(_hourly_spent(engine, now) + status_spent)
    pass_left = usd - status_spent
    return step_budget(price, max(0.0, min(pass_left, day_share))), pass_left < day_share


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
        if hourly and last_pass:
            _warn_spent_day(engine, now, log, facts)
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
    settings = writer_settings(os.environ)
    spend = WeekReadSpend(retry_model=settings.retry_model)
    for _, reason in due:
        spend.due[reason] = spend.due.get(reason, 0) + 1
    # An hourly pass writes the status rewrites first on the pass's dollars, then the retries on their share alone.
    first, retries = _split(due) if hourly else (list(due), [])
    budgets: list[RunBudget] = []
    retries_by_pass = False
    try:
        with httpx.Client() as http:
            judge = judge_model(os.environ)
            checked = _checked_retry(http, key, settings, log)
            spend.retry_model = checked.model
            prices = [checked_price(http, key, replace(settings, model=m)) for m in (settings.model, judge)]
            price = dearest_price([*prices, *checked.prices])
            worst = worst_read_usd(price)
            budgets.append(step_budget(price, usd))
            gateway = GatewayClient.for_run(key, http, settings)
            rounds = 1 if hourly else ROLLOVER_ROUNDS
            pass_ = _Pass(engine, night, now, spend, judge)
            pass_.write(gateway.with_budget(budgets[0]), first, _room(budgets[0], worst), rounds)
            stopped_first = spend.budget_stopped
            if retries:
                retry_budget, retries_by_pass = _retry_budget(engine, now, usd, budgets[0], spend=spend, price=price)
                budgets.append(retry_budget)
                pass_.write(gateway.with_budget(budgets[1]), retries, _room(budgets[1], worst), rounds)
    finally:
        # Whatever the pass spent is on the day's ledger even when it raised (the re-review's F6).
        record_spend(engine, now, mode, spend, combined(budgets))
    stopped_retries = spend.budget_stopped - stopped_first
    left = _left_line(first, stopped_first, stopped_retries, usd, retries_by_pass=retries_by_pass) if hourly else None
    if hourly and last_pass and (warned := left_unread(first, stopped_first)) is not None:
        log(f"{WARNING_MARKER} {warned} at the game-day window's last pass")
    budget = combined(budgets)
    assert budget is not None  # the pass's own budget is the first, made before any read
    line = (
        f"{spend.head()}{head}, {len(night.sheets)} board players with a week {night.board_week} ahead, "
        f"{budget.line()}; {spend.line(left)}"
    )
    log(f"{STEP}: {line}")
    return StepRecord(STEP, spend.status, line)


# THE DRY PASS (Lane 293): the pass's due selection and admission at an instant, nothing asked of a model, nothing
# written, so a scratch copy or a diagnosis reads what a nightly or an hourly pass would ask.
DRY: Final = "dry"


def admitted_at_worst(due: int, usd: float, worst: float) -> int:
    """The reads a pass starts at the least under `usd` when each one spends its whole worst case (`_room`)."""
    return due if worst <= 0 else min(due, int(usd / worst))


def dry_week_read_step(  # noqa: PLR0913 - the pass's parts and its price
    engine: Engine, now: datetime, log: Log, facts: FactsPassMemo, price: ModelPrice, *, hourly: bool = False
) -> StepRecord:
    """What the pass at `now` would ask, in its order (`_due`), and how many reads its budget admits at the
    worst case at `price` (the gateway's list price, or none); no model is asked and no row written."""
    mode = HOURLY if hourly else NIGHTLY
    usd = _budget_usd(engine, now, hourly)
    night = _read_night(engine, now, facts)
    if night is None:
        return StepRecord(STEP, DRY, "no game is left to kick off this season")
    head = f"{mode}, board week {night.board_week}, {night.rollover.line()}"
    if not night.rollover.ready:
        line = f"{head}; nothing written before it"
        log(f"{STEP} {DRY}: {line}")
        return StepRecord(STEP, DRY, line)
    due = _due(night, now, hourly)
    counts: dict[str, int] = {}
    for _, reason in due:
        counts[reason] = counts.get(reason, 0) + 1
    worst = worst_read_usd(price)
    admitted = admitted_at_worst(len(due), usd, worst)
    by_reason = ", ".join(f"{reason} {count}" for reason, count in sorted(counts.items())) or "none"
    asks = "".join(f"\n  {sheet.name} ({reason})" for sheet, reason in due)
    line = (
        f"{head}, {len(night.sheets)} board players with a week {night.board_week} ahead, nothing asked or "
        f"written; {len(due)} reads due ({by_reason}), at least {admitted} admitted under ${usd:.2f} at "
        f"${worst:.6f} a read's worst case ({price.model}), in the order asked:{asks}"
    )
    log(f"{STEP} {DRY}: {line}")
    return StepRecord(STEP, DRY, line)


def dry_price(environ: Mapping[str, str]) -> ModelPrice:
    """The dry pass's price: the dearest of the pass's models on the gateway's list (a read of the list, no ask)
    when the key is set, else none, which admits every due read."""
    key = environ.get(CAPSULE_CONFIG.gateway.api_key_variable, "").strip()
    if not key:
        return ModelPrice("no list price read", None, None, "no key, so the gateway's list was not read", False)
    settings = writer_settings(environ)
    models = [settings.model, judge_model(environ), *([] if settings.retry_model is None else [settings.retry_model])]
    with httpx.Client() as http:
        return dearest_price([fetch_price(http, key, model) for model in models])
