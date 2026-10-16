"""THE NIGHTLY'S CAPSULE STEP: the sweep, the retry pass, the repair pass, then the capsule gate.

The order, and why each pass exists:

1. **Regenerate all** (only when asked, `--regenerate-all`): every board page is stamped stale, so
   the sweep rewrites the whole board with the current writer. The first Python run does this once,
   to replace the oracle-era rows (their prose template and their repeated verdict sentences).
2. **The sweep** (`capsules.sweep`): every page whose facts moved, whose row is missing or whose row
   the writer did not write, within the night's budget. Each writer call in every pass is told the
   six-word spans the pass's latest pages already share (`landing.TonightWindow`), so tonight's
   collisions are avoided as they are written; the span rules are built once for the night.
3. **The retry passes** (up to `RETRY_PASSES`): another attempt at the pages still unwritten (facts blocks), from the budget
   left, because a throttled or refused read often succeeds on a second try.
4. **The repair attempts** (`REPAIR_PASSES`, `nightly.capsule_repair`). The capsule gate fails a run
   when the board's unwritten share passes the run's line (2% preseason, 3% in season) or a written
   sentence of four words or more sits on two pages; the page gate fails a written page with no page
   number printed, a voice-rule hit or a time frame slip. Six words in a row on two pages
   (`capsules.spans`) never fail a run: they are counted and repaired within the budget. Each attempt,
   in order (the coordinator's Lane 17 rulings):
   a. the unwritten pages' retry, before any repair spends budget;
   b. the hard targets: every page but the first in board order of each shared sentence, and every
      page failing its page gate;
   c. the retry of any page a hard rewrite left blocked;
   d. on every attempt but the last, the span targets, the pages carrying the most shared spans
      first, within the night's span cap (`span_repair_pages_per_night`), a rewrite that cannot pass
      its validator keeping the page's written read. The last attempt never rewrites for spans, so
      nothing after it can make a failure, and a page a span rewrite left unwritten is retried at the
      next attempt's (a) before any further span rewrite.
   The first page keeps a shared sentence or span, so each attempt strictly shrinks the set. No
   rewrite of chosen pages may land a sentence another page carries (`landing.BoardSentences`).
5. **The graced rewrite**: a page still carrying a shared sentence after the last attempt takes one
   more generation, past the night's call ceiling once (the coordinator's ruling of 2026-10-15).
6. **The capsule gate** (`capsule_gate`), judged once more after the graced rewrite: the step's verdict.

Every pass keeps the writer's pool full (`gateway.GatewayClient.rolling`: a slot refilled the moment its page
lands, each page told the spans of every page landed before it started, and checked as it lands against the
pages landed before it, a carrier left to the repair attempts, `capsules.landing`), each call paced by the run's
token bucket (`capsules.pace`), the commits on one small pool of connections. The passes themselves run in
order, since each reads what the last one stored.

Every pass shares one ceiling per player for the night, `NIGHT_CALLS_PER_PLAYER` (12, two of phase C's
six-call generations): a player who reached it is left to the next night rather than written again,
with one exception (the coordinator's Lane 17 ruling, extended 2026-10-15): a page at the ceiling may
start one more generation that night, once, in a graced pass: a pass over unwritten pages, or the
graced rewrite of the pages still carrying a shared sentence (`spent_out_for`). The night's page
budget stays the hard ceiling.

The writer's settings and the model are checked before anything is written: a malformed setting, or
a model the gateway's list (read before the first call) does not carry, fails the step there. A
pass that raises part way still reports what the night spent (`CapsuleStepError`).

Without AI_GATEWAY_API_KEY the writing passes are skipped by name (a sweep without the key would
demote written reads to facts blocks) and the gate still judges what is stored.
"""

import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Final

import httpx
from sqlalchemy import Engine

from research.capsules.config import CAPSULE_CONFIG, WriterSettings, writer_settings
from research.capsules.facts.history import history_cache
from research.capsules.gateway import GatewayClient
from research.capsules.gateway_ledger import ModelPrice, ModelSpend, fetch_price
from research.capsules.spans import SpanRules
from research.capsules.store import queue_regeneration
from research.capsules.sweep import FactsPassMemo, SweepInterruptedError, SweepPlan, SweepReport, sweep_capsules
from research.db.code_digest import code_digest
from research.db.engine import once_more_on_disconnect, pooled_like
from research.db.read_cache import snapshot
from research.errors import ConfigurationError
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
    # The landing gate (`capsules.landing`): sentences and spans a page shared, as it landed, with the pages
    # landed before it, every pass.
    landed_sentences: int = 0
    landed_spans: int = 0
    # The run's writer (`config.WriterSettings.line`), its model's list price read once this run, and
    # the ledger's calls by model (the cost each call's usage response stated) with the 429s met.
    writer: str | None = None
    price: ModelPrice | None = None
    by_model: dict[str, ModelSpend] = field(default_factory=dict)
    rate_limited: int = 0
    stated_limits: tuple[str, ...] = ()
    # The run's one loud line once its throttle pool ran dry (`throttle_waits.RunWaits.line`), else None.
    throttle_alarm: str | None = None

    def add(self, report: SweepReport) -> None:
        self.calls += report.calls
        self.prompt_tokens += report.prompt_tokens
        self.completion_tokens += report.completion_tokens
        self.cost_usd += report.cost_usd
        self.written += report.llm
        self.facts_blocks += report.facts
        self.processed += len(report.processed)
        self.landed_sentences += report.landed_sentences
        self.landed_spans += report.landed_spans

    def close(self, gateway: GatewayClient, writer: str, price: ModelPrice) -> None:
        """The run's ledger and price, kept on the spend the run's report carries."""
        self.writer = writer
        self.price = price
        self.by_model = gateway.ledger.by_model()
        self.rate_limited = gateway.ledger.rate_limited
        self.stated_limits = gateway.ledger.stated_limits
        self.throttle_alarm = gateway.waits.line()

    def line(self) -> str:
        limits = ", ".join(self.stated_limits) or "none stated"
        return (
            f"{self.processed} pages attempted ({self.written} written, {self.facts_blocks} facts blocks), "
            f"{self.calls} calls, {self.prompt_tokens} prompt and {self.completion_tokens} completion tokens, "
            f"${self.cost_usd:.6f}, {self.rate_limited} calls met a 429 (the gateway's limit: {limits}), "
            f"{self.landed_sentences} sentences and {self.landed_spans} spans shared as pages landed, left to the repair"
        ) + ("" if self.throttle_alarm is None else f"; {self.throttle_alarm}")


@dataclass(frozen=True, slots=True)
class CapsuleStepPlan:
    budget: int = CAPSULE_CONFIG.sweep_generation_budget
    regenerate_all: bool = False
    # A mending night: the sweep writes only the unwritten pages, not those whose facts moved, then
    # the retries and repairs run as on any night. For a night whose spend must stay near zero.
    mend_only: bool = False
    # The span repair's pages tonight, every attempt together (`Repetition.span_repair_pages_per_night`).
    span_repair_pages: int = CAPSULE_CONFIG.repetition.span_repair_pages_per_night


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
        f"${report.cost_usd:.6f}, {report.kept} written reads kept ({report.refused} rewrites refused for a sentence another page carries), {report.queued} queued by the repetition check, "
        f"{report.landed_sentences} sentences and {report.landed_spans} spans shared as pages landed, "
        f"{len(report.landed_carriers)} carriers left to the repair"
    )


def _regenerate_all(engine: Engine, now: datetime) -> str:
    with engine.begin() as conn:
        queued = queue_regeneration(conn, board_universe_ids(conn, now))
    return f"capsules: every board page stamped for regeneration ({queued} rows)"


def spent_out_for(calls: Mapping[str, int], graced: frozenset[str], *, grace: bool) -> frozenset[str]:
    """The players a pass may not start a generation for. A player is left for the next night once
    another full generation could take him past the ceiling (review N12: at 11 calls a six-call
    generation would reach 17); in a graced pass (`SweepPlan.grace`: a pass over unwritten pages, or
    the last rewrite of the pages still carrying a shared sentence) each may go past it once
    (`graced` holds those that already have)."""
    last_start = NIGHT_CALLS_PER_PLAYER - CAPSULE_CONFIG.max_gateway_calls_per_player
    spent = frozenset(pid for pid, n in calls.items() if n > last_start)
    return spent & graced if grace else spent


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
        # Pages that took their one generation past the ceiling tonight.
        self.graced: set[str] = set()
        # The span repair's pages left tonight (`CapsuleStepPlan.span_repair_pages`).
        self.span_pages_left = plan.span_repair_pages

    @property
    def left(self) -> int:
        return self.budget - self.spend.processed

    def sweep(self, name: str, plan: SweepPlan) -> SweepReport:
        graced_pass = plan.unwritten_only or plan.grace
        at_ceiling = spent_out_for(self.calls_by_player, frozenset(), grace=False)
        spent = spent_out_for(self.calls_by_player, frozenset(self.graced), grace=graced_pass)
        plan = replace(plan, exclude=plan.exclude | spent, span_rules=self.rules)
        try:
            report = sweep_capsules(self.engine, self.gateway, self.now, plan, self.facts)
        except SweepInterruptedError as interrupted:
            # What the sweep spent before it raised is the night's spend too (the review's M2).
            self._account(name, interrupted.report, at_ceiling, graced_pass=graced_pass)
            raise interrupted.cause from interrupted
        self._account(name, report, at_ceiling, graced_pass=graced_pass)
        return report

    def _account(self, name: str, report: SweepReport, at_ceiling: frozenset[str], *, graced_pass: bool) -> None:
        """A sweep's report on the night: the grace taken, the calls per player, the spend, the line."""
        if graced_pass:
            # A page past the ceiling that this pass reached has taken its one extra generation.
            self.graced |= at_ceiling & set(report.processed)
        for pid, calls in report.calls_by_player.items():
            self.calls_by_player[pid] = self.calls_by_player.get(pid, 0) + calls
        self.spend.add(report)
        self.log(_sweep_line(name, report))

    def run(self) -> None:
        # The sentences already on two pages are quoted to the writer from the first call, so the
        # sweep does not write them again and the repair pass is left the few it still does.
        gate, _, _ = self._judged()
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
        return once_more_on_disconnect(self._read_judgment)

    def _read_judgment(self) -> tuple[CapsuleGateResult, list[str], dict[str, tuple[str, ...]]]:
        with self.engine.connect() as conn:
            gate = capsule_gate(conn, self.now, self.rules)
            order = board_universe_ids(conn, self.now)
            failing = dict(page_findings(conn, self.now, self.facts).by_page)
        return gate, order, failing

    def _retry_unwritten(self, name: str) -> None:
        gate, _, _ = self._judged()
        if gate.facts_blocks and self.left > 0:
            self.retry(name, gate.facts_blocks, tuple(sentence.sentence for sentence in gate.shared))

    def repair(self) -> None:
        """The repair attempts in the ruled order (the module's step 4): unwritten pages, hard targets,
        the pages a hard rewrite blocked, then spans on every attempt but the last."""
        for attempt in range(1, REPAIR_PASSES + 1):
            self._retry_unwritten(f"capsule repair {attempt}, unwritten pages first")
            gate, order, failing = self._judged()
            targets = repair_order(gate, failing, order)
            spans = () if attempt == REPAIR_PASSES else targets.spans[: self.span_pages_left]
            if targets.spans and not spans and attempt < REPAIR_PASSES:
                self.log(
                    f"capsule span repair {attempt}: tonight's span cap is spent, "
                    f"{len(targets.spans)} span carriers left for later nights"
                )
            if (not targets.hard and not spans) or self.left <= 0:
                self.log(
                    f"capsule repair {attempt}: {'no budget left' if self.left <= 0 else 'nothing more to repair'}"
                )
                break
            avoid = tuple(sentence.sentence for sentence in gate.shared)
            if targets.hard:
                name = (
                    f"capsule repair {attempt} ({len(gate.shared)} shared sentences, {len(failing)} pages failing "
                    f"the page gate, {len(targets.hard)} pages)"
                )
                self.sweep(name, SweepPlan(self.left, only=targets.hard, avoid=avoid))
                self._retry_unwritten(f"capsule repair {attempt}, pages the rewrite blocked")
            if spans and self.left > 0:
                name = (
                    f"capsule span repair {attempt} ({len(gate.spans)} shared spans, {len(spans)} pages of "
                    f"{len(targets.spans)} carriers, the span cap at {self.span_pages_left} before this pass)"
                )
                plan = SweepPlan(
                    self.left, only=spans, avoid=avoid, avoid_by_page=quoted_spans(gate, spans), keep_written=True
                )
                self.span_pages_left -= len(self.sweep(name, plan).processed)
        self.grace_shared_sentences()

    def grace_shared_sentences(self) -> None:
        """The coordinator's ruling of 2026-10-15, Lane 17's grace extended to the hard targets: a page
        still carrying a written sentence on two pages after the last repair attempt takes one more
        generation, past the night's call ceiling once (`SweepPlan.grace`); the step's gate judges once
        more after it."""
        gate, order, _ = self._judged()
        if not gate.shared or self.left <= 0:
            return
        pages = repair_order(gate, {}, order).hard
        avoid = tuple(sentence.sentence for sentence in gate.shared)
        name = (
            f"capsule repair, one generation past the ceiling ({len(gate.shared)} shared sentences, {len(pages)} pages)"
        )
        self.sweep(name, SweepPlan(self.left, only=pages, avoid=avoid, grace=True))


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
        spend = _write(engine, key, now, plan, log, facts, rules)
        log(f"capsules spent: {spend.line()}")
    gate, findings = once_more_on_disconnect(lambda: _final_judgment(engine, now, rules, facts))
    gate = replace(gate, throttle_alarm=spend.throttle_alarm)
    log(f"{gate.summary()}; {len(findings.by_page)} written pages fail the page gate")
    return CapsuleStepResult(gate, findings, spend, bool(key))


class CapsuleStepError(Exception):
    """A writing pass raised part way; `spend` is what the night spent before it (the ledger, the
    price, the calls), so the run's report carries it with the failed step."""

    def __init__(self, cause: Exception, spend: CapsuleSpend) -> None:
        super().__init__(f"{type(cause).__name__}: {cause}")
        self.spend = spend


def _checked_price(http: httpx.Client, key: str, settings: WriterSettings) -> ModelPrice:
    """The model's price from the gateway's list; a list that was read and does not carry the model
    fails the step before any call (a typo in CAPSULE_MODEL would demote written reads board-wide).
    A list that could not be read does not block."""
    price = fetch_price(http, key, settings.model)
    if price.listed is False:
        raise ConfigurationError(
            f"capsules: {CAPSULE_CONFIG.gateway.model_variable} names {settings.model}, which the gateway's "
            "model list does not carry, so no call was made"
        )
    return price


def _write(  # noqa: PLR0913, PLR0917 - the step's parts
    engine: Engine, key: str, now: datetime, plan: CapsuleStepPlan, log: Log, facts: FactsPassMemo, rules: SpanRules
) -> CapsuleSpend:
    """The writing passes: the settings and the model checked before anything is written, then the
    night on one pool of writers' connections; the spend closed whether the passes finish or raise."""
    settings = writer_settings(os.environ)
    log(f"capsules: {settings.line()}")
    with httpx.Client() as http:
        price = _checked_price(http, key, settings)
        if plan.regenerate_all:
            log(_regenerate_all(engine, now))
        gateway = GatewayClient.for_run(key, http, settings)
        writers = pooled_like(engine, settings.concurrency)
        passes = _Passes(writers, gateway, now, plan, log, facts, rules=rules)
        try:
            passes.run()
        except Exception as error:
            passes.spend.close(gateway, settings.line(), price)
            log(f"capsules spent before the failure: {passes.spend.line()}")
            raise CapsuleStepError(error, passes.spend) from error
        finally:
            writers.dispose()
        passes.spend.close(gateway, settings.line(), price)
        return passes.spend


def _final_judgment(
    engine: Engine, now: datetime, rules: SpanRules, facts: FactsPassMemo
) -> tuple[CapsuleGateResult, PageFindings]:
    with engine.connect() as conn:
        return capsule_gate(conn, now, rules), page_findings(conn, now, facts)
