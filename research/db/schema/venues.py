"""THE GAME'S PLACE AND ITS FORECAST GRID (revision 0010, Lane 66a): `stadiums` and `nws_grid_points`.

`stadiums` is loaded from the reviewed seed `data/stadiums/stadiums.csv` (Wikidata's coordinates,
CC0, keyed to nflverse's `stadium_id`) by a validating ingest; nothing reads the file at runtime.
`roof_type` is the venue's build (`outdoors`, `dome`, `retractable`); whether a retractable roof
was open on a game day is the game table's `roof`, never this. `aliases` holds every name the
nflverse game table gives the venue, so a game whose `stadium` names another place is caught.

`nws_grid_points` caches the National Weather Service's `/points` answer per stadium and season:
the grid office and cell move rarely, so the forecast job reads `/points` once a season.
"""

from typing import Final

from sqlalchemy import ARRAY, Boolean, CheckConstraint, Column, DateTime, Double, Integer, Table, Text

from research.db.schema._base import METADATA, one_of, recorded_at

ROOF_TYPES: Final = ("outdoors", "dome", "retractable")
HOME_COUNTRY: Final = "US"

STADIUMS: Final = Table(
    "stadiums",
    METADATA,
    Column("stadium_id", Text, primary_key=True),
    Column("name", Text, nullable=False),
    Column("clubs", ARRAY(Text), nullable=False),
    Column("aliases", ARRAY(Text), nullable=False),
    Column("latitude", Double(53), nullable=False),
    Column("longitude", Double(53), nullable=False),
    Column("roof_type", Text, nullable=False),
    Column("surface", Text),
    Column("country", Text, nullable=False),
    # The US state's postal code, NULL outside the United States.
    Column("region", Text),
    Column("time_zone", Text, nullable=False),
    Column("international", Boolean, nullable=False),
    Column("wikidata_id", Text, nullable=False),
    # The ingest pass that last wrote this row's values.
    Column("read_at", DateTime(True), nullable=False),
    recorded_at(),
    one_of("roof_type", ROOF_TYPES, "stadiums_roof_type_ck"),
    CheckConstraint("latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180", name="stadiums_coordinates_ck"),
    CheckConstraint(f"international = (country <> '{HOME_COUNTRY}')", name="stadiums_international_ck"),
    CheckConstraint(f"(region IS NULL) = (country <> '{HOME_COUNTRY}')", name="stadiums_region_ck"),
)

NWS_GRID_POINTS: Final = Table(
    "nws_grid_points",
    METADATA,
    Column("stadium_id", Text, primary_key=True),
    Column("season", Integer, primary_key=True),
    Column("office", Text, nullable=False),
    Column("grid_x", Integer, nullable=False),
    Column("grid_y", Integer, nullable=False),
    Column("grid_url", Text, nullable=False),
    Column("time_zone", Text, nullable=False),
    Column("read_at", DateTime(True), nullable=False),
)
