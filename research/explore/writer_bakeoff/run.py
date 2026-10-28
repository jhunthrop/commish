"""THE BAKE-OFF RUN: the sheets of one instant, every sheet written by each writer, the judged drafts judged again.

The sheets are read as the nightly reads them (`nightly.week_reads`: the board facts pass, then the week's
facts and sheets), on read-only connections and with the facts pass uncached, so nothing is written to the
copy (no read-cache rows, no store rows). The instant is the copy's newest rest-of-season board.

Each writer keeps its own board of sentence shapes (`week_reads._Board`), started empty as at a week's
roll-over and filled as its reads land in board order, so each is held to the shapes its own earlier reads
carry, as the nightly holds production. The two writers' reads are interleaved on one rolling pool (the
same hour, the same line), all drawing on one dollar budget (`run_budget`) priced at the dearer model's list
price per token for its reservations; each call settles at the cost the gateway states.
"""

import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Final

from sqlalchemy import Connection, Engine, text

from research.capsules.gateway import GatewayClient, GenerationError
from research.capsules.gateway_ledger import ModelPrice
from research.capsules.generate import ask
from research.capsules.run_budget import RunBudget
from research.capsules.store import WRITTEN_SOURCE
from research.capsules.sweep import FactsPassMemo
from research.capsules.week.collect import collect_week_sheets, read_week_facts
from research.capsules.week.judge import (
    JUDGE_MAX_TOKENS,
    JUDGE_MIN_WORDS,
    VIOLATION,
    judge_messages,
    says_start,
)
from research.capsules.week.sheet import WeekSheet
from research.capsules.week.store import StoredWeekRead, stored_week_reads
from research.capsules.week.validate import SHARED_SENTENCE
from research.capsules.week.write import WeekReadResult, write_week_read
from research.db.read_cache import UNCACHED, snapshot
from research.explore.writer_bakeoff.tally import ReadOutcome
from research.nightly.week_reads import _Board, stored_row
from research.season import PRODUCT_SEASON

KEY_VARIABLE: Final = "AI_GATEWAY_API_KEY"
BUDGET_FALL: Final = "the run's budget is spent"
NO_JUDGE_ASK: Final = "No ask was left for the judge."
REASON: Final = "bakeoff"


def read_key(environ: Mapping[str, str], env_file: Path) -> str:
    """The gateway key from the environment, else from `env_file`'s line; never printed."""
    key = environ.get(KEY_VARIABLE, "").strip()
    if key:
        return key
    for line in env_file.read_text().splitlines():
        name, _, value = line.partition("=")
        if name.strip() == KEY_VARIABLE:
            return value.strip().strip("\"'")
    raise SystemExit(f"{KEY_VARIABLE} is neither set nor in {env_file}")


def _read_only(conn: Connection) -> Connection:
    conn.execute(text("set transaction read only"))
    return conn


def newest_board_instant(engine: Engine) -> datetime:
    with engine.connect() as conn:
        at = (
            _read_only(conn)
            .execute(
                text(
                    "select max(published_at) from research.published_boards "
                    "where season = :s and order_basis = 'rest_of_season'"
                ),
                {"s": PRODUCT_SEASON},
            )
            .scalar_one()
        )
    if at is None:
        raise SystemExit("the copy holds no rest-of-season board for the season")
    return at  # type: ignore[no-any-return]


@dataclass(frozen=True, slots=True)
class Night:
    now: datetime
    board_week: int
    sheets: tuple[WeekSheet, ...]
    stored: Mapping[tuple[str, int], StoredWeekRead]


def read_night(engine: Engine, now: datetime) -> Night:
    """The sheets the nightly would write at `now`, read without a write: the facts pass on a read-only
    snapshot and uncached, the week's facts on a read-only transaction."""
    memo = FactsPassMemo(lambda: snapshot(engine), UNCACHED)
    with engine.connect() as conn:
        _read_only(conn)
        subjects = memo(conn, now)
        week_facts = read_week_facts(conn, PRODUCT_SEASON, subjects, now)
        if week_facts is None:
            raise SystemExit("no game is left to kick off at the instant")
        weeks = sorted({cw.week for cw in week_facts.weeks.values()} | {week_facts.board_week})
        stored = stored_week_reads(conn, PRODUCT_SEASON, weeks)
        sheets = tuple(collect_week_sheets(week_facts, subjects, stored))
    return Night(now, week_facts.board_week, sheets, stored)


def _rule_breaks(violations: Sequence[str]) -> list[str]:
    return [v for v in violations if not v.startswith(VIOLATION) and v != NO_JUDGE_ASK]


def judged_drafts(sheet: WeekSheet, result: WeekReadResult) -> list[tuple[str, bool]]:
    """The drafts the judge read for a player who may not be started: (text, refused). A refused draft
    carries the judge's violation; a written read's last draft is the one it passed."""
    if sheet.may_start:
        return []
    drafts = [(a.body, True) for a in result.attempts if any(v.startswith(VIOLATION) for v in a.violations)]
    if result.source == WRITTEN_SOURCE and result.attempts:
        drafts.append((result.attempts[-1].body, False))
    return drafts


def outcome_of(model: str, sheet: WeekSheet, result: WeekReadResult, seconds: float) -> ReadOutcome:
    usage = result.usage
    judged = judged_drafts(sheet, result)
    return ReadOutcome(
        model=model,
        player_id=sheet.player_id,
        name=sheet.name,
        may_start=sheet.may_start,
        source=result.source,
        fallback=result.fallback,
        calls=result.calls,
        prompt_tokens=0 if usage is None else usage.prompt_tokens or 0,
        completion_tokens=0 if usage is None else usage.completion_tokens or 0,
        cost_usd=0.0 if usage is None else usage.cost_usd or 0.0,
        seconds=seconds,
        drafts=len(result.attempts),
        broken_drafts=sum(bool(_rule_breaks(a.violations)) for a in result.attempts),
        shape_broken_drafts=sum(any(v.startswith(SHARED_SENTENCE) for v in a.violations) for a in result.attempts),
        judged=len(judged),
        judge_refused=sum(refused for _, refused in judged),
    )


@dataclass(slots=True)
class Lane:
    """One writer's run: its board of shapes, its reads as they landed, and the reads the budget stopped."""

    model: str
    board: _Board = field(default_factory=lambda: _Board({}))
    reads: dict[str, tuple[WeekSheet, WeekReadResult, float]] = field(default_factory=dict)
    stopped: int = 0


def dearest_price(prices: Sequence[ModelPrice]) -> ModelPrice:
    """The dearest list price per token in and out across `prices`, for a budget shared by every model."""
    return ModelPrice(
        "+".join(p.model for p in prices),
        max(p.input_usd_per_million or 0.0 for p in prices),
        max(p.output_usd_per_million or 0.0 for p in prices),
        "the dearest of the models' list prices",
        True,
    )


def room(budget: RunBudget, worst: float) -> Callable[[], bool]:
    return lambda: budget.max_usd is None or budget.spent_usd + worst <= budget.max_usd


def write_all(
    gateway: GatewayClient, sheets: Sequence[WeekSheet], models: Sequence[str], judge: str, worst: float
) -> dict[str, Lane]:
    """Every sheet by every writer, interleaved in board order on the gateway's rolling pool."""
    lanes = {model: Lane(model) for model in models}
    items = [(sheet, model) for sheet in sheets for model in models]
    budget = gateway.budget

    def start(item: tuple[WeekSheet, str]) -> Callable[[GatewayClient], tuple[WeekReadResult, float]]:
        sheet, model = item
        board = lanes[model].board
        avoid, taken = board.avoid(sheet.week), board.taken(sheet)

        def work(scoped: GatewayClient) -> tuple[WeekReadResult, float]:
            began = time.monotonic()
            result = write_week_read(sheet, scoped.with_model(model), avoid, taken, judge)
            return result, time.monotonic() - began

        return work

    def land(item: tuple[WeekSheet, str], landed: tuple[WeekReadResult, float]) -> None:
        sheet, model = item
        result, seconds = landed
        lane = lanes[model]
        if result.fallback == BUDGET_FALL:
            lane.stopped += 1
            return
        lane.reads[sheet.player_id] = (sheet, result, seconds)
        lane.board.land(stored_row(sheet, result, REASON, None, sheet.written_at))

    stop = (lambda: False) if budget is None else (lambda: not room(budget, worst)())
    if gateway.rolling(items, start, land, stop=stop):
        for _, model in items[sum(len(lane.reads) + lane.stopped for lane in lanes.values()) :]:
            lanes[model].stopped += 1
    return lanes


@dataclass(frozen=True, slots=True)
class Rejudged:
    writer: str
    player_id: str
    text: str
    first_refused: bool
    second_refused: bool | None
    error: str | None = None


def rejudge(gateway: GatewayClient, lanes: Mapping[str, Lane], second_judge: str, worst_call: float) -> list[Rejudged]:
    """Every judged draft judged again by `second_judge`, on the same line and budget."""
    items = [
        (lane.model, sheet, draft, refused)
        for lane in lanes.values()
        for sheet, result, _ in lane.reads.values()
        for draft, refused in judged_drafts(sheet, result)
    ]
    out: list[Rejudged] = []
    budget = gateway.budget

    def start(item: tuple[str, WeekSheet, str, bool]) -> Callable[[GatewayClient], Rejudged]:
        writer, sheet, draft, refused = item

        def work(scoped: GatewayClient) -> Rejudged:
            try:
                answer = ask(
                    scoped.with_model(second_judge), judge_messages(sheet, draft), JUDGE_MAX_TOKENS, JUDGE_MIN_WORDS
                )
            except GenerationError as error:
                return Rejudged(writer, sheet.player_id, draft, refused, None, str(error))
            return Rejudged(writer, sheet.player_id, draft, refused, says_start(answer.content))

        return work

    stop = (lambda: False) if budget is None else (lambda: not room(budget, worst_call)())
    gateway.rolling(items, start, lambda _, judged: out.append(judged), stop=stop)
    return out


def worst_judge_call_usd(price: ModelPrice, prompt_tokens: int) -> float:
    """A judge call's worst case: a short prompt and the judge's whole allowance."""
    per_in = (price.input_usd_per_million or 0.0) / 1_000_000
    per_out = (price.output_usd_per_million or 0.0) / 1_000_000
    return prompt_tokens * per_in + JUDGE_MAX_TOKENS * per_out
