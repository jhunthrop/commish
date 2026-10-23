"""WHAT ROUND 3'S READS GIVE THE RUN, AND THE ONE NEW OUTCOME READ (preregistration 2.5, 3.1, 6.3).

Round 3's code is reproduced first (its development check's 26 lines exactly, `weekly4.round_three`), then
read as round 4 read it: the fit seasons again at weeks 4 to 17 for every fit row's rate m, its lines and
the rounds' recent form (each week's board, round 1's function, which G2 benchmarks), and the judged
season's population, ADP, form, lines and rate m from round 3's own judged read. Each read goes through a
ledgered outcome reader on its seasons.

The one read this round adds: the fit window's fumbles lost from each week-W line (2.5: "Fumbles lost come
from the week-W line's `fumbles_lost`"), through round 2's `WeekOutcomeReader` refusing the judged season
and every season after it, so its ledger joins G5's player readers.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import pandas as pd
from sqlalchemy import Connection

from research.model.domain import Position
from research.model.instants import FAR_FUTURE
from research.model.priors import ModelArtifacts
from research.model.reads.observations import ObservationQuery, WeekRange, stat_lines_for_measurement
from research.model.weekly.round.scoring import FORMATS
from research.model.weekly2.gates import GateLine
from research.model.weekly2.guard import LAST_JUDGED_WEEK, WeekOutcomeReader
from research.model.weekly2.guard import fit_reader as points_fit_reader
from research.model.weekly2.statistics import JudgedRow
from research.model.weekly3.judge import RoundFit
from research.model.weekly3.ledger import per_game_clause
from research.model.weekly3.season import SeasonRead
from research.model.weekly4.round_three import RoundThree, fit_season_reads, lines_of, rates
from research.model.weekly5.gates import RoundFive
from research.model.weekly5.system import Sources


def forms(reads: Sequence[SeasonRead]) -> pd.DataFrame:
    """The rounds' recent form per (season, week, player) in each format (`form_<format>`): each week's board,
    round 1's function, the benchmark G2 reads (guard test 5)."""
    rows: list[dict[str, Any]] = []
    for read in reads:
        for week in read.weeks:
            for pid, points in week.board.form.items():
                rows.append(
                    {
                        "season": read.season,
                        "week": week.board.week,
                        "player_id": pid,
                        **{f"form_{n}": float(points[n]) for n in FORMATS},
                    }
                )
    columns = ["season", "week", "player_id", *(f"form_{n}" for n in FORMATS)]
    return pd.DataFrame(rows, columns=columns).drop_duplicates(["season", "week", "player_id"])


def fumbles_lost(
    conn: Connection, seasons: Sequence[int], reader: WeekOutcomeReader
) -> tuple[pd.DataFrame, WeekOutcomeReader]:
    """Each lined player-week's fumbles lost over `seasons`, through the ledgered reader."""
    rows: list[dict[str, Any]] = []
    for season in seasons:
        reader = reader.admit(season)
        query = ObservationQuery(season, WeekRange(1, LAST_JUDGED_WEEK), FAR_FUTURE)
        for row in stat_lines_for_measurement(conn, query):
            rows.append(
                {
                    "season": season,
                    "week": row.line.week,
                    "player_id": row.line.player_id,
                    "fumbles_lost": row.line.fumbles_lost,
                }
            )
    found = pd.DataFrame(rows, columns=["season", "week", "player_id", "fumbles_lost"])
    return found.drop_duplicates(["season", "week", "player_id"], keep="last"), reader


@dataclass(frozen=True, slots=True)
class FitReads:
    """The fit seasons' reads (before the claim): the rate m, lines, forms and fumbles of the player window."""

    rates: pd.DataFrame
    lines: pd.DataFrame
    forms: pd.DataFrame
    fumbles: pd.DataFrame
    served: tuple[int, ...]
    clause: tuple[bool, str]


def fit_reads(
    conn: Connection,
    t: RoundFive,
    fit: RoundFit,
    artifacts: ModelArtifacts,
    positions: Mapping[str, Position],
) -> FitReads:
    """The player window read again at weeks 4 to 17 with round 3's fit of the run (the rate m, lines, forms),
    and its fumbles lost."""
    reads, reader = fit_season_reads(conn, t.round_three, fit, artifacts, positions, t.fit_weeks)
    fumbles, fumble_reader = fumbles_lost(conn, t.player_fit_seasons, points_fit_reader(t.round_three))
    clause = per_game_clause(tuple(g for r in reads for g in r.games), tuple(s for r in reads for s in r.all_stamps))
    return FitReads(
        rates(reads, t.population),
        pd.concat([lines_of(r) for r in reads], ignore_index=True),
        forms(reads),
        fumbles,
        (*reader.served, *fumble_reader.served),
        clause,
    )


@dataclass(frozen=True, slots=True)
class JudgedReads:
    """Round 3's judged season: its population rows, its 26 lines, its readers' seasons and clause."""

    rows: tuple[JudgedRow, ...]
    lines: tuple[GateLine, ...]
    rates: pd.DataFrame
    season_lines: pd.DataFrame
    forms: pd.DataFrame
    served: tuple[int, ...]
    fit_served: tuple[int, ...]


def judged_reads(three: RoundThree, t: RoundFive) -> JudgedReads:
    return JudgedReads(
        three.rows,
        three.lines,
        rates([three.judged], t.population),
        lines_of(three.judged),
        forms([three.judged]),
        tuple(s for s in three.served if s not in three.fit.served),
        tuple(three.fit.served),
    )


def sources_of(fit: FitReads, judged: JudgedReads) -> Sources:
    return Sources(
        pd.concat([fit.rates, judged.rates], ignore_index=True).drop_duplicates(["season", "week", "player_id"]),
        pd.concat([fit.lines, judged.season_lines], ignore_index=True).drop_duplicates(["season", "week", "player_id"]),
        pd.concat([fit.forms, judged.forms], ignore_index=True).drop_duplicates(["season", "week", "player_id"]),
        fit.fumbles,
    )
