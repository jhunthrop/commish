"""THE DEPTH PASS: every depth fact for every board player, from one read of each store.

Ported from `research-ts/src/capsules/facts/collect-depth.ts`. Subjects are the board's players
(by universe id, with the team the board has them on); the population each rank is taken over is
the active peers at their positions. A player the stores hold nothing for gets `EMPTY_DEPTH`.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final

from sqlalchemy import Connection

from research.capsules.facts import depth_reads as reads
from research.capsules.facts import history as cached
from research.capsules.facts.depth_absence import (
    InjuryCapture,
    SeasonInputs,
    games_missed_for,
    injury_history_for,
    season_endings_for,
)
from research.capsules.facts.depth_context import (
    AdpCapture,
    PedigreeRow,
    ScheduledGame,
    TeamMetricRow,
    coaching_for,
    market_movement_for,
    pedigree_for,
    schedule_for,
    team_context_for,
)
from research.capsules.facts.depth_model import Depth, PriorSeason, ScoringUsage, TargetCompetition
from research.capsules.facts.depth_role import (
    DepthRow,
    PlayerWeekShare,
    TeamPlayerTargets,
    depth_chart_for,
    prior_seasons_for,
    role_trend_for,
    scoring_usage_for,
    target_competition_for,
    volatility_for,
)
from research.capsules.facts.model import WeekPoints
from research.capsules.facts.rank import RankableStat, rank_within_groups
from research.db.read_cache import UNCACHED, ReadThrough
from research.model.domain import Position
from research.model.jsmath import js_round
from research.model.preseason.availability_history import (
    WeeklyInjuryReport,
    WeeklyRosterStatus,
    availability_store_coverage,
)
from research.model.reads.observations import LAST_POSSIBLE_WEEK, WeekRange
from research.model.reads.teams import first_kickoff_for
from research.pipeline.coaches import PlayCallerRow, read_coach_rows
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource, regular_season_games_per_team
from research.pipeline.nflverse.team_codes import product_team_code, source_team_code

ADP_WINDOW_DAYS: Final = 45
INJURY_CAPTURE_LIMIT: Final = 60
CAREER_SEASONS: Final = 3


def depth_prior_seasons(product_season: int) -> tuple[int, ...]:
    """`depthPriorSeasons`: the three seasons before the product season, newest first."""
    return tuple(product_season - 1 - index for index in range(CAREER_SEASONS))


@dataclass(frozen=True, slots=True)
class DepthOptions:
    product_season: int
    prior_seasons: tuple[int, ...]
    positions: Mapping[str, Position]
    team_by_player_id: Mapping[str, str]
    as_of: datetime
    # The team every board player is on, for placing his depth-chart room (`team_by_player_id` when
    # None: the board pass's subjects are the whole board). A single-player read passes the served
    # board's, so his room holds the same men the board pass puts in it.
    room_teams: Mapping[str, str] | None = None


def _headlines(
    season: int, scores: Mapping[str, Sequence[WeekPoints]], options: DepthOptions, names: Mapping[str, str]
) -> dict[str, PriorSeason]:
    """`headlinesFor`: each player's season total (to the tenth) and his finish at his position."""
    by_position: dict[Position, list[RankableStat]] = {}
    totals: dict[str, tuple[float, int]] = {}
    for player_id, weeks in scores.items():
        position = options.positions.get(player_id)
        if position is None or not weeks:
            continue
        points = 0.0
        for week in weeks:
            points += week.points
        total = js_round(points * 10) / 10
        totals[player_id] = (total, len(weeks))
        by_position.setdefault(position, []).append(RankableStat(player_id, names.get(player_id, player_id), total))
    ranks = rank_within_groups(by_position)
    return {
        player_id: PriorSeason(season, total, games, ranks[player_id].position_rank, ranks[player_id].qualifier_count)
        for player_id, (total, games) in totals.items()
        if player_id in ranks
    }


@dataclass(frozen=True, slots=True)
class _Pass:
    options: DepthOptions
    names: Mapping[str, str]
    injury_reports: Mapping[str, Sequence[WeeklyInjuryReport]]
    roster_statuses: Mapping[str, Sequence[WeeklyRosterStatus]]
    covered: frozenset[int]
    week_scores: Mapping[int, Mapping[str, Sequence[WeekPoints]]]
    headlines: Mapping[int, Mapping[str, PriorSeason]]
    captures: Sequence[InjuryCapture]
    pedigree: Mapping[str, PedigreeRow]
    colleges: Mapping[str, str | None]
    opening_day: datetime | None
    rows_by_room: Mapping[tuple[str, Position], Sequence[DepthRow]]
    weekly_shares: Mapping[str, Sequence[PlayerWeekShare]]
    competition_by_team: Mapping[str, TargetCompetition | None]
    scoring_usage: Mapping[str, ScoringUsage]
    play_callers: Sequence[PlayCallerRow]
    prior_team_rows: Mapping[str, Sequence[TeamMetricRow]]
    week_one_team_rows: Mapping[str, Sequence[TeamMetricRow]]
    games: Sequence[ScheduledGame]
    indoors: Mapping[str, Mapping[int, bool]]
    adp_history: Mapping[str, Sequence[AdpCapture]]


def _seasons(player_id: str, data: _Pass) -> list[SeasonInputs]:
    out: list[SeasonInputs] = []
    for season in data.options.prior_seasons:
        key = reads.season_key(player_id, season)
        played = [week.week for week in data.week_scores.get(season, {}).get(player_id, ())]
        out.append(
            SeasonInputs(
                season,
                regular_season_games_per_team(season),
                season in data.covered,
                data.roster_statuses.get(key, ()),
                data.injury_reports.get(key, ()),
                played,
            )
        )
    return out


def _depth_for(player_id: str, team: str, data: _Pass) -> Depth:
    options = data.options
    position = options.positions.get(player_id)
    prior = options.prior_seasons[0] if options.prior_seasons else None
    source_team = source_team_code(team)
    product_team = product_team_code(source_team)
    seasons = _seasons(player_id, data)
    pedigree_row = data.pedigree.get(player_id)
    recent = () if prior is None else data.week_scores.get(prior, {}).get(player_id, ())
    return Depth(
        season_endings_for(seasons),
        games_missed_for(seasons),
        injury_history_for(player_id, data.captures),
        coaching_for(source_team, options.product_season, data.play_callers),
        None
        if pedigree_row is None
        else pedigree_for(pedigree_row, data.opening_day, options.product_season, data.colleges.get(player_id)),
        None if position is None else depth_chart_for(player_id, product_team, position, data.rows_by_room, data.names),
        None if prior is None else role_trend_for(prior, data.weekly_shares.get(player_id, ())),
        data.competition_by_team.get(source_team),
        data.scoring_usage.get(player_id),
        None
        if prior is None
        else team_context_for(
            prior, data.prior_team_rows.get(source_team, ()), data.week_one_team_rows.get(source_team, ())
        ),
        schedule_for(product_team, data.games, data.indoors.get(source_team, {})),
        market_movement_for(data.adp_history.get(player_id, ())),
        None if prior is None else volatility_for(prior, recent),
        prior_seasons_for([data.headlines.get(season, {}).get(player_id) for season in options.prior_seasons]),
    )


def _indoors(rows: Mapping[str, Sequence[TeamMetricRow]]) -> dict[str, dict[int, bool]]:
    out: dict[str, dict[int, bool]] = {}
    for team, team_rows in rows.items():
        by_week = {row.week: row.value == 1 for row in team_rows if row.metric == ScheduleMetric.INDOORS}
        if by_week:
            out[team] = by_week
    return out


def _depth_rows(
    slots: Mapping[str, reads.DepthSlot], options: DepthOptions, team_of: Mapping[str, str]
) -> dict[tuple[str, Position], list[DepthRow]]:
    """Week one's depth slots at the population's positions, each under his club in the product's
    spelling: the board's team for a board player (a product code), else the club he played most of
    last season for (the archive's code, `LA`, `WAS`). The oracle passed both through
    `sourceTeamCode`, which throws on an archive code, so its single-player read failed for any
    player whose position room held an unboarded man from those two clubs; each spelling is read as
    what it is here."""
    rooms: dict[tuple[str, Position], list[DepthRow]] = {}
    for player_id, slot in slots.items():
        position = options.positions.get(player_id)
        rooms_known = options.team_by_player_id if options.room_teams is None else options.room_teams
        board_team = rooms_known.get(player_id)
        archive_team = team_of.get(player_id)
        if position is None or (board_team is None and archive_team is None):
            continue
        product = product_team_code(source_team_code(board_team) if board_team is not None else str(archive_team))
        row = DepthRow(player_id, product, position, slot.slot, options.product_season, slot.as_of)
        rooms.setdefault((product, position), []).append(row)
    return rooms


def collect_depth_facts(conn: Connection, options: DepthOptions, history: ReadThrough = UNCACHED) -> dict[str, Depth]:
    """`collectDepthFacts`: one `Depth` per subject; the finished seasons' reads through `history`."""
    subjects = list(options.team_by_player_id)
    if not subjects:
        return {}
    population = list(options.positions)
    prior = options.prior_seasons[0] if options.prior_seasons else None
    season, as_of = options.product_season, options.as_of
    names = reads.names_for(conn, list(dict.fromkeys([*population, *subjects])))
    week_scores = {s: cached.week_scores(history, conn, s, options.positions, as_of) for s in options.prior_seasons}
    targets, team_of = ({}, {}) if prior is None else cached.season_targets(history, conn, prior, population, as_of)
    by_team: dict[str, list[TeamPlayerTargets]] = {}
    for player_id, row in targets.items():
        team = team_of.get(player_id)
        if team is not None:
            by_team.setdefault(team, []).append(row)
    window = WeekRange(1, LAST_POSSIBLE_WEEK)
    data = _Pass(
        options=options,
        names=names,
        injury_reports=reads.injury_reports_for(conn, subjects, options.prior_seasons),
        roster_statuses=reads.roster_statuses_for(conn, subjects, options.prior_seasons),
        covered=frozenset(availability_store_coverage(conn, options.prior_seasons)),
        week_scores=week_scores,
        headlines={s: _headlines(s, scores, options, names) for s, scores in week_scores.items()},
        captures=reads.injury_captures_for(conn, datetime(season, 7, 1, tzinfo=UTC), INJURY_CAPTURE_LIMIT),
        pedigree=reads.pedigree_rows_for(conn, subjects, season),
        colleges=reads.latest_roster_colleges(conn),
        opening_day=first_kickoff_for(conn, season),
        rows_by_room=_depth_rows(reads.depth_slots_for(conn, season, as_of), options, team_of),
        weekly_shares={} if prior is None else cached.weekly_shares(history, conn, prior, subjects, as_of),
        competition_by_team={}
        if prior is None
        else {t: target_competition_for(prior, t, rows, names) for t, rows in by_team.items()},
        scoring_usage={}
        if prior is None
        else scoring_usage_for(
            prior, cached.scoring_tallies(history, conn, prior, population, as_of), options.positions, names
        ),
        play_callers=read_coach_rows(conn),
        prior_team_rows={} if prior is None else cached.team_rows(history, conn, prior, window, as_of),
        week_one_team_rows=reads.team_metric_rows_for(conn, season, 1, as_of, ScheduleSource.KICKOFF),
        games=reads.scheduled_games_for(conn, season),
        indoors=_indoors(reads.team_metric_rows_for(conn, season, window, as_of, ScheduleSource.SCHEDULE)),
        adp_history=reads.adp_history_for(conn, subjects, as_of - timedelta(days=ADP_WINDOW_DAYS)),
    )
    return {player_id: _depth_for(player_id, team, data) for player_id, team in options.team_by_player_id.items()}
