# Stadiums, 2016-2026

`stadiums.csv` is every venue nflverse's game table (`nflverse/nfldata` `games.csv`) names for a game
of 2016 through 2026, one row per nflverse `stadium_id` (47 rows). It is the reviewed input to
`python -m research.pipeline stadiums`, which validates it against the stored `nflverse_games` and
writes `research.stadiums`. Nothing reads this file at runtime: the API and the forecast job read the
table.

## Provenance and license

- **Coordinates and country** come from Wikidata (public domain, CC0), read once on 2026-10-16 with
  `wbgetentities` (`props=labels|claims`). The trimmed answer (each item's English label, `P625`
  coordinate, `P17` country and `P131` place) is `wikidata-2026-10-16.json`, with the `stadium_id` to
  item map that was chosen by hand from `wbsearchentities` results for each venue's name.
- **Names, aliases, clubs and surface** come from the game table itself (the recorded file of
  2026-10-12): `aliases` is every name the table gives the venue, `name` the one its newest season
  uses, `clubs` the nflverse codes that played at least four home games there in a season, `surface`
  the newest recorded surface.
- **Roof type, state and time zone** are reviewed facts about each building.

## Columns

| Column | Meaning |
| --- | --- |
| `stadium_id` | nflverse's venue id, the table's key. |
| `name` | The venue's current name. |
| `clubs` | The clubs whose home it was, `|`-separated, in nflverse's spelling of the era. Empty for a venue that hosted only neutral-site games. |
| `aliases` | Every name the game table uses for it, `|`-separated. A game whose `stadium` is not among them is caught (below). |
| `latitude`, `longitude` | Wikidata's `P625`, decimal degrees. |
| `roof_type` | `outdoors`, `dome` or `retractable`: the build, never a game day's state. |
| `surface` | The newest surface the game table records there. |
| `country` | ISO 3166-1 alpha-2. A venue outside `US` is international. |
| `region` | The US state's postal code, empty abroad. |
| `time_zone` | The venue's IANA zone. |
| `wikidata_id` | The Wikidata item the coordinates came from. |

## Reviewed calls

- `BUF00` takes the new Highmark Stadium's item (opened 2026). The old stadium stood a few hundred
  metres away, which no forecast cell tells apart.
- `GER00` and `MUN01` are both the Allianz Arena in Munich (nflverse gave it a second id in 2026).
- `HOU00`'s name is NRG Stadium: nflverse's 2026 rows call it Reliant Stadium, its name until 2014.
- Retractable roofs: Mercedes-Benz Stadium, AT&T Stadium, NRG Stadium, Lucas Oil Stadium, State
  Farm Stadium, the Bernabeu and Deutsche Bank Park. Domes: the Georgia Dome, Ford Field, SoFi
  Stadium, U.S. Bank Stadium, the Superdome and Allegiant Stadium. The rest are open to the sky.

## What the ingest checks

It refuses the whole file on any of these, writing nothing:

1. a venue of a stored 2016-2026 game with no row;
2. coordinates outside the venue's state (US) or country, a generous box per place;
3. a time zone that does not exist, or a US venue outside an `America/` zone;
4. at a domestic venue, a played game whose recorded roof the roof type does not allow (`dome` only
   in a dome, `open` or `closed` under a retractable roof, `outdoors` outside).

It prints, and does not refuse on, these notes (as of the recorded file):

- `FRA00`, `MEL00` and `RIO00`: the game table's roofs abroad disagree with the building (a cricket
  ground recorded as a dome). The forecast job takes no forecast abroad, so nothing reads them.
- `JAX00` holds the 2026 week 5 London game under Jacksonville's id with the name Tottenham Hotspur
  Stadium. Since that name is none of `JAX00`'s aliases, the forecast job treats the venue as unknown
  and takes no forecast for it.
- A surface the game table has changed since this file was built.

## Rebuilding

When nflverse adds a venue the ingest refuses with its id. Add the row by the same method: the
Wikidata item for the venue, its `P625` and `P17`, the game table's names and surface, and the
reviewed roof, state and zone. Then re-run the ingest.
