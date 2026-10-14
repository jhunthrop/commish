"""A BOARD FOR A LEAGUE'S EXACT RULES: the served generation's candidates, scored and valued.

The stored boards are `preseason_board(candidates, rules, BOARD_SHAPE, game_variance)` over each
format's blended candidate set. A league's own rules take the candidate set whose market blend
matches its reception scoring (`candidate_format`: the blend anchors on that format's ADP), then
the same function with the league's rules and shape. So PPR, half and standard rules reproduce the
three stored boards bit for bit, which `research.parity`'s custom board case proves, and any other
rules are scored exactly, never read as the nearest stored board.

The answer is cached in `custom_boards` by (season, the generation, the rules, the shape): a new
generation is a new key, so a cached answer is never stale and nothing has to expire it.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.boards.request import RULE_KEYS, CustomRequest, shape_json
from research.model.market.curve import BoardFormat, board_source_for
from research.model.preseason.board import BoardEntry, GameVariancePriors, preseason_board
from research.model.preseason.candidate_store import read_candidates, served_generation

# Reception points from which a league's rules take the PPR or the half PPR candidate set: the
# same thresholds the api read a custom rule by before this existed.
PPR_RECEPTION_FROM: Final = 0.75
HALF_RECEPTION_FROM: Final = 0.25
ROW_FIELDS: Final = (
    "player_id",
    "position",
    "rank",
    "position_rank",
    "value_rank",
    "tier",
    "projected_points",
    "value_over_replacement",
    "expected_games",
    "floor_points",
    "median_points",
    "ceiling_points",
)


class NoBoardError(LookupError):
    """The season has no stored board of the format the rules read from."""


@dataclass(frozen=True, slots=True)
class CustomBoard:
    season: int
    source: str
    as_of: datetime
    rows: list[dict[str, Any]]
    cached: bool


def candidate_format(points_per_reception: float) -> BoardFormat:
    """The stored format whose blended candidates a league's rules are scored over."""
    if points_per_reception >= PPR_RECEPTION_FROM:
        return "ppr"
    if points_per_reception >= HALF_RECEPTION_FROM:
        return "half"
    return "std"


def board_rows(board: Sequence[BoardEntry]) -> list[dict[str, Any]]:
    """The board as the api loads it: one row a player, the stored board's own columns."""
    return [
        {
            "player_id": entry.player_id,
            "position": entry.position,
            "rank": entry.rank,
            "position_rank": entry.position_rank,
            "value_rank": entry.value_rank,
            "tier": entry.tier,
            "projected_points": entry.projected_points,
            "value_over_replacement": entry.value_over_replacement,
            "expected_games": entry.expected_games,
            "floor_points": entry.outlook.floor,
            "median_points": entry.outlook.median,
            "ceiling_points": entry.outlook.ceiling,
        }
        for entry in board
    ]


_KEY: Final = "season = :season and as_of = :as_of and rules_hash = :rules_hash and shape_hash = :shape_hash"


def _cached(conn: Connection, key: Mapping[str, Any]) -> list[dict[str, Any]] | None:
    row = conn.execute(text(f"select rows from research.custom_boards where {_KEY}"), key).first()
    return None if row is None else list(row[0])


def _keep(conn: Connection, key: Mapping[str, Any], request: CustomRequest, board: CustomBoard, model: str) -> None:
    rules = {name: getattr(request.rules, name) for name in RULE_KEYS}
    conn.execute(
        text(
            "insert into research.custom_boards (season, as_of, rules_hash, shape_hash, source, rules, shape, rows, "
            "model_version) values (:season, :as_of, :rules_hash, :shape_hash, :source, cast(:rules as jsonb), "
            "cast(:shape as jsonb), cast(:rows as jsonb), :model_version) on conflict do nothing"
        ),
        {
            **key,
            "source": board.source,
            "rules": json.dumps(rules, allow_nan=False),
            "shape": json.dumps(shape_json(request.shape), allow_nan=False),
            "rows": json.dumps(board.rows, allow_nan=False),
            "model_version": model,
        },
    )


def custom_board(
    conn: Connection, request: CustomRequest, game_variance: GameVariancePriors, model_version: str
) -> CustomBoard:
    """The board for the request's rules and shape, from the cache or built and kept."""
    source = board_source_for(candidate_format(request.rules.points_per_reception))
    as_of = served_generation(conn, request.season, source)
    if as_of is None:
        raise NoBoardError(f"no stored {source} board for {request.season}")
    key = {
        "season": request.season,
        "as_of": as_of,
        "rules_hash": request.rules_hash,
        "shape_hash": request.shape_hash,
    }
    rows = _cached(conn, key)
    if rows is not None:
        return CustomBoard(request.season, source, as_of, rows, cached=True)
    candidates = read_candidates(conn, request.season, source, as_of)
    board = preseason_board(candidates, request.rules, request.shape, game_variance)
    built = CustomBoard(request.season, source, as_of, board_rows(board), cached=False)
    _keep(conn, key, request, built, model_version)
    return built
