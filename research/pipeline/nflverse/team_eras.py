"""THE LEAGUE'S SHAPE, YEAR BY YEAR (`src/projections/nflverse/team-eras.ts`).

Which abbreviation each franchise used in nflverse's own spelling, the Texans' expansion, and the
2021 move to an 18-week season. The independent ground truth `validatePlayCallers` checks against.
"""

FACT_SEASONS: tuple[int, ...] = tuple(range(1999, 2027))

_CURRENT_32: tuple[str, ...] = (
    "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND",
    "JAX", "KC", "LA", "LAC", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF",
    "TB", "TEN", "WAS",
)  # fmt: skip

_HOUSTON_EXPANSION_SEASON = 2002

# (current, historical, first season under the current name)
_RELOCATIONS: tuple[tuple[str, str, int], ...] = (("LA", "STL", 2016), ("LAC", "SD", 2017), ("LV", "OAK", 2020))

_SEVENTEEN_GAME_SEASON = 2021


def nfl_teams_by_season(season: int) -> list[str]:
    """`nflTeamsBySeason`: every abbreviation that played a regular-season game in `season`, sorted."""
    teams = set(_CURRENT_32)
    if season < _HOUSTON_EXPANSION_SEASON:
        teams.discard("HOU")
    for current, historical, first in _RELOCATIONS:
        if season < first:
            teams.discard(current)
            teams.add(historical)
    return sorted(teams)


def season_code(season: int, code: str) -> str:
    """The club's abbreviation in `season`'s own spelling: nflverse's play-by-play (and the stores
    built from it: the play table, its club rows, the pairing) spells a relocated club by its current
    code in every season, the schedule by the code of the season (OAK in 2016, LV in 2020)."""
    for current, historical, first in _RELOCATIONS:
        if code == current and season < first:
            return historical
    return code


def final_week_of(season: int) -> int:
    """18 from 2021, 17 before."""
    return 18 if season >= _SEVENTEEN_GAME_SEASON else 17
