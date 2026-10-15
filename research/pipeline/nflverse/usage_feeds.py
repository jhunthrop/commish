"""THE CHARTED FEEDS, FROM RELEASE TO STORE: FTN's charting, Next Gen Stats and PFR's advanced stats.

Each feed is its own `source` in `research.player_week_observations`, one row per player per week
per metric, written through the observation writer's conflict rule, so a re-run of a landed week
writes nothing. Every read streams through the nflverse client with the feed's byte cap
(`config.ByteCaps`). A season nflverse has not published raises the client's `not_found` (FTN,
PFR) or comes back `published=False` (Next Gen Stats, whose one file holds every season); the
weekly pass reports either as skipped. A file with a header and no rows is refused: no feed is
ever ingested empty.
"""

from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime

from sqlalchemy import Connection, text

from research.errors import SchemaDriftError
from research.pipeline.nflverse.client import NflverseClient, NflverseError
from research.pipeline.nflverse.config import FTN_PUBLICATION_LAG_HOURS, ByteCaps, Releases
from research.pipeline.nflverse.ftn import (
    FTN_COLUMNS,
    PBP_JOIN_COLUMNS,
    ChartedPlayers,
    ChartIndex,
    ftn_observations,
)
from research.pipeline.nflverse.ngs import NGS_KINDS, NgsWeeks
from research.pipeline.nflverse.pfr_advstats import PFR_KINDS, PfrPlayer, PfrWeeks
from research.pipeline.nflverse.players import projected_position
from research.pipeline.nflverse.schedule import kickoff_as_of
from research.pipeline.nflverse.universe_reads import all_positions
from research.pipeline.observations import record_observations

_NAMED_UNKNOWNS = 10


@dataclass(frozen=True, slots=True)
class FeedReport:
    """One feed's season: what was read, what was new, whose rows had no home, and per-file lines."""

    feed: str
    season: int
    rows_read: int
    observations_written: int
    player_weeks: int
    unknown: tuple[str, ...]
    detail: tuple[str, ...]
    published: bool = True

    def summary(self) -> str:
        return (
            f"{self.observations_written} new observations for {self.season} ({self.rows_read} rows read, "
            f"{self.player_weeks} player-weeks, {len(self.unknown)} ids we could not place on a projected player)"
        )


def _refuse_empty(rows: int, asset: str) -> None:
    if rows == 0:
        raise NflverseError("malformed", asset, f"nflverse asset {asset} has a header and no rows; refused.")


def _capped(client: NflverseClient, max_bytes: int) -> NflverseClient:
    return replace(client, max_bytes=max_bytes)


def _named(ids: set[str] | dict[str, str]) -> str:
    listed = sorted(ids.items() if isinstance(ids, dict) else ((i, "") for i in ids))
    shown = ", ".join(f"{key} {name}".strip() for key, name in listed[:_NAMED_UNKNOWNS])
    more = "" if len(listed) <= _NAMED_UNKNOWNS else f" and {len(listed) - _NAMED_UNKNOWNS} more"
    return f"{shown}{more}" if listed else "none"


def ingest_ftn_charting(conn: Connection, client: NflverseClient, season: int) -> FeedReport:
    """FTN's charted plays for `season`, joined to play-by-play and counted per player per week."""
    index = ChartIndex()
    ftn = f"ftn_charting_{season}.csv"
    charted = _capped(client, ByteCaps.FTN_CHARTING).stream_csv(Releases.FTN_CHARTING, ftn, FTN_COLUMNS, index.add)
    _refuse_empty(charted, f"{Releases.FTN_CHARTING}/{ftn}")
    players = ChartedPlayers(index)
    pbp = f"play_by_play_{season}.csv.gz"
    _capped(client, ByteCaps.PLAY_BY_PLAY).stream_csv(Releases.PBP, pbp, PBP_JOIN_COLUMNS, players.add)
    tallies = players.tallies()
    known = frozenset(all_positions(conn))
    built = ftn_observations(tallies, lambda day: kickoff_as_of(day, FTN_PUBLICATION_LAG_HOURS), known)
    written = record_observations(conn, built.observations)
    detail = (
        f"{charted} charted plays, {players.joined} dropbacks and targets joined to play-by-play, "
        f"{players.uncharted} with no charting row",
    )
    weeks = len({(t.week, t.player_id) for t in tallies if t.player_id in known})
    return FeedReport("ftn-charting", season, charted, written, weeks, tuple(built.unknown_players), detail)


def ingest_next_gen_stats(
    conn: Connection, client: NflverseClient, season: int, week_as_of: Mapping[float, datetime]
) -> FeedReport:
    """Next Gen Stats' weekly rows of `season`, every kind; `published` is False until a kind has one."""

    def stamp(week: int) -> datetime:
        stamped = week_as_of.get(float(week))
        if stamped is None:
            raise SchemaDriftError(f"Next Gen Stats has week {week} of {season}, which the schedule does not hold.")
        return stamped

    known = frozenset(all_positions(conn))
    capped = _capped(client, ByteCaps.NEXTGEN_STATS)
    written = rows = 0
    unknown: set[str] = set()
    detail: list[str] = []
    player_weeks: set[tuple[int, str]] = set()
    for kind in NGS_KINDS:
        weeks = NgsWeeks(kind, season, stamp, known)
        read = capped.stream_csv(Releases.NEXTGEN_STATS, kind.file, kind.columns, weeks.add)
        _refuse_empty(read, f"{Releases.NEXTGEN_STATS}/{kind.file}")
        new = record_observations(conn, weeks.observations)
        written, rows, unknown = written + new, rows + weeks.season_rows, unknown | weeks.unknown
        player_weeks |= {(o.week, o.player_id) for o in weeks.observations}
        detail.append(
            f"{kind.kind}: {weeks.season_rows} rows of {season} ({weeks.summary_rows} season summaries passed over), "
            f"{new} new observations"
        )
    published = rows > 0
    return FeedReport("next-gen-stats", season, rows, written, len(player_weeks), tuple(sorted(unknown)), tuple(detail), published)  # fmt: skip


def pfr_players(conn: Connection) -> dict[str, PfrPlayer]:
    """Every stored player with a PFR id, by that id, and whether the engine projects his position."""
    rows = conn.execute(text("select id, pfr_id, position from research.players where pfr_id is not null"))
    return {str(r.pfr_id): PfrPlayer(str(r.id), projected_position(str(r.position)) is not None) for r in rows}


def ingest_pfr_advstats(conn: Connection, client: NflverseClient, season: int) -> FeedReport:
    """PFR's weekly advanced stats of `season` (passing, receiving, rushing), mapped through `pfr_id`."""
    by_pfr_id = pfr_players(conn)
    capped = _capped(client, ByteCaps.PFR_ADVSTATS)
    written = rows = 0
    unmapped: dict[str, str] = {}
    detail: list[str] = []
    player_weeks: set[tuple[int, str]] = set()
    for kind in PFR_KINDS:
        weeks = PfrWeeks(kind, by_pfr_id)
        file = kind.file(season)
        read = capped.stream_csv(Releases.PFR_ADVSTATS, file, kind.columns, weeks.add)
        _refuse_empty(read, f"{Releases.PFR_ADVSTATS}/{file}")
        new = record_observations(conn, weeks.observations)
        written, rows = written + new, rows + weeks.rows
        unmapped |= weeks.unmapped
        player_weeks |= {(o.week, o.player_id) for o in weeks.observations}
        detail.append(
            f"{kind.kind}: {weeks.rows} rows, {len(weeks.mapped)} players mapped, {len(weeks.unmapped)} PFR ids "
            f"with no mapping ({_named(weeks.unmapped)}), {len(weeks.not_projected)} at positions the engine does "
            f"not project, {new} new observations"
        )
    return FeedReport("pfr-advstats", season, rows, written, len(player_weeks), tuple(sorted(unmapped)), tuple(detail))
