"""THE DEPTH GROUP'S SHARE OF THE LEDGERS (`research-ts/src/capsules/facts/ledger.ts`): every number,
person and team code the depth facts carry, in the group's own order."""

import math

from research.capsules.facts.depth_model import Depth
from research.capsules.facts.ledger import share_numbers
from research.capsules.facts.model import RankedStat
from research.pipeline.jscompat import js_number


def _ranked(rank: RankedStat | None) -> list[float]:
    return [] if rank is None else [rank.value, rank.position_rank, rank.qualifier_count]


def _dates(iso: str) -> list[float]:
    return [value for value in (js_number(part) for part in iso[:10].split("-")) if math.isfinite(value)]


def _absence(depth: Depth) -> list[float]:
    numbers: list[float] = []
    for ending in depth.season_endings:
        numbers += [ending.season, ending.last_played_week, ending.first_missed_week]
    for record in depth.games_missed:
        numbers += [record.season, record.team_games, record.games_played]
        if record.first_played_week is not None:
            numbers.append(record.first_played_week)
        if record.unavailable_weeks is not None:
            numbers += [len(record.unavailable_weeks), *record.unavailable_weeks]
        if record.suspended_weeks is not None:
            numbers += [len(record.suspended_weeks), *record.suspended_weeks]
        if record.healthy_did_not_play is not None:
            numbers.append(record.healthy_did_not_play)
    for spell in depth.injury_history:
        numbers += [spell.capture_count, *_dates(spell.first_seen_at), *_dates(spell.last_seen_at)]
    return numbers


def _situation(depth: Depth) -> list[float]:
    numbers: list[float] = []
    if depth.coaching is not None:
        numbers.append(depth.coaching.season)
    p = depth.pedigree
    if p is not None:
        numbers += [
            v
            for v in (p.age_on_opening_day, p.seasons_played, p.draft_year, p.draft_round, p.draft_pick)
            if v is not None
        ]
    chart = depth.depth_chart
    if chart is not None:
        numbers += [chart.season, chart.slot, *_dates(chart.as_of), *(n.slot for n in chart.around_him)]
    return numbers


def _role(depth: Depth) -> list[float]:
    numbers: list[float] = []
    trend = depth.role_trend
    if trend is not None:
        numbers += [trend.season, *trend.early_weeks, *trend.late_weeks]
        for split in (trend.snap_share, trend.target_share):
            if split is not None:
                numbers += [*share_numbers(split.early), *share_numbers(split.late)]
    competition = depth.target_competition
    if competition is not None:
        numbers += [competition.season, *share_numbers(competition.combined_share)]
        for leader in competition.leaders:
            numbers += share_numbers(leader.share)
    usage = depth.scoring_usage
    if usage is not None:
        numbers += [usage.season, *_ranked(usage.red_zone_touches), *_ranked(usage.inside_ten_touches)]
        numbers += _ranked(usage.target_depth)
    return numbers


def _context(depth: Depth) -> list[float]:
    numbers: list[float] = []
    c = depth.team_context
    if c is not None:
        numbers.append(c.prior_season)
        if c.pace_seconds_per_play is not None:
            numbers.append(c.pace_seconds_per_play)
        if c.pass_rate is not None:
            numbers += share_numbers(c.pass_rate)
        numbers += [v for v in (c.wins, c.week_one_implied_total, c.week_one_spread) if v is not None]
    s = depth.schedule
    if s is not None:
        numbers += [s.home_games, s.road_games]
        if s.indoor_games is not None:
            numbers.append(s.indoor_games)
        if s.week_one_opponent is not None:
            numbers.append(s.week_one_opponent.week)
        numbers += [fixture.week for fixture in s.playoff_weeks]
    return numbers


def _history(depth: Depth) -> list[float]:
    numbers: list[float] = []
    m = depth.market_movement
    if m is not None:
        numbers += [m.latest_adp, m.earlier_adp, m.picks, abs(m.picks), *_dates(m.latest_at), *_dates(m.earlier_at)]
    v = depth.volatility
    if v is not None:
        numbers += [
            v.season,
            v.weeks_played,
            v.weeks_above_threshold,
            v.threshold,
            v.worst_week.week,
            v.worst_week.points,
        ]
    for season in depth.prior_seasons:
        numbers += [season.season, season.points, season.games_played, season.position_rank, season.qualifier_count]
    return numbers


def depth_numbers(depth: Depth) -> list[float]:
    """`depthNumbers`."""
    return [*_absence(depth), *_situation(depth), *_role(depth), *_context(depth), *_history(depth)]


def depth_names(depth: Depth) -> list[str]:
    """`depthNames`: the coaches, the men around him on the chart, his team's target leaders and the
    named neighbours of his scoring-range ranks."""
    names: list[str | None] = []
    if depth.coaching is not None:
        names += [depth.coaching.head_coach, depth.coaching.play_caller]
    if depth.depth_chart is not None:
        names += [neighbor.name for neighbor in depth.depth_chart.around_him]
    if depth.target_competition is not None:
        names += [leader.name for leader in depth.target_competition.leaders]
    if depth.scoring_usage is not None:
        u = depth.scoring_usage
        names += [
            None if r is None else r.named_neighbor for r in (u.red_zone_touches, u.inside_ten_touches, u.target_depth)
        ]
    return [name for name in names if name is not None and name.strip() != ""]


def depth_team_codes(depth: Depth) -> list[str]:
    """`depthTeamCodes`: the drafting club, the target leaders' team, the opponents named."""
    codes: list[str] = []
    if depth.pedigree is not None and depth.pedigree.draft_club is not None:
        codes.append(depth.pedigree.draft_club)
    if depth.target_competition is not None:
        codes.append(depth.target_competition.team)
    if depth.schedule is not None:
        if depth.schedule.week_one_opponent is not None:
            codes.append(depth.schedule.week_one_opponent.opponent)
        codes += [fixture.opponent for fixture in depth.schedule.playoff_weeks]
    return codes
