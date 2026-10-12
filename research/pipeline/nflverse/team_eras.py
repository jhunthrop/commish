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


def final_week_of(season: int) -> int:
    """18 from 2021, 17 before."""
    return 18 if season >= _SEVENTEEN_GAME_SEASON else 17
