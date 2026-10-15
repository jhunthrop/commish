"""THIS SEASON'S USAGE AND PLAY, AS THE WRITER READS IT: one labelled line per figure, each with its
basis (what it was taken from, the weeks, who it ranks among and the sample they all cleared).

A labelled stat (`render.label_sections`), so a read that names one copies its label and the span
gate exempts it. Shares and rates print as whole percents, yards to the tenth, seconds to the
hundredth; every printed number is on the sheet's number ledger (`facts.season_usage_ledger`).
"""

from collections.abc import Callable
from dataclasses import dataclass
from types import MappingProxyType
from typing import TYPE_CHECKING, Final

from research.capsules.facts.model import SeasonFigure, SeasonUsage
from research.capsules.facts.season_usage import NEUTRAL_FIGURES, Figure
from research.capsules.render_season import week_list
from research.capsules.render_words import POSITION_PLURAL, percent, rank_where, signed, week_of, whole
from research.model.domain import Position
from research.model.jsmath import js_to_fixed

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts


def tenths(value: float) -> str:
    return js_to_fixed(value, 1)


def hundredths(value: float) -> str:
    return js_to_fixed(value, 2)


@dataclass(frozen=True, slots=True)
class FigureWords:
    """How one figure reads: its line from the figure, and the unit its floor is counted in."""

    line: Callable[[SeasonFigure], str]
    floor_unit: str


def _count(figure: SeasonFigure) -> str:
    return whole(figure.count or 0.0)


FIGURE_WORDS: Final = MappingProxyType({
    Figure.RED_ZONE_SHARE: FigureWords(
        lambda f: f"Red-zone share: {percent(f.value)} of his team's red-zone carries and targets in his games ({_count(f)} of {whole(f.out_of)})",
        "carries and targets of their own",
    ),
    Figure.INSIDE_TEN_SHARE: FigureWords(
        lambda f: f"Share inside the ten: {percent(f.value)} of his team's carries and targets inside the ten in his games ({_count(f)} of {whole(f.out_of)})",
        "carries and targets of their own",
    ),
    Figure.AIR_YARDS_SHARE: FigureWords(
        lambda f: f"Air yards share: {percent(f.value)} of his team's air yards in his games ({_count(f)} of {whole(f.out_of)})",
        "carries and targets of their own",
    ),
    Figure.TARGET_DEPTH: FigureWords(
        lambda f: f"Average depth of target: {tenths(f.value)} yards over {whole(f.out_of)} targets", "targets"
    ),
    Figure.DROPS: FigureWords(lambda f: f"Drops: {_count(f)} on {whole(f.out_of)} targets", "targets"),
    Figure.CONTESTED_CATCH_RATE: FigureWords(
        lambda f: f"Contested catches: {_count(f)} of {whole(f.out_of)} contested targets ({percent(f.value)})",
        "contested targets",
    ),
    Figure.SEPARATION: FigureWords(
        lambda f: f"Separation from the nearest defender at the catch or incompletion: {tenths(f.value)} yards on average over {whole(f.out_of)} tracked targets",
        "tracked targets",
    ),
    Figure.YAC_OVER_EXPECTED: FigureWords(
        lambda f: f"Yards after the catch over expectation: {signed(f.value)} a catch over {whole(f.out_of)} tracked catches",
        "tracked catches",
    ),
    Figure.RUSH_YARDS_OVER_EXPECTED: FigureWords(
        lambda f: f"Rushing yards over expected: {signed(f.value)} a carry, {signed(f.count or 0.0, 0)} in all, over {whole(f.out_of)} tracked carries",
        "tracked carries",
    ),
    Figure.YARDS_AFTER_CONTACT: FigureWords(
        lambda f: f"Yards after contact: {tenths(f.value)} a carry over {whole(f.out_of)} carries", "carries"
    ),
    Figure.PRESSURE_RATE: FigureWords(
        lambda f: f"Pressured on {percent(f.value)} of his dropbacks ({_count(f)} of {whole(f.out_of)})", "dropbacks"
    ),
    Figure.TIME_TO_THROW: FigureWords(
        lambda f: f"Time to throw: {hundredths(f.value)} seconds on average over {whole(f.out_of)} tracked attempts",
        "tracked attempts",
    ),
    Figure.COMPLETION_OVER_EXPECTED: FigureWords(
        lambda f: f"Completion rate over expectation: {signed(f.value)} percentage points over {whole(f.out_of)} tracked attempts",
        "tracked attempts",
    ),
    Figure.BLITZ_RATE: FigureWords(
        lambda f: f"Blitzed on {percent(f.value)} of his charted dropbacks ({_count(f)} of {whole(f.out_of)})",
        "charted dropbacks",
    ),
    Figure.INTERCEPTION_WORTHY: FigureWords(
        lambda f: f"Interception-worthy throws: {_count(f)} on {whole(f.out_of)} charted attempts", "charted attempts"
    ),
})  # fmt: skip


def _rank_clause(figure: SeasonFigure, position: Position) -> str:
    if figure.rank is None:
        return ""
    among = f"{POSITION_PLURAL[position]} with {whole(figure.floor)} or more {FIGURE_WORDS[figure.key].floor_unit}"
    return f", {rank_where(position, figure.rank, among, neutral=figure.key in NEUTRAL_FIGURES)}"


def week_span(usage: SeasonUsage) -> str:
    if usage.first_week == usage.last_week:
        return week_of(usage.first_week, usage.season)
    return f"weeks {usage.first_week} to {usage.last_week} of {usage.season}"


def _weeks_clause(figure: SeasonFigure, usage: SeasonUsage) -> str:
    """The weeks a figure covers, named when they are fewer than the weeks he has facts in (a feed
    that has not published his latest game, or a week its source did not list him)."""
    return "" if figure.weeks == usage.weeks else f", {week_list(figure.weeks, usage.season)} only"


def usage_lines(usage: SeasonUsage, position: Position) -> list[str]:
    return [
        f"{FIGURE_WORDS[f.key].line(f)}{_weeks_clause(f, usage)}{_rank_clause(f, position)}." for f in usage.figures
    ]


def season_usage_section(facts: "PlayerFacts") -> str | None:
    """This season's usage and play, or None when no figure cleared its floor."""
    usage = facts.season_usage
    if usage is None or not usage.figures:
        return None
    lines = usage_lines(usage, facts.identity.position)
    return f"This season's usage and play ({week_span(usage)}):\n" + "\n".join(f"- {line}" for line in lines)
