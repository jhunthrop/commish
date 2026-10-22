"""THE ONE PLACE THE TWO TEAM SPELLINGS MEET (`src/projections/nflverse/team-codes.ts`).

The stats provider spells the Rams `LAR` and Washington `WSH`; nflverse spells them `LA` and
`WAS`, and its older files carry `STL`, `SD` and `OAK`. Folding is one-directional: a historical
spelling folds onto today's code, never the reverse. It also mints the synthetic universe id a
team defense hangs on, `team-def:<source code>`, and that row's ESPN id (Lane 156): ESPN keys a D/ST as
`-16000 - <ESPN's club id>` (the Seahawks' is -16026), so its projections join the defense's row by
`players.espn_id` as a kicker's join his.
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
# ESPN's club ids (its `proTeamId`), keyed by the product code; checked 2026-10-22 against the 32 D/ST
# rows of ESPN's public pool, each `-16000 - id` named for its club ("Seahawks D/ST" is -16026).
ESPN_PRO_TEAM_IDS = MappingProxyType({
    "ATL": 1, "BUF": 2, "CHI": 3, "CIN": 4, "CLE": 5, "DAL": 6, "DEN": 7, "DET": 8, "GB": 9, "TEN": 10,
    "IND": 11, "KC": 12, "LV": 13, "LAR": 14, "MIA": 15, "MIN": 16, "NE": 17, "NO": 18, "NYG": 19, "NYJ": 20,
    "PHI": 21, "ARI": 22, "PIT": 23, "LAC": 24, "SF": 25, "SEA": 26, "TB": 27, "WSH": 28, "CAR": 29, "JAX": 30,
    "BAL": 33, "HOU": 34,
})  # fmt: skip
ESPN_DEFENSE_ID_BASE = -16000
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


def team_defense_espn_id(source_code: str) -> str:
    """The ESPN id of one club's D/ST, the club in nflverse's spelling (`LA` is the Rams')."""
    return str(ESPN_DEFENSE_ID_BASE - ESPN_PRO_TEAM_IDS[product_team_code(source_code)])


_DEFENSE_ESPN_IDS = frozenset(str(ESPN_DEFENSE_ID_BASE - club) for club in ESPN_PRO_TEAM_IDS.values())


def is_defense_id(espn_id: str) -> bool:
    """Whether an ESPN id is one of the 32 clubs' D/ST ids."""
    return espn_id in _DEFENSE_ESPN_IDS


def team_defense_universe_ids() -> list[str]:
    return sorted(team_defense_universe_id(source_team_code(code)) for code in NFL_TEAM_ABBREVIATIONS)
