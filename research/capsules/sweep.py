"""THE CAPSULE SWEEP: the facts pass, a fresh capsule wherever a player's facts moved, the repetition
check over the board as it then stands.

Ported from `research-ts/src/capsules/sweep.ts`. A player is written when his row is missing, his
facts hash moved, or his row is not written (a facts block, or the oracle's template: a throttled or
refused read keeps retrying);
players demoted from a written read go first. Each player is committed as he is written, so a run
stopped part way loses at most the one in hand. The worn language the board already carries is
quoted into every prompt; the check runs again at the end and queues anyone over a line. Capsules
key on the universe id (`research.players.id`), through the crosswalk.
"""

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import Connection, Engine

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts.build import PlayerFacts
from research.capsules.facts.collect import collect_board_facts
from research.capsules.facts_block import FACTS_SOURCE
from research.capsules.gateway import GatewayClient
from research.capsules.generate import CapsuleResult, describe_fallback, generate_capsule
from research.capsules.prompt import WornPhrases
from research.capsules.repetition import (
    CapsuleRow,
    measure_sameness,
    phrases_to_avoid,
    players_to_regenerate,
    stock_sentences,
)
from research.capsules.store import (
    RETRY_FIRST_FACTS_HASH,
    CapsuleWrite,
    StoredCapsule,
    queue_regeneration,
    stored_capsules_for,
    upsert_capsule,
)


@dataclass(frozen=True, slots=True)
class Subject:
    """One board player the sweep may write: his sheet and the universe id his row keys on."""

    facts: PlayerFacts
    universe_id: str


def _needs_generation(subject: Subject, stored: StoredCapsule | None) -> bool:
    return stored is None or stored.facts_hash != subject.facts.facts_hash or stored.source != "llm"


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
    demoted: int = 0
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    queued: int | None = None
    detail: list[str] = field(default_factory=list)


def _tally(report: SweepReport, subject: Subject, result: CapsuleResult, demoted: bool) -> None:
    usage = result.usage
    report.calls += result.calls
    if usage is not None:
        report.prompt_tokens += usage.prompt_tokens or 0
        report.completion_tokens += usage.completion_tokens or 0
        report.cost_usd += usage.cost_usd or 0.0
    name = subject.facts.identity.name
    report.detail += [f"{name}: narrative slot rejected, {line}" for line in result.narrative.rejected]
    if result.source == "llm":
        report.llm += 1
        report.detail.append(f"{name}: llm, {result.calls} calls, ${(usage.cost_usd or 0.0) if usage else 0.0:.6f}")
        return
    report.facts += 1
    report.demoted += int(demoted)
    suffix = ", kept nothing, was written" if demoted else ""
    report.detail.append(f"{name}: {describe_fallback(result.compact, result.full)}{suffix}")


def write_one(
    engine: Engine, subject: Subject, stored: StoredCapsule | None, gateway: GatewayClient, worn: WornPhrases
) -> tuple[CapsuleResult, bool]:
    """One player's capsule, generated and committed on its own."""
    result = generate_capsule(subject.facts, gateway, worn)
    demoted = stored is not None and stored.source == "llm" and result.source == FACTS_SOURCE
    row = CapsuleWrite(
        subject.universe_id,
        RETRY_FIRST_FACTS_HASH if demoted else subject.facts.facts_hash,
        result.compact.text,
        result.full.text,
        result.source,
        result.narrative.slots,
        result.model,
    )
    with engine.begin() as conn:
        upsert_capsule(conn, row, datetime.now(UTC))
    return result, demoted


def subjects_of(conn: Connection, as_of: datetime) -> list[Subject]:
    """The board facts pass, each sheet with the universe id its capsule row keys on."""
    facts_pass = collect_board_facts(conn, as_of)
    return [
        Subject(facts, facts_pass.universe_ids[facts.identity.id])
        for facts in facts_pass.facts
        if facts.identity.id in facts_pass.universe_ids
    ]


def sweep_capsules(
    engine: Engine,
    gateway: GatewayClient,
    as_of: datetime,
    budget: int = CAPSULE_CONFIG.sweep_generation_budget,
    deadline: Callable[[], bool] | None = None,
) -> SweepReport:
    """`sweepCapsules`: write every eligible player (retry-first, then board order) up to `budget`,
    stopping before a player when `deadline` says time is up, then run the repetition check."""
    with engine.connect() as conn:
        subjects = subjects_of(conn, as_of)
        stored = stored_capsules_for(conn, [s.universe_id for s in subjects])
    eligible = [s for s in subjects if _needs_generation(s, stored.get(s.universe_id))]
    demoted_first = [
        s
        for s in eligible
        if (row := stored.get(s.universe_id)) is not None and row.facts_hash == RETRY_FIRST_FACTS_HASH
    ]
    ordered = [*demoted_first, *(s for s in eligible if s not in demoted_first)]
    worn = worn_phrases(subjects, stored)
    report = SweepReport(as_of, len(subjects), len(ordered))
    stopped = False
    for subject in ordered[:budget]:
        if deadline is not None and deadline():
            stopped = True
            break
        if report.processed and CAPSULE_CONFIG.sweep_pacing_ms > 0:
            time.sleep(CAPSULE_CONFIG.sweep_pacing_ms / 1000)
        result, demoted = write_one(engine, subject, stored.get(subject.universe_id), gateway, worn)
        _tally(report, subject, result, demoted)
        report.processed.append(subject.universe_id)
    if stopped:
        # A half-swept board would flag sentences the rest of tonight's work is about to rewrite.
        return report
    with engine.begin() as conn:
        after = stored_capsules_for(conn, [s.universe_id for s in subjects])
        rows = _rows(subjects, after)
        report.queued = queue_regeneration(conn, players_to_regenerate(stock_sentences(rows), measure_sameness(rows)))
    return report
