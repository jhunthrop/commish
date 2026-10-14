"""WHAT THE WEEKLY FIT READS: every season's usage, lines and club facts, final and corrected.

Ported from `research-ts/scripts/projection-fit.ts` (`usageForSeasons`, `historyForSeasons`,
`contextForSeasons`): a fit is measured against what really happened, so it reads with no as-of
gate (the point-in-time gate governs prediction, and each fit computes its regressors from weeks
before the one it explains). The history season is read for its usage and club facts, since week
one of the first fit season shrinks toward it, and is never itself a fit season.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from sqlalchemy import Connection

from research.model.arithmetic import Arithmetic
from research.model.domain import Position
from research.model.instants import FAR_FUTURE
from research.model.reads.observations import (
    LAST_POSSIBLE_WEEK,
    PlayerWeekUsage,
    SeasonStatLine,
    WeekRange,
    season_span,
)
from research.model.reads.preseason import all_positions
from research.model.reads.teams import TeamContext, player_teams_as_of, team_observations_as_of
from research.model.weekly.context_fit import (
    GameContextFitInput,
    SchemeFitInput,
    fit_game_context_priors,
    fit_scheme_priors,
)
from research.model.weekly.fit import FitInput, fit_efficiency_priors, fit_opportunity_priors
from research.model.weekly.inputs import FactReader
from research.model.weekly.model import WeeklyPriors
from research.pipeline.observations import PlayerWeekTeam, TeamWeekObservation


@dataclass(frozen=True, slots=True)
class FitData:
    seasons: tuple[int, ...]
    usage: tuple[PlayerWeekUsage, ...]
    history: tuple[SeasonStatLine, ...]
    positions: Mapping[str, Position]
    context: TeamContext


def read_fit_data(conn: Connection, seasons: Sequence[int], reader: FactReader) -> FitData:
    """Every season in `seasons` (history and fit seasons alike), read at the far future."""
    positions = all_positions(conn)
    usage: list[PlayerWeekUsage] = []
    history: list[SeasonStatLine] = []
    edges: list[PlayerWeekTeam] = []
    facts: list[TeamWeekObservation] = []
    for season in seasons:
        usage.extend(reader.usage(conn, season_span(season, FAR_FUTURE), positions))
    for season in seasons:
        history.extend(reader.lines(conn, season_span(season, FAR_FUTURE)))
    for season in seasons:
        edges.extend(player_teams_as_of(conn, season, WeekRange(1, LAST_POSSIBLE_WEEK), FAR_FUTURE))
        facts.extend(team_observations_as_of(conn, season, WeekRange(1, LAST_POSSIBLE_WEEK), FAR_FUTURE))
    return FitData(tuple(seasons), tuple(usage), tuple(history), positions, TeamContext(tuple(edges), tuple(facts)))


@dataclass(frozen=True, slots=True)
class WeeklyFit:
    priors: WeeklyPriors
    share_rmse: float
    share_observations: int


def fit_weekly_priors(
    data: FitData, fit_seasons: Sequence[int], held_out: Sequence[int], arithmetic: Arithmetic
) -> WeeklyFit:
    """The oracle's four shipped fits, in its order: layer 1, layer 2, then the scheme against the
    fitted layer 1 and the game context."""
    seasons = tuple(fit_seasons)
    excluded = tuple(held_out)
    base = FitInput(data.usage, data.positions, seasons, excluded, data.history)
    opportunity = fit_opportunity_priors(base)
    efficiency = fit_efficiency_priors(base)
    scheme = fit_scheme_priors(
        SchemeFitInput(data.usage, data.positions, data.context, opportunity.priors, seasons, excluded), arithmetic
    )
    game_context = fit_game_context_priors(
        GameContextFitInput(data.usage, data.history, data.context, seasons, excluded), arithmetic
    )
    return WeeklyFit(
        WeeklyPriors(opportunity.priors, efficiency, scheme, game_context), opportunity.rmse, opportunity.sample_size
    )
