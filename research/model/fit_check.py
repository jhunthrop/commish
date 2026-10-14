"""THE FIT STEP: rebuild the stored boards and compare, or (deliberately) retake the product season.

    RESEARCH_DATABASE_URL=... uv run python -m research.model.fit_check [--persist-board] [--now ISO]
        [--arithmetic fused|unfused]

Ported from `research-ts/src/nightly/steps.ts` (`fitStep`, `checkTargets`, `driftOf`). CHECK-ONLY BY
DEFAULT: each board the store can rebuild is rebuilt at its stored moment and compared, writing
nothing; a point field past 0.05 (the pages print one decimal), a player on one side only, or a
reason that would change fails the step. Before the product season's kickoff that is its live
board at the stored generation's moment; after kickoff it is the archived replay boards, and a
board whose inputs the store no longer holds is named as unbuildable, not failed. `--persist-board`
retakes the product season's live board, which replaces what the site serves and what the register
freezes next.

A SECOND DIFFERENCE, from phase D: after kickoff an archived board is rebuilt only when the model
that made it is one this code reproduces (`reproduces`): a board this lane wrote (`research@...`), or
the TypeScript tree the port matches bit for bit (`PORTED_MODELS`). The 2021-2024 replay boards
were made by older trees (or record none); once the history rebuild (`research.pipeline history`)
gave the store their inputs back, comparing them with today's model reports a model change, not
drift, and would fail every night until the offseason refit retakes them. They are named as made by
another model and skipped.

One deliberate difference from the oracle, named in the report: a reason is compared by its code
and law id, and by value. `diffReasons` (`persist.ts`) keys by code alone, so a player's law
reasons collapse to the last one, and compares `JSON.stringify` text, so a stored payload (jsonb
keeps its own key order) never equals a fresh one even when every value does.

`--arithmetic` defaults to `fused`, the arithmetic every stored board was made in
(`research.model.arithmetic`); it is a property of the boards, never of the host, so a nightly on
x86-64 runs fused too. `unfused` exists to rebuild a board an x86-64 V8 made.
"""

import argparse
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final

from sqlalchemy import Connection, text

from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.model.arithmetic import ARITHMETIC_BY_NAME, Arithmetic, Provenance, model_version
from research.model.instants import js_iso, ms_instant
from research.model.market.curve import BOARD_FORMATS, BoardFormat, board_source_for
from research.model.preseason.inputs import MissingInputError
from research.model.preseason.persist import (
    PointDrift,
    build_season,
    diff_points,
    fresh_reasons,
    legs_for,
    projection_rows,
    reasons_that_would_change,
    stored_generation,
    stored_reasons,
    write_board,
)
from research.model.priors import ModelArtifacts, load_model_artifacts
from research.model.reads.teams import first_kickoff_for
from research.season import PRODUCT_SEASON

INGESTED_SEASONS: Final = (2021, 2022, 2023, 2024)
FIT_POINT_TOLERANCE: Final = 0.05
SERVED_SOURCE: Final = board_source_for("ppr")
# The TypeScript trees the port reproduces bit for bit (phase B's board parity cases).
PORTED_MODELS: Final = frozenset({"research-ts@7af71283"})
_THIS_LANE: Final = "research@"


def reproduces(model: str | None) -> bool:
    """Whether a stored board's model is one this code rebuilds exactly."""
    return model is not None and (model in PORTED_MODELS or model.startswith(_THIS_LANE))


def _season_models(conn: Connection, season: int) -> list[str | None]:
    """The models of the newest generation of each of the season's stored boards."""
    return [
        row[0]
        for row in conn.execute(
            text(
                "select distinct model_version from research.preseason_projections p where season = :s and as_of = "
                "(select max(as_of) from research.preseason_projections where season = :s and source = p.source)"
            ),
            {"s": season},
        )
    ]


@dataclass(frozen=True, slots=True)
class Target:
    season: int
    now: datetime
    formats: tuple[BoardFormat, ...]
    why: str


@dataclass(frozen=True, slots=True)
class LegCheck:
    season: int
    source: str
    points: PointDrift
    reasons_moved: int


@dataclass(frozen=True, slots=True)
class StepRecord:
    status: str
    summary: str
    legs: tuple[LegCheck, ...] = ()


def _stored_formats(conn: Connection, season: int) -> tuple[BoardFormat, ...]:
    sources = {
        row[0]
        for row in conn.execute(
            text("select distinct source from research.preseason_projections where season = :s"), {"s": season}
        )
    }
    return tuple(board_format for board_format in BOARD_FORMATS if board_source_for(board_format) in sources)


def _served_moment(conn: Connection, season: int) -> datetime | None:
    row = conn.execute(
        text("select max(as_of) from research.preseason_projections where season = :s and source = :source"),
        {"s": season, "source": SERVED_SOURCE},
    ).first()
    return None if row is None or row[0] is None else ms_instant(row[0])


def check_targets(conn: Connection, now: datetime) -> tuple[list[Target], list[str]] | str:
    """`checkTargets`."""
    kickoff = first_kickoff_for(conn, PRODUCT_SEASON)
    if kickoff is None or now < kickoff:
        moment = _served_moment(conn, PRODUCT_SEASON)
        if moment is None:
            return f"no stored {SERVED_SOURCE} generation for {PRODUCT_SEASON} to check against"
        return [
            Target(
                PRODUCT_SEASON,
                moment,
                _stored_formats(conn, PRODUCT_SEASON),
                f"live board at its stored moment {js_iso(moment)}",
            )
        ], []
    targets: list[Target] = []
    skipped: list[str] = []
    for season in INGESTED_SEASONS:
        formats = _stored_formats(conn, season)
        models = _season_models(conn, season)
        if not formats:
            skipped.append(f"{season} (no stored board)")
        elif not all(reproduces(model) for model in models):
            made_by = ", ".join(sorted(model or "an unrecorded model" for model in models))
            skipped.append(f"{season} (made by {made_by}, which this code does not reproduce)")
        elif first_kickoff_for(conn, season) is None:
            skipped.append(f"{season} (no ingested schedule)")
        else:
            targets.append(
                Target(season, now, formats, f"archived replay board, {PRODUCT_SEASON} kicked off {js_iso(kickoff)}")
            )
    # With no target the step skips by name (`fit_step`): nothing rebuildable is not drift, which is
    # the oracle's own rule for a target its store refuses (`fitStep`'s NOTHING COULD BE REBUILT).
    return targets, skipped


def check_target(
    conn: Connection, target: Target, artifacts: ModelArtifacts, arithmetic: Arithmetic, tolerance: float
) -> list[LegCheck] | str:
    """One target's legs against the store, or the store's own refusal for want of an input."""
    try:
        season = build_season(conn, target.season, target.now, artifacts, arithmetic, target.formats)
    except MissingInputError as refusal:
        return str(refusal).split(". ")[0]
    checks: list[LegCheck] = []
    for leg in legs_for(target.formats):
        built = season.boards[leg.source]
        moment = season.inputs.moment
        stored = stored_generation(conn, target.season, leg.source, moment)
        rebuilt = projection_rows(built.board, target.season, leg.source, moment, season.inputs.moment_kind)
        moved = reasons_that_would_change(stored_reasons(conn, target.season, leg.source, moment), fresh_reasons(built))
        checks.append(LegCheck(target.season, leg.source, diff_points(stored, rebuilt, tolerance), moved))
    return checks


def _findings(check: LegCheck, tolerance: float) -> list[str]:
    where = f"{check.season} {check.source}"
    points = check.points
    found: list[str] = []
    if points.over_tolerance > 0:
        found.append(
            f"{where}: {points.over_tolerance} point fields over {tolerance} (max {points.max_abs_delta:.4f}, {points.worst})"
        )
    if points.missing_from_rebuild:
        found.append(f"{where}: {len(points.missing_from_rebuild)} stored players not rebuilt")
    if points.missing_from_store:
        found.append(f"{where}: {len(points.missing_from_store)} rebuilt players not stored")
    if check.reasons_moved > 0:
        found.append(f"{where}: {check.reasons_moved} reasons would change")
    return found


def fit_step(
    conn: Connection,
    now: datetime,
    artifacts: ModelArtifacts,
    arithmetic: Arithmetic,
    tolerance: float = FIT_POINT_TOLERANCE,
) -> StepRecord:
    """`fitStep` in its default, check-only mode."""
    plan = check_targets(conn, now)
    if isinstance(plan, str):
        return StepRecord("failed", plan)
    targets, skipped = plan
    unbuildable = list(skipped)
    legs: list[LegCheck] = []
    compared: list[str] = []
    for target in targets:
        result = check_target(conn, target, artifacts, arithmetic, tolerance)
        if isinstance(result, str):
            unbuildable.append(f"{target.season} ({result})")
            continue
        legs.extend(result)
        worst = max(check.points.max_abs_delta for check in result)
        compared.append(f"{target.season} ({target.why}) {len(result)} boards, max |delta| {worst:.4f}")
    tail = "" if not unbuildable else f"; not rebuildable: {', '.join(unbuildable)}"
    if not compared:
        return StepRecord("skipped", f"no board could be rebuilt to check{tail}")
    findings = [finding for check in legs for finding in _findings(check, tolerance)]
    header = f"rebuilt and compared, nothing written: {'; '.join(compared)}{tail}"
    if findings:
        return StepRecord("failed", f"{header}; DRIFT: {'; '.join(findings)}", tuple(legs))
    return StepRecord(
        "ran", f"{header}; every board matches within {tolerance} points with the same reasons", tuple(legs)
    )


def persist_product_season(
    conn: Connection, now: datetime, artifacts: ModelArtifacts, provenance: Provenance
) -> StepRecord:
    """`--persist-board`: retake the product season's boards and write them."""
    season = build_season(conn, PRODUCT_SEASON, now, artifacts, provenance.arithmetic)
    written = []
    for leg in legs_for(BOARD_FORMATS):
        counts = write_board(conn, PRODUCT_SEASON, leg.source, season.inputs, season.boards[leg.source], provenance)
        written.append(f"{leg.source} {counts.written} rows")
    return StepRecord("ran", f"{PRODUCT_SEASON} {season.inputs.moment_kind} board written: {', '.join(written)}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="research.model.fit_check", description="check the stored boards (default) or retake the product season"
    )
    parser.add_argument("--persist-board", action="store_true", help="retake and write the product season's live board")
    parser.add_argument("--now", help="the instant to act at (ISO 8601); defaults to the wall clock")
    parser.add_argument(
        "--arithmetic",
        choices=tuple(ARITHMETIC_BY_NAME),
        default="fused",
        help="the boards' arithmetic (default fused, what every stored board was made in)",
    )
    args = parser.parse_args(argv)
    now = datetime.fromisoformat(args.now.replace("Z", "+00:00")) if args.now else datetime.now(UTC)
    engine = make_engine(database_url_from_env())
    with engine.begin() as conn:
        artifacts = load_model_artifacts(conn)
        arithmetic = ARITHMETIC_BY_NAME[args.arithmetic]
        record = (
            persist_product_season(conn, now, artifacts, Provenance(model_version(), arithmetic))
            if args.persist_board
            else fit_step(conn, now, artifacts, arithmetic)
        )
    sys.stdout.write(f"fit: {record.status}, {record.summary}\n")
    return 1 if record.status == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
