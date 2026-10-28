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

from research.capsules.store import WRITTEN_SOURCE, StoredCapsule, stored_capsules_for
from research.capsules.week.collect import published_projections
from research.capsules.week.rollover import ReadsDue, projection_held, published_from_week, reads_due, rollover
from research.capsules.week.sheet import PublishedProjection
from research.capsules.week.store import served_week_reads
from research.errors import ResearchError
from research.headshots.faces import our_faces
from research.headshots.table import faced_ids
from research.model.reads.teams import first_kickoff_for
from research.nightly.build import pages, season
from research.nightly.build.page_club import with_page_clubs
from research.nightly.build.player_season import season_context
from research.nightly.build.ros import MODEL_NAME as ROS_MODEL
from research.nightly.build.ros import RosBasis, RosSetup, ros_boards
from research.nightly.config import PAGE_FORMAT, RUN_FORMATS, RunFormat
from research.nightly.designations import read_statuses, status_word
from research.nightly.reads import draft_record as draft_read
from research.nightly.reads import record as record_read
from research.nightly.reads import schedule as schedule_read
from research.nightly.reads import weekly_record as weekly_read
from research.nightly.reads.adp import AdpCapture, adp_cutoff, latest_capture
from research.nightly.reads.board import FormatBoard, format_board
from research.nightly.reads.market import market_order, market_players
from research.nightly.reads.schedule import ClubWeek, Game, GameState
from research.nightly.register_log import FrozenBy
from research.season import PRODUCT_SEASON

Json = dict[str, Any]
WIN_TOTALS_VENDOR: Final = "Published preseason season win totals, the nfelo win_totals.csv (greerreNFL/nfelosrs)"
FIXTURES_VENDOR: Final = "Tank01 NFL fixtures (the stats provider)"
ROS_FEED: Final = "model_artifacts: model/ros-priors v1"
NO_REST_INPUTS: Final = "preseason: the run read no rest-of-season inputs"
REGISTER_VENDOR: Final = "The Commish register: frozen before each kickoff, graded on nflverse weekly stats"


class AssemblyError(ResearchError):
    """The store cannot give the run an artifact the web requires; the run fails, naming which."""


@dataclass(frozen=True, slots=True)
class Assembled:
    files: dict[str, Any]  # path in the run to its JSON
    boards: tuple[FormatBoard, ...]
    people: tuple[pages.Identity, ...]  # every player with a page
    # The kickers and defenses every board carries in draft order: index entries with no page.
    market: tuple[pages.Identity, ...]
    sources: tuple[Json, ...]
    model_versions: tuple[str, ...]
    formats: tuple[RunFormat, ...]
    # The formats the run does not carry tonight, each with why (a format without ADP is not shipped).
    dropped: tuple[str, ...]
    # In season, what the rest-of-season boards rank; None on a preseason board.
    rest: RosBasis | None = None
    # Why the boards are preseason or rest of season tonight, for the run's report.
    rest_status: str = NO_REST_INPUTS
    # The format ids whose board ranks the rest of the season tonight.
    rest_formats: frozenset[str] = frozenset()


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


def _states(conn: Connection, games: Mapping[str, Sequence[Game]], as_of: datetime) -> dict[ClubWeek, GameState]:
    """Every game's state at the run's instant (Lane 80): the one the schedule, the clubs and the
    rest-of-season boards read alike (Lane 86)."""
    return schedule_read.game_states(games, schedule_read.finals_at(conn, PRODUCT_SEASON, as_of), as_of)


def _schedule(
    conn: Connection, as_of: datetime, games: Mapping[str, list[Game]], states: Mapping[ClubWeek, GameState]
) -> tuple[Json, list[Json], Json, Json]:
    kickoff = first_kickoff_for(conn, PRODUCT_SEASON) or as_of
    values = schedule_read.opponent_values(conn, PRODUCT_SEASON, kickoff)
    slates = schedule_read.slates(games, values, states)
    published = [value.published for value in values.values()]
    sources = (
        {"artifact": "schedule", "vendor": WIN_TOTALS_VENDOR, "feed": schedule_read.WIN_TOTAL_SOURCE,
         "window": season.window(min(published), max(published))},
        {"artifact": "clubs", "vendor": FIXTURES_VENDOR, "feed": "provider_games", "window": season.window(*_fixtures_window(conn))},
    )  # fmt: skip
    clubs = season.clubs_json(schedule_read.clubs_of(games))
    return season.schedule_json(PRODUCT_SEASON, slates, values, states), clubs, sources[0], sources[1]


def _record(conn: Connection, as_of: datetime, frozen_by: FrozenBy) -> tuple[Json, Json | None]:
    """The record, and its source; a season with no freeze yet has an empty record and no source."""
    weeks, rows_by_week = record_read.read_record(conn, PRODUCT_SEASON, as_of)
    record = season.record_json(
        PRODUCT_SEASON,
        weeks,
        record_read.to_date(weeks, rows_by_week),
        frozen_by,
        published_from=record_read.published_from(conn, PRODUCT_SEASON),
        weekly=weekly_read.read_weekly(conn, PRODUCT_SEASON, as_of)[0],
        draft=draft_read.read_draft(conn, PRODUCT_SEASON, as_of),
    )
    frozen = [w for w in weeks if w.status in {"frozen", "graded"}]
    if not frozen:
        return record, None
    stamps = [w.at for w in frozen if w.at is not None] + [w.graded_at for w in frozen if w.graded_at is not None]
    source = {
        "artifact": "record",
        "vendor": REGISTER_VENDOR,
        "feed": "register_freeze_rows, register_grade_rows",
        "window": season.window(min(stamps), max(stamps)),
    }
    return record, source


def _captures(
    conn: Connection, as_of: datetime
) -> tuple[dict[str, AdpCapture], tuple[RunFormat, ...], tuple[str, ...]]:
    """Tonight's ADP per source, the formats it carries, and each format dropped with why."""
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
    carried = {source: c for source, c in captures.items() if any(f.adp.source == source for f in formats)}
    return carried, formats, dropped


def _feed_sources(
    boards: Sequence[FormatBoard], captures: Mapping[str, AdpCapture], capsules: Mapping[str, StoredCapsule]
) -> list[Json]:
    """The sources block's boards, ADP and capsules entries, each with its vendor and window."""
    board_sources = {
        b.stored.source: {"artifact": "boards", "vendor": f"Commish projections, model {b.stored.model_version}",
                          "feed": b.stored.source, "window": season.window(b.stored.as_of, b.stored.as_of)}
        for b in boards
    }  # fmt: skip
    adp_sources = [
        {"artifact": "adp", "vendor": c.feed.vendor, "feed": c.feed.source,
         "window": season.window(c.captured_at, c.captured_at)}
        for c in captures.values()
        if c.captured_at is not None
    ]  # fmt: skip
    written = [c for c in capsules.values() if c.source == WRITTEN_SOURCE]
    capsule_sources = (
        [{"artifact": "capsules", "vendor": f"written by {', '.join(sorted({c.model or 'the writer' for c in written}))}",
          "feed": "player_capsules", "window": season.window(min(c.generated_at for c in written), max(c.generated_at for c in written))}]
        if written else []
    )  # fmt: skip
    return [*board_sources.values(), *adp_sources, *capsule_sources]


def assemble(
    conn: Connection,
    as_of: datetime,
    frozen_by: FrozenBy,
    ros: RosSetup | None = None,
    rollover_at: datetime | None = None,
) -> Assembled:
    """Every artifact at `as_of`; with the model's inputs (`ros`), the in-season boards once the switch
    week is reached (`nightly.build.ros`), else the preseason boards. The week's roll-over is judged at
    `rollover_at`, the week-reads step's instant, so the page's promise is the step's verdict (Lane 265,
    L5); at `as_of` without one."""
    captures, formats, dropped = _captures(conn, as_of)
    boards = _boards(conn, as_of, formats)
    adp_by_format = {f.id: season.format_adp(f, captures) for f in formats}
    # The season so far for every board player, and in season for every player with a line this
    # season (the judged universe ranks him whether or not the preseason board did).
    extra = () if ros is None else tuple(p.provider_id for p in ros.season_players)
    on_boards = {e.row.player_id for b in boards for e in b.entries}
    context = season_context(conn, PRODUCT_SEASON, sorted({*on_boards, *extra}), as_of, prior=True)
    # Every row names the page's club (Lane 120), so the board, the page and the rest of season agree.
    boards = tuple(with_page_clubs(board, context.clubs) for board in boards)
    games = schedule_read.slates_by_club(conn, PRODUCT_SEASON)
    states = _states(conn, games, as_of)
    rest = None if ros is None else ros_boards(boards, context, as_of, states, ros)
    if rest is not None:
        boards = rest.boards
    # The pages and the search index in the order of the boards the run prints, then the kickers and
    # defenses: each board's those its own drafts take, in their order; the index's every one any board
    # carries, the page format's order first.
    # Every face is our copy's address (Lane 241), never the provider's image.
    faced = faced_ids(conn, PRODUCT_SEASON)
    people = our_faces(pages.identities(boards), PRODUCT_SEASON, faced)
    roster = market_players(conn)
    orders = {f.id: market_order(roster, adp_by_format[f.id]) for f in formats}
    carried = {e.player.player_id: e for f in (PAGE_FORMAT.id, *orders) for e in orders[f]}
    market = our_faces(pages.market_identities(people, tuple(carried.values())), PRODUCT_SEASON, faced)
    by_slug = {p.id: p for p in (*people, *market)}
    universe_ids = sorted({e.row.universe_id for b in boards for e in b.entries})
    capsules = stored_capsules_for(conn, universe_ids)
    ids = sorted({(e.row.player_id, e.row.universe_id) for b in boards for e in b.entries})
    run_board_from = rest.basis.from_week if rest is not None and rest.basis is not None else None
    served = _served_week(conn, as_of, games, states, run_board_from, ids, rollover_at or as_of)
    inputs = pages.page_inputs(boards, adp_by_format, capsules, context, served)
    players = [pages.player_json(who, inputs) for who in people]
    schedule, clubs, schedule_source, clubs_source = _schedule(conn, as_of, games, states)
    record, record_source = _record(conn, as_of, frozen_by)
    files: dict[str, Any] = {
        f"boards/{b.format.id}.json": pages.board_json(b, by_slug, adp_by_format[b.format.id], orders[b.format.id])
        for b in boards
    }
    files |= {f"players/{page['id']}.json": page for page in players}
    files |= {
        "adp.json": season.adp_json(formats, captures),
        "record.json": record,
        "index.json": pages.index_json(people, {page["id"]: page for page in players}, market),
        "clubs.json": clubs,
        "schedule.json": schedule,
    }
    feeds = _feed_sources(boards, captures, capsules)
    if rest is not None and rest.basis is not None:
        feeds.insert(0, _rest_source(rest.basis))
    # The sources block's order: boards, ADP, schedule, clubs, the record, capsules.
    capsule_feeds = [f for f in feeds if f["artifact"] == "capsules"]
    sources = (
        *(f for f in feeds if f["artifact"] != "capsules"),
        schedule_source,
        clubs_source,
        *([record_source] if record_source else []),
        *capsule_feeds,
    )
    model_versions = tuple(sorted({b.stored.model_version or "unrecorded" for b in boards}))
    if rest is not None and rest.basis is not None:
        model_versions = (*model_versions, ROS_MODEL)
    return Assembled(
        files,
        boards,
        people,
        market,
        sources,
        model_versions,
        formats,
        dropped,
        None if rest is None else rest.basis,
        NO_REST_INPUTS if rest is None else rest.status,
        frozenset() if rest is None else rest.in_season,
    )


def _served_week(  # noqa: PLR0913, PLR0917 - the reads' parts
    conn: Connection,
    as_of: datetime,
    games: Mapping[str, Sequence[Game]],
    states: Mapping[ClubWeek, GameState],
    run_board_from: int | None,
    ids: Sequence[tuple[str, str]],
    judged_at: datetime,
) -> pages.ServedWeek:
    """The week reads the pages serve (Lane 72): the board week's (the run's rest-of-season window's first
    week, `run_board_from`, else the first week with a game still to play by the run's game state, as the site's `board_week`), against each
    player's status on the status read `designations.json` is written from (`designations.read_statuses`). `ids` is each page's (board id, universe id).
    While the week's roll-over has not run at `judged_at`, the nightly that writes its reads (`reads_due_at`)."""
    pending = schedule_read.weeks_left(states)
    week = run_board_from if run_board_from is not None else (pending[0] if pending else None)
    if week is None:
        return pages.ServedWeek({}, {}, as_of)
    read = read_statuses(conn, as_of, now=as_of)
    statuses = {board_id: status_word(read, board_id) for board_id, _ in ids}
    reads = served_week_reads(conn, PRODUCT_SEASON, week, sorted({uid for _, uid in ids}))
    projections = served_projections(published_projections(conn, PRODUCT_SEASON, [week], as_of), week)
    due = reads_due_at(conn, week, games, run_board_from, judged_at)
    return pages.ServedWeek(reads, statuses, as_of, projections, due)


def reads_due_at(
    conn: Connection, week: int, games: Mapping[str, Sequence[Game]], run_board_from: int | None, at: datetime
) -> ReadsDue | None:
    """Week `week`'s roll-over judged at `at` on the store as it stood then (`rollover`, the step's rule), and
    while it has not run, the nightly that writes its reads (`rollover.reads_due`)."""
    held = projection_held(conn, PRODUCT_SEASON, week, at)
    state = rollover(week, games, _states(conn, games, at), published_from_week(conn, PRODUCT_SEASON, at), held, at)
    return reads_due(state, games, held, run_board_from, at)


def served_projections(read: Mapping[tuple[str, int], PublishedProjection], week: int) -> Mapping[str, float] | None:
    """The board week's published projection by board id as the card prints it; None with no snapshot for
    the week, so the reads are not judged by one (Lane 66v)."""
    out = {player_id: p.points for (player_id, of), p in read.items() if of == week}
    return out or None


def _rest_source(basis: RosBasis) -> Json:
    """The in-season boards' feed: the judged model's artifact, applied at the run's instant."""
    return {
        "artifact": "boards",
        "vendor": f"Commish rest-of-season model {ROS_MODEL}, from week {basis.from_week}",
        "feed": ROS_FEED,
        "window": season.window(basis.refreshed_at, basis.refreshed_at),
    }
