"""EVERY ARTIFACT OF A RUN, READ FROM THE STORE AND SHAPED IN THE WEB'S RUN FORMAT.

`assemble` reads what tonight's steps left in the store (the boards, tonight's ADP, the register,
the slate and its values, the capsules) at one instant and returns each artifact as JSON, keyed by
its path in the run (`RUN_PATHS` in `web/src/lib/run/schema.ts`), with the sources block naming
each feed's vendor and window.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.capsules.pull_figures import PageValues
from research.capsules.store import StoredCapsule, stored_capsules_for
from research.errors import ResearchError
from research.model.reads.teams import first_kickoff_for
from research.nightly.build import pages, season
from research.nightly.config import PAGE_FORMAT, PRODUCT_SEASON, RUN_FORMATS, RunFormat
from research.nightly.gates import CapsulePage
from research.nightly.reads import record as record_read
from research.nightly.reads import schedule as schedule_read
from research.nightly.reads.adp import AdpCapture, adp_cutoff, latest_capture
from research.nightly.reads.board import FormatBoard, format_board

Json = dict[str, Any]
WIN_TOTALS_VENDOR: Final = "Published preseason season win totals, the nfelo win_totals.csv (greerreNFL/nfelosrs)"
FIXTURES_VENDOR: Final = "Tank01 NFL fixtures (the stats provider)"
REGISTER_VENDOR: Final = "The Commish register: frozen before each kickoff, graded on nflverse weekly stats"


class AssemblyError(ResearchError):
    """The store cannot give the run an artifact the web requires; the run fails, naming which."""


@dataclass(frozen=True, slots=True)
class Assembled:
    files: dict[str, Any]  # path in the run to its JSON
    boards: tuple[FormatBoard, ...]
    people: tuple[pages.Identity, ...]
    capsule_pages: tuple[CapsulePage, ...]
    sources: tuple[Json, ...]
    model_versions: tuple[str, ...]
    formats: tuple[RunFormat, ...]
    # The formats the run does not carry tonight, each with why (a format without ADP is not shipped).
    dropped: tuple[str, ...]


def _boards(conn: Connection, as_of: datetime, formats: Sequence[RunFormat]) -> tuple[FormatBoard, ...]:
    boards = []
    for run_format in formats:
        board = format_board(conn, PRODUCT_SEASON, run_format, as_of)
        if board is None or not board.entries:
            raise AssemblyError(f"board_missing:{run_format.id}: no stored {run_format.board_source} at {as_of}")
        boards.append(board)
    return tuple(boards)


def _fixtures_window(conn: Connection) -> tuple[datetime, datetime]:
    row = conn.execute(
        text("select min(ingested_at), max(ingested_at) from research.provider_games where season = :s"),
        {"s": PRODUCT_SEASON},
    ).one()
    if row[0] is None:
        raise AssemblyError(f"schedule_missing: no {PRODUCT_SEASON} fixtures stored")
    return row[0], row[1]


def _schedule(conn: Connection, as_of: datetime) -> tuple[Json, list[Json], Json, Json]:
    games = schedule_read.slates_by_club(conn, PRODUCT_SEASON)
    kickoff = first_kickoff_for(conn, PRODUCT_SEASON) or as_of
    values = schedule_read.opponent_values(conn, PRODUCT_SEASON, kickoff)
    slates = schedule_read.slates(games, values)
    published = [value.published for value in values.values()]
    sources = (
        {"artifact": "schedule", "vendor": WIN_TOTALS_VENDOR, "feed": schedule_read.WIN_TOTAL_SOURCE,
         "window": season.window(min(published), max(published))},
        {"artifact": "clubs", "vendor": FIXTURES_VENDOR, "feed": "provider_games", "window": season.window(*_fixtures_window(conn))},
    )  # fmt: skip
    clubs = season.clubs_json(schedule_read.clubs_of(games))
    return season.schedule_json(PRODUCT_SEASON, slates, values), clubs, sources[0], sources[1]


def _record(conn: Connection) -> tuple[Json, Json | None]:
    """The record, and its source; a season with no freeze yet has an empty record and no source."""
    weeks, rows_by_week = record_read.read_record(conn, PRODUCT_SEASON)
    record = season.record_json(PRODUCT_SEASON, weeks, record_read.to_date(weeks, rows_by_week))
    if not weeks:
        return record, None
    stamps = [w.frozen_at for w in weeks] + [w.graded_at for w in weeks if w.graded_at is not None]
    source = {
        "artifact": "record",
        "vendor": REGISTER_VENDOR,
        "feed": "register_freeze_rows, register_grade_rows",
        "window": season.window(min(stamps), max(stamps)),
    }
    return record, source


def _capsule_pages(people: Sequence[pages.Identity], players: Sequence[Json], boards: Sequence[FormatBoard],
                   adp: Mapping[str, float], capsules: Mapping[str, StoredCapsule]) -> tuple[CapsulePage, ...]:  # fmt: skip
    """The pages carrying a written capsule, with what the page gate checks them against."""
    page_board = next(b for b in boards if b.format.id == PAGE_FORMAT.id)
    entries = {e.row.player_id: e for e in page_board.entries}
    out = []
    for who, page in zip(people, players, strict=True):
        entry = entries.get(who.id)
        stored = None if entry is None else capsules.get(entry.row.universe_id)
        if page["capsule"] is None or entry is None or stored is None:
            continue
        values: PageValues = pages.page_values(entry, adp.get(who.id))
        out.append(CapsulePage(who.id, (stored.body_compact, stored.body_full), values, (who.name,)))
    return tuple(out)


def assemble(conn: Connection, as_of: datetime) -> Assembled:
    cutoff = adp_cutoff(as_of, first_kickoff_for(conn, PRODUCT_SEASON))
    captures: dict[str, AdpCapture] = {}
    for run_format in RUN_FORMATS:
        captures.setdefault(run_format.adp.source, latest_capture(conn, run_format.adp, cutoff))
    formats = tuple(f for f in RUN_FORMATS if captures[f.adp.source].by_player)
    dropped = tuple(
        f"{f.id}: no {f.adp.source} capture at or before {season.iso(cutoff)}" for f in RUN_FORMATS if f not in formats
    )
    if PAGE_FORMAT not in formats:
        raise AssemblyError(
            f"adp_missing:{PAGE_FORMAT.id}: the page format has no ADP at or before {season.iso(cutoff)}"
        )
    captures = {source: c for source, c in captures.items() if any(f.adp.source == source for f in formats)}
    boards = _boards(conn, as_of, formats)
    adp_by_format = {f.id: season.format_adp(f, captures) for f in formats}
    people = tuple(pages.identities(boards))
    by_slug = {p.id: p for p in people}
    universe_ids = sorted({e.row.universe_id for b in boards for e in b.entries})
    capsules = stored_capsules_for(conn, universe_ids)
    inputs = pages.page_inputs(boards, adp_by_format, capsules)
    players = [pages.player_json(who, inputs) for who in people]
    schedule, clubs, schedule_source, clubs_source = _schedule(conn, as_of)
    record, record_source = _record(conn)
    files: dict[str, Any] = {
        f"boards/{b.format.id}.json": pages.board_json(b, by_slug, adp_by_format[b.format.id]) for b in boards
    }
    files |= {f"players/{page['id']}.json": page for page in players}
    files |= {
        "adp.json": season.adp_json(formats, captures),
        "record.json": record,
        "index.json": pages.index_json(people),
        "clubs.json": clubs,
        "schedule.json": schedule,
    }
    board_sources = {
        b.stored.source: {"artifact": "boards", "vendor": f"Commish projections, model {b.stored.model_version}",
                          "feed": b.stored.source, "window": season.window(b.stored.as_of, b.stored.as_of)}
        for b in boards
    }  # fmt: skip
    adp_sources = [
        {
            "artifact": "adp",
            "vendor": c.feed.vendor,
            "feed": c.feed.source,
            "window": season.window(c.captured_at, c.captured_at),
        }
        for c in captures.values()
        if c.captured_at is not None
    ]
    written = [c for c in capsules.values() if c.source == pages.WRITTEN_SOURCE]
    capsule_sources = (
        [{"artifact": "capsules", "vendor": f"written by {', '.join(sorted({c.model or 'the writer' for c in written}))}",
          "feed": "player_capsules", "window": season.window(min(c.generated_at for c in written), max(c.generated_at for c in written))}]
        if written else []
    )  # fmt: skip
    return Assembled(
        files,
        boards,
        people,
        _capsule_pages(people, players, boards, adp_by_format[PAGE_FORMAT.id], capsules),
        (
            *board_sources.values(),
            *adp_sources,
            schedule_source,
            clubs_source,
            *([record_source] if record_source else []),
            *capsule_sources,
        ),
        tuple(sorted({b.stored.model_version or "unrecorded" for b in boards})),
        formats,
        dropped,
    )
