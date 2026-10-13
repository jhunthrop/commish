"""THE PER-GAME VARIANCE FIT: how far a player's weekly points scatter around his own mean, pooled
per position and class (rookie or veteran), the spread the board's floor and ceiling are built on.

Ported from `research-ts/src/projections/preseason/game-variance.ts` (`loadGameVarianceObservations`,
`fitGameVariance`) and `scripts/game-variance-fit.ts`: fit on 2023 and 2024, 2025 and 2026 held
out, published as the next version of `preseason/game-variance-skill`.
"""

import argparse
import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final

from sqlalchemy import Connection, text

from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.model.artifacts import CATALOG, publish_artifact
from research.model.domain import PPR_SCORING, Position, compute_fantasy_points
from research.model.instants import FAR_FUTURE
from research.model.reads.observations import season_span, stat_lines_for_measurement
from research.model.reads.preseason import all_positions

VARIANCE_POSITIONS: Final[tuple[Position, ...]] = ("QB", "RB", "WR", "TE", "K", "DEF")
OBSERVABLE_POSITIONS: Final[tuple[Position, ...]] = ("QB", "RB", "WR", "TE")
TRAIN_SEASONS: Final = (2023, 2024)
HELD_OUT_SEASONS: Final = (2025, 2026)
MINIMUM_POOLED_PLAYER_SEASONS: Final = 20
ARTIFACT: Final = "preseason/game-variance-skill"
_MINIMUM_WEEKS: Final = 2


@dataclass(frozen=True, slots=True)
class GameVarianceObservation:
    season: int
    player_id: str
    position: Position
    player_class: str
    weekly_points: tuple[float, ...]


def draft_class_ids(conn: Connection, season: int) -> set[str]:
    """`draftPicksFor(db, [season])`'s players."""
    rows = conn.execute(
        text("select player_id from research.nfl_draft_picks where season = :s order by season, pick"), {"s": season}
    )
    return {row.player_id for row in rows}


def load_game_variance_observations(conn: Connection, seasons: Sequence[int]) -> list[GameVarianceObservation]:
    """`loadGameVarianceObservations`: every scored player-season's weekly PPR points."""
    positions = all_positions(conn)
    observations: list[GameVarianceObservation] = []
    for season in seasons:
        rookies = draft_class_ids(conn, season)
        by_player: dict[str, list[float]] = {}
        for row in stat_lines_for_measurement(conn, season_span(season, FAR_FUTURE)):
            position = positions.get(row.line.player_id)
            if position is None or position not in VARIANCE_POSITIONS:
                continue
            by_player.setdefault(row.line.player_id, []).append(compute_fantasy_points(row.line, position, PPR_SCORING))
        for player_id, weekly in by_player.items():
            position = positions[player_id]
            observations.append(
                GameVarianceObservation(
                    season, player_id, position, "rookie" if player_id in rookies else "veteran", tuple(weekly)
                )
            )
    return observations


def _pooled_variance(observations: Sequence[GameVarianceObservation]) -> float:
    sum_squares = 0.0
    degrees = 0
    for observation in observations:
        weekly = observation.weekly_points
        if len(weekly) < _MINIMUM_WEEKS:
            continue
        total = 0.0
        for value in weekly:
            total += value
        mean = total / len(weekly)
        squares = 0.0
        for value in weekly:
            squares += (value - mean) * (value - mean)
        sum_squares += squares
        degrees += len(weekly) - 1
    return sum_squares / degrees if degrees > 0 else 0.0


def fit_game_variance(
    observations: Sequence[GameVarianceObservation],
    held_out: Sequence[int],
    positions: Sequence[Position] = OBSERVABLE_POSITIONS,
) -> dict[str, dict[str, float]]:
    """`fitGameVariance`: a class's own pooled variance where it has enough player-seasons, else the
    position's, never a held-out season."""
    forbidden = set(held_out)
    for observation in observations:
        if observation.season in forbidden:
            raise ValueError(f"The per-game variance fit was handed {observation.season}, which is held out.")
    result: dict[str, dict[str, float]] = {}
    for player_class in ("rookie", "veteran"):
        result[player_class] = {}
        for position in positions:
            cell = [o for o in observations if o.player_class == player_class and o.position == position]
            eligible = [o for o in cell if len(o.weekly_points) >= _MINIMUM_WEEKS]
            if len(eligible) >= MINIMUM_POOLED_PLAYER_SEASONS:
                result[player_class][position] = _pooled_variance(cell)
                continue
            result[player_class][position] = _pooled_variance([o for o in observations if o.position == position])
    return result


def fit_skill_game_variance(conn: Connection) -> dict[str, dict[str, float]]:
    """`scripts/game-variance-fit.ts`'s fit, without the publish."""
    return fit_game_variance(load_game_variance_observations(conn, TRAIN_SEASONS), HELD_OUT_SEASONS)


def main(argv: Sequence[str] | None = None) -> int:
    """Refit and print; `--publish` writes the refit as the next version. The catalog still pins
    the served version, so publishing changes nothing a board reads until the pin moves."""
    parser = argparse.ArgumentParser(prog="research.model.fits.game_variance")
    parser.add_argument("--publish", action="store_true", help="publish the refit as the next version")
    args = parser.parse_args(argv)
    engine = make_engine(database_url_from_env())
    with engine.begin() as conn:
        priors = fit_skill_game_variance(conn)
        sys.stdout.write(json.dumps(priors) + "\n")
        if args.publish:
            version = CATALOG[ARTIFACT] + 1
            fitted_on = (
                f"Fit on {' and '.join(map(str, TRAIN_SEASONS))}; {' and '.join(map(str, HELD_OUT_SEASONS))} held out"
            )
            outcome = publish_artifact(conn, ARTIFACT, version, priors, datetime.now(UTC), fitted_on)
            sys.stdout.write(f"{outcome}: {ARTIFACT} v{version}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
