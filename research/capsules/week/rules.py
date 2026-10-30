"""THE WEEK READ'S OWN RULES, on top of the writer's (`capsules.validate`).

This week's rulings and the Lane 72 review's, each a rule the validator reads:
- No betting word in any sense: the writer's list and this read's stricter four ("line" outside football's
  own senses, "lines up" included; "favoured"; "underdog"; "spread" outside spreading the ball). No
  provider's name, no rival product.
- No semicolon, em dash or en dash (Lane 307, the founder 2026-10-30).
- The week's number is the published projection, never ours (`sheet.PROJECTION_BASIS`), and the read never
  states it (H4, inverted by Lane 275, the founder 2026-10-28): no sentence names the published projection,
  and none states its figure, the one before it or its change, with or without a unit. The card's Wk cell
  prints it, and a read that quoted it went stale the moment it moved. Nothing calls a weekly number ours.
- A player the sheet says may not be started (on his bye, out, on a season-long list, Doubtful) is never
  recommended to start: the writer's own call for its read must not be "start" (`CALLS`), and a sentence
  that tells a manager to start him, in his name or a pronoun, outside a negation of its own clause,
  refuses the read too (H2). A player who cannot play is said not to play. One designated to return this week
  (Lane 153) is this week's question and may play: no sentence keeps him on his list or out.
- A rank in our order says which order it is: "in our preseason order" or "in our rest-of-season order" (M2).
- The season is named at most once; weeks after it are "week 5" (the coordinator's ruling on L5).
- An injury report named by its day is the one the sheet names, the game status report the clubs had issued
  by the write (`week.report_day`), or this week's game status report by the day the sheet states for it
  (Lane 303, B307); never a day no report came out, and never a report still to come cited for what it says
  (Lane 96, B16). The writer's season wording is mended before these rules read it (`season_words`, Lane 303).
- Every figure is one the page draws as a cell or a usage fact on the sheet states (`cells`, Lane 100, 300).
- His place on the depth chart is the sheet's, and a game's figure tied to a week is that week's game
  (Lane 299, `fact_rules`).

Each violation names its sentence in the writer's form (`the sentence "..."`), so a correction hands it
back word for word (`rule_notes`).

Lane 307 retired the rules that refused a true sentence for its wording (the sentence count, the opener, a
figure's unit, the cap on figures, a rank said twice, the member addressed, a figure spelled out, the ordinary
matchup's rank, the tip words) with the checklist prompt that asked for them.
"""

import re
from collections.abc import Sequence
from typing import Final

from research.capsules.facts.team_names import NFL_TEAM_NAMES
from research.capsules.names import name_pattern
from research.capsules.page_figures import page_tenth
from research.capsules.sentences import split_sentences
from research.capsules.voice_rules import named_rule
from research.capsules.week.angle_rules import figure_violations as angle_figure_violations
from research.capsules.week.cells import cell_figures, misnamed, misranked, quotable_figures
from research.capsules.week.fact_rules import place_violations, weather_violations, week_figure_violations
from research.capsules.week.place_rules import place_violations as angle_place_violations
from research.capsules.week.place_rules import unusual_violations
from research.capsules.week.rank_words import fits, rank_words, superlatives_in
from research.capsules.week.render import report_said
from research.capsules.week.report_day import report_day, report_issued, report_out
from research.capsules.week.sheet import WeekSheet, central_day_and_time, sheet_names
from research.capsules.week.start_advice import start_advice_in

# The writer's own call for its read, one word (H2): what it tells a manager who has him to do this week.
START: Final = "start"
CALLS: Final = (START, "sit", "hold", "none")
# The words a week read never carries beyond the writer's lists: each a named rule, shown to the writer.
WEEK_NEVER_WORDS: Final = (
    named_rule(
        "a betting word (a line)",
        r"(?<!offensive )(?<!defensive )(?<!goal )(?<!goal-)(?<!stat )(?<!o-)(?<!d-)(?<!front )\blines?\b"
        r"(?! of scrimmage)(?! up\b)",
        shown=("line", "the line"),
    ),
    named_rule(
        "a betting word (favoured)",
        r"\bfavou?red\b|\bfavou?rites?\b(?! (?:target|receiver|weapon|option|read)s?\b)",
        shown=("favoured", "favored", "the favorite"),
    ),
    named_rule("a betting word (underdog)", r"\bunderdogs?\b", shown=("underdog",)),
    named_rule(
        "a betting word (spread)",
        r"\bspreads?\b(?! (?:the ball|it around|out|the field|the defense)\b)",
        shown=("spread",),
    ),
    named_rule(
        "a provider's name",
        r"\btank ?01\b|\bnflverse\b|\b(?:national )?weather service\b|\bnws\b|\bnext gen stats\b|"
        r"\bpro football reference\b|\bftn\b",
    ),
)
_OURS: Final = re.compile(
    r"\bour (?:own )?(?:weekly )?(?:projection|number|forecast|model)s?\b|\bwe(?:'re| are)? project(?:s|ing)?\b",
    re.IGNORECASE,
)
# A name for the week's published projection (Lane 275): "published", "projection" or "projected", other than
# our rest-of-season order's own words.
_NAMES_PROJECTION: Final = re.compile(
    r"\bpublished\b|(?<!rest-of-season )(?<!rest of season )\bprojections?\b|\bprojected\b", re.IGNORECASE
)
# The card and its cells by name, and the week's number by a name of its own (Lane 275 fix round 2, review M2):
# "his Wk figure looks light" grades the published projection without its words.
_NAMES_THE_CARD: Final = re.compile(
    r"\b(?:cards?|cells?|tiles?|wk|proj)\b|\b(?:the|this) week(?:'|\u2019)?s (?:number|figure)\b", re.IGNORECASE
)
_DOES_NOT_PLAY: Final = re.compile(
    r"\bbye\b|\b(?:does not|doesn't|will not|won't|cannot|can't) play\b|\bno game\b|\bruled out\b|"
    r"\binjured reserve\b|\bsits? out\b|\bis out\b",
    re.IGNORECASE,
)
# A read that waits on his status before saying start (the re-review's F4): its call is hold.
_WAITS: Final = re.compile(
    r"\b(?:wait|waiting)\b|\bif (?:he(?:'s| is)?|the inactives) (?:active|cleared|clear him|plays|good to go|"
    r"suits up|goes)\b|\bcheck (?:his|the) status\b|\bgame-time\b|\bbefore (?:you )?(?:lock|start)\b",
    re.IGNORECASE,
)
# A figure's digits ("19.5", "3", "30%"), with what may stand right after it as its unit or basis.
_FIGURE: Final = re.compile(r"(?<![\w.:])\d+(?:\.\d+)?%?(?![\w:]|\.\d)")
_WEEK_BEFORE: Final = re.compile(r"\bweeks?\s+(?:\d{1,2}\s*(?:,|and|or|to|through|-)\s*)*$", re.IGNORECASE)
_CLOCK_AFTER: Final = re.compile(r"^(?::\d\d)?\s*(?:am|pm)\b", re.IGNORECASE)
_ORDINAL_OF_BEFORE: Final = re.compile(r"\d(?:st|nd|rd|th)\s+of\s+$", re.IGNORECASE)


_ALLOWS: Final = re.compile(r"\b(?:allow\w*|gives? up|giving up|gave up|surrender\w*)\b", re.IGNORECASE)


def _sentence_violation(what: str, sentence: str, remedy: str) -> str:
    return f'The text {what} in the sentence "{sentence}". {remedy}'


def _unnamed(sentence: str, names: Sequence[str]) -> str:
    """`sentence` with each of `names` (his and his teammates', whole and case-sensitive, any accent) masked, so a
    word rule never reads a name (Lane 303 fix round 1): "Tip Reiman" carries no tip, "KC Concepcion" no club code."""
    for name in sorted(dict.fromkeys(names), key=len, reverse=True):
        sentence = re.sub(rf"(?<![^\W\d_]){name_pattern(name)}(?![^\W\d_])", "Him", sentence)
    return sentence


def _word_violations(sentences: Sequence[str], names: Sequence[str] = ()) -> list[str]:
    out = []
    for rule in WEEK_NEVER_WORDS:
        sentence = next((s for s in sentences if rule.pattern.search(_unnamed(s, names))), None)
        if sentence is not None:
            out.append(_sentence_violation(f"carries {rule.name}", sentence, "Rewrite that sentence without it."))
    return out


def figures_of(sentence: str, season: int) -> list[tuple[str, float, int, int]]:
    """Every figure a sentence states, as (as written, value, start, end): week numbers, the season and
    clock times are not figures."""
    out = []
    for match in _FIGURE.finditer(sentence):
        raw, before, after = match.group(0), sentence[: match.start()], sentence[match.end() :]
        if raw == str(season) or _WEEK_BEFORE.search(before) or _CLOCK_AFTER.match(after):
            continue
        out.append((raw, float(raw.removesuffix("%")), match.start(), match.end()))
    return out


def stated_figures(sentence: str, season: int) -> list[tuple[str, float]]:
    """The figures a sentence states, (as written, value): a rank's "of 32" belongs to its rank."""
    return [(raw, value) for raw, value, _, _ in _stated(sentence, season)]


def _stated(sentence: str, season: int) -> list[tuple[str, float, str, str]]:
    """Each stated figure with the text before and after it, where its name is."""
    return [
        (raw, value, sentence[:start], sentence[end:])
        for raw, value, start, end in figures_of(sentence, season)
        if not _ORDINAL_OF_BEFORE.search(sentence[:start])
    ]


_NAME_AS_THE_CELL: Final = (
    "Name each figure as its cell does: his points a game are his Avg, his last game's points are Last's, a "
    "game's points are that game's, his rest-of-season points are the Rest of season tile's, and the opponent's "
    "rank is Opp rank's. The week's published projection is the card's alone: never quote it."
)


def _misnamed_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """A cell's figure named as another cell (Lane 100 review M1, Lane 117 B80): "37.7 PPR points a game"
    where his Avg is 25.9 and 37.7 is a game's; a rank against his position that is not Opp rank's."""
    out = []
    for s in sentences:
        for raw, value, before, after in _stated(s, sheet.season):
            cell = misnamed(before, after, page_tenth(value), sheet)
            if cell is not None:
                out.append(
                    _sentence_violation(
                        f'names "{raw}" as {cell}, a cell that prints another figure', s, _NAME_AS_THE_CELL
                    )
                )
        out.extend(
            _sentence_violation(
                f'names "{raw}" as the opponent\'s rank against his position (Opp rank), a cell that prints another '
                "rank",
                s,
                _NAME_AS_THE_CELL,
            )
            for raw in misranked(s, sheet)
        )
    return out


def _cell_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """A figure the page draws in no cell and no usage fact states (Lane 100, Lane 300)."""
    cells = cell_figures(sheet)
    out = []
    for s in sentences:
        off = [raw for raw, value in stated_figures(s, sheet.season) if page_tenth(value) not in cells]
        if off:
            quoted = ", ".join(f'"{raw}"' for raw in off)
            out.append(
                _sentence_violation(
                    f"states {quoted}, a figure the page draws in no cell",
                    s,
                    "Quote only a figure the facts state (the opponent's rank, his points a game, a game's points, "
                    "his rest-of-season points, the expected score, the kickoff weather, a usage fact's figure), "
                    "named as the facts name it, or say it in words.",
                )
            )
    return out


def _paragraph_violation(text: str) -> list[str]:
    if "\n" not in text.strip():
        return []
    return ["The read runs to more than one paragraph. Write it as one paragraph."]


def _published_figures(sheet: WeekSheet) -> set[float]:
    """The figures the sheet puts on the published projection that no other cell prints: it, the one before
    it, the changes, and the figure the last read was written with (a figure another cell prints too, his last
    game's points, is that cell's to quote)."""
    p = sheet.projection
    if p is None:
        return set()
    last = sheet.last_read
    values = [p.points, p.previous_points, sheet.projection_change, sheet.change_since_last_read]
    values.append(None if last is None else last.projection_points)
    return {page_tenth(abs(v)) for v in values if v is not None} - quotable_figures(sheet)


_LEAVE_IT_OUT: Final = (
    "The card prints the published projection: leave it, its figure, its change and the card out of the read, "
    "and say what you see in his status, his role, the matchup or his rate."
)


def names_the_projection(text: str) -> bool:
    """Whether a read names the published projection or the card, or calls a weekly number ours (H4's words, on
    the text alone): the cadence's check for a read written under the rule before Lane 275 (`cadence.RULE_STALE`)."""
    patterns = (_NAMES_PROJECTION, _NAMES_THE_CARD, _OURS)
    return any(pattern.search(s) for s in split_sentences(text.strip()) for pattern in patterns)


def _projection_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """H4 (Lane 275): no sentence names the published projection or states its figures; none calls a weekly
    number ours."""
    figures = _published_figures(sheet)
    out = []
    for s in sentences:
        if _OURS.search(s):
            out.append(
                _sentence_violation(
                    "calls a weekly number ours", s, "The week's number is never ours. " + _LEAVE_IT_OUT
                )
            )
        named = _NAMES_PROJECTION.search(s)
        if named is not None:
            out.append(_sentence_violation(f'names the published projection ("{named.group(0)}")', s, _LEAVE_IT_OUT))
        card = _NAMES_THE_CARD.search(s)
        if card is not None:
            out.append(_sentence_violation(f'names the card ("{card.group(0)}")', s, _LEAVE_IT_OUT))
        stated = [raw for raw, value, _, _ in _stated(s, sheet.season) if page_tenth(value) in figures]
        if stated:
            quoted = ", ".join(f'"{raw}"' for raw in stated)
            out.append(_sentence_violation(f"states the published projection's figure {quoted}", s, _LEAVE_IT_OUT))
    return out


def _cannot_start_violations(sentences: Sequence[str], sheet: WeekSheet, call: str | None) -> list[str]:
    if sheet.may_start:
        return []
    why = "is on his bye" if sheet.bye else "may not be started on his status"
    week = f"week {sheet.week} of {sheet.season}"
    out = []
    if call == START:
        out.append(
            f"The read's call is start, but he {why} in {week}. Never recommend him for this week: say what it means "
            "for a roster that has him, and make the call sit, hold or none."
        )
    for s in sentences:
        found = start_advice_in(s, sheet.name)
        if found is not None:
            out.append(
                _sentence_violation(
                    f'recommends starting a player who may not be started this week ("{found}")',
                    s,
                    f"He {why} in {week}: say what that means for a roster, and never recommend him for this week.",
                )
            )
    if not sheet.can_play and not any(_DOES_NOT_PLAY.search(s) for s in sentences):
        out.append(
            f"The read never says he does not play in {week}. He {why}: say so, and what it means for a roster "
            "that has him."
        )
    return out


# A read about a player designated to return this week (Lane 153) never keeps him on his list: he may play.
_KEPT_OUT: Final = re.compile(
    r"\b(?:does not|doesn't|will not|won't|cannot|can't) play\b|\bno game\b|\bruled out\b|\bsits? out\b|"
    r"\bis out\b|\b(?:is|remains|stays|still) on (?:injured reserve|the (?:pup|nfi) list)\b",
    re.IGNORECASE,
)


def _returning_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    if not sheet.can_play or not sheet.status.returning_this_week:
        return []
    return [
        _sentence_violation(
            "keeps a player designated to return this week out",
            s,
            f"He is designated to return and may play in week {sheet.week} of {sheet.season}: say what his "
            "return means for a roster that has him.",
        )
        for s in sentences
        if _KEPT_OUT.search(s)
    ]


def _wait_violation(text: str, sheet: WeekSheet, call: str | None) -> list[str]:
    if call != START or _WAITS.search(text) is None:
        return []
    return [
        f"The read waits on {sheet.name}'s status before saying start, but its call is start. A read that waits "
        "on his status calls itself hold."
    ]


_CLUB_CODE: Final = re.compile(r"\b(?:" + "|".join(sorted(NFL_TEAM_NAMES, key=len, reverse=True)) + r")\b")


def _code_violations(sentences: Sequence[str], names: Sequence[str] = ()) -> list[str]:
    out = []
    for s in sentences:
        found = _CLUB_CODE.search(_unnamed(s, names))
        if found is not None:
            out.append(
                _sentence_violation(
                    f'names a club by its code ("{found.group(0)}")',
                    s,
                    "Name clubs by name, as the facts give them beside the code: the Cardinals, Arizona.",
                )
            )
    return out


def _order_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    board = sheet.board
    if board is None:
        return []
    claim = re.compile(
        rf"\b{re.escape(sheet.position)}{board.position_rank}\b|\b{board.rank}(?:st|nd|rd|th)?\s+overall\b|"
        r"\bour (?:board|order)\b",
        re.IGNORECASE,
    )
    words = board.order_words.removeprefix("our ")
    return [
        _sentence_violation(
            "states his place in our order without saying which order",
            s,
            f'Say it is "in {board.order_words}".',
        )
        for s in sentences
        if claim.search(s) and words not in s.lower()
    ]


# A report or a list named by its day (review L1): "Friday's report", "the Tuesday report", "Tuesday's
# practice report", "Sunday's injury list", and a week named with it (Lane 303 fix round 1): "Friday's week 9 report".
_REPORT_DAY: Final = re.compile(
    r"\b(?:the\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:(?:'|\u2019)s)?\s+"
    r"(?:week\s+(?P<week>\d{1,2})(?:\s+of\s+(?:19|20)\d\d)?(?:(?:'|\u2019)s)?\s+)?"
    r"(?:injury\s+|practice\s+|game status\s+)?(?:report|list)\b",
    re.IGNORECASE,
)


# The words between a day and its report that name no other report (review R1-L2): "Friday's injury
# report" is the sheet's "Friday's report", and so is "Friday's week 8 report" once its week is checked.
_KIND: Final = re.compile(r"\s(?:injury|practice|game status)\s")
_WEEK_WORDS: Final = re.compile(r"\s+week\s+\d{1,2}(?:\s+of\s+\d{4})?(?:'s)?(?=\s)")


def _named(text: str) -> set[str]:
    """Each report or list named by its day, as one phrase: lower case, no leading "the", no week, no kind word."""
    return {
        _KIND.sub(" ", _WEEK_WORDS.sub("", m.group(0).lower().replace("\u2019", "'")).removeprefix("the "))
        for m in _REPORT_DAY.finditer(text)
    }


# A report still to come (the review's H1): a forward cue in the clause before it ("before Friday's report", "if
# Friday's game status report clears him", "until", "ahead of", "once", "pending"), or a future word after it
# ("Friday's report will settle it", "is still to come", "decides whether he plays"). A report as the source of
# what it says ("Friday's report cleared him", "has him Out", "is out") is never still to come.
_FORWARD_BEFORE: Final = re.compile(
    r"\b(?:before|until|till|unless|ahead of|if|when|once|into|heading into|awaiting|pending|"
    r"wait(?:s|ing)? (?:for|on)|check|watch|let|see what|by the time)\b",
    re.IGNORECASE,
)
# "by" is the agent as often as the deadline ("cleared by Friday's report", the re-review's M1): it is still to
# come only with a forward word in its clause ("we will know by Friday's report", "by Friday's report it decides").
_BY_BEFORE: Final = re.compile(r"\bby\s+$", re.IGNORECASE)
_FORWARD_IN_CLAUSE: Final = re.compile(
    r"\b(?:will|would|could|should|decides?|settles?|determines?|we know|we'll know|we will know)\b", re.IGNORECASE
)
_FORWARD_AFTER: Final = re.compile(
    r"^(?:'s)?\s*(?:will|would|could|should|may|might|is due|comes?|lands?|is (?:still )?to come|still to come|"
    r"(?:is )?still ahead|has yet to|is yet to|is not out|isn't out|has not come|hasn't come|"
    r"(?:decides?|settles?|determines?) (?:whether|if|it|his|this|that))\b",
    re.IGNORECASE,
)
_CITES_AFTER: Final = re.compile(
    r"^(?:'s)?\s*(?:cleared|lists?|listed|has him|had him|shows?|showed|confirmed|named|ruled|put|gave|"
    r"downgraded|upgraded|is out|came out|is in|says|said)\b",
    re.IGNORECASE,
)
_CLAUSE_START: Final = re.compile(r"[,;:.]")


def _still_to_come(sentence: str, found: re.Match[str]) -> bool:
    """Whether a day-named report is named as still to come in `sentence` (the review's H1)."""
    after = sentence[found.end() :]
    if _CITES_AFTER.match(after):
        return False
    clause = _CLAUSE_START.split(sentence[: found.start()])[-1]
    if _FORWARD_BEFORE.search(clause) is not None or _FORWARD_AFTER.match(after) is not None:
        return True
    rest = _CLAUSE_START.split(after)[0]
    return _BY_BEFORE.search(clause) is not None and _FORWARD_IN_CLAUSE.search(f"{clause} {rest}") is not None


def _report_day_words(sheet: WeekSheet) -> set[str]:
    """This week's game status report by its day, as `_named` reads it ("friday's report", "friday report"), when
    the sheet states the day (`report_day.report_day_line`)."""
    day = report_day(sheet)
    return set() if day is None else {f"{day.lower()}'s report", f"{day.lower()} report"}


def _list_day_words(sheet: WeekSheet) -> set[str]:
    """The injury list by the Central day his status was read (Lane 303 fix round 1): "Tuesday's injury list" is
    the sheet's "the injury list as of Tuesday"; a list named by any other day is not."""
    seen_at = sheet.status.seen_at(sheet.written_at)
    if seen_at is None:
        return set()
    day = central_day_and_time(seen_at).split(" ", 1)[0].lower()
    return {f"{day}'s list", f"{day} list"}


def _report_day_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """A report or a list named by its day is one the sheet's own words name (Lane 96, B16 and review L1), this
    week's game status report by the day the sheet states for it (Lane 303, B307), or the injury list by the day
    his status was read. Never a day no report was issued on by the write, and never a report for a week the read
    is not for (a bye's "Friday's week 9 report"). This week's report by its day, as the write's clock and his
    status's read date it (`report_day`, the review's H1 and M2): cited freely once his status was read after it;
    before it is out, named only as still to come; out but his status read before it, not named by its day."""
    named = report_said(sheet)
    day_words = _report_day_words(sheet)
    allowed = _named(named) | day_words | _list_day_words(sheet)
    out_for_him, issued = report_out(sheet), report_issued(sheet)
    out: list[str] = []
    for s in sentences:
        for found in _REPORT_DAY.finditer(s):
            said = _named(found.group(0))
            week = found.group("week")
            if week is not None and int(week) != sheet.week:
                what: str | None = "a report for a week this read is not for"
            elif not said <= allowed:
                what = "a report the facts do not name"
            elif not said <= day_words or out_for_him or said <= _named(named):
                what = None
            elif issued:
                what = "a report that came out after his status was read"
            elif not _still_to_come(s, found):
                what = "a report not out at the write, as if it were"
            else:
                what = None
            if what is not None:
                out.append(
                    _sentence_violation(f"names {found.group(0)}, {what}", s, f'Name it as the facts do: "{named}".')
                )
    return out


def _superlative_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """A points superlative the opponent's rank does not bear out (Lane 139, C01): Opp rank is points
    allowed, 1st the fewest, so "the most" is the last rank alone (`rank_words`)."""
    a = sheet.allowed
    out = []
    # Only a sentence about what an opponent allows reads as its rank (review LOW-1): "the most points of any
    # Rams receiver" is his own figure, the cells' rule's to judge.
    for s in (s for s in sentences if _ALLOWS.search(s)):
        for raw, said in superlatives_in(s):
            if a is not None and not sheet.bye and fits(said, a.rank, a.of):
                continue
            words = None if a is None or sheet.bye else rank_words(a.rank, a.of)
            rank = "the facts give no opponent's rank" if a is None or sheet.bye else f"{a.rank} of {a.of} is"
            remedy = (
                f'Opp rank counts 1st as the fewest points allowed: {rank} "{words}".'
                if words is not None
                else f"Opp rank counts 1st as the fewest points allowed: {rank} said by its rank, never most or fewest."
            )
            out.append(_sentence_violation(f'says "{raw}"', s, remedy))
    return out


def _season_violation(text: str, season: int) -> list[str]:
    count = len(re.findall(rf"\b{season}\b", text))
    if count <= 1:
        return []
    return [
        f"The read names the season {count} times. Name it once, with the first week you name "
        f'("week 6 of {season}"), and say the weeks after it as "week 5" or "week 7".'
    ]


def _call_violation(call: str | None) -> list[str]:
    if call in CALLS:
        return []
    return [f'The answer gave no call. Give "call" as one word of {", ".join(CALLS)}: what the read tells a manager.']


# THE DASHES AND SEMICOLON (Lane 307, the founder 2026-10-30: "no semicolons or em dashes"): none of the three
# in a week read. The writer's own copy rules refuse the em dash and the semicolon (`capsules.validate`); the week
# read refuses the en dash too, and the cadence holds a stored read to all three (`body_rule_violations`).
_PUNCTUATION: Final = (("a semicolon", ";"), ("an em dash", "\u2014"), ("an en dash", "\u2013"))


def _punctuation_violations(sentences: Sequence[str]) -> list[str]:
    out = []
    for name, mark in _PUNCTUATION:
        sentence = next((s for s in sentences if mark in s), None)
        if sentence is not None:
            out.append(
                _sentence_violation(
                    f"carries {name}", sentence, "Write it without one: a full stop or a comma, never a dash."
                )
            )
    return out


def week_rule_violations(text: str, sheet: WeekSheet, call: str | None = "none") -> list[str]:
    """Every week rule `text` breaks for `sheet`, given the writer's `call` for it; empty is clean. Lane 307
    retired the rules that refused a true sentence for its wording (the sentence count, the opener, a figure's
    unit, the cap on figures, a rank said twice, the member addressed, a figure spelled out, the ordinary
    matchup's rank, the tip words): every rule left binds a figure, a place, a depth place, a week, a forecast,
    a status or the call to its fact, or keeps a word off the page."""
    sentences = split_sentences(text.strip())
    names = sheet_names(sheet)
    return [
        *_paragraph_violation(text),
        *_punctuation_violations(sentences),
        *_call_violation(call),
        *_word_violations(sentences, names),
        *_projection_violations(sentences, sheet),
        *_cannot_start_violations(sentences, sheet, call),
        *_returning_violations(sentences, sheet),
        *_cell_violations(sentences, sheet),
        *_misnamed_violations(sentences, sheet),
        *_order_violations(sentences, sheet),
        *_report_day_violations(sentences, sheet),
        *_season_violation(text, sheet.season),
        *_wait_violation(text, sheet, call),
        *_code_violations(sentences, names),
        *_superlative_violations(sentences, sheet),
        *place_violations(sentences, sheet),
        *week_figure_violations(sentences, sheet),
        *weather_violations(sentences, sheet),
        *angle_figure_violations(sentences, sheet, _stated),
        *angle_place_violations(sentences, sheet),
        *unusual_violations(sentences, sheet),
    ]


def body_rule_violations(text: str, season: int, names: Sequence[str] = ()) -> list[str]:
    """The week rules `text` breaks that judge the body alone, never a sheet (the Lane 286 re-review): its
    paragraph, the semicolon and the dashes, the never words, the projection or card named, the season named
    once, a club's code. The cadence's check on a stored read (`cadence.RULE_STALE`): a rule that reads today's
    sheet (the cells, the status, the report day) would refuse a read that was right when it was written. `names`
    are his and his teammates', masked before the word and code rules as the validator masks them."""
    sentences = split_sentences(text.strip())
    named = [] if not names_the_projection(text) else ["The read names the published projection or the card."]
    return [
        *_paragraph_violation(text),
        *_punctuation_violations(sentences),
        *_word_violations(sentences, names),
        *named,
        *_season_violation(text, season),
        *_code_violations(sentences, names),
    ]


def shown_week_words() -> tuple[str, ...]:
    """The week's own refused words, as the prompt lists them."""
    return tuple(dict.fromkeys(word for rule in WEEK_NEVER_WORDS for word in rule.shown))
