"""THE FACT SHEET THE WRITER READS: manager language, section by section.

Ported from `research-ts/src/capsules/render.ts`, re-deriving its own sentences from the sheet's
numbers (the sheet's field names never reach the prompt). Two deliberate departures, both rulings of
the prep-site review: the sportsbook register is gone (no props line, no win total, no "the books"
sentence, `render_depth.py` drops the week-one game line), and the new-play-caller line no longer
hands the writer the stock "the honest concern" frame. Numbers print as JavaScript prints them.
"""

from collections.abc import Callable

from research.capsules.facts.build import PlayerFacts
from research.capsules.facts.model import (
    ChangedTeamEvidence,
    EvidenceItem,
    LawEvidence,
    MarketUnlistedEvidence,
    NewPlayCallerEvidence,
    RookieEvidence,
    ShareEvidence,
    TrendMetric,
)
from research.capsules.render_depth import render_depth_section
from research.capsules.render_season import bye_line, injury_line, season_section, today_line
from research.capsules.render_usage import season_usage_section
from research.capsules.render_words import (
    AS_WE_SAW_IT,
    LOW_TAIL,
    MOST_OUTCOMES,
    POOLED_IN,
    RISK_COUNTED,
    percent,
    ranked_clause,
    signed,
    week_of,
    whole,
)
from research.capsules.voice_rules import in_fantasy_words
from research.model.jsmath import js_round, js_to_fixed
from research.pipeline.jscompat import js_number, js_string


def _signed_percent(fraction: float) -> str:
    return f"{signed(js_round(fraction * 100), 0)}%"


def _adp_line(facts: PlayerFacts) -> str:
    adp, before = facts.market.adp, "" if facts.season is None else " before the season"
    if adp is None:
        return f"ADP{before}: none."
    by_adp = "" if facts.market.position_adp is None else f", {facts.market.position_adp} by ADP"
    if facts.season is not None:
        # In season the ADP is history, printed as history and with no pick word (the floor refuses one).
        return f"ADP{before} {js_string(adp)} (where drafters took him{by_adp})."
    return f"ADP {js_string(adp)} (drafters take him around pick {whole(adp)}{by_adp})."


def _board_line(facts: PlayerFacts) -> str:
    m, p, position = facts.market, facts.projection, facts.identity.position
    ranks = [] if m.board_rank is None else [f"overall rank {m.board_rank}"]
    if m.position_rank is not None:
        ranks.append(f"position rank {position}{m.position_rank} by our own board")
    ranges = (
        f"Middle range, {MOST_OUTCOMES}: {whole(p.typical_low)} to {whole(p.typical_high)} points. "
        f"Full tails: {whole(p.floor_points)} to {whole(p.ceiling_points)}, {LOW_TAIL}."
    )
    rank_text = f" {', '.join(ranks)}." if ranks else ""
    number = (
        f"Our number: {whole(p.projected_points)} season points."
        if facts.season is None
        else f"Our preseason number: {whole(p.projected_points)} points for the full {facts.product_season} season."
    )
    parts = [f"{number} {ranges}{rank_text}", _adp_line(facts)]
    if m.market_anchor_points is not None:
        parts.append(
            f"Past seasons of {position}s drafted around his ADP: about {js_string(m.market_anchor_points)} points, "
            f"{POOLED_IN}. Our number is {signed(m.market_anchor_delta or 0.0)} points from that."
        )
    if m.players_left_in_tier is not None and m.drop_to_next_tier is not None:
        parts.append(
            f"{m.players_left_in_tier} players left in his tier before a {js_to_fixed(m.drop_to_next_tier, 1)}-point cliff."
        )
    return " ".join(parts)


def _availability_line(facts: PlayerFacts) -> str | None:
    a = facts.availability
    if a is None:
        return None
    when = "Availability" if facts.season is None else f"Availability {AS_WE_SAW_IT}"
    line = (
        f"{when}: expected games {whole(a.expected_games)}, from {whole(a.floor_games)} to "
        f"{whole(a.ceiling_games)} {RISK_COUNTED}."
    )
    pace = preseason_pace_line(facts)
    return line if pace is None else f"{line} {pace}"


def preseason_pace_line(facts: PlayerFacts) -> str | None:
    """In season, our preseason number as points a game over the games we expected, from the whole
    numbers the sheet prints (Lane 52). The writer set his pace against the season total on 39
    attempts of Lane 50's samples, which the time rule refuses; with a pace printed, a pace goes
    against a pace."""
    a = facts.availability
    if facts.season is None or a is None:
        return None
    points, games = js_round(facts.projection.projected_points), js_round(a.expected_games)
    if games < 1:
        return None
    return (
        f"Our preseason pace: {js_to_fixed(points / games, 1)} points a game, our {js_string(points)} points over "
        f"the {js_string(games)} games we expected."
    )


def law_line(item: LawEvidence) -> str:
    """A law's figure with its basis, the coordinator's M3 ruling (Lane 52): the figure is the average
    change in points a game among players in his spot from one season to the next (the law harness's
    matched difference-in-differences), summed over the group's laws, never his own points."""
    moved = "fell" if item.net_effect_points < 0 else "rose"
    size = js_string(abs(js_number(js_to_fixed(item.net_effect_points, 1))))
    net = f", net of {item.law_count} factors" if item.law_count > 1 else ""
    return (
        f"{in_fantasy_words(item.headline)}: among players in his spot, points a game {moved} {size} on average "
        f"from one season to the next{net}."
    )


def _evidence_line(item: EvidenceItem) -> str:
    if isinstance(item, LawEvidence):
        return law_line(item)
    if isinstance(item, ShareEvidence):
        verb = "grew" if item.kind == "offseason_share_gained" else "shrank"
        target, carry = _signed_percent(item.target_share_change), _signed_percent(item.carry_share_change)
        return f"Offseason role {verb}: targets {target}, carries {carry}."
    if isinstance(item, ChangedTeamEvidence):
        return f"Changed teams: {item.from_} to {item.to}."
    if isinstance(item, NewPlayCallerEvidence):
        return f"New play caller at {item.team}."
    if isinstance(item, RookieEvidence):
        return (
            "A rookie, went undrafted."
            if item.overall_pick is None
            else f"A rookie, drafted at pick {item.overall_pick}."
        )
    if isinstance(item, MarketUnlistedEvidence):
        return "No ADP for him."
    raise TypeError(f"no evidence line for {item!r}")


def _news_lines(facts: PlayerFacts) -> list[str]:
    if not facts.news:
        return ["No recent headlines."]
    return [f'"{s.title}"' + ("" if s.published_at is None else f" ({s.published_at[:10]})") for s in facts.news]


def _percent(value: float) -> str:
    return percent(value, 1)


def _story_line(facts: PlayerFacts) -> str | None:
    story, position = facts.last_season_story, facts.identity.position
    if story is None:
        return None
    games = "game" if story.games_played == 1 else "games"
    sentences = [
        f"Last season ({story.season}): {ranked_clause(position, 'total points', story.points_rank, whole)}.",
        f"Over {story.games_played} {games}, averaging {js_to_fixed(story.points_per_game, 1)} points a game.",
        f"His best week was {week_of(story.best_week.week, story.season)} with {js_string(story.best_week.points)} points.",
        f"He scored above the position's own weekly median in {story.weeks_above_median} of those {story.games_played} {games}.",
    ]
    if story.touches_rank is not None:
        sentences.append(f"{ranked_clause(position, 'Touches', story.touches_rank, whole)}.")
    sentences.append(f"{ranked_clause(position, 'Receiving yards', story.receiving_yards_rank, whole)}.")
    return " ".join(sentences)


def _usage_line(facts: PlayerFacts) -> str | None:
    usage, position = facts.usage, facts.identity.position
    if usage is None:
        return None
    shares: list[str] = []
    for label, share, rank in (
        ("snap share", usage.snap_share, usage.snap_share_rank),
        ("target share", usage.target_share, usage.target_share_rank),
        ("red-zone share of his own touches", usage.red_zone_share, usage.red_zone_share_rank),
    ):
        if share is not None:
            shares.append(
                f"{label} {_percent(share)}" if rank is None else ranked_clause(position, label, rank, _percent)
            )
    return None if not shares else f"Last season's usage ({usage.season}): {', '.join(shares)}."


def _trend_sentence(subject: str, metric: TrendMetric | None, fmt: Callable[[float], str]) -> str | None:
    if metric is None or not metric.material:
        return None
    verb = "rose" if metric.delta >= 0 else "fell"
    return f"{subject} {verb} from {fmt(metric.prior_value)} in {metric.prior_season} to {fmt(metric.recent_value)} in {metric.recent_season}."


def _trend_line(facts: PlayerFacts) -> str | None:
    trend = facts.trend
    if trend is None:
        return None
    noun = "yards per target" if facts.identity.position in ("WR", "TE") else "yards per touch"
    sentences = [
        _trend_sentence("His points per game", trend.points_per_game, js_string),
        _trend_sentence(f"His {noun}", trend.yards_per_opportunity, js_string),
        _trend_sentence("His target share", trend.target_share, _percent),
    ]
    written = [sentence for sentence in sentences if sentence is not None]
    return None if not written else " ".join(written)


def label_sections(facts: PlayerFacts) -> list[str]:
    """The sheet's labelled stats: the case (each factor's name and worth), the color (each ranked
    stat with its label) and this season's usage and play (each figure with its basis). A read that
    names one of these stats copies its label; the span gate exempts these words with every other
    span the whole sheet prints (`capsules.span_rules`, which renders the whole sheet)."""
    sections = []
    if facts.evidence:
        sections.append("The case:\n" + "\n".join(f"- {_evidence_line(item)}" for item in facts.evidence))
    color = [line for line in (_story_line(facts), _usage_line(facts), _trend_line(facts)) if line is not None]
    if color:
        sections.append("The color:\n" + "\n".join(f"- {line}" for line in color))
    usage = season_usage_section(facts)
    if usage is not None:
        sections.append(usage)
    return sections


def render_facts_for_model(facts: PlayerFacts) -> str:
    """`renderFactsForModel`: the whole sheet, plain text, the user message's first half."""
    identity = facts.identity
    sections = [
        f"Player: {identity.name}, {identity.position}, {identity.team}. Season: {facts.product_season}.",
        today_line(facts),
        _board_line(facts),
    ]
    availability = _availability_line(facts)
    if availability is not None:
        sections.append(availability)
    sections += label_sections(facts)
    sections += [season_section(facts), bye_line(facts), injury_line(facts)]
    sections.append("Recent news:\n" + "\n".join(f"- {line}" for line in _news_lines(facts)))
    depth = render_depth_section(facts)
    if depth is not None:
        sections.append(depth)
    return "\n\n".join(sections)
