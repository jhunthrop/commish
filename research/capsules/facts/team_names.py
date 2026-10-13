"""EVERY SPELLING OF A TEAM a capsule may use: the code, the city, the nickname, the two together.

Ported from `research-ts/src/domain/nfl-team-names.ts`. Both the product's codes (LAR, WSH) and
the archive's (LA, WAS) are here, and the relocated franchises' old codes, so a code from any
store grounds every name the writer could fairly use for it.
"""

from types import MappingProxyType
from typing import Final

from research.pipeline.jscompat import js_trim

NFL_TEAM_NAMES: Final = MappingProxyType(
    {
        "ARI": ("Arizona", "Cardinals"),
        "ATL": ("Atlanta", "Falcons"),
        "BAL": ("Baltimore", "Ravens"),
        "BUF": ("Buffalo", "Bills"),
        "CAR": ("Carolina", "Panthers"),
        "CHI": ("Chicago", "Bears"),
        "CIN": ("Cincinnati", "Bengals"),
        "CLE": ("Cleveland", "Browns"),
        "DAL": ("Dallas", "Cowboys"),
        "DEN": ("Denver", "Broncos"),
        "DET": ("Detroit", "Lions"),
        "GB": ("Green Bay", "Packers"),
        "HOU": ("Houston", "Texans"),
        "IND": ("Indianapolis", "Colts"),
        "JAX": ("Jacksonville", "Jaguars"),
        "KC": ("Kansas City", "Chiefs"),
        "LA": ("Los Angeles", "Rams"),
        "LAR": ("Los Angeles", "Rams"),
        "LAC": ("Los Angeles", "Chargers"),
        "LV": ("Las Vegas", "Raiders"),
        "OAK": ("Oakland", "Raiders"),
        "MIA": ("Miami", "Dolphins"),
        "MIN": ("Minnesota", "Vikings"),
        "NE": ("New England", "Patriots"),
        "NO": ("New Orleans", "Saints"),
        "NYG": ("New York", "Giants"),
        "NYJ": ("New York", "Jets"),
        "PHI": ("Philadelphia", "Eagles"),
        "PIT": ("Pittsburgh", "Steelers"),
        "SEA": ("Seattle", "Seahawks"),
        "SF": ("San Francisco", "49ers"),
        "TB": ("Tampa Bay", "Buccaneers"),
        "TEN": ("Tennessee", "Titans"),
        "WAS": ("Washington", "Commanders"),
        "WSH": ("Washington", "Commanders"),
        "SD": ("San Diego", "Chargers"),
        "STL": ("St. Louis", "Rams"),
    }
)


def team_name_forms(code: str) -> list[str]:
    """`teamNameForms`: the code itself, then its city, nickname and both; an unknown code alone."""
    trimmed = js_trim(code)
    if trimmed == "":
        return []
    names = NFL_TEAM_NAMES.get(trimmed.upper())
    if names is None:
        return [trimmed]
    city, nickname = names
    return [trimmed, city, nickname, f"{city} {nickname}"]
