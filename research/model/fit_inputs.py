"""WHAT EACH UNPORTED FIT READS, AND WHETHER THE STORE HOLDS IT.

The fits phase B carries as numbers (`research/README.md`, "Unported fits") each need seasons the
store lost and the history rebuild (`research.pipeline history`) re-creates. This names, per fit,
every input by table and season, and `fit_readiness` reads the store to say which fits can be
re-run and, for the rest, exactly which seasons of which input are missing. The fit step reports it
(`model.fit_check`), so a blocked fit is named with its reason, never skipped in silence.

    RESEARCH_DATABASE_URL=... uv run python -m research.model.fit_inputs
"""

import sys
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from sqlalchemy import Connection, text

from research.db.engine import make_engine
from research.db.url import database_url_from_env


@dataclass(frozen=True, slots=True)
class Input:
    name: str
    seasons: range


def _seasons(first: int, last: int) -> range:
    return range(first, last + 1)


WEEKLY = "weekly box scores"
TEAMS = "player teams"
SCHEDULE = "schedule and kickoffs"
COACHES = "coaches"
ROSTERS = "week-one rosters"

# Every unported fit's inputs, from its oracle module's own seasons (`model/fit_provenance.py`).
FIT_INPUTS: Final[Mapping[str, tuple[Input, ...]]] = {
    "model/weekly-priors": (Input(WEEKLY, _seasons(2020, 2022)), Input(TEAMS, _seasons(2020, 2022)), Input(SCHEDULE, _seasons(2020, 2022))),
    "preseason/priors": (Input(ROSTERS, _seasons(2021, 2024)), Input(WEEKLY, _seasons(2018, 2022)), Input(TEAMS, _seasons(2018, 2023))),
    "preseason/rookie-curve": (Input(WEEKLY, _seasons(2003, 2022)),),
    "preseason/rookie-history": (Input(WEEKLY, _seasons(2003, 2022)),),
    "preseason/kdef-priors": (Input(SCHEDULE, _seasons(2013, 2024)),),
    "preseason/game-variance-kdef": (Input(SCHEDULE, _seasons(2023, 2024)),),
    "market/blend-constants": (Input(ROSTERS, _seasons(2013, 2021)), Input(WEEKLY, _seasons(2010, 2021))),
    "market/curve-ppr": (Input(WEEKLY, _seasons(2013, 2022)),),
    "market/curve-half": (Input(WEEKLY, _seasons(2018, 2022)),),
    "market/curve-std": (Input(WEEKLY, _seasons(2013, 2022)),),
    "market/props-anchor-weight": (Input(ROSTERS, _seasons(2023, 2024)), Input(WEEKLY, _seasons(2020, 2023))),
    "laws/measured": (Input(WEEKLY, _seasons(2003, 2023)), Input(TEAMS, _seasons(2003, 2023)), Input(COACHES, _seasons(2003, 2023)), Input(SCHEDULE, _seasons(2003, 2023))),
    "laws/discovered": (Input(WEEKLY, _seasons(2003, 2023)), Input(TEAMS, _seasons(2003, 2023)), Input(COACHES, _seasons(2003, 2023)), Input(SCHEDULE, _seasons(2003, 2023))),
    "laws/discovery-quantiles": (Input(WEEKLY, _seasons(2003, 2023)), Input(TEAMS, _seasons(2003, 2023))),
}  # fmt: skip

_HELD: Final[Mapping[str, str]] = {
    WEEKLY: (
        "select distinct season from research.player_week_observations where metric = 'receiving_yards' "
        "and source in ('nflverse_player_week', 'nflverse_pbp_derived')"
    ),
    TEAMS: "select distinct season from research.player_week_teams",
    SCHEDULE: "select distinct season from research.team_week_observations where source = 'nflverse_kickoff' and metric = 'kickoff_instant'",
    COACHES: "select distinct season from research.team_week_observations where source = 'nflverse_schedule' and metric = 'coach_tenure_seasons'",
    ROSTERS: "select distinct season from research.preseason_rosters",
}


def _ranges(seasons: list[int]) -> str:
    out: list[str] = []
    for season in seasons:
        if out and out[-1].split("-")[-1] == str(season - 1):
            out[-1] = f"{out[-1].split('-')[0]}-{season}"
        else:
            out.append(str(season))
    return ", ".join(out)


def fit_readiness(conn: Connection) -> dict[str, str | None]:
    """Each fit to None when the store holds every input, else the seasons each input lacks."""
    held = {name: {int(row[0]) for row in conn.execute(text(query))} for name, query in _HELD.items()}
    readiness: dict[str, str | None] = {}
    for fit, inputs in FIT_INPUTS.items():
        lacking = [
            f"{item.name} {_ranges(missing)}"
            for item in inputs
            if (missing := [s for s in item.seasons if s not in held[item.name]])
        ]
        readiness[fit] = None if not lacking else "the store lacks " + "; ".join(lacking)
    return readiness


def main() -> int:
    engine = make_engine(database_url_from_env())
    with engine.connect() as conn:
        readiness = fit_readiness(conn)
    engine.dispose()
    for fit, reason in readiness.items():
        sys.stdout.write(f"{fit}: {'inputs held, re-runnable' if reason is None else reason}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
