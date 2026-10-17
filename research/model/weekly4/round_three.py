"""ROUND 3'S PATH, READ FOR ROUND 4 (preregistration sections 3.1, 6.3).

Round 3's own code fits and scores its number for G7's benchmark: "`commish_weekly_v3`'s x, recomputed
... by its committed code, its stage 1 fit on" the round's fit seasons. Before it is used as a benchmark
its development check's 26 gate lines are reproduced exactly against their committed record (6.3). Its
read of the judged season gives the population, ADP, the rounds' recent form, every week's lines and
the rate m; the fit seasons are read again, weeks 4 to 17, for the rate m of the player-level fit rows
(round 3 read weeks 6 to 17 only), each read through an outcome reader on its seasons.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any, Final

import pandas as pd
from sqlalchemy import Connection

from research.model.domain import Position
from research.model.priors import ModelArtifacts
from research.model.weekly.round.judge import table_digests
from research.model.weekly2.board import WeekBoard
from research.model.weekly2.gates import GateLine, Thresholds
from research.model.weekly2.judge import DOCS
from research.model.weekly2.judgment import assess
from research.model.weekly2.statistics import JudgedRow, population
from research.model.weekly3.gates import isolation_line
from research.model.weekly3.judge import RoundFit, fit_round
from research.model.weekly3.judgment import score_season
from research.model.weekly3.ledger import per_game_clause
from research.model.weekly3.outcomes import GameOutcomeReader, fit_reader, judgment_reader
from research.model.weekly3.season import SeasonRead, read_season
from research.model.weekly4.play_model import FORMAT_NAMES

ROUND_THREE_RECORD: Final = DOCS / "2026-10-15-weekly-projection-round3-dev-check.json"


@dataclass(frozen=True, slots=True)
class RoundThree:
    fit: RoundFit
    judged: SeasonRead
    rows: tuple[JudgedRow, ...]  # the judged season's population, round 3's number beside ADP and form
    lines: tuple[GateLine, ...]  # its 26 lines on this run
    served: tuple[int, ...]  # the outcome seasons its readers served


def run_round_three(
    conn: Connection, t: Thresholds, artifacts: ModelArtifacts, positions: Mapping[str, Position], version: str
) -> RoundThree:
    """Round 3's fit and its judged season, scored and assessed by its own code."""
    before = table_digests(conn)
    fitted, _ = fit_round(conn, t, artifacts, fit_reader(t), positions)
    read, reader = read_season(conn, t.judgment_season, t, fitted.rate.priors, artifacts, positions, judgment_reader(t))
    scored = score_season(read, fitted, positions, t, version)
    lines, _ = assess(scored, fitted.ranges.band, t)
    after = table_digests(conn)
    clause = per_game_clause((*fitted.games, *read.games), (*fitted.stamps, *read.all_stamps))
    g5 = isolation_line(fitted.served, reader.served, before, after, clause, t)
    return RoundThree(fitted, read, scored.rows, (*lines, g5), (*fitted.served, *reader.served))


def reproduction(lines: Sequence[GateLine], record: Path = ROUND_THREE_RECORD) -> list[str]:
    """Each of the 26 recorded lines this run does not reproduce exactly (empty: reproduced)."""
    recorded = json.loads(record.read_text())["gates"]
    found = [asdict(line) for line in lines]
    if len(found) != len(recorded):
        return [f"{len(found)} lines against {len(recorded)} recorded"]
    return [f"{r['gate']} {r['subject']}: {f} against {r}" for f, r in zip(found, recorded, strict=True) if f != r]


def fit_season_reads(  # noqa: PLR0913, PLR0917 - the reads one season needs, named
    conn: Connection,
    t: Thresholds,
    fitted: RoundFit,
    artifacts: ModelArtifacts,
    positions: Mapping[str, Position],
    weeks: Sequence[int],
) -> tuple[list[SeasonRead], GameOutcomeReader]:
    """The fit seasons read again at `weeks`, for the rate m of every fit row (weeks 4 to 17)."""
    reader = fit_reader(t)
    found: list[SeasonRead] = []
    for season in t.fit_seasons:
        read, reader = read_season(
            conn, season, replace(t, weeks=tuple(weeks)), fitted.rate.priors, artifacts, positions, reader
        )
        found.append(read)
    return found, reader


def candidates(board: WeekBoard, sizes: Mapping[str, int]) -> frozenset[str]:
    """The week's projected set (2.6, the identities): at each position the union of ADP's top K and
    the season-to-date top K, the population's own lists before its line filter (3.1), known before
    kickoff. A player outside it (a backup, a fullback, a third tight end) is the residual's."""
    everyone = {p.player_id for p in board.players}
    positions = {p.player_id: str(p.position) for p in board.players}
    to_date = {p.player_id: p.to_date for p in board.players if p.games > 0}
    found: set[str] = set()
    for position, size in sizes.items():
        found |= population(position, everyone, board.adp, to_date, positions, size)
    return frozenset(found)


def rates(reads: Sequence[SeasonRead], sizes: Mapping[str, int]) -> pd.DataFrame:
    """The rate m per (season, week, player) in each format (`rate_m_<format>`), and whether he is in
    the week's projected set (`candidate`)."""
    rows: list[dict[str, Any]] = []
    for read in reads:
        for week in read.weeks:
            chosen = candidates(week.board, sizes)
            for player in week.board.players:
                rows.append(
                    {
                        "season": read.season,
                        "week": week.board.week,
                        "player_id": player.player_id,
                        **{f"rate_m_{name}": float(player.rate[name]) for name in FORMAT_NAMES},
                        "candidate": int(player.player_id in chosen),
                    }
                )
    return pd.DataFrame(rows).drop_duplicates(["season", "week", "player_id"])


def lines_of(read: SeasonRead) -> pd.DataFrame:
    """Every week's lines of the season in each format, with the line's club."""
    rows = [
        {"season": read.season, "week": week, "player_id": pid, "club": o.club, **dict(o.points)}
        for week, by in read.outcomes.items()
        for pid, o in by.items()
    ]
    return pd.DataFrame(rows, columns=["season", "week", "player_id", "club", *FORMAT_NAMES])
