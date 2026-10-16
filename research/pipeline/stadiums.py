"""THE STADIUMS INGEST (Lane 66a; the round 4 preregistration, section 2.5): the reviewed seed into `stadiums`.

`data/stadiums/stadiums.csv` is built once from Wikidata's coordinates (CC0, `wikidata-2026-10-16.json`
beside it, keyed to nflverse's `stadium_id`) and reviewed; its README says how. It is this ingest's
input only, never read at runtime. The ingest VALIDATES before it writes, against `nflverse_games`
(so that table is ingested first), and refuses the whole seed on any problem:

- every venue of a 2016 to 2026 game has a row, the season's own venues named first;
- each venue's coordinates fall inside its US state or its country (a box per place, generous, so a
  flipped sign or a swapped pair is caught and a real stadium never is);
- the time zone is a real zone, an American one for a US venue;
- the roof type matches every recorded roof of a game played there at home (a dome is `dome`, a
  retractable roof `open` or `closed`, an outdoor venue `outdoors`). Abroad the game table's roofs are
  less reliable (a cricket ground recorded as a dome), so there a disagreement is a note, not a problem.

Notes are printed and never refuse: a game whose `stadium` is none of its venue's names (nflverse
files the 2026 London game of week 5 under Jacksonville's venue), so the forecast job takes no
forecast for it, and a surface that moved since the seed was built.
"""

import re
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from types import MappingProxyType
from typing import Final
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import Connection, select, tuple_
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import NFLVERSE_GAMES, STADIUMS
from research.db.schema.venues import HOME_COUNTRY, ROOF_TYPES
from research.errors import SchemaDriftError
from research.pipeline.nflverse.csv import parse_csv
from research.pipeline.nflverse.games import GameRow
from research.season import PRODUCT_SEASON

STADIUMS_CSV_PATH: Final = "data/stadiums/stadiums.csv"
_COLUMNS: Final = (
    "stadium_id",
    "name",
    "clubs",
    "aliases",
    "latitude",
    "longitude",
    "roof_type",
    "surface",
    "country",
    "region",
    "time_zone",
    "wikidata_id",
)
_LIST_SEPARATOR: Final = "|"
_WIKIDATA_ID: Final = re.compile(r"^Q\d+$")
_US_ZONE_PREFIX: Final = "America/"

# The recorded roofs each build allows (`nflverse_games.roof`; an unrecorded roof says nothing).
_RECORDED_ROOFS: Final = MappingProxyType(
    {"dome": frozenset({"dome"}), "retractable": frozenset({"open", "closed"}), "outdoors": frozenset({"outdoors"})}
)

# (south, north, west, east) in degrees: each US state and country a venue of 2016 to 2026 sits in,
# rounded outward so a real venue never falls on an edge.
_BOUNDS: Final = MappingProxyType(
    {
        "AZ": (31.3, 37.0, -114.9, -109.0),
        "CA": (32.5, 42.1, -124.5, -114.1),
        "CO": (36.9, 41.1, -109.1, -102.0),
        "FL": (24.4, 31.1, -87.7, -80.0),
        "GA": (30.3, 35.1, -85.7, -80.8),
        "IL": (36.9, 42.6, -91.6, -87.0),
        "IN": (37.7, 41.8, -88.1, -84.7),
        "LA": (28.9, 33.1, -94.1, -88.8),
        "MA": (41.2, 42.9, -73.6, -69.9),
        "MD": (37.9, 39.8, -79.5, -75.0),
        "MI": (41.6, 48.4, -90.5, -82.1),
        "MN": (43.4, 49.4, -97.3, -89.4),
        "MO": (35.9, 40.7, -95.8, -89.1),
        "NC": (33.8, 36.6, -84.4, -75.4),
        "NJ": (38.9, 41.4, -75.6, -73.8),
        "NV": (35.0, 42.1, -120.1, -114.0),
        "NY": (40.4, 45.1, -79.8, -71.8),
        "OH": (38.4, 42.0, -84.9, -80.5),
        "PA": (39.7, 42.3, -80.6, -74.6),
        "TN": (34.9, 36.7, -90.4, -81.6),
        "TX": (25.8, 36.6, -106.7, -93.5),
        "WA": (45.5, 49.1, -124.9, -116.9),
        "WI": (42.4, 47.1, -92.9, -86.2),
        "AU": (-43.7, -10.6, 113.3, 153.7),
        "BR": (-33.8, 5.3, -74.0, -34.7),
        "DE": (47.2, 55.1, 5.8, 15.1),
        "ES": (35.9, 43.8, -9.4, 4.4),
        "FR": (41.3, 51.1, -5.2, 9.6),
        "GB": (49.9, 60.9, -8.7, 1.8),
        "MX": (14.5, 32.8, -118.5, -86.7),
    }
)


@dataclass(frozen=True)
class StadiumRow:
    stadium_id: str
    name: str
    clubs: tuple[str, ...]
    aliases: tuple[str, ...]
    latitude: float
    longitude: float
    roof_type: str
    surface: str | None
    country: str
    region: str | None
    time_zone: str
    wikidata_id: str

    @property
    def international(self) -> bool:
        return self.country != HOME_COUNTRY


@dataclass(frozen=True)
class GameVenue:
    """What the game table says about where a game was played, as the validation reads it."""

    season: int
    gameday: date
    stadium_id: str
    stadium: str
    roof: str | None
    surface: str | None
    played: bool
    neutral: bool


def _list(raw: str) -> tuple[str, ...]:
    return tuple(item for item in raw.split(_LIST_SEPARATOR) if item)


def _coordinate(raw: str, column: str, stadium_id: str) -> float:
    try:
        return float(raw)
    except ValueError as error:
        raise SchemaDriftError(f"stadiums.csv row {stadium_id} has an unreadable {column} ({raw!r}).") from error


def parse_stadiums_csv(text: str) -> list[StadiumRow]:
    rows = parse_csv(text)
    if rows and tuple(rows[0]) != _COLUMNS:
        raise SchemaDriftError(f"stadiums.csv columns are {', '.join(rows[0])}, not {', '.join(_COLUMNS)}.")
    out = []
    for row in rows:
        sid = row["stadium_id"]
        out.append(
            StadiumRow(
                stadium_id=sid,
                name=row["name"],
                clubs=_list(row["clubs"]),
                aliases=_list(row["aliases"]),
                latitude=_coordinate(row["latitude"], "latitude", sid),
                longitude=_coordinate(row["longitude"], "longitude", sid),
                roof_type=row["roof_type"],
                surface=row["surface"] or None,
                country=row["country"],
                region=row["region"] or None,
                time_zone=row["time_zone"],
                wikidata_id=row["wikidata_id"],
            )
        )
    return out


def game_venues(games: Iterable[GameRow]) -> list[GameVenue]:
    return [
        GameVenue(
            g.season, g.gameday, g.stadium_id, g.stadium, g.roof, g.surface, g.result is not None, g.location != "Home"
        )
        for g in games
    ]


@dataclass(frozen=True)
class Validation:
    problems: list[str]
    notes: list[str]


def _row_problems(row: StadiumRow) -> list[str]:
    sid, problems = row.stadium_id, []
    if row.roof_type not in ROOF_TYPES:
        problems.append(f"{sid} has roof type {row.roof_type!r}, not one of {', '.join(ROOF_TYPES)}")
    if _WIKIDATA_ID.fullmatch(row.wikidata_id) is None or not row.aliases or row.name == "":
        problems.append(f"{sid} lacks a Wikidata id, a name or the game table's names for it")
    place = row.region if not row.international else row.country
    if not row.international and row.region is None:
        problems.append(f"{sid} is in the United States with no state")
    bounds = _BOUNDS.get(place or "")
    if bounds is None:
        problems.append(f"{sid} is in {place}, which has no bounds to check its coordinates against")
    else:
        south, north, west, east = bounds
        if not (south <= row.latitude <= north and west <= row.longitude <= east):
            problems.append(f"{sid} at {row.latitude}, {row.longitude} is outside {place}")
    try:
        ZoneInfo(row.time_zone)
    except (ZoneInfoNotFoundError, ValueError):
        problems.append(f"{sid} has no time zone named {row.time_zone!r}")
    if not row.international and not row.time_zone.startswith(_US_ZONE_PREFIX):
        problems.append(f"{sid} is in the United States with the zone {row.time_zone}")
    return problems


def _coverage_problems(rows: Mapping[str, StadiumRow], venues: Sequence[GameVenue]) -> list[str]:
    seasons_by_venue: dict[str, set[int]] = defaultdict(set)
    for v in venues:
        seasons_by_venue[v.stadium_id].add(v.season)
    missing = sorted(set(seasons_by_venue) - set(rows), key=lambda sid: (-max(seasons_by_venue[sid]), sid))
    return [f"{sid} is a venue of {max(seasons_by_venue[sid])} games with no stadium row" for sid in missing]


def _roof_findings(rows: Mapping[str, StadiumRow], venues: Sequence[GameVenue]) -> tuple[list[str], list[str]]:
    recorded: dict[str, set[str]] = defaultdict(set)
    for v in venues:
        if v.played and v.roof is not None and v.stadium_id in rows:
            recorded[v.stadium_id].add(v.roof)
    problems: list[str] = []
    notes: list[str] = []
    for sid, roofs in sorted(recorded.items()):
        row = rows[sid]
        odd = roofs - _RECORDED_ROOFS.get(row.roof_type, frozenset())
        if odd:
            finding = f"{sid} is {row.roof_type} and its played games record the roof {', '.join(sorted(odd))}"
            (notes if row.international else problems).append(finding)
    return problems, notes


def _name_notes(rows: Mapping[str, StadiumRow], venues: Sequence[GameVenue]) -> list[str]:
    misfiled = sorted(
        {
            (v.stadium_id, v.stadium, v.gameday.isoformat())
            for v in venues
            if v.stadium_id in rows and v.stadium not in rows[v.stadium_id].aliases
        }
    )
    return [
        f"{sid} holds a game of {day} at {name}, none of its names: no forecast is taken for it"
        for sid, name, day in misfiled
    ]


def _surface_notes(rows: Mapping[str, StadiumRow], venues: Sequence[GameVenue]) -> list[str]:
    latest: dict[str, tuple[date, str]] = {}
    for v in venues:
        if (
            v.surface is not None
            and v.stadium_id in rows
            and (v.stadium_id not in latest or v.gameday > latest[v.stadium_id][0])
        ):
            latest[v.stadium_id] = (v.gameday, v.surface)
    return [
        f"{sid} has the surface {rows[sid].surface} and the game table's newest is {surface}"
        for sid, (_, surface) in sorted(latest.items())
        if rows[sid].surface != surface
    ]


def validate_stadiums(seed: Sequence[StadiumRow], venues: Sequence[GameVenue]) -> Validation:
    rows = {row.stadium_id: row for row in seed}
    problems = [f"{sid} appears more than once" for sid in sorted(rows) if sum(r.stadium_id == sid for r in seed) > 1]
    for row in seed:
        problems.extend(_row_problems(row))
    problems.extend(_coverage_problems(rows, venues))
    roof_problems, roof_notes = _roof_findings(rows, venues)
    problems.extend(roof_problems)
    return Validation(problems, [*roof_notes, *_name_notes(rows, venues), *_surface_notes(rows, venues)])


def stored_game_venues(conn: Connection) -> list[GameVenue]:
    table = NFLVERSE_GAMES
    query = select(
        table.c.season,
        table.c.gameday,
        table.c.stadium_id,
        table.c.stadium,
        table.c.roof,
        table.c.surface,
        table.c.result.is_not(None).label("played"),
        (table.c.location != "Home").label("neutral"),
    )
    return [GameVenue(*r) for r in conn.execute(query)]


@dataclass(frozen=True)
class StadiumsReport:
    rows: int
    written: int
    notes: list[str]

    def line(self) -> str:
        notes = "".join(f"\n  note: {note}" for note in self.notes)
        return f"{self.rows} stadiums validated, {self.written} written or updated{notes}"


def _upsert(conn: Connection, seed: Sequence[StadiumRow], read_at: datetime) -> int:
    table = STADIUMS
    names = [c.name for c in table.columns if c.name not in ("stadium_id", "read_at", "ingested_at")]
    values = [{**{name: getattr(row, name) for name in ("stadium_id", *names)}, "read_at": read_at} for row in seed]
    rows = insert(table).values([{**v, "clubs": list(v["clubs"]), "aliases": list(v["aliases"])} for v in values])
    moved = tuple_(*(table.c[n] for n in names)).is_distinct_from(tuple_(*(rows.excluded[n] for n in names)))
    upsert = rows.on_conflict_do_update(
        index_elements=[table.c.stadium_id],
        set_={**{n: rows.excluded[n] for n in names}, "read_at": rows.excluded.read_at},
        where=moved,
    ).returning(table.c.stadium_id)
    return len(conn.execute(upsert).all())


def ingest_stadiums(conn: Connection, csv_path: Path, read_at: datetime) -> StadiumsReport:
    """The reviewed seed, validated against the stored game table, written in one statement."""
    venues = stored_game_venues(conn)
    if not any(v.season == PRODUCT_SEASON for v in venues):
        raise SchemaDriftError(
            f"nflverse_games holds no {PRODUCT_SEASON} game: ingest the game table first (`research.pipeline games`)."
        )
    seed = parse_stadiums_csv(csv_path.read_text(encoding="utf-8"))
    validation = validate_stadiums(seed, venues)
    if validation.problems:
        raise SchemaDriftError("stadiums.csv does not validate: " + "; ".join(validation.problems))
    return StadiumsReport(len(seed), _upsert(conn, seed, read_at), validation.notes)
