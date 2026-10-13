"""THE HISTORICAL PLAYER UNIVERSE (`src/projections/nflverse/players.ts`, `universe.ts`).

Everyone who has ever played, keyed on the NFL's gsis id, with Pro Football Reference's id (the
only way into the snap-count file) and ESPN's (the only way to the provider roster). Identity is
an ID join everywhere downstream, never a name join, and nothing here drops a row in silence: an
unresolved reference comes back named and counted.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Final, Literal

from sqlalchemy import Connection, text
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import PLAYERS
from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_is_integer, js_number, js_trim
from research.pipeline.nflverse.csv import CsvRow

Position = Literal["QB", "RB", "WR", "TE", "K", "DEF"]
PlayerIdKind = Literal["gsis", "pfr"]

# Eight columns a row; the TypeScript writer chunks the ~25,000-person universe at 2,000.
_CHUNK_ROWS = 2_000


@dataclass(frozen=True)
class NflPlayer:
    id: str
    pfr_id: str | None
    espn_id: str | None
    name: str
    position: str
    latest_team: str | None
    rookie_season: int | None
    last_season: int | None


@dataclass(frozen=True)
class PlayerRef:
    kind: PlayerIdKind
    id: str
    name: str


@dataclass(frozen=True)
class UnresolvedRef:
    kind: PlayerIdKind
    id: str
    name: str
    occurrences: int


@dataclass(frozen=True)
class UniverseResolution:
    resolved: Mapping[str, str]
    unresolved: Sequence[UnresolvedRef]
    resolution_rate: float | None


# The `seasonOrNull` floor: anything at or below is a placeholder, not a season.
_NOT_A_SEASON_BEFORE: Final = 1900


def _text(row: CsvRow, column: str) -> str | None:
    raw = row.get(column)
    if raw is None:
        return None
    trimmed = js_trim(raw)
    return None if trimmed == "" else trimmed


def _season(row: CsvRow, column: str) -> int | None:
    raw = _text(row, column)
    if raw is None:
        return None
    value = js_number(raw)
    # 0 appears for players with no recorded season, and it is not a year.
    return int(value) if js_is_integer(value) and value > _NOT_A_SEASON_BEFORE else None


def map_nfl_players(rows: Sequence[CsvRow]) -> list[NflPlayer]:
    """`mapNflPlayers`: throws on a row with no gsis id, display name or position."""
    players: list[NflPlayer] = []
    for row in rows:
        player_id = _text(row, "gsis_id")
        if player_id is None:
            unnamed = _text(row, "display_name") or "unnamed"
            raise SchemaDriftError(
                f'An nflverse players row has no gsis_id ("{unnamed}"); the universe is keyed on it.'
            )
        name = _text(row, "display_name")
        position = _text(row, "position")
        if name is None or position is None:
            raise SchemaDriftError(
                f"nflverse player {player_id} has no display_name or position; the players release schema has moved."
            )
        players.append(
            NflPlayer(
                id=player_id,
                pfr_id=_text(row, "pfr_id"),
                espn_id=_text(row, "espn_id"),
                name=name,
                position=position,
                latest_team=_text(row, "latest_team"),
                rookie_season=_season(row, "rookie_season"),
                last_season=_season(row, "last_season"),
            )
        )
    return players


def projected_position(nflverse_position: str) -> Position | None:
    """`projectedPosition`: the five positions this engine projects, FB and HB narrowed to RB."""
    match nflverse_position:
        case "QB":
            return "QB"
        case "RB" | "FB" | "HB":
            return "RB"
        case "WR":
            return "WR"
        case "TE":
            return "TE"
        case "K":
            return "K"
        case _:
            return None


class PlayerUniverse:
    """`buildPlayerUniverse`: lookups by gsis and pfr id, refusing a duplicated id of either kind."""

    def __init__(self, players: Sequence[NflPlayer]) -> None:
        by_gsis: dict[str, NflPlayer] = {}
        by_pfr: dict[str, NflPlayer] = {}
        for player in players:
            if player.id in by_gsis:
                raise SchemaDriftError(
                    f"The nflverse players release lists gsis id {player.id} twice; the universe cannot be keyed on it."
                )
            by_gsis[player.id] = player
            if player.pfr_id is None:
                continue
            claimed = by_pfr.get(player.pfr_id)
            if claimed is not None:
                raise SchemaDriftError(
                    f"nflverse pfr id {player.pfr_id} is claimed by both {claimed.name} ({claimed.id}) "
                    f"and {player.name} ({player.id})."
                )
            by_pfr[player.pfr_id] = player
        self._by_gsis = by_gsis
        self._by_pfr = by_pfr

    def by_gsis_id(self, player_id: str) -> NflPlayer | None:
        return self._by_gsis.get(player_id)

    def by_pfr_id(self, pfr_id: str) -> NflPlayer | None:
        return self._by_pfr.get(pfr_id)

    def _lookup(self, ref: PlayerRef) -> NflPlayer | None:
        return self._by_gsis.get(ref.id) if ref.kind == "gsis" else self._by_pfr.get(ref.id)

    def resolve_all(self, refs: Sequence[PlayerRef]) -> UniverseResolution:
        resolved: dict[str, str] = {}
        unresolved: dict[str, UnresolvedRef] = {}
        for ref in refs:
            if ref.id in resolved:
                continue
            already = unresolved.get(ref.id)
            if already is not None:
                unresolved[ref.id] = replace(already, occurrences=already.occurrences + 1)
                continue
            player = self._lookup(ref)
            if player is None:
                unresolved[ref.id] = UnresolvedRef(kind=ref.kind, id=ref.id, name=ref.name, occurrences=1)
            else:
                resolved[ref.id] = player.id
        distinct = len(resolved) + len(unresolved)
        rate = None if distinct == 0 else len(resolved) / distinct
        return UniverseResolution(resolved=resolved, unresolved=list(unresolved.values()), resolution_rate=rate)


def is_projected_candidate(universe: PlayerUniverse, ref: PlayerRef, file_position: str | None) -> bool:
    """`isProjectedCandidate`: the universe's position wherever it knows the man, the file's otherwise."""
    known = universe.by_gsis_id(ref.id) if ref.kind == "gsis" else universe.by_pfr_id(ref.id)
    position = known.position if known is not None else (js_trim(file_position) if file_position is not None else "")
    return projected_position(position) is not None


_SECONDARY_IDS = (("pfr_id", "pfr_id"), ("espn_id", "espn_id"))


def release_moved_ids(conn: Connection, players: Sequence[NflPlayer]) -> None:
    """`releaseMovedIds`: the release owns the secondary ids.

    `pfr_id` and `espn_id` are unique, and nflverse does move them (on 2026-09-23 it gave two ESPN
    ids held by legacy rows to two 2026 rookies, and the upsert, conflicting on `id` only, was
    refused by the unique index until this existed). Any row holding a secondary id the release
    now gives to a different `id` gives it up first; the row itself stays.
    """
    for column, attribute in _SECONDARY_IDS:
        pairs = [(p.id, getattr(p, attribute)) for p in players if getattr(p, attribute) is not None]
        for start in range(0, len(pairs), _CHUNK_ROWS):
            chunk = pairs[start : start + _CHUNK_ROWS]
            values = ", ".join(f"(:id{i}, :secondary{i})" for i in range(len(chunk)))
            params: dict[str, object] = {}
            for i, (player_id, secondary) in enumerate(chunk):
                params[f"id{i}"] = player_id
                params[f"secondary{i}"] = secondary
            conn.execute(
                text(
                    f"update {PLAYERS.fullname} as p set {column} = null from (values {values}) as v(id, secondary) "
                    f"where p.{column} = v.secondary and p.id <> v.id"
                ),
                params,
            )


def record_nfl_players(conn: Connection, players: Sequence[NflPlayer]) -> int:
    """`recordNflPlayers`: release any moved secondary id, then upsert on id, every column refreshed."""
    if not players:
        return 0
    release_moved_ids(conn, players)
    written = 0
    for start in range(0, len(players), _CHUNK_ROWS):
        chunk = [
            {
                "id": p.id,
                "pfr_id": p.pfr_id,
                "espn_id": p.espn_id,
                "name": p.name,
                "position": p.position,
                "latest_team": p.latest_team,
                "rookie_season": p.rookie_season,
                "last_season": p.last_season,
            }
            for p in players[start : start + _CHUNK_ROWS]
        ]
        values = insert(PLAYERS).values(chunk)
        statement = values.on_conflict_do_update(
            index_elements=[PLAYERS.c.id],
            set_={
                column: values.excluded[column]
                for column in ("pfr_id", "espn_id", "name", "position", "latest_team", "rookie_season", "last_season")
            },
        ).returning(PLAYERS.c.id)
        written += len(conn.execute(statement).all())
    return written
