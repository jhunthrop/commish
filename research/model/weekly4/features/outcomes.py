"""THE TEAM-GAME AND PLAY OUTCOMES, through one ledgered reader that serves 2016 to 2024 only.

The round 4 preregistration, section 2.6 and G5: the play and team models fit on 2016 to 2023 and
the judgment reads 2024; "all refuse 2025 and 2026". Week W's plays are an outcome of week W, so the
team model's targets (plays, dropbacks, sacks, scrambles, designed rushes, team targets, rushing and
receiving touchdowns) and the play rows the expected-points model fits on are read only here, never
by an input read, and the reader keeps the seasons it served on its ledger. The live week builds no
outcome at all, so it holds no reader.

Each play row carries the play's own stamp (its game's, section 2.9) and its game's recorded roof and
weather, as the play model conditions on them.
"""

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from sqlalchemy import Connection

from research.errors import ResearchError
from research.model.instants import FAR_FUTURE
from research.model.ros.outcomes import PRISTINE_SEASON
from research.model.weekly2.guard import LAST_JUDGED_WEEK
from research.model.weekly4.features import reads
from research.model.weekly4.features.columns import default_column
from research.model.weekly4.features.game import NO_WEATHER, Weather
from research.model.weekly4.features.plays import Play, dropper, is_designed_rush, is_dropback, is_target

FIRST_SERVED: Final = 2016
LAST_SERVED: Final = 2024  # the judgment season; every season after it is closed
SERVED_SEASONS: Final = frozenset(range(FIRST_SERVED, LAST_SERVED + 1))
TARGET: Final = "target"
CARRY: Final = "carry"
DROPBACK: Final = "dropback"


class OutcomeSeasonError(ResearchError):
    """An outcome read of a season the round's fit and judgment may not read."""


@dataclass(frozen=True, slots=True)
class OutcomeReader:
    """The one outcome reader: 2016 to 2024 served, 2025 and the pristine 2026 refused."""

    served: tuple[int, ...] = ()

    def plays(self, conn: Connection, season: int) -> tuple[list[Play], "OutcomeReader"]:
        if season not in SERVED_SEASONS or season >= PRISTINE_SEASON:
            raise OutcomeSeasonError(f"the outcome reader serves {FIRST_SERVED} to {LAST_SERVED}; {season} is refused")
        return reads.plays(conn, season, LAST_JUDGED_WEEK, FAR_FUTURE), OutcomeReader((*self.served, season))


def _flag(value: bool | None) -> float:
    return math.nan if value is None else float(value)


def team_outcomes(plays: Sequence[Play]) -> dict[tuple[str, int], dict[str, float]]:
    """Each club-week's targets of the team model."""
    found: dict[tuple[str, int], dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for play in plays:
        if play.posteam is None or play.play_type not in {"pass", "run"} or play.two_point_attempt:
            continue
        row = found[(play.posteam, play.week)]
        row["plays"] += 1.0
        row["dropbacks"] += float(is_dropback(play))
        row["sacks"] += float(bool(play.sack))
        row["scrambles"] += float(bool(play.qb_scramble))
        row["designed_rushes"] += float(is_designed_rush(play))
        row["team_targets"] += float(is_target(play))
        row["rushing_touchdowns"] += float(bool(play.rush_touchdown))
        row["receiving_touchdowns"] += float(bool(play.pass_touchdown))
    return {key: dict(value) for key, value in found.items()}


def _kinds(play: Play) -> list[tuple[str, str | None]]:
    found: list[tuple[str, str | None]] = []
    if is_target(play):
        found.append((TARGET, play.receiver_player_id))
    if is_designed_rush(play):
        found.append((CARRY, play.rusher_player_id))
    if is_dropback(play):
        found.append((DROPBACK, dropper(play)))
    return found


def play_rows(plays: Sequence[Play], weather: Mapping[str, Weather]) -> list[dict[str, object]]:
    """One row per opportunity: each target, designed rush and dropback, with its outcome."""
    rows: list[dict[str, object]] = []
    for play in plays:
        w = weather.get(play.game_id)
        for kind, player in _kinds(play):
            rows.append(
                {
                    "season": play.season,
                    "week": play.week,
                    "game_id": play.game_id,
                    "play_id": play.play_id,
                    "as_of": play.as_of.isoformat(),
                    "kind": kind,
                    "player_id": player,
                    "posteam": play.posteam,
                    "defteam": play.defteam,
                    "down": math.nan if play.down is None else float(play.down),
                    "ydstogo": math.nan if play.ydstogo is None else float(play.ydstogo),
                    "yardline_100": math.nan if play.yardline_100 is None else float(play.yardline_100),
                    "air_yards": math.nan if play.air_yards is None else play.air_yards,
                    "pass_location": play.pass_location,
                    "run_location": play.run_location,
                    "run_gap": play.run_gap,
                    "roof": None if w is None else w.roof,
                    "indoor": math.nan if w is None else w.indoor,
                    "temperature_f": math.nan if w is None else w.temperature_f,
                    "wind_mph": math.nan if w is None else w.wind_mph,
                    "precipitation": math.nan if w is None else w.precipitation,
                    default_column(NO_WEATHER): int(w is None or NO_WEATHER in w.defaults),
                    "complete_pass": _flag(play.complete_pass),
                    "yards_gained": math.nan if play.yards_gained is None else play.yards_gained,
                    "touchdown": float(bool(play.pass_touchdown) or bool(play.rush_touchdown)),
                    "interception": _flag(play.interception),
                    "sack": _flag(play.sack),
                }
            )
    return rows
