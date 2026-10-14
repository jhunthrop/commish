"""WRITE AND GATE A CHOSEN FEW: the paid trial of the writer against a store.

Chooses board players (named, or every `spread`-th in board order so the trial runs from the top of
the board to its tail), writes each through the sweep's own `write_one` (committed as written), then
holds each stored capsule to the gate the nightly enforces (`pull_figures.capsule_findings`) with the
page's own numbers from his served board row, and the chosen pages together to the nightly's
capsule gate (the unwritten share and no written sentence on two pages), and reports what each
cost in calls and tokens.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Engine

from research.capsules.facts.board import BoardRow, board_rows
from research.capsules.gateway import GatewayClient
from research.capsules.generate import CapsuleResult, describe_fallback
from research.capsules.pull_figures import PageValues, capsule_findings, page_numbers, pull_figures_of
from research.capsules.season_voice import clock_of
from research.capsules.store import stored_capsules_for
from research.capsules.sweep import Subject, subjects_of, worn_phrases, write_one
from research.nightly.capsule_gate import judge_capsules, span_rules
from research.season import PRODUCT_SEASON


@dataclass(frozen=True, slots=True)
class Written:
    subject: Subject
    row: BoardRow
    result: CapsuleResult
    findings: tuple[str, ...]


def page_values_of(row: BoardRow) -> PageValues:
    """The page's numbers as its served board row carries them."""
    return PageValues(
        row.projected_points,
        row.ceiling_points,
        row.floor_points,
        row.median_points,
        row.value_over_replacement,
        row.drop_to_next_tier,
        row.market_adp,
    )


@dataclass(frozen=True, slots=True)
class Choice:
    """Who to write: named provider ids, else `count` players every `spread`-th in board order."""

    players: tuple[str, ...] = ()
    count: int = 10
    spread: int = 50


def _chosen(subjects: Sequence[Subject], choice: Choice) -> list[Subject]:
    players, count, spread = choice.players, choice.count, choice.spread
    if players:
        by_id = {s.facts.identity.id: s for s in subjects}
        missing = [p for p in players if p not in by_id]
        if missing:
            raise ValueError(f"not on the board, so no sheet to write from: {', '.join(missing)}")
        return [by_id[p] for p in players]
    return list(subjects[:: max(1, spread)][:count])


def write_chosen(engine: Engine, gateway: GatewayClient, as_of: datetime, choice: Choice) -> list[Written]:
    """Writes the chosen players' capsules and gates each stored one."""
    with engine.connect() as conn:
        subjects = subjects_of(conn, as_of)
        rows = {row.player_id: row for row in board_rows(conn, PRODUCT_SEASON, as_of)}
        stored = stored_capsules_for(conn, [s.universe_id for s in subjects])
    worn = worn_phrases(subjects, stored)
    written: list[Written] = []
    for subject in _chosen(subjects, choice):
        result, _ = write_one(engine, subject, stored.get(subject.universe_id), gateway, worn)
        row = rows[subject.facts.identity.id]
        numbers = page_numbers(page_values_of(row))
        findings = capsule_findings(
            subject.facts.identity.id,
            (result.compact.text, result.full.text),
            numbers,
            subject.facts.name_ledger,
            clock_of(subject.facts),
        )
        written.append(Written(subject, row, result, tuple(findings)))
    return written


def gate_written(engine: Engine, written: Sequence[Written], as_of: datetime) -> list[str]:
    """One line per capsule (outcome, cost, pull figures, gate findings), read back from the store, and the totals."""
    with engine.connect() as conn:
        stored = stored_capsules_for(conn, [w.subject.universe_id for w in written])
        rules = span_rules(conn, as_of, subjects_of)  # the trial's own pass: a CLI tool, not the nightly
    lines: list[str] = []
    calls = prompt = completion = 0
    cost = 0.0
    for w in written:
        row = stored[w.subject.universe_id]
        numbers = page_numbers(page_values_of(w.row))
        findings = capsule_findings(
            w.subject.facts.identity.id,
            (row.body_compact, row.body_full),
            numbers,
            w.subject.facts.name_ledger,
            clock_of(w.subject.facts),
        )
        figures = ", ".join(f"{f.label} {f.text}" for f in pull_figures_of(row.body_full, numbers))
        usage = w.result.usage
        p, c, d = (
            (0, 0, 0.0)
            if usage is None
            else (usage.prompt_tokens or 0, usage.completion_tokens or 0, usage.cost_usd or 0.0)
        )
        calls, prompt, completion, cost = calls + w.result.calls, prompt + p, completion + c, cost + d
        name = w.subject.facts.identity.name
        outcome = describe_fallback(w.result.compact, w.result.full)
        verdict = "passes the gate" if not findings else f"FAILS the gate: {'; '.join(findings)}"
        lines.append(
            f"{name} (overall {w.row.overall_rank}, {row.source}, {outcome}): {w.result.calls} calls, {p} prompt and {c} "
            f"completion tokens, ${d:.6f}; pull figures {figures or 'none'}; {verdict}; "
            f"narrative slots kept {len(w.result.narrative.slots)}, refused {len(w.result.narrative.refused)}"
        )
    judged = judge_capsules([w.subject.universe_id for w in written], stored, rules)
    lines.append(f"the nightly's capsule gate over these pages alone: {judged.summary()}")
    n = max(1, len(written))
    lines.append(
        f"total: {len(written)} capsules, {calls} calls ({calls / n:.1f} a capsule), {prompt} prompt and {completion} "
        f"completion tokens ({prompt / n:.0f} and {completion / n:.0f} a capsule), ${cost:.6f} (${cost / n:.6f} a capsule)"
    )
    return lines
