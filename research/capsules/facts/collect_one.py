"""ONE PLAYER'S FACTS, WITHOUT THE WHOLE-BOARD PASS: the narrow cached read for a surface that
needs one man's sheet (a peek, a single capsule rewrite).

Ported from `research-ts/src/capsules/collect-one.ts`. The reads that can be narrowed are: his
identity row, his crosswalk entry, his one projection row and this season's lines. The color and
depth reads are narrowed to the active peers at his position, which leaves every rank he gets
unchanged (each is taken within his position). The served board, for the rank the page shows, is
read once and held for an hour (`ServedBoardCache`, the oracle's `genericBoardRows` memo). The
sheet equals the one the whole-board pass builds for him; the parity case checks that too.
"""

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.capsules.facts.board import (
    BOARD_SOURCE,
    BoardRow,
    board_reasons,
    board_rows,
    bye_weeks_by_team,
    projections_as_of,
)
from research.capsules.facts.build import PlayerFacts, build_player_facts
from research.capsules.facts.collect import (
    Population,
    SharedReads,
    active_peers_for,
    collect_color,
    facts_input_for,
    season_reads,
)
from research.capsules.facts.market_adp import run_market_adp
from research.capsules.facts.reference import capture_day, injury_snapshot, news_for_players
from research.model.laws.registry import chip_eligible_laws
from research.model.priors import load_model_artifacts
from research.season import PRODUCT_SEASON

BOARD_MEMO_SECONDS: Final = 60 * 60


@dataclass(frozen=True, slots=True)
class ServedBoard:
    """What a single-player read takes from the served board: each player's rank and each board
    player's team, by universe id."""

    ranks: Mapping[str, int]
    teams: Mapping[str, str]


@dataclass(slots=True)
class ServedBoardCache:
    """The served board, read at most once an hour per process (`BOARD_REASONS_MEMO_TTL_MS`)."""

    clock: Callable[[], float] = time.monotonic
    _board: ServedBoard | None = None
    _read_at: float | None = None

    def served(self, conn: Connection, as_of: datetime) -> ServedBoard:
        now = self.clock()
        if self._board is None or self._read_at is None or now - self._read_at >= BOARD_MEMO_SECONDS:
            rows = board_rows(conn, PRODUCT_SEASON, as_of)
            self._board = ServedBoard(
                {row.player_id: row.overall_rank for row in rows}, {row.nfl_player_id: row.team for row in rows}
            )
            self._read_at = now
        return self._board


def collect_player_facts(
    conn: Connection, player_id: str, as_of: datetime, served: ServedBoardCache
) -> PlayerFacts | None:
    """`collectPlayerFacts`: his sheet, or None when the board does not rank him."""
    identity = conn.execute(
        text("select id, name, position, team, adp, pos_adp from research.provider_players where id = :id"),
        {"id": player_id},
    ).first()
    if identity is None:
        return None
    crosswalk = conn.execute(
        text("select player_id from research.player_crosswalk where provider_player_id = :id"), {"id": player_id}
    ).first()
    if crosswalk is None or crosswalk.player_id is None:
        return None
    gsis = str(crosswalk.player_id)
    projections = projections_as_of(conn, PRODUCT_SEASON, BOARD_SOURCE, as_of, [gsis])
    if not projections:
        return None
    projection = projections[0]
    peers = active_peers_for(conn, [identity.position], PRODUCT_SEASON)
    board = served.served(conn, as_of)
    color = collect_color(conn, Population(peers, {player_id: gsis}, {gsis: identity.team}, board.teams), as_of)
    rank = board.ranks.get(player_id)
    row = BoardRow(
        player_id, gsis, identity.name, identity.position, identity.team, identity.adp, identity.pos_adp,
        projection.value_rank if rank is None else rank, projection.value_rank, projection.projected_points,
        projection.floor_points, projection.median_points, projection.ceiling_points,
        bye_weeks_by_team(conn, PRODUCT_SEASON).get(identity.team),
        tuple(board_reasons(conn, PRODUCT_SEASON, BOARD_SOURCE, [gsis]).get(gsis, [])),
    )  # fmt: skip
    injuries = injury_snapshot(conn, as_of)
    shared = SharedReads(
        chip_eligible_laws(load_model_artifacts(conn).laws),
        injuries,
        news_for_players(conn, [identity.name], as_of),
        season_reads(conn, as_of, [row], injuries),
        color,
        run_market_adp(conn, as_of),
        capture_day(as_of),
    )
    return build_player_facts(facts_input_for(row, shared))
