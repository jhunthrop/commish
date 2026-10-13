"""THE ONE PLACE THE TWO TEAM SPELLINGS MEET (`src/projections/nflverse/team-codes.ts`).

The stats provider spells the Rams `LAR` and Washington `WSH`; nflverse spells them `LA` and
`WAS`, and its older files carry `STL`, `SD` and `OAK`. Folding is one-directional: a historical
spelling folds onto today's code, never the reverse. It also mints the synthetic universe id a
team defense hangs on, `team-def:<source code>`.
"""

from types import MappingProxyType

from research.errors import SchemaDriftError

# The provider's 32, `NFL_TEAM_ABBREVIATIONS` in capture-feeds.ts.
NFL_TEAM_ABBREVIATIONS: tuple[str, ...] = (
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND",
    "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF",
    "TB", "TEN", "WSH",
)  # fmt: skip

TEAM_DEFENSE_UNIVERSE_PREFIX = "team-def:"
DEFENSE_PLAYER_ID_PREFIX = "DST-"

_PRODUCT_TO_SOURCE = MappingProxyType({"LAR": "LA", "WSH": "WAS"})
_SOURCE_TO_PRODUCT = MappingProxyType({"LA": "LAR", "WAS": "WSH", "STL": "LAR", "SD": "LAC", "OAK": "LV"})
_PRODUCT_CODES = frozenset(NFL_TEAM_ABBREVIATIONS)


def source_team_code(product_code: str) -> str:
    if product_code not in _PRODUCT_CODES:
        raise SchemaDriftError(
            f"{product_code} is not one of the 32 product team codes (`NFL_TEAM_ABBREVIATIONS`, capture-feeds.ts). "
            "A team code that maps to nothing would silently drop a whole club's history."
        )
    return _PRODUCT_TO_SOURCE.get(product_code, product_code)


def product_team_code(source_code: str) -> str:
    mapped = _SOURCE_TO_PRODUCT.get(source_code)
    if mapped is not None:
        return mapped
    if source_code not in _PRODUCT_CODES:
        raise SchemaDriftError(
            f"{source_code} is not a team code either feed uses. nflverse's own spelling for the covered span is "
            "`nflTeamsBySeason` (team-eras.ts); a code outside it means the release changed."
        )
    return source_code


def team_week_key(season: int, week: int, source_team: str) -> str:
    return f"{season}|{week}|{product_team_code(source_team)}"


def team_defense_universe_id(source_code: str) -> str:
    return f"{TEAM_DEFENSE_UNIVERSE_PREFIX}{source_code}"


def team_defense_universe_id_for_provider_id(provider_id: str) -> str | None:
    if not provider_id.startswith(DEFENSE_PLAYER_ID_PREFIX):
        return None
    product_code = provider_id[len(DEFENSE_PLAYER_ID_PREFIX) :]
    if product_code not in _PRODUCT_CODES:
        return None
    return team_defense_universe_id(source_team_code(product_code))


def team_defense_universe_ids() -> list[str]:
    return sorted(team_defense_universe_id(source_team_code(code)) for code in NFL_TEAM_ABBREVIATIONS)
