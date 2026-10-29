"""WRITE AND GATE A CHOSEN FEW: the paid trial of the writer against a store.

Chooses board players (named, or every `spread`-th in board order so the trial runs from the top of
the board to its tail), writes each through the sweep's own `write_one` (committed as written), then
holds each stored capsule to the gate the nightly enforces (`pull_figures.capsule_findings`) with the
page's own numbers from his served board row, and the chosen pages together to the nightly's
capsule gate (the unwritten share and no written sentence on two pages), and reports what each
cost in calls and tokens.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Engine

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts.board import BoardRow, board_rows
from research.capsules.facts.season_so_far import in_season
from research.capsules.gateway import GatewayClient
from research.capsules.generate import CapsuleResult, describe_fallback
from research.capsules.pull_figures import PageValues, capsule_findings, page_numbers, pull_figures_of
from research.capsules.run_budget import RunBudget
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
    # The run's budget in calls or dollars (None: no cap), a hard stop at the gateway (`run_budget`): a
    # player starts only if his worst case fits what is left.
    budget: RunBudget | None = None


@dataclass(frozen=True, slots=True)
class Trial:
    """What a trial wrote, and the chosen players it never started because the budget could not
    cover a page's worst case."""

    written: tuple[Written, ...]
    unstarted: tuple[str, ...]


def within_budget[S, R](
    subjects: Sequence[S], write: Callable[[S], R], room_for_page: Callable[[], bool]
) -> tuple[list[R], list[S]]:
    """Writes subjects in order, refusing to start one once `room_for_page` says his worst case no
    longer fits; the subjects left are returned unstarted."""
    done: list[R] = []
    for index, subject in enumerate(subjects):
        if not room_for_page():
            return done, list(subjects[index:])
        done.append(write(subject))
    return done, []


def _chosen(subjects: Sequence[Subject], choice: Choice) -> list[Subject]:
    players, count, spread = choice.players, choice.count, choice.spread
    if players:
        by_id = {s.facts.identity.id: s for s in subjects}
        missing = [p for p in players if p not in by_id]
        if missing:
            raise ValueError(f"not on the board, so no sheet to write from: {', '.join(missing)}")
        return [by_id[p] for p in players]
    return list(subjects[:: max(1, spread)][:count])


def write_chosen(engine: Engine, gateway: GatewayClient, as_of: datetime, choice: Choice) -> Trial:
    """Writes the chosen players' capsules, inside the choice's budget, and gates each stored one."""
    with engine.connect() as conn:
        subjects = subjects_of(conn, as_of)
        rows = {row.player_id: row for row in board_rows(conn, PRODUCT_SEASON, as_of)}
        stored = stored_capsules_for(conn, [s.universe_id for s in subjects])
    worn = worn_phrases(subjects, stored)
    budget = choice.budget or RunBudget.of()
    paid = gateway.with_budget(budget)

    def write(subject: Subject) -> Written:
        result, _ = write_one(engine, subject, stored.get(subject.universe_id), paid, worn)
        row = rows[subject.facts.identity.id]
        findings = capsule_findings(
            subject.facts.identity.id,
            (result.compact.text, result.full.text),
            page_numbers(page_values_of(row)),
            subject.facts.name_ledger,
            clock_of(subject.facts),
        )
        return Written(subject, row, result, tuple(findings))

    written, unstarted = within_budget(_chosen(subjects, choice), write, budget.room_for_page)
    return Trial(tuple(written), tuple(s.facts.identity.name for s in unstarted))


def gate_written(engine: Engine, written: Sequence[Written], as_of: datetime) -> list[str]:
    """One line per capsule (outcome, cost, pull figures, gate findings), read back from the store, and the totals."""
    with engine.connect() as conn:
        stored = stored_capsules_for(conn, [w.subject.universe_id for w in written])
        rules = span_rules(conn, as_of, subjects_of)  # the trial's own pass: a CLI tool, not the nightly
        line = CAPSULE_CONFIG.unwritten_line(in_season=in_season(conn, PRODUCT_SEASON, as_of))
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
    judged = judge_capsules([w.subject.universe_id for w in written], stored, rules, line)
    lines.append(f"the nightly's capsule gate over these pages alone: {judged.summary()}")
    n = max(1, len(written))
    lines.append(
        f"total: {len(written)} capsules, {calls} calls ({calls / n:.1f} a capsule), {prompt} prompt and {completion} "
        f"completion tokens ({prompt / n:.0f} and {completion / n:.0f} a capsule), ${cost:.6f} (${cost / n:.6f} a capsule)"
    )
    return lines
