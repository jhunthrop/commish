"""THE NIGHTLY'S CAPSULE STEP: the sweep, the retry pass, the repair pass, then the capsule gate.

The order, and why each pass exists:

1. **Regenerate all** (only when asked, `--regenerate-all`): every board page is stamped stale, so
   the sweep rewrites the whole board with the current writer. The first Python run does this once,
   to replace the oracle-era rows (their prose template and their repeated verdict sentences).
2. **The sweep** (`capsules.sweep`): every page whose facts moved, whose row is missing or whose row
   the writer did not write, within the night's budget. Each writer call in every pass is told the
   six-word spans the pass's latest pages already share (`spans.TonightSpans`), so tonight's
   collisions are avoided as they are written; the span rules are built once for the night.
3. **The retry passes** (up to `RETRY_PASSES`): another attempt at the pages still unwritten (facts blocks), from the budget
   left, because a throttled or refused read often succeeds on a second try.
4. **The repair pass**: the capsule gate fails a run when a written sentence of four words or more
   sits on two pages, six words in a row sit on two pages (`capsules.spans`), or a written page fails
   its page gate (`page_findings`: no page number printed, a voice-rule hit, a time frame slip for
   the run's day), and those pages are rewritten. Each shared sentence and span is kept on its first
   page in board order and the other pages are rewritten, the shared sentences quoted to every one
   as worn language and each page's own shared spans quoted to it, at most `REPAIR_PASSES` times,
   from the budget left. The first page keeps the span so each pass strictly shrinks the set: were
   every carrier rewritten, two pages could trade one shared span for another night after night.
5. **The retry passes again**, when a repair's rewrite could not pass its validator and left a facts
   block, with the sentences still on two pages quoted, and then the repairs once more, since a page
   those retries write can share a sentence.
6. **The capsule gate** (`capsule_gate`), whose verdict is the step's.

Every pass shares one ceiling per player for the night, `NIGHT_CALLS_PER_PLAYER` (12, two of phase C's
six-call generations): a player who reached it is left to the next night rather than written again.

Without AI_GATEWAY_API_KEY the writing passes are skipped by name (a sweep without the key would
demote written reads to facts blocks) and the gate still judges what is stored.
"""

import os
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Final

import httpx
from sqlalchemy import Engine

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts.history import history_cache
from research.capsules.gateway import GatewayClient
from research.capsules.spans import SpanRules
from research.capsules.store import queue_regeneration
from research.capsules.sweep import FactsPassMemo, SweepPlan, SweepReport, sweep_capsules
from research.db.code_digest import code_digest
from research.db.read_cache import snapshot
from research.nightly.capsule_gate import (
    CapsuleGateResult,
    board_universe_ids,
    capsule_gate,
    span_rules,
)
from research.nightly.capsule_repair import quoted_spans, repair_order
from research.nightly.page_findings import PageFindings, page_findings

REPAIR_PASSES: Final = 3
# Each retry pass writes about half of what is left (measured on the 2026-10-13 regeneration: 31 of
# 66 on the first), so three passes bring a tenth of the board unwritten under the 2% line.
RETRY_PASSES: Final = 3
# THE NIGHT'S CALLS FOR ONE PLAYER, shared by the sweep, the retries and the repairs. Phase C caps one
# generation at six calls; with seven passes a night one player could take 42. Two full generations'
# worth is the night's ceiling: a player starts a generation only while it cannot take him past it
# (at most 6 calls used), and otherwise waits for the next night.
NIGHT_CALLS_PER_PLAYER: Final = 12
Log = Callable[[str], None]


@dataclass(slots=True)
class CapsuleSpend:
    """What the step's writing passes cost, summed over every pass."""

    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    written: int = 0
    facts_blocks: int = 0
    processed: int = 0

    def add(self, report: SweepReport) -> None:
        self.calls += report.calls
        self.prompt_tokens += report.prompt_tokens
        self.completion_tokens += report.completion_tokens
        self.cost_usd += report.cost_usd
        self.written += report.llm
        self.facts_blocks += report.facts
        self.processed += len(report.processed)

    def line(self) -> str:
        return (
            f"{self.processed} pages attempted ({self.written} written, {self.facts_blocks} facts blocks), "
            f"{self.calls} calls, {self.prompt_tokens} prompt and {self.completion_tokens} completion tokens, "
            f"${self.cost_usd:.6f}"
        )


@dataclass(frozen=True, slots=True)
class CapsuleStepPlan:
    budget: int = CAPSULE_CONFIG.sweep_generation_budget
    regenerate_all: bool = False
    # A mending night: the sweep writes only the unwritten pages, not those whose facts moved, then
    # the retries and repairs run as on any night. For a night whose spend must stay near zero.
    mend_only: bool = False


def night_facts(engine: Engine) -> FactsPassMemo:
    """The night's one board facts pass: read on its own snapshot, its finished seasons through the
    read cache. Every reader of the night's sheets takes this memo (see `FactsPassMemo`)."""
    return FactsPassMemo(
        lambda: snapshot(engine), history_cache(engine, code_digest("research.capsules.facts.history"))
    )


@dataclass(frozen=True, slots=True)
class CapsuleStepResult:
    gate: CapsuleGateResult
    findings: PageFindings
    spend: CapsuleSpend
    wrote: bool


def _sweep_line(name: str, report: SweepReport) -> str:
    return (
        f"{name}: {report.board_players} board players, {report.eligible} eligible, "
        f"{len(report.processed)} processed ({report.llm} written, {report.facts} facts blocks), {report.calls} calls, "
        f"${report.cost_usd:.6f}, {report.queued} queued by the repetition check"
    )


def _regenerate_all(engine: Engine, now: datetime) -> str:
    with engine.begin() as conn:
        queued = queue_regeneration(conn, board_universe_ids(conn, now))
    return f"capsules: every board page stamped for regeneration ({queued} rows)"


class _Passes:
    """The writing passes of one night: one gateway, one clock, one budget shared by every pass."""

    def __init__(  # noqa: PLR0913, PLR0917 - the night's shared parts
        self,
        engine: Engine,
        gateway: GatewayClient,
        now: datetime,
        plan: CapsuleStepPlan,
        log: Log,
        facts: FactsPassMemo,
        *,
        rules: SpanRules,
    ) -> None:
        self.engine = engine
        self.facts = facts
        # Built once from the night's facts: the sheets, and so the exempt spans, are fixed by the instant.
        self.rules = rules
        self.mend_only = plan.mend_only
        self.gateway = gateway
        self.now = now
        self.budget = plan.budget
        self.log = log
        self.spend = CapsuleSpend()
        self.calls_by_player: dict[str, int] = {}

    @property
    def left(self) -> int:
        return self.budget - self.spend.processed

    @property
    def spent_out(self) -> frozenset[str]:
        # A player is left for the next night once another full generation could take him past the
        # ceiling (review N12: at 11 calls a six-call generation would reach 17).
        last_start = NIGHT_CALLS_PER_PLAYER - CAPSULE_CONFIG.max_gateway_calls_per_player
        return frozenset(pid for pid, calls in self.calls_by_player.items() if calls > last_start)

    def sweep(self, name: str, plan: SweepPlan) -> SweepReport:
        plan = replace(plan, exclude=plan.exclude | self.spent_out, span_rules=self.rules)
        report = sweep_capsules(self.engine, self.gateway, self.now, plan, self.facts)
        for pid, calls in report.calls_by_player.items():
            self.calls_by_player[pid] = self.calls_by_player.get(pid, 0) + calls
        self.spend.add(report)
        self.log(_sweep_line(name, report))
        return report

    def run(self) -> None:
        # The sentences already on two pages are quoted to the writer from the first call, so the
        # sweep does not write them again and the repair pass is left the few it still does.
        with self.engine.connect() as conn:
            gate = capsule_gate(conn, self.now, self.rules)
        cap = CAPSULE_CONFIG.repetition.max_quoted_spans
        shared = (*(s.sentence for s in gate.shared), *(s.span for s in gate.spans[:cap]))
        name = "capsules (mend only: pages whose facts moved wait for a full night)" if self.mend_only else "capsules"
        report = self.sweep(name, SweepPlan(self.budget, unwritten_only=self.mend_only, avoid=shared))
        self.retry("capsule retries", report.facts, shared)
        self.repair()

    def retry(self, name: str, unwritten: int, avoid: tuple[str, ...]) -> None:
        for attempt in range(1, RETRY_PASSES + 1):
            if self.left <= 0 or unwritten == 0:
                return
            retry = self.sweep(f"{name} {attempt}", SweepPlan(self.left, unwritten_only=True, avoid=avoid))
            unwritten = retry.facts

    def _judged(self) -> tuple[CapsuleGateResult, list[str], dict[str, tuple[str, ...]]]:
        with self.engine.connect() as conn:
            gate = capsule_gate(conn, self.now, self.rules)
            order = board_universe_ids(conn, self.now)
            failing = dict(page_findings(conn, self.now, self.facts).by_page)
        return gate, order, failing

    def repair(self) -> None:
        """Each attempt: the unwritten pages' retry first, then the hard targets, then the span
        targets most shared first (`capsule_repair`), all from the budget left."""
        for attempt in range(1, REPAIR_PASSES + 1):
            gate, _, _ = self._judged()
            avoid = tuple(sentence.sentence for sentence in gate.shared)
            if gate.facts_blocks and self.left > 0:
                self.retry(f"capsule repair {attempt}, unwritten pages first", gate.facts_blocks, avoid)
            gate, order, failing = self._judged()
            targets = repair_order(gate, failing, order)
            if targets.empty or self.left <= 0:
                self.log(f"capsule repair {attempt}: {'none needed' if targets.empty else 'no budget left'}")
                return
            avoid = tuple(sentence.sentence for sentence in gate.shared)
            if targets.hard:
                name = (
                    f"capsule repair {attempt} ({len(gate.shared)} shared sentences, {len(failing)} pages failing "
                    f"the page gate, {len(targets.hard)} pages)"
                )
                self.sweep(name, SweepPlan(self.left, only=targets.hard, avoid=avoid))
            if targets.spans and self.left > 0:
                name = f"capsule span repair {attempt} ({len(gate.spans)} shared spans, {len(targets.spans)} pages)"
                quoted = quoted_spans(gate, targets.spans)
                plan = SweepPlan(self.left, only=targets.spans, avoid=avoid, avoid_by_page=quoted, keep_written=True)
                self.sweep(name, plan)


def run_capsule_step(
    engine: Engine, now: datetime, plan: CapsuleStepPlan, log: Log, facts: FactsPassMemo
) -> CapsuleStepResult:
    """The capsule step, a line per pass; the result carries the gate and what the writing cost.
    Every pass reads its sheets from `facts`, one board facts pass for the step."""
    key = os.environ.get(CAPSULE_CONFIG.gateway.api_key_variable, "").strip()
    spend = CapsuleSpend()
    with engine.connect() as conn:
        rules = span_rules(conn, now, facts)
    if not key:
        log(
            f"capsules: writing skipped, {CAPSULE_CONFIG.gateway.api_key_variable} is not set "
            "(a sweep without it would demote written reads)"
        )
    else:
        if plan.regenerate_all:
            log(_regenerate_all(engine, now))
        with httpx.Client() as http:
            passes = _Passes(engine, GatewayClient(key, http), now, plan, log, facts, rules=rules)
            passes.run()
            spend = passes.spend
        log(f"capsules spent: {spend.line()}")
    with engine.connect() as conn:
        gate = capsule_gate(conn, now, rules)
        findings = page_findings(conn, now, facts)
    log(f"{gate.summary()}; {len(findings.by_page)} written pages fail the page gate")
    return CapsuleStepResult(gate, findings, spend, bool(key))
