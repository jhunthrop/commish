"""THE GAME'S FIGURES FROM THE HOURLY CAPTURE (Lane 66a; the round 4 preregistration, section 2.5).

Each `tank01_betting_odds` snapshot in `capture_snapshots` is kept as it is; this reads it into the
`tank01_lines` team-week source: per game, the median across the books in the snapshot of the
spread and the total, the spread in the store's sign (positive when the club is favoured; Tank01's
`homeTeamSpread` "-3.5" is the home club favoured by 3.5), and each club's implied points by the one
derivation (`game_figures.implied_points`). Four metrics per club-week: `point_spread`,
`game_total`, `implied_team_total` and `books` (how many books the median took).

A BOOK IS READ OR LEFT OUT, NEVER GUESSED. A quote whose spreads do not parse as signed numbers
(the capture holds a book quoting "--7.5" and "+-7.5"), whose two spreads are not opposite, or
whose over and under totals differ is left out by name; a game with no book left writes nothing.
A snapshot whose shape is not the provider's (a game that is not an object, a key that is not its
game id) is refused, never read as a quiet week.

THE STAMP. The backfill stamps each snapshot's rows at its capture. The hourly pass stamps the
newest snapshot's rows at the pass, whether its payload was new or unchanged: an unchanged payload
writes no snapshot, but the figures were read then, and a live read takes the newest figure at or
before the game's instant (section 5, item 2).
"""

import re
import statistics
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, select

from research.db.schema import CAPTURE_SNAPSHOTS, PROVIDER_GAMES
from research.errors import SchemaDriftError
from research.pipeline.game_figures import implied_points
from research.pipeline.nflverse.team_codes import source_team_code
from research.pipeline.observations import TeamWeekObservation, record_team_observations
from research.pipeline.tank01.capture import BETTING_ODDS_SOURCE, CaptureResult

LINES_SOURCE: Final = "tank01_lines"


_SPREAD: Final = re.compile(r"^[+-]?\d+(\.\d+)?$")
_LEVEL_GAME: Final = "PK"
# The game object's own fields; every other field holding an object is one book's quote.
_GAME_FIELDS: Final = ("gameID", "homeTeam", "awayTeam")


class LinesMetric:
    POINT_SPREAD = "point_spread"
    GAME_TOTAL = "game_total"
    IMPLIED_TEAM_TOTAL = "implied_team_total"
    BOOKS = "books"


@dataclass(frozen=True)
class GameLine:
    """One game's consensus in one snapshot, the clubs in Tank01's codes."""

    game_id: str
    home: str
    away: str
    home_spread: float
    total: float
    books: int
    rejected: tuple[str, ...]


@dataclass(frozen=True)
class GamePlace:
    """Where the provider's schedule puts a game: its season and week, and its clubs."""

    season: int
    week: int
    home: str
    away: str


def parse_spread(raw: object) -> float | None:
    """A quoted spread as a number, "PK" as a level game, None for anything else."""
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if text.upper() == _LEVEL_GAME:
        return 0.0
    return float(text) if _SPREAD.fullmatch(text) else None


def _total(raw: object) -> float | None:
    if not isinstance(raw, str) or _SPREAD.fullmatch(raw.strip()) is None:
        return None
    value = float(raw)
    return value if value > 0 else None


def _quote(book: Mapping[str, object]) -> tuple[float, float] | None:
    """A book's home spread in the store's sign and its total, or None when it does not read."""
    home, away = parse_spread(book.get("homeTeamSpread")), parse_spread(book.get("awayTeamSpread"))
    over, under = _total(book.get("totalOver")), _total(book.get("totalUnder"))
    if home is None or away is None or home != -away or over is None or over != under:
        return None
    return -home, over


def _game(game_id: str, game: object) -> GameLine | None:
    if not isinstance(game, dict):
        raise SchemaDriftError(f"Tank01 odds for {game_id} are not an object; the capture's shape changed.")
    fields = [game.get(name) for name in _GAME_FIELDS]
    if not all(isinstance(value, str) and value for value in fields) or game["gameID"] != game_id:
        raise SchemaDriftError(f"Tank01 odds for {game_id} carry no matching gameID, homeTeam and awayTeam.")
    quotes: list[tuple[float, float]] = []
    rejected: list[str] = []
    for name in sorted(key for key, value in game.items() if isinstance(value, dict)):
        quote = _quote(game[name])
        if quote is None:
            rejected.append(name)
        else:
            quotes.append(quote)
    if not quotes:
        return None
    return GameLine(
        game_id=game_id,
        home=str(game["homeTeam"]),
        away=str(game["awayTeam"]),
        home_spread=statistics.median(q[0] for q in quotes),
        total=statistics.median(q[1] for q in quotes),
        books=len(quotes),
        rejected=tuple(rejected),
    )


def _bodies(payload: object) -> list[dict[str, object]]:
    """A capture of one date is the provider's body; of several, the list of their bodies."""
    bodies = payload if isinstance(payload, list) else [payload]
    if not all(isinstance(body, dict) for body in bodies):
        raise SchemaDriftError("A Tank01 odds capture is neither a body nor a list of bodies.")
    return [body for body in bodies if isinstance(body, dict)]


def parse_snapshot(payload: object) -> list[GameLine]:
    """Every game in a capture with at least one book that reads."""
    lines: list[GameLine] = []
    for body in _bodies(payload):
        for game_id, game in body.items():
            line = _game(game_id, game)
            if line is not None:
                lines.append(line)
    return lines


def _club_rows(place: GamePlace, line: GameLine, home: bool, at: datetime) -> list[TeamWeekObservation]:
    """One club's four rows: its own side of the spread, the game's total and its implied points."""
    club = source_team_code(line.home if home else line.away)
    spread = line.home_spread if home else -line.home_spread
    values = (
        (LinesMetric.POINT_SPREAD, spread),
        (LinesMetric.GAME_TOTAL, line.total),
        (LinesMetric.IMPLIED_TEAM_TOTAL, implied_points(line.total, spread)),
        (LinesMetric.BOOKS, float(line.books)),
    )
    return [TeamWeekObservation(place.season, place.week, club, LINES_SOURCE, m, v, at) for m, v in values]


def line_observations(
    lines: Iterable[GameLine], places: Mapping[str, GamePlace], at: datetime
) -> tuple[list[TeamWeekObservation], list[str]]:
    """Both clubs' rows for each game the schedule places with the same clubs, and the rest named."""
    rows: list[TeamWeekObservation] = []
    unplaced: list[str] = []
    for line in lines:
        place = places.get(line.game_id)
        if place is None:
            unplaced.append(f"{line.game_id} (not in the provider schedule)")
            continue
        if (place.home, place.away) != (line.home, line.away):
            unplaced.append(f"{line.game_id} (the schedule has {place.home} at home to {place.away})")
            continue
        rows.extend(_club_rows(place, line, True, at))
        rows.extend(_club_rows(place, line, False, at))
    return rows, unplaced


def game_places(conn: Connection) -> dict[str, GamePlace]:
    """The provider schedule's games by their Tank01 id (the store holds one season)."""
    table = PROVIDER_GAMES
    query = select(table.c.game_id, table.c.season, table.c.week, table.c.home_team, table.c.away_team)
    return {r.game_id: GamePlace(r.season, r.week, r.home_team, r.away_team) for r in conn.execute(query)}


@dataclass(frozen=True)
class LinesResult:
    snapshots: int
    games: int
    written: int
    unplaced: tuple[str, ...]
    rejected_books: int

    def line(self) -> str:
        unplaced = f", unplaced: {'; '.join(sorted(set(self.unplaced)))}" if self.unplaced else ""
        return (
            f"{self.snapshots} snapshots, {self.games} game figures, {self.written} rows written, "
            f"{self.rejected_books} book quotes left out{unplaced}"
        )


def _record(
    conn: Connection, snapshots: Sequence[tuple[object, datetime]], places: Mapping[str, GamePlace]
) -> LinesResult:
    rows: list[TeamWeekObservation] = []
    unplaced: list[str] = []
    games = rejected = 0
    for payload, at in snapshots:
        lines = parse_snapshot(payload)
        games += len(lines)
        rejected += sum(len(line.rejected) for line in lines)
        placed, missed = line_observations(lines, places, at)
        rows.extend(placed)
        unplaced.extend(missed)
    written = record_team_observations(conn, rows)
    return LinesResult(len(snapshots), games, written, tuple(unplaced), rejected)


def backfill_lines(conn: Connection) -> LinesResult:
    """Every stored odds capture, each stamped at its capture. Idempotent: a re-run writes nothing."""
    table = CAPTURE_SNAPSHOTS
    query = (
        select(table.c.payload, table.c.captured_at)
        .where(table.c.source == BETTING_ODDS_SOURCE)
        .order_by(table.c.captured_at, table.c.id)
    )
    snapshots = [(r.payload, r.captured_at) for r in conn.execute(query)]
    return _record(conn, snapshots, game_places(conn))


def lines_after_harvest(conn: Connection, harvest: CaptureResult, checked_at: datetime) -> LinesResult | None:
    """The pass's figures when its odds feed was read (captured or unchanged), None otherwise."""
    read = any(f.source == BETTING_ODDS_SOURCE and f.status in ("captured", "unchanged") for f in harvest.feeds)
    return record_checked_lines(conn, checked_at) if read else None


def record_checked_lines(conn: Connection, checked_at: datetime) -> LinesResult:
    """The newest odds capture, stamped at the pass that read it (captured or unchanged)."""
    table = CAPTURE_SNAPSHOTS
    query = (
        select(table.c.payload)
        .where(table.c.source == BETTING_ODDS_SOURCE, table.c.captured_at <= checked_at)
        .order_by(table.c.captured_at.desc(), table.c.id.desc())
        .limit(1)
    )
    payload = conn.execute(query).scalar_one_or_none()
    if payload is None:
        return LinesResult(0, 0, 0, (), 0)
    return _record(conn, [(payload, checked_at)], game_places(conn))
