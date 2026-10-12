"""THE BRIDGE BETWEEN THE TWO ID SPACES (`src/projections/crosswalk.ts`), into `player_crosswalk`.

The engine keys on nflverse's gsis id, the product on the stats provider's id (ESPN's space). The
join is an ID join on `espn_id`, never a name join; a name comparison is computed only as an
audit signal. A team defense is placed on its synthetic universe row by team code. Nobody is
dropped: an unplaced player gets a row saying why.
"""

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Connection, select
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import NFL_PLAYERS, PLAYER_CROSSWALK, PLAYERS
from research.errors import CoherenceError
from research.pipeline.nflverse.team_codes import (
    TEAM_DEFENSE_UNIVERSE_PREFIX,
    team_defense_universe_id_for_provider_id,
    team_defense_universe_ids,
)
from research.pipeline.observations import INSERT_CHUNK_ROWS


class CrosswalkMethod:
    ESPN_ID = "espn_id"
    TEAM_DEFENSE = "team_defense"


TEAM_DEFENSE_POSITION = "DEF"
_NAME_SUFFIXES = frozenset({"jr", "sr", "ii", "iii", "iv", "v"})
_COMBINING = re.compile("[̀-ͯ]")
_NOT_LETTER = re.compile(r"[^a-z\s]")
_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class ProviderPlayer:
    id: str
    name: str
    position: str


@dataclass(frozen=True)
class UniversePlayer:
    id: str
    espn_id: str | None
    name: str


@dataclass(frozen=True)
class CrosswalkMatch:
    player_id: str
    nfl_player_id: str
    method: str
    name_agrees: bool
    provider_name: str
    universe_name: str


@dataclass(frozen=True)
class CrosswalkMiss:
    player_id: str
    name: str
    position: str
    reason: str


@dataclass(frozen=True)
class CrosswalkResolution:
    matched: list[CrosswalkMatch]
    unmatched: list[CrosswalkMiss]
    match_rate: float | None
    match_rate_of_people: float | None


def comparable_name(name: str) -> str:
    """`comparableName`: accents, punctuation and generational suffixes set aside. For comparison only."""
    stripped = _NOT_LETTER.sub("", _COMBINING.sub("", unicodedata.normalize("NFD", name)).lower())
    parts = [part for part in _WHITESPACE.split(stripped) if part != ""]
    return " ".join(part for index, part in enumerate(parts) if index == 0 or part not in _NAME_SUFFIXES)


def resolve_crosswalk(
    providers: Sequence[ProviderPlayer],
    universe: Sequence[UniversePlayer],
    team_defense_ids: frozenset[str] = frozenset(),
) -> CrosswalkResolution:
    by_espn: dict[str, list[UniversePlayer]] = {}
    for person in universe:
        if person.espn_id is None or person.espn_id == "":
            continue
        by_espn.setdefault(person.espn_id, []).append(person)

    matched: list[CrosswalkMatch] = []
    unmatched: list[CrosswalkMiss] = []
    claimed: dict[str, str] = {}
    for provider in providers:
        if provider.position == TEAM_DEFENSE_POSITION:
            universe_id = team_defense_universe_id_for_provider_id(provider.id)
            if universe_id is None:
                unmatched.append(CrosswalkMiss(provider.id, provider.name, provider.position, "not_an_nfl_player"))
                continue
            if universe_id not in team_defense_ids:
                unmatched.append(CrosswalkMiss(provider.id, provider.name, provider.position, "no_team_defense_row"))
                continue
            matched.append(
                CrosswalkMatch(provider.id, universe_id, CrosswalkMethod.TEAM_DEFENSE, True, provider.name, universe_id)
            )
            continue
        claimants = by_espn.get(provider.id, [])
        if not claimants:
            unmatched.append(CrosswalkMiss(provider.id, provider.name, provider.position, "no_espn_id"))
            continue
        if len(claimants) > 1:
            unmatched.append(CrosswalkMiss(provider.id, provider.name, provider.position, "ambiguous_espn_id"))
            continue
        person = claimants[0]
        already = claimed.get(person.id)
        if already is not None:
            raise CoherenceError(
                f"Two league players resolve to {person.name} ({person.id}): {already} and {provider.id}. "
                "One man's projection would be rendered on another man's screen."
            )
        claimed[person.id] = provider.id
        matched.append(
            CrosswalkMatch(
                provider.id,
                person.id,
                CrosswalkMethod.ESPN_ID,
                comparable_name(provider.name) == comparable_name(person.name),
                provider.name,
                person.name,
            )
        )
    people = sum(1 for p in providers if p.position != TEAM_DEFENSE_POSITION)
    matched_people = sum(1 for m in matched if m.method != CrosswalkMethod.TEAM_DEFENSE)
    return CrosswalkResolution(
        matched=matched,
        unmatched=unmatched,
        match_rate=None if not providers else len(matched) / len(providers),
        match_rate_of_people=None if people == 0 else matched_people / people,
    )


@dataclass(frozen=True)
class CrosswalkRow:
    player_id: str
    nfl_player_id: str | None
    method: str | None
    unmatched_reason: str | None
    resolved_at: datetime


def crosswalk_rows(resolution: CrosswalkResolution, resolved_at: datetime) -> list[CrosswalkRow]:
    return [
        *(CrosswalkRow(m.player_id, m.nfl_player_id, m.method, None, resolved_at) for m in resolution.matched),
        *(CrosswalkRow(m.player_id, None, None, m.reason, resolved_at) for m in resolution.unmatched),
    ]


def record_crosswalk(conn: Connection, rows: Sequence[CrosswalkRow]) -> int:
    """`recordCrosswalk`: identity carries no as-of, so each row replaces what it said before."""
    written = 0
    for start in range(0, len(rows), INSERT_CHUNK_ROWS):
        chunk = [
            {
                "player_id": r.player_id,
                "nfl_player_id": r.nfl_player_id,
                "method": r.method,
                "unmatched_reason": r.unmatched_reason,
                "resolved_at": r.resolved_at,
            }
            for r in rows[start : start + INSERT_CHUNK_ROWS]
        ]
        statement = insert(PLAYER_CROSSWALK).values(chunk)
        upsert = statement.on_conflict_do_update(
            index_elements=[PLAYER_CROSSWALK.c.player_id],
            set_={c: statement.excluded[c] for c in ("nfl_player_id", "method", "unmatched_reason", "resolved_at")},
        ).returning(PLAYER_CROSSWALK.c.player_id)
        written += len(conn.execute(upsert).all())
    return written


@dataclass(frozen=True)
class CrosswalkInputs:
    providers: list[ProviderPlayer]
    universe: list[UniversePlayer]
    team_defenses: frozenset[str]


def crosswalk_inputs(conn: Connection) -> CrosswalkInputs:
    providers = [
        ProviderPlayer(row.id, row.name, row.position)
        for row in conn.execute(select(PLAYERS.c.id, PLAYERS.c.name, PLAYERS.c.position))
    ]
    universe = [
        UniversePlayer(row.id, row.espn_id, row.name)
        for row in conn.execute(
            select(NFL_PLAYERS.c.id, NFL_PLAYERS.c.espn_id, NFL_PLAYERS.c.name).where(
                NFL_PLAYERS.c.espn_id.is_not(None)
            )
        )
    ]
    seeded = conn.execute(select(NFL_PLAYERS.c.id).where(NFL_PLAYERS.c.id.in_(team_defense_universe_ids()))).scalars()
    return CrosswalkInputs(providers, universe, frozenset(seeded))


def seed_team_defense_universe(conn: Connection) -> int:
    """`seedTeamDefenseUniverse`: the 32 synthetic, unmistakably labelled universe rows."""
    rows = [
        {
            "id": universe_id,
            "pfr_id": None,
            "espn_id": None,
            "name": universe_id,
            "position": TEAM_DEFENSE_POSITION,
            "latest_team": universe_id[len(TEAM_DEFENSE_UNIVERSE_PREFIX) :],
            "rookie_season": None,
            "last_season": None,
        }
        for universe_id in team_defense_universe_ids()
    ]
    statement = insert(NFL_PLAYERS).values(rows).on_conflict_do_nothing().returning(NFL_PLAYERS.c.id)
    return len(conn.execute(statement).all())


def build_crosswalk(conn: Connection, resolved_at: datetime) -> CrosswalkResolution:
    """`build-crosswalk.ts` after the universe refresh: seed the defenses, resolve, record."""
    seed_team_defense_universe(conn)
    inputs = crosswalk_inputs(conn)
    resolution = resolve_crosswalk(inputs.providers, inputs.universe, inputs.team_defenses)
    record_crosswalk(conn, crosswalk_rows(resolution, resolved_at))
    return resolution
