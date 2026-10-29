"""THE CAPSULE SWEEP: the facts pass, a fresh capsule wherever a player's facts moved, the repetition
check over the board as it then stands.

Ported from `research-ts/src/capsules/sweep.ts`. A player is written when his row is missing, his
facts hash moved, or his row is not written (a facts block, or the oracle's template: a throttled or
refused read keeps retrying); players demoted to their facts blocks (`nightly.capsule_demotion`, the
page check) go first.

THE HOLD PATH (Lane 294, the founder's "we should always show a read"): a rewrite of a written capsule
that falls to its facts block never replaces it. The written row stands, its old facts hash keeping it
due, and the page is counted held (`SweepReport.held`) for the night's retry passes to ask again. A
first capsule that falls stores its facts block.

Each player is committed as he is written, so a run stopped part way loses at most the pages in
flight. Pages are written concurrently on the writer's rolling pool, each checked as it lands
(`capsules.landing`). The worn language the board already carries is quoted into every prompt; the
check runs again at the end and queues anyone over a line. Capsules key on the universe id
(`research.players.id`), through the crosswalk.
"""

from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from types import MappingProxyType

from sqlalchemy import Connection, Engine
from sqlalchemy.exc import DBAPIError

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts.build import PlayerFacts
from research.capsules.facts.collect import collect_board_facts
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import GatewayClient
from research.capsules.generate import CapsuleResult, describe_fallback, generate_capsule
from research.capsules.landing import BoardSentences, TonightWindow
from research.capsules.prompt import WornPhrases
from research.capsules.repetition import (
    CapsuleRow,
    measure_sameness,
    phrases_to_avoid,
    players_to_regenerate,
    stock_sentences,
)
from research.capsules.span_rules import span_rules_for
from research.capsules.spans import SpanRules, page_texts
from research.capsules.store import (
    RETRY_FIRST_FACTS_HASH,
    WRITTEN_SOURCE,
    CapsuleWrite,
    StoredCapsule,
    queue_regeneration,
    stored_capsules_for,
    upsert_capsule,
)
from research.db.engine import once_more_on_disconnect
from research.db.read_cache import UNCACHED, ReadThrough


@dataclass(frozen=True, slots=True)
class Subject:
    """One board player the sweep may write: his sheet and the universe id his row keys on."""

    facts: PlayerFacts
    universe_id: str


def _unwritten(stored: StoredCapsule | None) -> bool:
    """No row, or a row the writer did not write (a facts block, or the oracle's template)."""
    return stored is None or stored.source != "llm"


def _needs_generation(subject: Subject, stored: StoredCapsule | None) -> bool:
    return _unwritten(stored) or stored is None or stored.facts_hash != subject.facts.facts_hash


def _rows(subjects: Sequence[Subject], stored: dict[str, StoredCapsule]) -> list[CapsuleRow]:
    rows = []
    for subject in subjects:
        row = stored.get(subject.universe_id)
        if row is not None:
            rows.append(
                CapsuleRow(
                    row.player_id,
                    subject.facts.identity.name,
                    row.body_compact,
                    row.body_full,
                    row.source,
                    row.narrative,
                )
            )
    return rows


def worn_phrases(subjects: Sequence[Subject], stored: dict[str, StoredCapsule]) -> WornPhrases:
    rows = _rows(subjects, stored)
    sentences, phrases = phrases_to_avoid(stock_sentences(rows), measure_sameness(rows))
    return WornPhrases(tuple(sentences), tuple(phrases))


@dataclass(slots=True)
class SweepReport:
    as_of: datetime
    board_players: int
    eligible: int
    processed: list[str] = field(default_factory=list)
    llm: int = 0
    facts: int = 0
    # Rewrites that left the page's written read as it was: a rewrite that fell to its facts block (the
    # hold path, `held` of them by universe id), or one refused because it would land a sentence another
    # page carries (`refused` of them).
    kept: int = 0
    refused: int = 0
    held: list[str] = field(default_factory=list)
    # The retry writer's drafts (Lane 294) and the written pages it rescued.
    retry_asks: int = 0
    rescued: int = 0
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    queued: int | None = None
    detail: list[str] = field(default_factory=list)
    # Universe id to the writer's asks his capsule took in this sweep (`CapsuleResult.asks`), which the
    # night's ceiling counts; the gateway's HTTP calls are `calls`.
    asks_by_player: dict[str, int] = field(default_factory=dict)
    # The landing gate (`capsules.landing`): sentences and spans each page shared, as it landed, with
    # the pages landed before it, and those pages (carriers), left to the repair pass.
    landed_sentences: int = 0
    landed_spans: int = 0
    landed_carriers: list[str] = field(default_factory=list)
    # Each page that fell to its facts block this sweep, by name with why (`describe_fallback`), so
    # the nightly can say why its pages are unwritten (Lane 73).
    fell: list[str] = field(default_factory=list)


class PageCommitError(Exception):
    """A page whose read was paid for but whose commit failed (twice: `once_more_on_disconnect`). It
    carries the read, so the sweep still counts what the page spent before the error goes on."""

    def __init__(self, subject: "Subject", result: CapsuleResult, cause: Exception) -> None:
        super().__init__(f"{type(cause).__name__}: {cause}")
        self.subject = subject
        self.result = result


class SweepInterruptedError(Exception):
    """A sweep that raised part way: `report` holds every page that landed (and a failed commit's
    spend), so the step adds it to the night's spend before `cause` goes on (the review's M2)."""

    def __init__(self, cause: Exception, report: "SweepReport") -> None:
        super().__init__(f"{type(cause).__name__}: {cause}")
        self.cause = cause
        self.report = report


def _count_spend(report: SweepReport, subject: Subject, result: CapsuleResult) -> None:
    """A page's calls, tokens and cost on the sweep's report."""
    usage = result.usage
    report.calls += result.calls
    report.retry_asks += result.retry_asks
    # The night's ceiling counts the writer's asks, never the gateway's re-asks (Lane 73 ruling 1).
    report.asks_by_player[subject.universe_id] = report.asks_by_player.get(subject.universe_id, 0) + result.asks
    if usage is not None:
        report.prompt_tokens += usage.prompt_tokens or 0
        report.completion_tokens += usage.completion_tokens or 0
        report.cost_usd += usage.cost_usd or 0.0


def _tally(report: SweepReport, subject: Subject, result: CapsuleResult, kept: bool) -> None:
    usage = result.usage
    _count_spend(report, subject, result)
    name = subject.facts.identity.name
    report.detail += [f"{name}: narrative slot rejected, {line}" for line in result.narrative.rejected]
    fell = f"{name}: {describe_fallback(result.compact, result.full)}"
    if kept:
        report.kept += 1
        if result.source == "llm":
            report.refused += 1
            report.detail.append(f"{name}: rewrite refused, it would land a sentence another page carries")
        else:
            report.held.append(subject.universe_id)
            report.fell.append(f"{fell}, held over the written read")
            report.detail.append(f"{fell}, held over the written read")
        return
    if result.source == "llm":
        report.llm += 1
        report.rescued += int(result.rescued)
        report.detail.append(f"{name}: llm, {result.calls} calls, ${(usage.cost_usd or 0.0) if usage else 0.0:.6f}")
        return
    report.facts += 1
    report.fell.append(fell)
    report.detail.append(fell)


def write_one(  # noqa: PLR0913 - one write's parts
    engine: Engine,
    subject: Subject,
    stored: StoredCapsule | None,
    gateway: GatewayClient,
    worn: WornPhrases,
    *,
    claim: Callable[[CapsuleResult], bool] | None = None,
    retry_model: str | None = None,
) -> tuple[CapsuleResult, bool]:
    """One player's capsule, generated and committed on its own: the result, and whether the page was
    kept as it was. A rewrite of a written row that falls to its facts block is held: the written row
    stands, nothing is written (the hold path). `claim` (`landing.BoardSentences`) is asked before
    anything lands: False keeps the page as it is, nothing written. `retry_model` is the retry writer a
    read the writer could not write is asked once more of (`generate_capsule`)."""
    result = generate_capsule(subject.facts, gateway, worn, retry_model=retry_model)
    if stored is not None and stored.source == WRITTEN_SOURCE and result.source == FACTS_SOURCE:
        return result, True
    if claim is not None and not claim(result):
        return result, True
    row = CapsuleWrite(
        subject.universe_id,
        subject.facts.facts_hash,
        result.compact.text,
        result.full.text,
        result.source,
        result.narrative.slots,
        result.model,
    )

    def commit() -> None:
        with engine.begin() as conn:
            upsert_capsule(conn, row, datetime.now(UTC))

    # A dropped connection costs the commit one more try on a fresh one, never the page's paid read.
    try:
        once_more_on_disconnect(commit)
    except DBAPIError as error:
        raise PageCommitError(subject, result, error) from error
    return result, False


def subjects_of(conn: Connection, as_of: datetime, history: ReadThrough = UNCACHED) -> list[Subject]:
    """The board facts pass, each sheet with the universe id its capsule row keys on."""
    facts_pass = collect_board_facts(conn, as_of, history)
    return [
        Subject(facts, facts_pass.universe_ids[facts.identity.id])
        for facts in facts_pass.facts
        if facts.identity.id in facts_pass.universe_ids
    ]


Subjects = Callable[[Connection, datetime], Sequence[Subject]]


class FactsPassMemo:
    """ONE BOARD FACTS PASS AN INSTANT: the nightly's capsule step runs a sweep, its retries, its
    repairs and the page gate at one instant, and the sheets are the same for each (the step writes
    only capsule rows, which no sheet reads), so the pass is read once and handed to every one.
    Before this each of them read it again, up to seventeen passes a night (2026-10-14).

    The pass reads on its own connection from `snapshot_of` (`db.read_cache.snapshot`: one
    REPEATABLE READ snapshot, so its history reads may be kept by the read cache), never the
    caller's, which is why a caller's `conn` is not used.

    WHERE A NEW READER OF THE NIGHT'S FACTS HOOKS IN: anything in the nightly that needs the board's
    sheets (a gate, a span rule, a repair) takes a `Subjects` (`subjects_at`) and is handed the
    step's memo (`nightly.capsule_step.night_facts`, built once in `nightly.run_parts.run_steps`);
    it never calls `subjects_of` itself, which is a whole uncached pass (about 196 MB)."""

    def __init__(
        self,
        snapshot_of: Callable[[], AbstractContextManager[Connection]],
        history: ReadThrough = UNCACHED,
        read: Callable[[Connection, datetime, ReadThrough], Sequence[Subject]] = subjects_of,
    ) -> None:
        self._snapshot_of = snapshot_of
        self._history = history
        self._read = read
        self._held: tuple[datetime, tuple[Subject, ...]] | None = None

    def __call__(self, conn: Connection, as_of: datetime) -> tuple[Subject, ...]:
        del conn  # the pass reads its own snapshot
        if self._held is None or self._held[0] != as_of:
            with self._snapshot_of() as snapshot:
                self._held = (as_of, tuple(self._read(snapshot, as_of, self._history)))
        return self._held[1]


@dataclass(frozen=True, slots=True)
class SweepPlan:
    """How much one sweep may do: `budget` players, stopping before a player once `deadline` says
    time is up; `unwritten_only` is the retry pass the nightly runs before its gate, over only the
    pages the writer has not served."""

    budget: int = CAPSULE_CONFIG.sweep_generation_budget
    deadline: Callable[[], bool] | None = None
    unwritten_only: bool = False
    # The repair pass the nightly runs when its capsule gate finds a written sentence on two pages:
    # exactly these universe ids are rewritten, whatever their rows hold, with `avoid` (the shared
    # sentences) quoted into the prompt beside the board's worn language.
    only: tuple[str, ...] | None = None
    avoid: tuple[str, ...] = ()
    # The repair's per page language: each page's own six-word spans that another page carries too
    # (`capsules.spans`), quoted into that page's prompt beside `avoid`.
    avoid_by_page: Mapping[str, tuple[str, ...]] = field(default_factory=lambda: MappingProxyType({}))
    # The night's span rules (`capsules.span_rules`), built once by the nightly; None builds them here.
    # Each writer call is told the spans tonight's latest pages already share (`landing.TonightWindow`).
    span_rules: SpanRules | None = None
    # Written pages an `unwritten_only` pass asks again besides the unwritten ones: tonight's held
    # rewrites (`SweepReport.held`, the hold path), so a fallen rewrite has the night's rounds too.
    again: frozenset[str] = frozenset()
    # The retry writer a read the writer's asks could not write is asked once more of (Lane 294); None
    # turns it off.
    retry_model: str | None = None
    # Players the night has spent its call budget on (`nightly.capsule_step`), never written again.
    exclude: frozenset[str] = frozenset()
    # A graced pass (`nightly.capsule_step.spent_out_for`): a page at the night's call ceiling may take
    # its one generation past it. Every pass over unwritten pages is graced; this marks the other one,
    # the last rewrite of the pages still carrying a shared sentence.
    grace: bool = False
    # Pages written before any other this pass, whatever their stamp: the last night's demotions
    # (`nightly.capsule_demotion`), so each has its fresh attempt before it could be demoted again.
    first: tuple[str, ...] = ()


def _eligible(subject: Subject, row: StoredCapsule | None, plan: SweepPlan) -> bool:
    if subject.universe_id in plan.exclude:
        return False
    if plan.only is not None:
        return subject.universe_id in plan.only
    if plan.unwritten_only:
        return _unwritten(row) or subject.universe_id in plan.again
    return _needs_generation(subject, row)


def _ordered(subjects: Sequence[Subject], stored: dict[str, StoredCapsule], plan: SweepPlan) -> list[Subject]:
    """The demoted first (`plan.first`, then the rows stamped demoted), then every unwritten page, then
    the rest in board order; a repair's own pages (`plan.only`) in the order it gives them."""
    eligible = [s for s in subjects if _eligible(s, stored.get(s.universe_id), plan)]
    by_id = {s.universe_id: s for s in eligible}
    if plan.only is not None:
        return [by_id[pid] for pid in plan.only if pid in by_id]
    first = [by_id[pid] for pid in dict.fromkeys(plan.first) if pid in by_id]
    demoted = [
        *first,
        *(
            s
            for s in eligible
            if s.universe_id not in plan.first
            and (row := stored.get(s.universe_id)) is not None
            and row.facts_hash == RETRY_FIRST_FACTS_HASH
        ),
    ]
    unwritten = [s for s in eligible if s not in demoted and _unwritten(stored.get(s.universe_id))]
    return [*demoted, *unwritten, *(s for s in eligible if s not in demoted and s not in unwritten)]


Written = tuple[CapsuleResult, bool]


def _reads(row: StoredCapsule) -> tuple[str, str]:
    return row.body_compact, row.body_full


def _land(report: SweepReport, tonight: TonightWindow, subject: Subject, written: Written) -> None:
    """One page as it lands: tallied, checked against the pages landed before it, added to the window."""
    result, kept = written
    if result.source == "llm" and not kept:
        texts = page_texts(result.compact.text, result.full.text, result.narrative.slots)
        landing = tonight.land(texts, (result.compact.text, result.full.text))
        report.landed_sentences += landing.sentences
        report.landed_spans += landing.spans
        if landing.carrier:
            report.landed_carriers.append(subject.universe_id)
    _tally(report, subject, result, kept)
    report.processed.append(subject.universe_id)


def sweep_capsules(
    engine: Engine, gateway: GatewayClient, as_of: datetime, plan: SweepPlan, subjects_at: Subjects = subjects_of
) -> SweepReport:
    """`sweepCapsules`: write every eligible player in `_ordered`'s order within `plan`, then run
    the repetition check. The sheets come from `subjects_at` (a fresh facts pass unless the caller
    holds one, `FactsPassMemo`)."""
    with engine.connect() as conn:
        subjects = subjects_at(conn, as_of)
        stored = stored_capsules_for(conn, [s.universe_id for s in subjects])
        rules = plan.span_rules or span_rules_for(conn, (s.facts for s in subjects))
    ordered = _ordered(subjects, stored, plan)
    board_worn = worn_phrases(subjects, stored)
    repetition = CAPSULE_CONFIG.repetition
    tonight = TonightWindow(rules, repetition.tonight_window_pages, CAPSULE_CONFIG.shared_sentence_min_words)
    report = SweepReport(as_of, len(subjects), len(ordered))
    board = BoardSentences(
        {s.universe_id: _reads(row) for s in subjects if (row := stored.get(s.universe_id)) and row.source == "llm"},
        CAPSULE_CONFIG.shared_sentence_min_words,
        rules.exempt_sentences,
    )
    # A rewrite of chosen pages (the hard repair, the graced rewrite, the span repair) may not land a
    # sentence another page carries; the sweep and its retries record theirs as they land.
    exclusive = plan.only is not None

    def claim_for(subject: Subject) -> Callable[[CapsuleResult], bool]:
        def claim(result: CapsuleResult) -> bool:
            if result.source != "llm":
                return board.claim(subject.universe_id, (), exclusive=False)
            return board.claim(subject.universe_id, (result.compact.text, result.full.text), exclusive=exclusive)

        return claim

    def start(subject: Subject) -> Callable[[GatewayClient], Written]:
        # Told, as it starts, what every page landed so far already repeats.
        worn = WornPhrases(
            (
                *plan.avoid,
                *plan.avoid_by_page.get(subject.universe_id, ()),
                *tonight.repeated(repetition.max_quoted_spans),
                *board_worn.sentences,
            ),
            board_worn.phrases,
        )
        return lambda view: write_one(
            engine,
            subject,
            stored.get(subject.universe_id),
            view,
            worn,
            claim=claim_for(subject),
            retry_model=plan.retry_model,
        )

    try:
        stopped = gateway.rolling(
            ordered[: plan.budget],
            start,
            lambda subject, written: _land(report, tonight, subject, written),
            plan.deadline or (lambda: False),
        )
    except Exception as error:
        if isinstance(error, PageCommitError):
            _count_spend(report, error.subject, error.result)
            report.processed.append(error.subject.universe_id)
        raise SweepInterruptedError(error, report) from error
    if stopped:
        # A half-swept board would flag sentences the rest of tonight's work is about to rewrite.
        return report
    with engine.begin() as conn:
        after = stored_capsules_for(conn, [s.universe_id for s in subjects])
        rows = _rows(subjects, after)
        report.queued = queue_regeneration(conn, players_to_regenerate(stock_sentences(rows), measure_sameness(rows)))
    return report
