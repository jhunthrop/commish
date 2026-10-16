"""THE SHEET'S CLOCK: where the reader stands on the run's day, and this season so far.

Before the season's first kickoff the reader is about to draft; from it on his draft is done and he
is managing a roster (`facts.season_so_far`). These lines tell the writer which, name the run's
day, and give this season week by week as the player page prints it, every week with its season so
the writer never has to guess which year a week belongs to.
"""

from typing import TYPE_CHECKING, Final

from research.capsules.facts.model import InjuryClean, InjuryDesignated, SeasonSoFar, SeasonWeek
from research.capsules.render_words import (
    AS_THE_PAGE_PRINTS,
    IN_OUR_RECORDS,
    NEXT_TO_PLAY,
    week_of,
)
from research.model.designations import season_long, status_of
from research.model.jsmath import js_to_fixed
from research.pipeline.jscompat import js_string
from research.season import REGULAR_SEASON_WEEKS

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts


def week_list(weeks: tuple[int, ...], season: int) -> str:
    """One week or several, with their season: week 4 of 2026, or weeks 4, 5 and 9 of 2026."""
    if len(weeks) == 1:
        return week_of(weeks[0], season)
    listed = ", ".join(str(w) for w in weeks[:-1])
    return f"weeks {listed} and {weeks[-1]} of {season}"


def today_line(facts: "PlayerFacts") -> str:
    """The run's day and the reader's place in the season."""
    season = facts.season
    if season is None:
        return (
            f"Today is {facts.run_day}, before the {facts.product_season} season's first kickoff. The reader is "
            "getting ready to draft."
        )
    year = season.season
    reach = (
        f"no week's games are {IN_OUR_RECORDS} yet"
        if season.through == 0
        else f"every game through {week_of(season.through, year)} is {IN_OUR_RECORDS}"
    )
    return (
        f"Today is {facts.run_day}. The {year} season is under way: {reach}{_next_week(season)}. The reader "
        "drafted before the season began and is managing his roster now."
    )


def _next_week(season: SeasonSoFar) -> str:
    """The week after `through`: none past the regular season, and under way when he has played it."""
    following = season.through + 1
    if following > REGULAR_SEASON_WEEKS:
        return ""
    played = any(w.week == following and w.status == "played" for w in season.weeks)
    return f", and {week_of(following, season.season)} {'is under way' if played else NEXT_TO_PLAY}"


def _week_line(week: SeasonWeek, season: int) -> str:
    named = week_of(week.week, season)
    if week.status == "bye":
        return f"{named}, his club's bye"
    if week.status == "inactive":
        return f"{named}, did not play"
    points = "points not recorded" if week.points is None else f"{js_string(week.points)} points"
    return f"{named}, played, {points}"


def _totals_line(season: SeasonSoFar) -> str | None:
    t = season.totals
    parts = [
        (t.carries, "carries"),
        (t.rushing_yards, "rush yards"),
        (t.targets, "targets"),
        (t.receptions, "catches"),
        (t.receiving_yards, "rec yards"),
        (t.passing_yards, "pass yards"),
        (t.touchdowns, "touchdowns"),
    ]
    written = [f"{js_string(value)} {label}" for value, label in parts if value is not None]
    return None if not written or season.games_played == 0 else f"Totals: {', '.join(written)}."


def season_section(facts: "PlayerFacts") -> str:
    """This season so far, or that it has not begun."""
    season = facts.season
    if season is None:
        return f"No games played yet: the {facts.product_season} season has not kicked off."
    year = season.season
    games = "game" if season.games_played == 1 else "games"
    per_game = "" if season.points_per_game is None else f", {js_to_fixed(season.points_per_game, 1)} points a game"
    lines = [f"This season so far ({year}, PPR, {AS_THE_PAGE_PRINTS}): {season.games_played} {games} played{per_game}."]
    if season.weeks:
        lines.append("Week by week: " + ". ".join(_week_line(w, year) for w in season.weeks) + ".")
    missed = season.missed_weeks
    lines.append(
        "He has not missed a game this season."
        if not missed
        else f"Weeks he has missed this season: {week_list(missed, year)} ({len(missed)} in all)."
    )
    totals = _totals_line(season)
    return "\n".join([*lines, *([] if totals is None else [totals])])


def bye_line(facts: "PlayerFacts") -> str:
    bye, season = facts.bye_week, facts.season
    if bye is None:
        return "Bye week not yet set."
    named = week_of(bye, facts.product_season)
    if season is None:
        return f"Bye: {named}."
    return f"Bye: {named}, {'already behind him' if bye <= season.through else 'still to come'}."


# A season-long designation, as the board treats it (Lane 63): the page's read must not contradict the
# row, which shows him below the available players at his position.
SEASON_LONG_FACT: Final = (
    "That is a season-long list: the board ranks him below every available player at his position, "
    "and he plays no game while he is on it."
)


def _since(facts: "PlayerFacts", since: str) -> str:
    """When his status began: its day before the season; in season the week it reaches, never a
    date (a date reads back as a month, which the in-season floor refuses). Printed as data, never
    as a sentence to copy (Lane 29: "on every report since the run-up to week 6" was the label the
    writer copied onto 122 pages, and "since the run-up to the next game" the template it failed to fill)."""
    season = facts.season
    if season is None:
        return f"since {since}"
    if season.injury_from_week is None:
        return f"since after his last game of {season.season}"
    return f"since before {week_of(season.injury_from_week, season.season)}"


def injury_line(facts: "PlayerFacts") -> str:
    injury = facts.injury
    if isinstance(injury, InjuryDesignated):
        line = f"Injury report: designation {injury.designation} {_since(facts, injury.since)}."
        status = status_of(injury.designation)
        # The capsule's sheet carries no capture note, so only the codes that are season-long alone.
        return f"{line} {SEASON_LONG_FACT}" if status is not None and season_long(status, None) else line
    if isinstance(injury, InjuryClean):
        return f"Injury report: no designation {_since(facts, injury.since)}."
    return "Injury report: no injury feed has been checked for him yet. This is not a health claim either way."
