"""THE RECORD: the depth facts as the writer reads them, one line per fact the store holds.

Ported from `research-ts/src/capsules/render-depth.ts`. One departure, the prep-site ruling: the
week-one game line (the books' total and spread) is not rendered, because the sheet carries no
sportsbook number. Every other line is the oracle's.
"""

from collections.abc import Sequence
from typing import TYPE_CHECKING, Final

from research.capsules.facts.depth_model import Depth, Fixture, GamesMissed
from research.capsules.render_words import ranked_clause, whole
from research.model.jsmath import js_round, js_to_fixed
from research.pipeline.jscompat import js_string

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

_ARCHIVES_SILENT: Final = "the injury and roster archives hold nothing for that season"
_SEASON_WORDS: Final = ("first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth")
_SLOT_WORDS: Final = ("first", "second", "third", "fourth", "fifth")


def _season_endings(depth: Depth) -> list[str]:
    lines: list[str] = []
    for ending in depth.season_endings:
        if ending.source == "report":
            injury = "" if ending.primary_injury is None else f", {ending.primary_injury.lower()}"
            cause = f"the injury report listed him {ending.report_status}{injury}"
        else:
            cause = f"the weekly roster listed him {ending.roster_status} with no body part on file"
        lines.append(
            f"His {ending.season} season ended after week {ending.last_played_week}. From week {ending.first_missed_week} on, {cause}."
        )
    return lines


def _week_runs(weeks: Sequence[int]) -> str:
    runs: list[str] = []
    start: int | None = None
    previous: int | None = None
    for week in weeks:
        if start is None or previous is None or week != previous + 1:
            if start is not None and previous is not None:
                runs.append(str(start) if start == previous else f"{start} to {previous}")
            start = week
        previous = week
    if start is not None and previous is not None:
        runs.append(str(start) if start == previous else f"{start} to {previous}")
    plural = "weeks" if len(weeks) > 1 else "week"
    listed = "".join(runs) if len(runs) <= 1 else f"{', '.join(runs[:-1])} and {runs[-1]}"
    return f"{plural} {listed}"


def _games_missed(record: GamesMissed) -> str:
    played = f"Played {record.games_played} of {record.team_games} in {record.season}"
    first = None if record.first_played_week is None else f"first appearance in week {record.first_played_week}"
    if record.unavailable_weeks is None:
        return f"{', '.join(p for p in (played, first) if p is not None)}; {_ARCHIVES_SILENT}."
    missed = len(record.unavailable_weeks)
    clauses = [
        "none missed to injury or a reserve list"
        if missed == 0
        else f"{missed} missed to injury or a reserve list ({_week_runs(record.unavailable_weeks)})"
    ]
    suspended = record.suspended_weeks or ()
    if suspended:
        clauses.append(f"{len(suspended)} missed to a suspension ({_week_runs(suspended)})")
    head = ", ".join(p for p in (played, first, *clauses) if p is not None)
    scratches = record.healthy_did_not_play or 0
    if scratches == 0:
        return f"{head}."
    if missed == 0:
        return f"{head}; the other {scratches} were healthy weeks he did not play."
    return f"{head}, {scratches} healthy {'week' if scratches == 1 else 'weeks'} he did not play."


def _injury_history(depth: Depth) -> str | None:
    if not depth.injury_history:
        return None
    spells = []
    for spell in depth.injury_history:
        body = "" if spell.description is None else f", {spell.description.lower()}"
        when = (
            f"on {spell.first_seen_at}"
            if spell.first_seen_at == spell.last_seen_at
            else f"from {spell.first_seen_at} to {spell.last_seen_at} across {spell.capture_count} captures"
        )
        spells.append(f"{spell.designation} {when}{body}")
    return f"Injury designations captured this season, oldest first: {'. '.join(spells)}."


def _tenure(is_new: bool | None) -> str:
    if is_new is None:
        return ""
    return ", new this year" if is_new else ", continuing from last season"


def _coaching(depth: Depth) -> str | None:
    c = depth.coaching
    if c is None:
        return None
    if c.play_caller_role == "HC" and c.play_caller is not None and c.head_coach in (None, c.play_caller):
        tenure = _tenure(c.head_coach_is_new if c.head_coach_is_new is not None else c.play_caller_is_new)
        return f"Coaching for {c.season}: head coach {c.play_caller}{tenure}, and he calls the plays himself."
    parts = []
    if c.head_coach is not None:
        parts.append(f"head coach {c.head_coach}{_tenure(c.head_coach_is_new)}")
    if c.play_caller is not None:
        parts.append(f"offensive play caller {c.play_caller}{_tenure(c.play_caller_is_new)}")
    return None if not parts else f"Coaching for {c.season}: {', '.join(parts)}."


def _draft(depth: Depth) -> str | None:
    p = depth.pedigree
    if p is None or p.draft_year is None:
        return None
    if p.undrafted is True:
        return f"undrafted out of the {p.draft_year} class"
    where = [
        part
        for part in (
            None if p.draft_round is None else f"round {p.draft_round}",
            None if p.draft_pick is None else f"pick {p.draft_pick}",
        )
        if part is not None
    ]
    by = "" if p.draft_club is None else f" by {p.draft_club}"
    return f"drafted in {p.draft_year}{by}" if not where else f"drafted in {p.draft_year} at {', '.join(where)}{by}"


def _pedigree(depth: Depth) -> str | None:
    p = depth.pedigree
    if p is None:
        return None
    parts = []
    if p.age_on_opening_day is not None:
        parts.append(f"Age {js_to_fixed(p.age_on_opening_day, 1)} on opening day")
    if p.seasons_played is not None:
        ordinal = _SEASON_WORDS[p.seasons_played] if p.seasons_played < len(_SEASON_WORDS) else None
        parts.append(
            f"entering his {f'season number {p.seasons_played + 1}' if ordinal is None else f'{ordinal} season'}"
        )
    if p.college is not None:
        parts.append(f"out of {p.college}")
    draft = _draft(depth)
    if draft is not None:
        parts.append(draft)
    return None if not parts else f"{', '.join(parts)}."


def _slot_word(slot: float) -> str:
    index = int(slot) - 1 if slot == int(slot) else -1
    return _SLOT_WORDS[index] if 0 <= index < len(_SLOT_WORDS) else f"number {js_string(slot)}"


def _depth_chart(facts: "PlayerFacts") -> str | None:
    chart = facts.depth.depth_chart
    if chart is None:
        return None
    around = (
        "No other player at his position is listed on that release"
        if not chart.around_him
        else "Listed with him: " + ", ".join(f"{peer.name} {_slot_word(peer.slot)}" for peer in chart.around_him)
    )
    team, position = facts.identity.team, facts.identity.position
    return f"Depth chart as of {chart.as_of}: listed {_slot_word(chart.slot)} among {team} {position}s. {around}."


def _pct(fraction: float) -> str:
    return f"{js_string(js_round(fraction * 100))}%"


def _span(weeks: Sequence[int]) -> str:
    if not weeks:
        return "no weeks"
    return f"week {weeks[0]}" if weeks[0] == weeks[-1] else f"weeks {weeks[0]} to {weeks[-1]}"


def _role_trend(depth: Depth) -> str | None:
    t = depth.role_trend
    if t is None:
        return None
    clauses = [
        clause
        for clause in (
            None if t.snap_share is None else f"snap share {_pct(t.snap_share.early)} to {_pct(t.snap_share.late)}",
            None
            if t.target_share is None
            else f"target share {_pct(t.target_share.early)} to {_pct(t.target_share.late)}",
        )
        if clause is not None
    ]
    return (
        None
        if not clauses
        else f"Inside {t.season}, {_span(t.early_weeks)} against {_span(t.late_weeks)}: {', '.join(clauses)}."
    )


def _target_competition(depth: Depth) -> str | None:
    c = depth.target_competition
    if c is None:
        return None
    named = " and ".join(f"{leader.name} took {_pct(leader.share)}" for leader in c.leaders)
    return f"Target competition on {c.team} in {c.season}: {named}, {_pct(c.combined_share)} between them."


def _scoring_usage(facts: "PlayerFacts") -> str | None:
    u, position = facts.depth.scoring_usage, facts.identity.position
    if u is None:
        return None
    clauses = [
        clause
        for clause in (
            None
            if u.red_zone_touches is None
            else ranked_clause(position, "Red-zone touches", u.red_zone_touches, whole),
            None
            if u.inside_ten_touches is None
            else ranked_clause(position, "Touches inside the ten", u.inside_ten_touches, whole),
            None
            if u.target_depth is None
            else ranked_clause(
                position, "Average depth of target", u.target_depth, lambda v: f"{js_to_fixed(v, 1)} yards"
            ),
        )
        if clause is not None
    ]
    return None if not clauses else f"Scoring-range usage ({u.season}): {'. '.join(clauses)}."


def _team_context(facts: "PlayerFacts") -> str | None:
    c = facts.depth.team_context
    if c is None:
        return None
    history = [
        part
        for part in (
            None if c.pace_seconds_per_play is None else f"{js_to_fixed(c.pace_seconds_per_play, 1)} seconds a play",
            None if c.pass_rate is None else f"{_pct(c.pass_rate)} of situation-neutral plays passes",
            None if c.wins is None else f"{js_string(c.wins)} wins",
        )
        if part is not None
    ]
    return None if not history else f"{facts.identity.team} in {c.prior_season}: {', '.join(history)}."


def _fixture(fixture: Fixture) -> str:
    return f"{'at home against' if fixture.home else 'away at'} {fixture.opponent} in week {fixture.week}"


def _schedule(depth: Depth) -> str | None:
    s = depth.schedule
    if s is None:
        return None
    opener = (
        "The published schedule holds no week one game for his team."
        if s.week_one_opponent is None
        else f"Opens {_fixture(s.week_one_opponent)}."
    )
    roof = ", with no roof reading on file" if s.indoor_games is None else f", {s.indoor_games} of them indoors"
    playoffs = (
        "The schedule holds none of weeks 15 to 17 for his team yet."
        if not s.playoff_weeks
        else f"Weeks 15 to 17: {', '.join(_fixture(f) for f in s.playoff_weeks)}."
    )
    return f"Schedule: {opener} {s.home_games} home and {s.road_games} away on the published schedule{roof}. {playoffs}"


def _market_movement(depth: Depth) -> str | None:
    m = depth.market_movement
    if m is None:
        return None
    window = f"between {m.earlier_at} and {m.latest_at}"
    if m.picks == 0:
        return f"ADP held at {js_string(m.latest_adp)} {window}."
    direction = "up" if m.picks > 0 else "down"
    return f"ADP moved {direction} {js_string(abs(m.picks))} picks {window}, from {js_string(m.earlier_adp)} to {js_string(m.latest_adp)}."


def _volatility(depth: Depth) -> str | None:
    v = depth.volatility
    if v is None:
        return None
    weeks = "week" if v.weeks_played == 1 else "weeks"
    return (
        f"He cleared {js_string(v.threshold)} points in {v.weeks_above_threshold} of his {v.weeks_played} played {weeks} in "
        f"{v.season}, and his worst was {js_string(v.worst_week.points)} in week {v.worst_week.week}."
    )


def _prior_seasons(facts: "PlayerFacts") -> str | None:
    seasons, position = facts.depth.prior_seasons, facts.identity.position
    if not seasons:
        return None
    clauses = [
        f"{s.season}, {js_string(s.points)} points over {s.games_played} games, {position}{s.position_rank} among {s.qualifier_count}"
        for s in seasons
    ]
    return f"Season by season: {'. '.join(clauses)}."


def render_depth_section(facts: "PlayerFacts") -> str | None:
    """`renderDepthSection`: the record, or None when the store held nothing worth a line."""
    depth = facts.depth
    lines = [
        *_season_endings(depth),
        *(_games_missed(record) for record in depth.games_missed),
        _injury_history(depth),
        _coaching(depth),
        _pedigree(depth),
        _depth_chart(facts),
        _role_trend(depth),
        _target_competition(depth),
        _scoring_usage(facts),
        _team_context(facts),
        _schedule(depth),
        _market_movement(depth),
        _volatility(depth),
        _prior_seasons(facts),
    ]
    written = [line for line in lines if line is not None and line != ""]
    return None if not written else "The record:\n" + "\n".join(f"- {line}" for line in written)
