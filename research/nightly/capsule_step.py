"""THE NIGHTLY'S CAPSULE STEP: the sweep, the retry pass, the repair pass, then the capsule gate.

The order, and why each pass exists:

1. **Regenerate all** (only when asked, `--regenerate-all`): every board page is stamped stale, so
   the sweep rewrites the whole board with the current writer. The first Python run does this once,
   to replace the oracle-era rows (their prose template and their repeated verdict sentences).
2. **The sweep** (`capsules.sweep`): every page whose facts moved, whose row is missing or whose row
   the writer did not write, within the night's budget.
3. **The retry pass**: one more attempt at the pages still unwritten (facts blocks), from the budget
   left, because a throttled or refused read often succeeds on a second try.
4. **The repair pass**: the capsule gate fails a run when a written sentence of four words or more
   sits on two pages. Each such sentence is kept on its first page in board order and the other
   pages are rewritten with the shared sentences quoted as worn language, at most `REPAIR_PASSES`
   times, from the budget left.
5. **The capsule gate** (`capsule_gate`), whose verdict is the step's.

Without AI_GATEWAY_API_KEY the writing passes are skipped by name (a sweep without the key would
demote written reads to facts blocks) and the gate still judges what is stored.
"""

import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

import httpx
from sqlalchemy import Engine

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.gateway import GatewayClient
from research.capsules.store import queue_regeneration
from research.capsules.sweep import SweepPlan, SweepReport, sweep_capsules
from research.nightly.capsule_gate import CapsuleGateResult, SharedSentence, board_universe_ids, capsule_gate

REPAIR_PASSES: Final = 2
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


@dataclass(frozen=True, slots=True)
class CapsuleStepResult:
    gate: CapsuleGateResult
    spend: CapsuleSpend
    wrote: bool


def repair_targets(shared: Sequence[SharedSentence], board_order: Sequence[str]) -> list[str]:
    """Every page but the first (in board order) of each shared sentence, each once, in board order."""
    place = {player_id: index for index, player_id in enumerate(board_order)}
    rewrite: set[str] = set()
    for sentence in shared:
        ordered = sorted(sentence.player_ids, key=lambda pid: place.get(pid, len(place)))
        rewrite.update(ordered[1:])
    return sorted(rewrite, key=lambda pid: place.get(pid, len(place)))


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

    def __init__(self, engine: Engine, gateway: GatewayClient, now: datetime, budget: int, log: Log) -> None:
        self.engine = engine
        self.gateway = gateway
        self.now = now
        self.budget = budget
        self.log = log
        self.spend = CapsuleSpend()

    @property
    def left(self) -> int:
        return self.budget - self.spend.processed

    def sweep(self, name: str, plan: SweepPlan) -> SweepReport:
        report = sweep_capsules(self.engine, self.gateway, self.now, plan)
        self.spend.add(report)
        self.log(_sweep_line(name, report))
        return report

    def run(self) -> None:
        report = self.sweep("capsules", SweepPlan(self.budget))
        if self.left > 0 and report.facts > 0:
            self.sweep("capsule retries", SweepPlan(self.left, unwritten_only=True))
        for attempt in range(1, REPAIR_PASSES + 1):
            with self.engine.connect() as conn:
                gate = capsule_gate(conn, self.now)
                order = board_universe_ids(conn, self.now)
            targets = repair_targets(gate.shared, order)
            if not targets or self.left <= 0:
                self.log(f"capsule repair {attempt}: {'none needed' if not targets else 'no budget left'}")
                return
            avoid = tuple(sentence.sentence for sentence in gate.shared)
            name = f"capsule repair {attempt} ({len(gate.shared)} shared sentences, {len(targets)} pages)"
            self.sweep(name, SweepPlan(self.left, only=frozenset(targets), avoid=avoid))


def run_capsule_step(engine: Engine, now: datetime, plan: CapsuleStepPlan, log: Log) -> CapsuleStepResult:
    """The capsule step, a line per pass; the result carries the gate and what the writing cost."""
    key = os.environ.get(CAPSULE_CONFIG.gateway.api_key_variable, "").strip()
    spend = CapsuleSpend()
    if not key:
        log(
            f"capsules: writing skipped, {CAPSULE_CONFIG.gateway.api_key_variable} is not set "
            "(a sweep without it would demote written reads)"
        )
    else:
        if plan.regenerate_all:
            log(_regenerate_all(engine, now))
        with httpx.Client() as http:
            passes = _Passes(engine, GatewayClient(key, http), now, plan.budget, log)
            passes.run()
            spend = passes.spend
        log(f"capsules spent: {spend.line()}")
    with engine.connect() as conn:
        gate = capsule_gate(conn, now)
    log(gate.summary())
    return CapsuleStepResult(gate, spend, bool(key))
