"""THE SHEET THE WRITER READS, and the facts block a page shows when the writer could not serve him.

One fact to a line, each with the read it came from ("as of Monday 9:03 pm Central"), so the writer and
a reviewer see how old each fact is; the injury report is named by its day ("on Monday's report"). His
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
from research.capsules.render_words import IN_OUR_RECORDS, ordinal, signed, week_of
from research.capsules.week.sheet import (
    CANNOT_PLAY,
    CENTRAL,
    STATUS_WORDS,
    WeekGame,
    WeekSheet,
    central_day_and_time,
    points_text,
)
from research.pipeline.jscompat import js_string

LAST_FANTASY_WEEK: Final = 17
_ROOF_WORDS: Final = {
    "dome": "indoors, under a fixed roof",
    "retractable": "under a retractable roof, open or closed on the day",
}


def _as_of(at: datetime | None) -> str:
    return "" if at is None else f" (as of {central_day_and_time(at)} Central)"


def report_day(at: datetime) -> str:
    """The injury report by its day in Central time: "Monday's report"."""
    return f"{at.astimezone(CENTRAL).strftime('%A')}'s report"


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
    at = sheet.status.captured_at
    report = "the latest report" if at is None else report_day(at)
    if status is None:
        return f"Injury report: no designation for him on {report}."
    word = STATUS_WORDS.get(status, status)
    if status in CANNOT_PLAY:
        return f"Injury report: {word} on {report}. He cannot play in {this_week}."
    if status == "doubtful":
        return f"Injury report: {word} on {report}, unlikely to play in {this_week}. Never tell anyone to start him."
    return f"Injury report: {word} on {report}, so whether he plays in {this_week} is not settled."


def _projection_line(sheet: WeekSheet) -> str | None:
    p = sheet.projection
    if p is None or sheet.bye:
        return None
    parts = [
        f"Published projection for {week_of(sheet.week, sheet.season)}: {points_text(p.points)} points in PPR "
        f"scoring{_as_of(p.captured_at)}. It is a projection published for the week, not ours: call it the "
        "published projection, with that figure."
    ]
    change = sheet.projection_change
    if change is not None and p.previous_points is not None:
        parts.append(
            f"The published figure before it was {points_text(p.previous_points)} points{_as_of(p.previous_captured_at)}, "
            f"a change of {signed(change)} points."
        )
    since = sheet.change_since_last_read
    if since is not None and sheet.last_read is not None and sheet.last_read.projection_points is not None:
        parts.append(
            f"At our last read for this week it was {points_text(sheet.last_read.projection_points)} points, "
            f"a change of {signed(since)} points since."
        )
    return " ".join(parts)


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
    parts = [
        f"{js_string(round(w.temperature_f))} degrees" if w.temperature_f is not None else None,
        f"wind {js_string(round(w.wind_mph))} mph" if w.wind_mph is not None else None,
        f"a {js_string(round(w.precipitation_chance))}% chance of {w.precipitation_kind or 'rain'}"
        if w.precipitation_chance is not None and w.precipitation_kind not in (None, "none")
        else None,
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
    return (
        f"{game.opponent} against {a.position}s in {sheet.season}: {ordinal(a.rank)} of {a.of}, allowing "
        f"{points_text(a.points_a_game)} PPR points a game to {a.position}s through {week_of(a.through, sheet.season)} "
        f"(1st allowed the fewest, {ordinal(a.of)} the most){_as_of(a.read_at)}."
    )


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
        else f" This season: {points_text(sheet.points_per_game)} PPR points a game over {sheet.games_played} {games}"
        + ("" if sheet.touchdowns is None else f", {js_string(sheet.touchdowns)} touchdowns")
        + "."
    )
    missed = "" if not sheet.missed else f" He did not play {week_list(sheet.missed, sheet.season)}."
    return f"His last games, newest first{_as_of(sheet.lines_at)}: {reach}.{rate}{missed}"


def _board_line(sheet: WeekSheet) -> str | None:
    b = sheet.board
    if b is None:
        return None
    place = f"{b.rank} overall, {sheet.position}{b.position_rank}"
    say = f'Any sentence with this rank says it is "in {b.order_words}".'
    if b.rest_of_season and b.from_week is not None:
        points = "" if b.points is None else f"{points_text(b.points)} PPR points, "
        return (
            f"Our rest-of-season order, {week_of(b.from_week, sheet.season)} to "
            f"{week_of(LAST_FANTASY_WEEK, sheet.season)}{_as_of(b.published_at)}: {points}{place}. {say}"
        )
    return f"Our preseason order, set before the season{_as_of(b.published_at)}: {place}. {say}"


def render_week_sheet(sheet: WeekSheet) -> str:
    """The week's facts as the writer reads them, one fact to a line, each with its read."""
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
        _expected_line(sheet),
        _weather_line(sheet),
        _allowed_line(sheet),
        _depth_line(sheet),
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
    status = sheet.status.status
    lines.append(("Status", "no designation" if status is None else STATUS_WORDS.get(status, status)))
    if sheet.projection is not None and not sheet.bye:
        lines.append(("Published projection", f"{points_text(sheet.projection.points)} points (PPR)"))
    if sheet.allowed is not None and not sheet.bye:
        a = sheet.allowed
        lines.append(
            (
                f"Opponent against {a.position}s",
                f"{ordinal(a.rank)} of {a.of}, {points_text(a.points_a_game)} points a game",
            )
        )
    if sheet.last_games:
        lines.append(("Last games", ", ".join(f"{points_text(g.points)} points" for g in sheet.last_games)))
    if sheet.board is not None:
        b = sheet.board
        lines.append((f"In {b.order_words}", f"{b.rank} overall, {sheet.position}{b.position_rank}"))
    return tuple(lines)


def render_week_facts_block(sheet: WeekSheet) -> str:
    """The facts block as stored: one `Label: value` line per fact, the read the writer could not serve."""
    return "\n".join(f"{label}: {value}" for label, value in week_facts_lines(sheet))
