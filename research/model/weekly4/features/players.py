"""THE PLAYER ROWS OF ONE INSTANT (round 4 preregistration, sections 2.2 to 2.4).

Round 3's snapshot gives the box-score reads of weeks before W and week W's filings at t_g
(`weekly3.snapshot.read_snapshot`, its own `box` and `filings` stamps): each player's line-weeks
(his club edges with his snap share), his latest club, the club rows and the filings. The week-W
depth chart (or week W-1's on the stamp check's fallback, section 5 item 6) is read at t_g. A
player's club is his latest club edge before W (round 3's rule, the old club until his first line
for a new one); a skill player on the club's chart with no edge this season is placed on it too.

The rows: every universe skill player (QB, RB, WR, TE) so placed on a club whose game kicks off at
this instant. The populations the fit and the judgment use are chosen by Lane 69 from these, with
the outcome reader; this store reads no week-W line.
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final, Literal

from sqlalchemy import Connection

from research.model.weekly.round.scoring import SKILL_POSITIONS
from research.model.weekly3.allowance import Allowance, GroupTotals, allowance, group_totals
from research.model.weekly3.ledger import Stamp
from research.model.weekly3.snapshot import Snapshot, read_snapshot
from research.model.weekly3.work import KINDS_BY_POSITION, NO_SNAP_ROW, SNAP_SHARE
from research.model.weekly4.features.admitted import DEPTH_CHARTS, DEPTH_COLUMNS, admit_read
from research.model.weekly4.features.matchup import role_allowances
from research.model.weekly4.features.plays import PlayerTally
from research.model.weekly4.features.reads import DepthRow, as_of_rows
from research.model.weekly4.features.rows import ClubGame, PlayerInputs, Row, player_row
from research.model.weekly4.features.shares import LAST_GAMES, GameShare, history
from research.model.weekly4.features.teammates import Teammates, returning, vacated
from research.model.weekly4.features.view import InstantView, SeasonInputs
from research.pipeline.observations import PlayerWeekObservation

DepthRule = Literal["week", "prior"]
DEPTH_PAIRS: Final = tuple((DEPTH_CHARTS, column) for column in DEPTH_COLUMNS)


@dataclass(frozen=True, slots=True)
class PlayerInstant:
    rows: tuple[Row, ...]
    stamps: tuple[Stamp, ...]
    counts: Mapping[str, int]


def depth_charts(
    rows: Sequence[DepthRow], season: int, week: int, moment: datetime, rule: DepthRule
) -> tuple[dict[str, dict[str, int]], int, Stamp]:
    """Each club's chart at t_g (week W's, or week W-1's on the stamp check's fallback): player -> his
    best depth order, the chart's week, and the read's stamp."""
    chart_week = week if rule == "week" else week - 1
    kind: Literal["depth", "depth_prior"] = "depth" if rule == "week" else "depth_prior"
    found = as_of_rows(rows, chart_week, chart_week, moment)
    stamp = admit_read(kind, DEPTH_PAIRS, found, season, week, moment)
    by_club: dict[str, dict[str, int]] = defaultdict(dict)
    for r in found:
        best = by_club[r.team].get(r.player_id)
        by_club[r.team][r.player_id] = r.depth_order if best is None else min(best, r.depth_order)
    return by_club, chart_week, stamp


def _by_player[V](items: Mapping[tuple[str, int], V]) -> dict[str, dict[int, V]]:
    found: dict[str, dict[int, V]] = defaultdict(dict)
    for (pid, week), value in items.items():
        found[pid][week] = value
    return found


def _candidates(club: str, snapshot: Snapshot, chart: Mapping[str, int], positions: Mapping[str, str]) -> list[str]:
    on_club = {pid for pid, c in snapshot.clubs.items() if c == club}
    chart_only = {pid for pid in chart if pid not in snapshot.clubs}
    return sorted(pid for pid in on_club | chart_only if positions.get(pid) in SKILL_POSITIONS)


def read_players(  # noqa: PLR0913, PLR0917 - one instant's player reads, named
    conn: Connection,
    s: SeasonInputs,
    view: InstantView,
    depth_rows: Sequence[DepthRow],
    rule: DepthRule,
    prior: Mapping[str, tuple[GameShare, ...]],
    positions: Mapping[str, str],
) -> PlayerInstant:
    week, season = view.week, s.season
    snapshot = read_snapshot(conn, season, week, view.moment)
    charts, chart_week, depth_stamp = depth_charts(depth_rows, season, week, view.moment, rule)
    histories = {pid: history(pid, games, view.tallies) for pid, games in snapshot.games.items()}
    charted: dict[str, list[PlayerWeekObservation]] = defaultdict(list)
    for row in view.charted:
        charted[row.player_id].append(row)
    at = _Instant(
        s,
        view,
        snapshot,
        histories,
        prior,
        _by_player(view.tallies.players),
        charted,
        positions,
        chart_week,
        group_totals(snapshot.games, positions),
    )
    rows: list[Row] = []
    counts: dict[str, int] = defaultdict(int)
    for club in view.clubs:
        chart = charts.get(club, {})
        mates = Teammates(
            club,
            s.schedule.club_weeks(club, week)[-LAST_GAMES:],
            histories,
            snapshot.clubs,
            snapshot.statuses,
            frozenset(chart) if rule == "week" else None,
        )
        _count_teammates(counts, mates)
        rows += _club_rows(at, club, chart, mates)
    return PlayerInstant(tuple(rows), (*snapshot.stamps, depth_stamp), dict(counts))


@dataclass(frozen=True, slots=True)
class _Instant:
    s: SeasonInputs
    view: InstantView
    snapshot: Snapshot
    histories: Mapping[str, tuple[GameShare, ...]]
    prior: Mapping[str, tuple[GameShare, ...]]
    tallies: Mapping[str, Mapping[int, PlayerTally]]
    charted: Mapping[str, list[PlayerWeekObservation]]
    positions: Mapping[str, str]
    chart_week: int
    totals: GroupTotals  # round 3's position-group totals, for its volume allowances


def _count_teammates(counts: dict[str, int], mates: Teammates) -> None:
    """The club-game's returning and withheld teammates, counted once per club-game (2.2's report)."""
    back, gone = returning("", mates), vacated("", mates)
    counts["club_games"] += 1
    counts["returning_teammates"] += back.counted
    counts["club_games_with_a_returning_teammate"] += int(back.counted > 0)
    counts["teammates_absent_without_evidence"] += back.without_evidence
    counts["vacating_teammates"] += gone.counted
    counts["club_games_with_vacated_shares"] += int(gone.counted > 0)
    counts["withheld_teammates_not_in_the_last_three"] += gone.left_out


def _allowances(at: _Instant, game: ClubGame, position: str) -> tuple[dict[str, Allowance], dict[str, Allowance]]:
    week, schedule, snapshot, totals = at.view.week, at.s.schedule, at.snapshot, at.totals
    kinds = [k for k in KINDS_BY_POSITION[position] if k != SNAP_SHARE]
    volume: dict[str, Allowance] = {
        k: allowance(game.opponent, week, position, k, schedule, totals, snapshot.team_rows) for k in kinds
    }
    return volume, role_allowances(game.opponent, week, position, schedule, at.view.tallies)


def _club_rows(at: _Instant, club: str, chart: Mapping[str, int], mates: Teammates) -> list[Row]:
    game = at.view.games[club]
    cache: dict[str, tuple[dict[str, Allowance], dict[str, Allowance]]] = {}
    rows: list[Row] = []
    for pid in _candidates(club, at.snapshot, chart, at.positions):
        position = at.positions[pid]
        if position not in cache:
            cache[position] = _allowances(at, game, position)
        volume, role = cache[position]
        edge_games = at.snapshot.games.get(pid, ())
        inputs = PlayerInputs(
            pid,
            position,
            at.snapshot.statuses.get(pid),
            at.histories.get(pid, ()),
            at.prior.get(pid, ()),
            frozenset(d for g in edge_games for d in g.defaults if d == NO_SNAP_ROW),
            at.tallies.get(pid, {}),
            at.charted.get(pid, []),
            chart.get(pid),
            at.chart_week,
            mates.recent_weeks,
            vacated(pid, mates),
            returning(pid, mates),
            volume,
            role,
        )
        rows.append(player_row(game, inputs))
    return rows
