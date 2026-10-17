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

from sqlalchemy import Connection

from research.model.weekly.round.scoring import SKILL_POSITIONS
from research.model.weekly2.designation import WeekStatus
from research.model.weekly3.allowance import Allowance, GroupTotals, allowance, group_totals
from research.model.weekly3.ledger import Stamp
from research.model.weekly3.snapshot import Snapshot, read_snapshot
from research.model.weekly3.work import KINDS_BY_POSITION, NO_SNAP_ROW, SNAP_SHARE
from research.model.weekly4.features.depth import DepthChart, DepthRule, depth_charts
from research.model.weekly4.features.filings import earlier_filings, live_statuses
from research.model.weekly4.features.matchup import role_allowances
from research.model.weekly4.features.plays import PlayerTally
from research.model.weekly4.features.reads import DepthRow
from research.model.weekly4.features.rows import ClubGame, PlayerInputs, Row, player_row
from research.model.weekly4.features.shares import LAST_GAMES, GameShare, history
from research.model.weekly4.features.teammates import Teammates, returning, vacated
from research.model.weekly4.features.view import InstantView, SeasonInputs
from research.pipeline.observations import PlayerWeekObservation


@dataclass(frozen=True, slots=True)
class PlayerInstant:
    rows: tuple[Row, ...]
    stamps: tuple[Stamp, ...]
    counts: Mapping[str, int]


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
    depth = depth_charts(depth_rows, season, week, view.moment, rule)
    earlier, earlier_stamp = earlier_filings(conn, season, week, view.moment)
    stamps: list[Stamp] = [*snapshot.stamps, depth.stamp, earlier_stamp]
    statuses: Mapping[str, WeekStatus] = snapshot.statuses
    if s.live:  # amendment 2 item 7: live, Tank01's word from lane 63's status rows
        statuses, live_stamp = live_statuses(conn, season, week, view.moment)
        stamps.append(live_stamp)
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
        depth,
        group_totals(snapshot.games, positions),
        statuses,
    )
    rows: list[Row] = []
    counts: dict[str, int] = defaultdict(int)
    for club in view.clubs:
        chart = depth.ranks.get(club, {})
        mates = Teammates(
            club,
            s.schedule.club_weeks(club, week)[-LAST_GAMES:],
            histories,
            snapshot.clubs,
            statuses,
            frozenset(chart) if rule == "week" else None,
            earlier,
        )
        _count_teammates(counts, mates)
        rows += _club_rows(at, club, chart, mates)
    return PlayerInstant(tuple(rows), tuple(stamps), dict(counts))


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
    depth: DepthChart
    totals: GroupTotals  # round 3's position-group totals, for its volume allowances
    statuses: Mapping[str, WeekStatus]  # week W's filings at t_g (live: Tank01's word)


def _count_teammates(counts: dict[str, int], mates: Teammates) -> None:
    """The club-game's returning and withheld teammates, counted once per club-game (2.2's report)."""
    back, gone = returning("", mates), vacated("", mates)
    counts["club_games"] += 1
    counts["returning_teammates"] += back.counted
    counts["club_games_with_a_returning_teammate"] += int(back.counted > 0)
    counts["teammates_absent_without_evidence"] += back.without_evidence
    counts["returning_teammates_without_an_out_or_doubtful_filing"] += back.without_withheld_filing
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
            at.statuses.get(pid),
            at.histories.get(pid, ()),
            at.prior.get(pid, ()),
            frozenset(d for g in edge_games for d in g.defaults if d == NO_SNAP_ROW),
            at.tallies.get(pid, {}),
            at.charted.get(pid, []),
            chart.get(pid),
            at.depth.week,
            at.depth.mapped,
            mates.recent_weeks,
            vacated(pid, mates),
            returning(pid, mates),
            volume,
            role,
        )
        rows.append(player_row(game, inputs))
    return rows
