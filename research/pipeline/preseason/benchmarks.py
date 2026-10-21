"""JOINING A PUBLISHED BOARD TO THE ROSTER SPINE (`src/projections/preseason/benchmarks.ts`).

A publisher names a player and a position, never an id, so this is the one place a NAME join is
the right tool, and it is kept narrow: the spine is a season's week-one roster (a few thousand
people, not the 25,000-person universe), an exact normalised name and position group first, a
first-initial-and-surname key only when it is unique, the club breaking a tie, and nobody taken
twice. A team defense resolves by its club code onto the synthetic universe row.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from research.errors import SchemaDriftError
from research.pipeline.crosswalk import comparable_name
from research.pipeline.jscompat import js_trim
from research.pipeline.nflverse.team_codes import product_team_code, source_team_code, team_defense_universe_id
from research.pipeline.preseason.publishers import RankingCandidate

BENCHMARK_BOARD_FLOOR = 2013


class BenchmarkSource:
    ADP = "ffc_adp_ppr_12"
    ADP_HALF = "ffc_adp_half_12"
    ADP_STD = "ffc_adp_std_12"
    ECR = "fantasypros_ecr_ppr"


@dataclass(frozen=True)
class RosterIdentity:
    player_id: str
    name: str
    position: str
    team: str | None  # None for a free agent (revision 0018, Lane 123)


@dataclass(frozen=True)
class ResolvedRanking:
    player_id: str
    rank: float


@dataclass(frozen=True)
class RankingResolution:
    resolved: list[ResolvedRanking]
    unresolved: list[RankingCandidate]
    resolution_rate: float | None


# `normalizeName` is the same reduction the crosswalk's audit uses; one definition of a name.
normalize_name = comparable_name


# A name needs a first and a last part to have a loose key.
_FIRST_AND_LAST: Final = 2


def position_group(position: str) -> str:
    upper = js_trim(position).upper()
    if upper in ("FB", "HB"):
        return "RB"
    if upper == "PK":
        return "K"
    if upper in ("DST", "D/ST", "DEF"):
        return "DEF"
    return upper


def _key(name: str, position: str) -> str:
    return f"{normalize_name(name)}|{position_group(position)}"


def _loose_key(name: str, position: str) -> str | None:
    parts = normalize_name(name).split(" ")
    if len(parts) < _FIRST_AND_LAST:
        return None
    return f"{parts[0][:1]}|{parts[-1]}|{position_group(position)}"


def _team_defense_id(team: str | None) -> str | None:
    if team is None:
        return None
    code = js_trim(team).upper()
    if code == "":
        return None
    try:
        return team_defense_universe_id(source_team_code(product_team_code(code)))
    except SchemaDriftError:
        return None


def resolve_rankings(candidates: Sequence[RankingCandidate], identities: Sequence[RosterIdentity]) -> RankingResolution:
    by_key: dict[str, list[RosterIdentity]] = {}
    by_loose: dict[str, list[RosterIdentity]] = {}
    for identity in identities:
        by_key.setdefault(_key(identity.name, identity.position), []).append(identity)
        loose_key = _loose_key(identity.name, identity.position)
        if loose_key is not None:
            by_loose.setdefault(loose_key, []).append(identity)

    resolved: list[ResolvedRanking] = []
    unresolved: list[RankingCandidate] = []
    taken: set[str] = set()
    for candidate in candidates:
        if position_group(candidate.position) == "DEF":
            universe_id = _team_defense_id(candidate.team)
            if universe_id is None or universe_id in taken:
                unresolved.append(candidate)
                continue
            taken.add(universe_id)
            resolved.append(ResolvedRanking(universe_id, candidate.rank))
            continue
        exact = by_key.get(_key(candidate.name, candidate.position), [])
        loose = by_loose.get(_loose_key(candidate.name, candidate.position) or "", [])
        claimants = exact if exact else (loose if len(loose) == 1 else [])
        team = None if candidate.team is None else js_trim(candidate.team).upper()
        narrowed = [c for c in claimants if c.team == team] if len(claimants) > 1 else claimants
        chosen = narrowed[0] if len(narrowed) == 1 else None
        if chosen is None or chosen.player_id in taken:
            unresolved.append(candidate)
            continue
        taken.add(chosen.player_id)
        resolved.append(ResolvedRanking(chosen.player_id, candidate.rank))
    rate = None if not candidates else len(resolved) / len(candidates)
    return RankingResolution(resolved, unresolved, rate)
