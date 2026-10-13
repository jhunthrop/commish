"""Where the nflverse fixtures come from: the real release URLs, and how each slice is narrowed."""

from collections.abc import Mapping

from research.pipeline.nflverse.config import NFLVERSE_BASE_URL
from research.pipeline.nflverse.schedule import SCHEDULE_BASE_URL, SCHEDULE_FILE, SCHEDULE_RELEASE


def release_url(release: str, file: str) -> str:
    return f"{NFLVERSE_BASE_URL}{release}/{file}"


SCHEDULE_URL = f"{SCHEDULE_BASE_URL}{SCHEDULE_RELEASE}/{SCHEDULE_FILE}"

# Four clubs, one per division of one conference, chosen for spread rather than for any result:
# a slice of a large asset keeps every column and the clubs' every row, so each mapper still sees
# a full club-week (a whole offensive line, a whole depth chart) for every club it is handed.
SLICE_TEAMS: frozenset[str] = frozenset({"BUF", "BAL", "HOU", "KC"})


def team_in_slice(*columns: str) -> "TeamFilter":
    return TeamFilter(columns)


class TeamFilter:
    """Keeps a row when any of the named team columns is one of `SLICE_TEAMS`."""

    def __init__(self, columns: tuple[str, ...]) -> None:
        self._columns = columns

    def __call__(self, row: Mapping[str, str]) -> bool:
        return any(row.get(column, "") in SLICE_TEAMS for column in self._columns)

    def describe(self) -> str:
        return f"rows whose {' or '.join(self._columns)} is one of {', '.join(sorted(SLICE_TEAMS))}"
