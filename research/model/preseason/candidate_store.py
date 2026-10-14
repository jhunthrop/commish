"""A BOARD'S CANDIDATE SET, KEPT: written beside the board, read back exactly (revision 0005).

`preseason_board` is a pure function of its candidates, the rules, the shape and the game-variance
priors. Keeping the candidates the stored board was given, field for field, is what lets a board
for a league's exact rules be built later from the same generation. Every float is written as the
shortest decimal that round-trips it (JSON from Python's `repr`, `double precision` from Postgres
12 on), so what is read back is the same bits that were written.
"""

import json
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.domain import STAT_LINE_FIELDS, StatLine
from research.model.preseason.availability import GamesPlayedOutlook, ProjectionDistribution
from research.model.preseason.candidates import BoardCandidate, Reason
from research.model.preseason.inputs import MomentKind

_COLUMNS: Final = (
    "season, source, as_of, player_id, ordinal, model_version, position, team, per_game, games, reasons, "
    "per_game_tier_points, season_projection_error_variance"
)
_INSERT: Final = text(
    f"insert into research.preseason_candidates ({_COLUMNS}) values (:season, :source, :as_of, :player_id, "
    ":ordinal, :model_version, :position, :team, cast(:per_game as jsonb), cast(:games as jsonb), cast(:reasons as jsonb), "
    ":per_game_tier_points, :season_projection_error_variance) on conflict do nothing"
)


class MissingCandidatesError(LookupError):
    """The served generation has no candidate set kept beside it."""


def _json(value: object) -> str:
    return json.dumps(value, allow_nan=False, separators=(",", ":"))


def _stat_line(line: StatLine) -> dict[str, Any]:
    return {name: getattr(line, name) for name in STAT_LINE_FIELDS if getattr(line, name) is not None}


def _games(games: GamesPlayedOutlook) -> dict[str, Any]:
    spread = games.distribution
    return {
        "expected": games.expected,
        "rate": games.rate,
        "distribution": {"floor": spread.floor, "median": spread.median, "ceiling": spread.ceiling},
        "probabilities": list(games.probabilities),
    }


def candidate_row(  # noqa: PLR0913, PLR0917 - the row's key, its place and its maker
    candidate: BoardCandidate, ordinal: int, season: int, source: str, as_of: datetime, model_version: str
) -> dict[str, Any]:
    """One candidate as its stored row."""
    return {
        "season": season,
        "source": source,
        "as_of": as_of,
        "player_id": candidate.player_id,
        "ordinal": ordinal,
        "model_version": model_version,
        "position": candidate.position,
        "team": candidate.team,
        "per_game": _json(_stat_line(candidate.per_game)),
        "games": _json(_games(candidate.games)),
        "reasons": _json([dict(reason) for reason in candidate.reasons]),
        "per_game_tier_points": candidate.per_game_tier_points,
        "season_projection_error_variance": candidate.season_projection_error_variance,
    }


def candidate_of(row: Mapping[str, Any]) -> BoardCandidate:
    """A stored row as the candidate it was written from."""
    games = row["games"]
    spread = games["distribution"]
    reasons: tuple[Reason, ...] = tuple(dict(reason) for reason in row["reasons"])
    return BoardCandidate(
        player_id=row["player_id"],
        position=row["position"],
        team=row["team"],
        per_game=StatLine(**row["per_game"]),
        games=GamesPlayedOutlook(
            games["expected"],
            games["rate"],
            ProjectionDistribution(spread["floor"], spread["median"], spread["ceiling"]),
            tuple(games["probabilities"]),
        ),
        reasons=reasons,
        per_game_tier_points=row["per_game_tier_points"],
        season_projection_error_variance=row["season_projection_error_variance"],
    )


def write_candidates(  # noqa: PLR0913, PLR0917 - the board writer's own key, beside its board
    conn: Connection,
    season: int,
    source: str,
    as_of: datetime,
    kind: MomentKind,
    candidates: Sequence[BoardCandidate],
    model_version: str,
) -> int:
    """The set beside its board: a live generation replaces the season's previous set (as the
    board does), a replay generation appends."""
    if kind == "live":
        conn.execute(
            text("delete from research.preseason_candidates where season = :season and source = :source"),
            {"season": season, "source": source},
        )
    rows = [
        candidate_row(candidate, ordinal, season, source, as_of, model_version)
        for ordinal, candidate in enumerate(candidates)
    ]
    return sum(conn.execute(_INSERT, row).rowcount for row in rows)


def served_generation(conn: Connection, season: int, source: str) -> datetime | None:
    """The newest stored generation of a board: the one the api serves."""
    row = conn.execute(
        text("select max(as_of) from research.preseason_projections where season = :season and source = :source"),
        {"season": season, "source": source},
    ).first()
    return None if row is None else row[0]


def read_candidates(conn: Connection, season: int, source: str, as_of: datetime) -> list[BoardCandidate]:
    """The candidate set of one generation, in the order the board was given it."""
    rows = conn.execute(
        text(
            f"select {_COLUMNS} from research.preseason_candidates where season = :season and source = :source "
            "and as_of = :as_of order by ordinal"
        ),
        {"season": season, "source": source, "as_of": as_of},
    )
    out = [candidate_of(row._asdict()) for row in rows]
    if not out:
        raise MissingCandidatesError(f"no candidate set is kept for {source} {season} at {as_of.isoformat()}")
    return out
