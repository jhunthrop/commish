"""THE WEEK READ'S FACT RULES (Lane 299): a claim the sheet holds a fact for says that fact, not a nearby one.

The founder, 2026-10-29: "they need to be accurate." The writer's rules trace every figure to a cell and every
name to the sheet, but a traced figure or name can still be tied to the wrong fact, or go false after the write.
The live week 8 audit found these, each closed here against the sheet (and two more the cadence alone holds a
stored read to, `standing_violations`: an undated Opp rank and his points a game as tonight's cells print them):

- His place on the depth chart. A place said of him ("he sits fourth among Titans backs", "Seattle lists him
  second", "his second job behind Jacory Croskey-Merritt") is the sheet's (`DepthPlace.slot`), and a teammate he
  is said to sit behind is one the sheet lists ahead of him. With no place on the sheet, the read states none.
- A game's figure tied to its week. "1.6 PPR points, back in week 4 of 2026 at New Orleans" is refused when the
  sheet's week 4 line is 1.2 points against Miami: a figure tied to a week is that week's game, and a club named
  with it is that game's opponent; a week the sheet's newest games do not include has no figure to state.
- The kickoff forecast. A degrees, mph or chance figure, or a kind of weather the read says will come, is the
  weather cell's (`weather_violations`); a denied kind ("no rain") is no claim, and thunderstorms carry rain.

Both judge the text against the sheet, never the body alone, so a stored read that breaks them is not
`cadence.RULE_STALE`: the cadence holds a stored read to them against tonight's sheet (`cadence.FACT_STALE`), so
a read written from the week-one chart, or whose place has moved since, is written again once a night.
"""

import re
from collections.abc import Sequence
from typing import Final

from research.capsules.facts.team_names import NFL_TEAM_NAMES
from research.capsules.page_figures import page_tenth
from research.capsules.render_depth import slot_word
from research.capsules.sentences import split_sentences
from research.capsules.week.cells import ROOFED, misranked, named_chance
from research.capsules.week.sheet import WeekSheet, points_text
from research.model.jsmath import js_round

_ORDINALS: Final = ("first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth")
_ORDINAL: Final = "|".join(_ORDINALS)
# What a place on the chart stands before: "fourth among", "second on the depth chart", "third behind",
# "third-string", "second in line".
_PLACE_AFTER: Final = r"(?=\s+(?:among|on|in|behind|at)\b|-string\b|\s+string\b)"
# Words that may stand between him and his place ("he's still listed second", "Seattle lists him second"): no
# capitalised word, so a teammate's place ("Tucker Kraft sits first") is never read as his.
_GAP: Final = r"(?:\s+(?:[a-z']+|'s))*?\s+"


def _his_names(sheet: WeekSheet) -> list[str]:
    parts = sheet.name.split()
    last = next((p for p in reversed(parts) if p.rstrip(".") not in {"Jr", "Sr", "II", "III", "IV", "V"}), parts[-1])
    return [re.escape(sheet.name), re.escape(last)]


def _place_patterns(sheet: WeekSheet) -> tuple[re.Pattern[str], ...]:
    him = r"(?:\b[Hh]e(?:'s)?|\bhim|" + "|".join(rf"\b{n}" for n in _his_names(sheet)) + r")"
    his = r"(?:\b[Hh]is|" + "|".join(rf"\b{n}(?:'|\u2019)s" for n in _his_names(sheet)) + r")"
    return (
        re.compile(rf"{him}{_GAP}({_ORDINAL}){_PLACE_AFTER}"),
        re.compile(rf"{his}(?:\s+[a-z]+)?\s+({_ORDINAL})(?:\s+|-)(?:job|role|spot|string|place)\b"),
        re.compile(rf"{his}\s+(?:spot|place|role)\s+(?:running|listed|sitting)\s+({_ORDINAL}){_PLACE_AFTER}"),
    )


def _named_ahead(sentence: str) -> list[str]:
    """The players a sentence puts ahead of him: the capitalised names after "behind", a list joined by commas
    and "and"."""
    found = re.search(r"\bbehind\s+((?:[A-Z][\w.'\u2019-]*(?:\s+[A-Z][\w.'\u2019-]*)*)(?:(?:,\s*|,?\s+and\s+)"
                      r"[A-Z][\w.'\u2019-]*(?:\s+[A-Z][\w.'\u2019-]*)*)*)", sentence)  # fmt: skip
    if found is None:
        return []
    return [n.strip().rstrip(".") for n in re.split(r",\s*(?:and\s+)?|\s+and\s+", found.group(1)) if n.strip()]


def _about_him_behind(sentence: str, sheet: WeekSheet) -> bool:
    """Whether "behind" in the sentence is said of him: he, him or his name stands before it with no other
    capitalised name between."""
    head = sentence[: sentence.find("behind")]
    him = r"(?:\b[Hh]e(?:'s)?\b|\bhim\b|\b[Hh]is\b|" + "|".join(rf"\b{n}\b" for n in _his_names(sheet)) + r")"
    mentions = list(re.finditer(him, head))
    if not mentions:
        return False
    between = head[mentions[-1].end() :]
    for city, nick in NFL_TEAM_NAMES.values():
        between = between.replace(f"{city} {nick}", "").replace(city, "").replace(nick, "")
    return not re.search(r"\b[A-Z][a-z]+\b", between)


def _violation(what: str, sentence: str, remedy: str) -> str:
    return f'The text {what} in the sentence "{sentence}". {remedy}'


def _depth_remedy(sheet: WeekSheet) -> str:
    d = sheet.depth
    if d is None:
        return "The facts give him no place on this week's depth chart: say nothing of where he sits."
    ahead = [name for name, slot in d.around if slot < d.slot]
    names = "" if not ahead else f", behind {', '.join(ahead)}"
    return f"The facts list him {slot_word(d.slot)} on this week's depth chart{names}: say his place as they do."


# A place said as where he came from ("up from second on the chart before", Lane 300's depth line).
_FROM_BEFORE: Final = re.compile(r"\bfrom\s+$")


def _said_as_the_move(sentence: str, m: re.Match[str], sheet: WeekSheet) -> bool:
    """Whether a place is his place on the chart before, said after "from" as the sheet's move gives it."""
    before = sheet.depth_moved_from
    if before is None or not _FROM_BEFORE.search(sentence[: m.start(1)]):
        return False
    return float(_ORDINALS.index(m.group(1)) + 1) == before


def place_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """His place on the chart as the sheet lists it, and only teammates it lists ahead of him behind (Lane 299)."""
    d = sheet.depth
    out = []
    for s in sentences:
        for pattern in _place_patterns(sheet):
            m = next((m for m in pattern.finditer(s) if not _said_as_the_move(s, m, sheet)), None)
            if m is None:
                continue
            said = _ORDINALS.index(m.group(1)) + 1
            if d is None or float(said) != d.slot:
                out.append(
                    _violation(f'places him {m.group(1)} on the depth chart ("{m.group(0)}")', s, _depth_remedy(sheet))
                )
            break
        else:
            ahead = _named_ahead(s) if "behind" in s and _about_him_behind(s, sheet) else []
            listed = {} if d is None else dict(d.around)
            wrong = [
                n for n in ahead
                if (slot := next((v for name, v in listed.items() if n == name or name.endswith(f" {n}")), None))
                is not None and d is not None and slot > d.slot
            ]  # fmt: skip
            if wrong:
                out.append(
                    _violation(f"puts {', '.join(wrong)} ahead of him on the depth chart", s, _depth_remedy(sheet))
                )
    return out


# A figure in points tied to a week: "1.6 PPR points, back in week 4", "21.8 PPR points in week 7", "week 7's
# 26.1 points". A points-a-game figure is his Avg's, never a week's.
_POINTS: Final = r"(\d+(?:\.\d+)?)\s+(?:(?:half-)?ppr\s+)?(?:fantasy\s+)?points?\b(?!\s+(?:a|per)\s+game\b)"
_FIGURE_THEN_WEEK: Final = re.compile(
    _POINTS
    + r"(?:[^.;\d]{0,12}?)\b(?:in|from|during|back in|all the way back in)\s+week\s+(\d{1,2})\b(?!\s*(?:to|through|-|on\b|onward))",
    re.IGNORECASE,
)
_WEEK_THEN_FIGURE: Final = re.compile(r"\bweek\s+(\d{1,2})(?:'|\u2019)s\s+" + _POINTS, re.IGNORECASE)
_CLUB_FORMS: Final = {code: (city, nick) for code, (city, nick) in NFL_TEAM_NAMES.items()}


def _clubs_in(text: str) -> set[str]:
    return {
        code
        for code, (city, nick) in _CLUB_FORMS.items()
        if re.search(rf"\b{re.escape(nick)}\b", text) or (city not in ("New York", "Los Angeles") and re.search(rf"\b{re.escape(city)}\b", text))
    }  # fmt: skip


def _people(sheet: WeekSheet) -> tuple[str, ...]:
    """His name and his teammates' on the chart, longest first, so a club inside a name ("Malik Washington") is
    never read as the club."""
    around = () if sheet.depth is None else tuple(name for name, _ in sheet.depth.around)
    return tuple(sorted({sheet.name, *around}, key=len, reverse=True))


def week_figure_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """A figure tied to a week is that week's game in the sheet, and a club named in its clause is that game's
    opponent (Lane 299)."""
    games = {g.week: g for g in sheet.last_games}
    out = []
    for s in sentences:
        tied = [(m.group(1), int(m.group(2)), m) for m in _FIGURE_THEN_WEEK.finditer(s)]
        tied += [(m.group(2), int(m.group(1)), m) for m in _WEEK_THEN_FIGURE.finditer(s)]
        for raw, week, m in tied:
            game = games.get(week)
            if game is None:
                out.append(
                    _violation(
                        f'ties "{raw}" points to week {week}, a game the facts do not list',
                        s,
                        "State a game's points only for a week the facts list among his last games, as they list it.",
                    )
                )
                continue
            clause = re.split(r"[;,]\s+(?:and|but|while|so)\b|;", s[m.start() :])[0]
            for person in _people(sheet):
                clause = clause.replace(person, "")
            clubs = _clubs_in(clause) - {sheet.team}
            wrong_points = page_tenth(float(raw)) != page_tenth(game.points)
            wrong_club = bool(clubs) and game.opponent not in clubs
            if wrong_points or wrong_club:
                where = "against" if game.home else "at"
                out.append(
                    _violation(
                        f'ties "{raw}" points to week {week}',
                        s,
                        f"The facts list week {week} as {where} {game.opponent}, {points_text(game.points)} PPR points: tie each "
                        "figure to its own week and club.",
                    )
                )
    return out


# The kickoff forecast's figures and kinds as a read states them: "64 degrees", "16 mph", "a 75% chance",
# "thunderstorms", "rain", "snow".
_DEGREES: Final = re.compile(r"\b(\d+)\s*(?:degrees|°)", re.IGNORECASE)
_MPH: Final = re.compile(r"\b(\d+)(?:\s+|-)mph\b", re.IGNORECASE)
_CHANCE: Final = re.compile(r"\b(\d+)(?:%|\s+percent)\s+chance\b", re.IGNORECASE)
# Each kind the forecast names (`nws.grid.PRECIPITATION_KINDS`) and the words a read says it in; freezing rain is
# ice, never rain.
_KINDS: Final = (
    ("thunderstorms", re.compile(r"\bthunder(?:storms?)?\b|\bstorms?\b", re.IGNORECASE)),
    ("rain", re.compile(r"(?<!freezing )\brain(?:y|fall|s)?\b|\bshowers?\b", re.IGNORECASE)),
    ("snow", re.compile(r"\bsnow(?:y|fall|s)?\b", re.IGNORECASE)),
    ("ice", re.compile(r"\bice\b|\bicy\b|\bsleet\b|\bfreezing rain\b", re.IGNORECASE)),
)
# The kinds a named kind carries with it: a thunderstorm forecast rains (the Lane 299 review's L1).
_IMPLIED: Final = {"thunderstorms": frozenset({"thunderstorms", "rain"})}
# A kind denied is no claim: "no rain in the forecast", "without snow", "not a storm" (within three words).
_NEGATED: Final = re.compile(r"\b(?:no|without|not)\b(?:\W+\w+){0,2}\W*$", re.IGNORECASE)


def _claimed(pattern: re.Pattern[str], sentence: str) -> bool:
    """Whether a sentence says a kind of weather will come: a match with no denial within three words before it."""
    return any(not _NEGATED.search(sentence[: m.start()]) for m in pattern.finditer(sentence))


def _forecast_cells(sheet: WeekSheet) -> tuple[float | None, float | None, float | None, str | None]:
    """The weather cell's temperature, wind, named chance and kind (`cells`), each None where it prints none."""
    w = sheet.weather
    if w is None or sheet.bye or w.roof in ROOFED:
        return None, None, None, None
    chance = named_chance(w)
    temperature = None if w.temperature_f is None else js_round(w.temperature_f)
    wind = None if w.wind_mph is None else js_round(w.wind_mph)
    return temperature, wind, chance, None if chance is None else w.precipitation_kind


def weather_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """A kickoff figure or a kind of weather a read states is the weather cell's (Lane 299): the forecast moves
    every hour, and a read whose "75% chance of thunderstorms" has become 89%, or rain that has cleared, is wrong
    on the page beside a cell printing tonight's forecast."""
    temperature, wind, chance, kind = _forecast_cells(sheet)
    out = []
    for s in sentences:
        said = [
            *(("degrees", float(m.group(1)), temperature) for m in _DEGREES.finditer(s)),
            *(("mph", float(m.group(1)), wind) for m in _MPH.finditer(s)),
            *(("% chance", float(m.group(1)), chance) for m in _CHANCE.finditer(s)),
        ]
        off = [f"{value:g} {unit}" for unit, value, cell in said if cell is None or value != cell]
        allowed = _IMPLIED.get(kind or "", frozenset({kind}))
        kinds = [name for name, pattern in _KINDS if name not in allowed and _claimed(pattern, s)]
        if off or kinds:
            out.append(
                _violation(
                    f"states the kickoff forecast as {', '.join([*off, *kinds])}",
                    s,
                    "Say the forecast as the facts give it, or leave the weather out.",
                )
            )
    return out


_A_GAME: Final = re.compile(
    r"\b(\d+(?:\.\d+)?)\s+(?:(?:half-)?ppr\s+)?(?:fantasy\s+)?(?:points?\s+)?(?:a|per)\s+game\b", re.I
)


def _dated_before(sentence: str, sheet: WeekSheet) -> bool:
    """Whether a sentence dates its rank to an earlier reach than tonight's ("through week 6" when the sheet
    ranks through week 7): a dated rank stands (the brief's ruling), only an undated one must be tonight's."""
    a, dated = sheet.allowed, re.search(r"\bthrough week (\d{1,2})\b", sentence, re.IGNORECASE)
    return a is not None and dated is not None and int(dated.group(1)) < a.through


def standing_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """The opponent's rank and his points a game as tonight's cells print them: the validator holds a read to both
    at the write (`rules`, `cells.misranked` and `cells.misnamed`), and the cadence holds a stored read to them,
    so a read written before a week's lines landed, or from the sheet's rank before it counted lines as the card
    does (`collect.allowed_by_opponent`, Lane 299), is written again. A figure a game that is not his Avg is
    another's (what an opponent allows) only in a sentence about what it allows, and is left to the cells."""
    out = [
        _violation(f'states the opponent\'s rank "{rank}"', s, "Say the opponent's rank as the facts give it.")
        for s in sentences
        if not _dated_before(s, sheet)
        for rank in misranked(s, sheet)
    ]
    avg = None if sheet.points_per_game is None else page_tenth(sheet.points_per_game)
    for s in sentences:
        if re.search(r"\b(?:allow|give|gave|giving|surrender)", s, re.IGNORECASE):
            continue
        off = [m.group(1) for m in _A_GAME.finditer(s) if avg is None or page_tenth(float(m.group(1))) != avg]
        if off:
            out.append(
                _violation(f'states "{off[0]}" points a game', s, "Say his points a game as the facts give them.")
            )
    return out


def fact_violations(text: str, sheet: WeekSheet) -> list[str]:
    """Every fact rule over a read's text against `sheet`: the cadence's check on a stored read
    (`cadence.FACT_STALE`) against tonight's sheet."""
    sentences = split_sentences(text.strip())
    return [
        *place_violations(sentences, sheet),
        *week_figure_violations(sentences, sheet),
        *weather_violations(sentences, sheet),
        *standing_violations(sentences, sheet),
    ]
