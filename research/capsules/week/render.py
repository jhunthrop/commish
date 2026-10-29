"""THE SHEET THE WRITER READS, and the facts block a page shows when the writer could not serve him.

One fact to a line, each with the read it came from ("as of Monday 9:03 pm Central"), so the writer and
a reviewer see how old each fact is; the injury report is named by the day the clubs issued it ("on
Friday's report", `week.report_day`), never by the day we read the list. His
place on our board names which order it is, and the words a read must say it in ("in our preseason
order", "in our rest-of-season order"). Every figure prints as the player card prints it (`page_figures`:
the tenth, the game's expected points in half points), so a figure the read quotes is the page's, word for
word, and the guard refuses any other (`capsules.page_figures.figure_violations`).
"""

from datetime import datetime
from typing import Final

from research.capsules.facts.team_names import NFL_TEAM_NAMES
from research.capsules.render_depth import slot_word
from research.capsules.render_season import week_list
from research.capsules.render_words import IN_OUR_RECORDS, ordinal, week_of
from research.capsules.week.angles import angles_on
from research.capsules.week.bites import depth_bites, rank_bites, weather_bites
from research.capsules.week.cells import named_chance
from research.capsules.week.rank_words import rank_words
from research.capsules.week.report_day import report_words
from research.capsules.week.sheet import (
    CANNOT_PLAY,
    STATUS_WORDS,
    WeekGame,
    WeekSheet,
    central_day_and_time,
    points_text,
    returning_words,
)
from research.model.jsmath import js_round
from research.pipeline.jscompat import js_string

LAST_FANTASY_WEEK: Final = 17
_ROOF_WORDS: Final = {
    "dome": "indoors, under a fixed roof",
    "retractable": "under a retractable roof, open or closed on the day",
}


def _as_of(at: datetime | None) -> str:
    return "" if at is None else f" (as of {central_day_and_time(at)} Central)"


def _club(code: str) -> str:
    names = NFL_TEAM_NAMES.get(code)
    return code if names is None else f"{code} ({names[0]} {names[1]})"


def _game_words(game: WeekGame, season: int) -> str:
    where = "at home against" if game.home else "away at"
    kickoff = central_day_and_time(game.kickoff)
    return f"{week_of(game.week, season)}, {where} {_club(game.opponent)}, kicking off {kickoff} Central"


def _game_line(sheet: WeekSheet) -> str:
    game = sheet.game
    this_week = week_of(sheet.week, sheet.season)
    if game is None:
        return f"His game: none on the schedule for {this_week}."
    words = f"{_game_words(game, sheet.season)}{_as_of(game.scheduled_at)}"
    if sheet.bye:
        return (
            f"Bye: {sheet.team} do not play in {this_week}, so he does not play in {this_week} and scores no "
            f"points that week. His next game: {words}."
        )
    return f"His game: {words}."


def _status_line(sheet: WeekSheet) -> str:
    status, this_week = sheet.status.status, week_of(sheet.week, sheet.season)
    report = report_words(sheet.status, sheet.written_at, sheet.game)
    if status is None:
        return f"Injury report: no designation for him on {report}."
    returning = returning_words(sheet.status)
    if returning is not None:
        # Designated to return this week (Lane 153): available, his one sentence the fact.
        return f"Injury report: {returning} He can play in {this_week}."
    word = STATUS_WORDS.get(status, status)
    if status in CANNOT_PLAY:
        return f"Injury report: {word} on {report}. He cannot play in {this_week}."
    if status == "doubtful":
        return f"Injury report: {word} on {report}, unlikely to play in {this_week}. Never tell anyone to start him."
    return f"Injury report: {word} on {report}, so whether he plays in {this_week} is not settled."


def _projection_line(sheet: WeekSheet) -> str | None:
    """The week's published projection, for the writer to know his week by. The read never quotes it nor its
    change (Lane 275): the card prints both, and the read stands when it moves."""
    p = sheet.projection
    if p is None or sheet.bye:
        return None
    return (
        f"Published projection for {week_of(sheet.week, sheet.season)}: {points_text(p.points)} points in PPR "
        f"scoring{_as_of(p.captured_at)}. It is a projection published for the week, not ours. The card prints "
        "it: never name it, its figure or its change in the read, and never the card."
    )


def _expected_line(sheet: WeekSheet) -> str | None:
    e, game = sheet.expected, sheet.game
    if e is None or game is None or sheet.bye:
        return None
    return (
        f"Expected points: {sheet.team} {points_text(e.club_points)} points, {game.opponent} "
        f"{points_text(e.opponent_points)} points, the game's expected score for each club{_as_of(e.read_at)}."
    )


def _weather_line(sheet: WeekSheet) -> str | None:
    w = sheet.weather
    if w is None or sheet.bye:
        return None
    roofed = None if w.roof is None else _ROOF_WORDS.get(w.roof)
    if roofed is not None:
        return f"Venue: {roofed}{_as_of(w.roof_read_at)}."
    # Each figure as the weather cell prints it (`Math.round`), the chance only from the share it names one
    # at (Lane 100 review M2, LOW-2).
    chance = named_chance(w)
    parts = [
        f"{js_string(js_round(w.temperature_f))} degrees" if w.temperature_f is not None else None,
        f"wind {js_string(js_round(w.wind_mph))} mph" if w.wind_mph is not None else None,
        None if chance is None else f"a {js_string(chance)}% chance of {w.precipitation_kind or 'rain'}",
    ]
    said = [part for part in parts if part is not None]
    if not said:
        return f"Venue: outdoors, no forecast yet{_as_of(w.roof_read_at)}." if w.roof == "outdoors" else None
    where = ", outdoors" if w.roof == "outdoors" else ""
    return f"Forecast for kickoff{where}: {', '.join(said)}{_as_of(w.read_at)}."


def _allowed_line(sheet: WeekSheet) -> str | None:
    a, game = sheet.allowed, sheet.game
    if a is None or game is None or sheet.bye:
        return None
    # The rank is the card's Opp rank cell; the points it allows a game are in no cell (Lane 100, B17).
    return (
        f"{game.opponent} against {a.position}s in {sheet.season}: {ordinal(a.rank)} of {a.of} through "
        f"{week_of(a.through, sheet.season)} (1st allowed the fewest PPR points a game, {ordinal(a.of)} the most)"
        f"{_as_of(a.read_at)}. {_rank_said(a.rank, a.of)}"
    )


def _rank_said(rank: int, of: int) -> str:
    """How the read says the rank (Lane 139, C01): its words from the fewest end or the most, or by its rank."""
    words = rank_words(rank, of)
    if words is None:
        return f"In words, say it by its rank, {ordinal(rank)} of {of}, never most or fewest."
    return f'In words, say it as "{words}" ({ordinal(rank)} of {of}).'


def _depth_line(sheet: WeekSheet) -> str | None:
    d = sheet.depth
    if d is None:
        return None
    around = (
        "No other player at his position is listed."
        if not d.around
        else "Listed with him: " + ", ".join(f"{name} {slot_word(slot)}" for name, slot in d.around) + "."
    )
    return (
        f"Depth chart{_as_of(d.released_at)}: listed {slot_word(d.slot)} among {sheet.team} {sheet.position}s. {around}"
    )


def _season_line(sheet: WeekSheet) -> str:
    reach = (
        "no game of his is in our records yet"
        if not sheet.last_games
        else "; ".join(
            f"{week_of(g.week, sheet.season)} {'against' if g.home else 'at'} {g.opponent}, {points_text(g.points)} "
            "PPR points"
            for g in sheet.last_games
        )
    )
    games = "game" if sheet.games_played == 1 else "games"
    rate = (
        ""
        if sheet.points_per_game is None
        # His touchdowns are in no one cell (Lane 100, B17): the log splits them by kind.
        else f" This season: {points_text(sheet.points_per_game)} PPR points a game over {sheet.games_played} {games}."
    )
    missed = "" if not sheet.missed else f" He did not play {week_list(sheet.missed, sheet.season)}."
    return f"His last games, newest first{_as_of(sheet.lines_at)}: {reach}.{rate}{missed}"


def _board_line(sheet: WeekSheet) -> str | None:
    b = sheet.board
    if b is None:
        return None
    # His overall rank is in no cell; his place at his position is the card's (Lane 100, B17).
    place = f"{sheet.position}{b.position_rank}"
    say = f'Any sentence with this rank says it is "in {b.order_words}".'
    if b.rest_of_season and b.from_week is not None:
        points = "" if b.points is None else f"{points_text(b.points)} PPR points, "
        # A week 18 board ranks week 18 alone (Lane 96): its span is that one week.
        last = max(LAST_FANTASY_WEEK, b.from_week)
        span = (
            week_of(last, sheet.season)
            if b.from_week == last
            else f"{week_of(b.from_week, sheet.season)} to {week_of(last, sheet.season)}"
        )
        return f"Our rest-of-season order, {span}{_as_of(b.published_at)}: {points}{place}. {say}"
    return f"Our preseason order, set before the season{_as_of(b.published_at)}: {place}. {say}"


ANGLES_HEAD: Final = "What sets his week apart, the most unusual first (build the read on these, in this order):"
NO_ANGLE: Final = (
    "What sets his week apart: no usage fact of his stands out this week. Build the read on his status, his game "
    "and his season."
)


def _angles_lines(sheet: WeekSheet) -> list[str]:
    """His angles (Lane 300), one to a line, for a player who can play this week."""
    if not sheet.can_play:
        return []
    if not sheet.angles:
        return [NO_ANGLE]
    return [ANGLES_HEAD, *(f"{n}. {angle.text}" for n, angle in enumerate(sheet.angles, start=1))]


def _biting(sheet: WeekSheet) -> list[str | None]:
    """The generic facts that bite this week (`bites`), with his angles: the sheet under the angles."""
    return [
        *_angles_lines(sheet),
        _weather_line(sheet) if weather_bites(sheet) else None,
        _allowed_line(sheet) if rank_bites(sheet.allowed) else None,
        _depth_line(sheet) if depth_bites(sheet) else None,
    ]


def render_week_sheet(sheet: WeekSheet) -> str:
    """The week's facts as the writer reads them, one fact to a line, each with its read: with the angles on
    (Lane 300), his angles first after his status, and the weather, the opponent's rank and the depth chart only
    where they bite; the expected score only as an angle."""
    this_week = week_of(sheet.week, sheet.season)
    reach = (
        f"no week's games are {IN_OUR_RECORDS} yet"
        if sheet.through == 0
        else f"every game through {week_of(sheet.through, sheet.season)} is {IN_OUR_RECORDS}"
    )
    lines = [
        f"Player: {sheet.name}, {sheet.position}, {_club(sheet.team)}.",
        f"Today is {central_day_and_time(sheet.written_at)} Central. This read is for {this_week}, the week in "
        f"front of him, and {reach}.",
        _game_line(sheet),
        _status_line(sheet),
        _projection_line(sheet),
        *(
            _biting(sheet)
            if angles_on()
            else (_expected_line(sheet), _weather_line(sheet), _allowed_line(sheet), _depth_line(sheet))
        ),
        _season_line(sheet),
        _board_line(sheet),
    ]
    return "\n".join(line for line in lines if line is not None)


def week_facts_lines(sheet: WeekSheet) -> tuple[tuple[str, str], ...]:
    """(label, value) for each fact the facts block states, no sentence among them."""
    lines: list[tuple[str, str]] = [("Week", f"{sheet.week} of {sheet.season}")]
    game = sheet.game
    if game is not None:
        where = "vs" if game.home else "at"
        kickoff = f"{where} {game.opponent}, {central_day_and_time(game.kickoff)} Central"
        lines.append(("Game", f"bye, next game week {game.week} {kickoff}" if sheet.bye else kickoff))
    status, returning = sheet.status.status, returning_words(sheet.status)
    shown = "no designation" if status is None else returning or STATUS_WORDS.get(status, status)
    lines.append(("Status", shown.removesuffix(".")))
    if sheet.projection is not None and not sheet.bye:
        lines.append(("Published projection", f"{points_text(sheet.projection.points)} points (PPR)"))
    if sheet.allowed is not None and not sheet.bye:
        a = sheet.allowed
        lines.append((f"Opponent against {a.position}s", f"{ordinal(a.rank)} of {a.of}"))
    if sheet.last_games:
        lines.append(("Last games", ", ".join(f"{points_text(g.points)} points" for g in sheet.last_games)))
    if sheet.board is not None:
        b = sheet.board
        lines.append((f"In {b.order_words}", f"{sheet.position}{b.position_rank}"))
    return tuple(lines)


def render_week_facts_block(sheet: WeekSheet) -> str:
    """The facts block as stored: one `Label: value` line per fact, the read the writer could not serve."""
    return "\n".join(f"{label}: {value}" for label, value in week_facts_lines(sheet))
