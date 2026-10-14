"""KEEPING THE SERVED GENERATION'S CANDIDATES: a one-shot for a board written before revision 0005.

A board written from revision 0005 on carries its candidate set (`fit_check --persist-board`). The
board the store serves today was written before, so its set has to be found and kept once. A set
is kept only when it reproduces the stored board exactly: `preseason_board` over it, with the
format's rules and the stored boards' shape, must give every stored row's rank, position rank,
value rank, tier, points and points over replacement to the bit. A set that does not would make
every custom board a different model's.

Where the set comes from:

- the target store itself (the default): the generation rebuilt at its own moment, which works
  until the season's first kickoff (after it the store can see the season's games, and the board
  refuses to be taken live);
- `--point-in-time`: a scratch copy of the dev store as it stood at the generation's moment
  (`research.parity.model.store.scratch_pair_at`, the parity harness's own copy, which reproduces
  the 2026 boards bit for bit), rebuilt there, kept in the target; needs PARITY_DATABASE_URL and
  PARITY_SOURCE_DATABASE_URL;
- `--from-url URL`: another store that already keeps the set (the dev copy, for production's
  one-shot backfill), read and checked against the target's own stored board before it is kept.

Idempotent: a set already kept for the generation is left alone.

    RESEARCH_DATABASE_URL=... uv run python -m research.boards keep-candidates [--point-in-time | --from-url URL]
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection, text

from research.boards.custom import board_rows
from research.model.market.curve import BOARD_FORMATS, FORMAT_RULES, BoardFormat, board_source_for
from research.model.preseason.board import GameVariancePriors, preseason_board
from research.model.preseason.build import BOARD_SHAPE
from research.model.preseason.candidate_store import served_generation, write_candidates
from research.model.preseason.candidates import BoardCandidate
from research.model.preseason.inputs import MomentKind

# The stored columns a kept set must reproduce exactly.
EXACT_COLUMNS: Final = ("rank", "position_rank", "value_rank", "tier", "projected_points", "value_over_replacement")
# Where the candidate sets come from: each format's set at the generation's moment.
type CandidateSets = Callable[[datetime], Mapping[BoardFormat, Sequence[BoardCandidate]]]


class SetDoesNotReproduceError(ValueError):
    """The set does not rebuild the stored board; nothing is kept."""


@dataclass(frozen=True, slots=True)
class Kept:
    source: str
    candidates: int
    already: bool


def stored_rows(conn: Connection, season: int, source: str, as_of: datetime) -> dict[str, dict[str, Any]]:
    rows = conn.execute(
        text(
            f"select player_id, {', '.join(EXACT_COLUMNS)} from research.preseason_projections "
            "where season = :season and source = :source and as_of = :as_of"
        ),
        {"season": season, "source": source, "as_of": as_of},
    )
    return {row.player_id: {column: getattr(row, column) for column in EXACT_COLUMNS} for row in rows}


def differences(stored: Mapping[str, Mapping[str, Any]], rebuilt: Sequence[Mapping[str, Any]]) -> list[str]:
    """Every player or cell on which a rebuilt board and the stored one differ, by name."""
    fresh = {row["player_id"]: row for row in rebuilt}
    found = [f"{player_id} on one side only" for player_id in sorted(set(stored) ^ set(fresh))]
    for player_id in sorted(set(stored) & set(fresh)):
        found.extend(
            f"{player_id} {column} {stored[player_id][column]!r} != {fresh[player_id][column]!r}"
            for column in EXACT_COLUMNS
            if stored[player_id][column] != fresh[player_id][column]
        )
    return found


def reproduces(
    stored: Mapping[str, Mapping[str, Any]],
    candidates: Sequence[BoardCandidate],
    board_format: BoardFormat,
    game_variance: GameVariancePriors,
) -> list[str]:
    """What a candidate set's board, under its format's rules and the stored shape, gets wrong."""
    board = preseason_board(candidates, FORMAT_RULES[board_format], BOARD_SHAPE, game_variance)
    return differences(stored, board_rows(board))


def _has_set(conn: Connection, season: int, source: str, as_of: datetime) -> bool:
    found = conn.execute(
        text(
            "select 1 from research.preseason_candidates where season = :season and source = :source "
            "and as_of = :as_of limit 1"
        ),
        {"season": season, "source": source, "as_of": as_of},
    ).first()
    return found is not None


def _kind(conn: Connection, season: int, source: str, as_of: datetime) -> MomentKind:
    kind = conn.execute(
        text(
            "select moment_kind from research.preseason_projections where season = :season and source = :source "
            "and as_of = :as_of limit 1"
        ),
        {"season": season, "source": source, "as_of": as_of},
    ).scalar_one()
    return "live" if kind == "live" else "replay"


def the_generation(conn: Connection, season: int) -> datetime:
    """The one generation every format of the season serves."""
    moments = {fmt: served_generation(conn, season, board_source_for(fmt)) for fmt in BOARD_FORMATS}
    distinct = set(moments.values())
    if None in distinct or len(distinct) != 1:
        raise SetDoesNotReproduceError(f"the {season} formats are not one stored generation: {moments}")
    moment = moments[BOARD_FORMATS[0]]
    assert moment is not None
    return moment


def keep_served_candidates(
    conn: Connection,
    season: int,
    sets: CandidateSets,
    game_variance: GameVariancePriors,
    model_version: str,
) -> list[Kept]:
    """Each format's served generation's candidate set, checked against the stored board and kept."""
    moment = the_generation(conn, season)
    sources = {fmt: board_source_for(fmt) for fmt in BOARD_FORMATS}
    if all(_has_set(conn, season, source, moment) for source in sources.values()):
        return [Kept(source, 0, already=True) for source in sources.values()]
    found = sets(moment)
    for fmt, source in sources.items():
        wrong = reproduces(stored_rows(conn, season, source, moment), found[fmt], fmt, game_variance)
        if wrong:
            raise SetDoesNotReproduceError(f"{source}: {len(wrong)} differences, first {wrong[0]}")
    return [
        Kept(
            source,
            write_candidates(
                conn, season, source, moment, _kind(conn, season, source, moment), found[fmt], model_version
            ),
            already=False,
        )
        for fmt, source in sources.items()
    ]
