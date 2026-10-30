"""THE WEEK READ'S OWN RULES, on top of the writer's (`capsules.validate`).

This week's rulings and the Lane 72 review's, each a rule the validator reads:
- No betting word in any sense: the writer's list and this read's stricter four ("line" outside football's
  own senses, "lines up" included; "favoured"; "underdog"; "spread" outside spreading the ball). No
  provider's name, no rival product, no tip.
- The week's number is the published projection, never ours (`sheet.PROJECTION_BASIS`), and the read never
  states it (H4, inverted by Lane 275, the founder 2026-10-28): no sentence names the published projection,
  and none states its figure, the one before it or its change, with or without a unit. The card's Wk cell
  prints it, and a read that quoted it went stale the moment it moved. Nothing calls a weekly number ours.
- A player the sheet says may not be started (on his bye, out, on a season-long list, Doubtful) is never
  recommended to start: the writer's own call for its read must not be "start" (`CALLS`), and a sentence
  that tells a manager to start him, in his name or a pronoun, outside a negation of its own clause,
  refuses the read too (H2). A player who cannot play is said not to play. One designated to return this week
  (Lane 153) is this week's question and may play: no sentence keeps him on his list or out.
- Every figure carries its unit or basis (points, PPR points, a game, degrees, mph, a percent, a count's
  noun, a rank's "of 32"); week numbers, the season and clock times are exempt (M1).
- A rank in our order says which order it is: "in our preseason order" or "in our rest-of-season order" (M2).
- The season is named at most once; weeks after it are "week 5" (the coordinator's ruling on L5).
- An injury report named by its day is the one the sheet names, the game status report the clubs had issued
  by the write (`week.report_day`); never a day no report came out (Lane 96, B16).
- Every figure is one the page draws as a cell, as the cell prints it (`cells`), and a read states at most
  `MAX_FIGURES` of them: the cells carry his numbers, the read says what they cannot (Lane 100, B17, B44).
- One paragraph, three to five sentences.
- A rank is stated once (B282, Lane 286): never the same rank in two forms ("the 11th-fewest ..., 11th of 32").
- The read never addresses the member's sheet, lineup or roster ("on your sheet", "in your lineup", "your
  roster"): it is about the player's week, and the call carries the advice (B282).
- The first sentence opens on no set-up clause ended by a colon (C25, made strict by B282: "Bye week for
  Kittle:" sets a scene even when its words name the bye).
- Every figure is digits, never spelled out ("Fourteen PPR points" is "14 PPR points", B282).
- His place on the depth chart is the sheet's, and a game's figure tied to a week is that week's game
  (Lane 299, `fact_rules`).

Each violation names its sentence in the writer's form (`the sentence "..."`), so a correction hands it
back word for word (`rule_notes`).
"""

import re
from collections.abc import Sequence
from typing import Final

from research.capsules.facts.team_names import NFL_TEAM_NAMES
from research.capsules.page_figures import page_tenth
from research.capsules.sentences import split_sentences
from research.capsules.voice_rules import named_rule
from research.capsules.week.angle_rules import figure_violations as angle_figure_violations
from research.capsules.week.angle_rules import ordinary_rank_violations
from research.capsules.week.angle_rules import place_violations as angle_place_violations
from research.capsules.week.cells import cell_figures, misnamed, misranked, quotable_figures
from research.capsules.week.fact_rules import place_violations, weather_violations, week_figure_violations
from research.capsules.week.rank_words import fits, rank_words, superlatives_in
from research.capsules.week.report_day import report_words
from research.capsules.week.sheet import STATUS_WORDS, WeekSheet
from research.capsules.week.start_advice import start_advice_in

MIN_SENTENCES: Final = 3
MAX_SENTENCES: Final = 5
# The figures a read states at most (Lane 100, B44): the cells above it carry his numbers.
MAX_FIGURES: Final = 3
# A read built on its angles (Lane 300) may state one figure more: an angle's share and the one it is set
# against are two figures, and the angles are in no cell, so the cap on retelling the cells is not what they spend.
ANGLE_FIGURES: Final = 1
# The writer's own call for its read, one word (H2): what it tells a manager who has him to do this week.
START: Final = "start"
CALLS: Final = (START, "sit", "hold", "none")
# The words a week read never carries beyond the writer's lists: each a named rule, shown to the writer.
WEEK_NEVER_WORDS: Final = (
    named_rule(
        "a betting word (a line)",
        r"(?<!offensive )(?<!defensive )(?<!goal )(?<!stat )(?<!o-)(?<!d-)(?<!front )\blines?\b"
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
    named_rule(
        "a tip",
        r"\b(?:pro )?tips?\b|\bremember to\b|\bdon'?t forget\b|\bmake sure (?:you|to)\b",
        shown=("tip", "pro tip", "remember to", "don't forget", "make sure to"),
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
_UNIT_AFTER: Final = re.compile(
    r"^(?:-(?:point|yard|game|catch|target)s?\b|(?:\s+(?:ppr|half-ppr))?\s+(?:fantasy\s+)?"
    r"(?:points?|pts|a game|per game|degrees|mph|percent|touchdowns?|tds?|games?|targets?|carries|receptions?|"
    r"catches|yards?|snaps?|overall|weeks?|starts?|of \d+)\b)",
    re.IGNORECASE,
)
_WEEK_BEFORE: Final = re.compile(r"\bweeks?\s+(?:\d{1,2}\s*(?:,|and|or|to|through|-)\s*)*$", re.IGNORECASE)
_CLOCK_AFTER: Final = re.compile(r"^(?::\d\d)?\s*(?:am|pm)\b", re.IGNORECASE)
_ORDINAL_OF_BEFORE: Final = re.compile(r"\d(?:st|nd|rd|th)\s+of\s+$", re.IGNORECASE)


# What a read's first sentence carries (Lane 139, C25): a figure (`stated_figures`) or a rank ("31st of 32"),
# the call in its own verb ("start him", "sit him", "keep him", "find a fill-in"), his status on the list, or
# that he does not play.
_RANK_WORD: Final = re.compile(r"\b\d+(?:st|nd|rd|th)\b", re.IGNORECASE)
# A call is a verb of the call list said of him ("start him", "sit Gibbs", "keep him on the bench"), never
# "sits first among" or "play Arizona" (review LOW-11).
_CALL_WORDS: Final = re.compile(
    r"\b(?:[Ss]tart|[Ss]it|[Bb]ench|[Kk]eep|[Hh]old|[Dd]rop|[Aa]dd|[Ff]lex|[Tt]rust)(?:s|ed|ing)? (?:him|them|[A-Z]\w+)\b|"
    r"\bfill-in\b|\b[Pp]ick(?:s|ing)? (?:him )?up\b|"
    # The call in the forms the writer uses for it (Lane 300 fix round 4): "Higgins starts this week", "he sits
    # this week", "can't be started", "fire him up".
    r"\b(?:starts|sits)\s+this\s+week\b|\b(?:can(?:'t|not)|shouldn't|should not|won't)\s+be\s+(?:started|benched)\b|"
    r"\b[Ff]ire\s+(?:him|them|[A-Z]\w+)\s+up\b"
)
# His status as the sheet says it (`sheet.STATUS_WORDS`, the one source) and the words for a player with none.
_STATUS_WORDS: Final = re.compile(
    r"\b(?:"
    + "|".join(re.escape(word.removeprefix("on ")) for word in STATUS_WORDS.values())
    + r"|IR|PUP|designation|designated|healthy|cleared|active|practiced|practice)\b",
    re.IGNORECASE,
)
# A colon that sets up what follows, never one inside a clock time ("6:00 pm").
_SET_UP: Final = re.compile(r"(?<!\d):|:(?!\d)")
# The end of a sentence's first clause: a set-up colon after it is in a later clause.
_CLAUSE_END: Final = re.compile(r"[,;]")
_ALLOWS: Final = re.compile(r"\b(?:allow\w*|gives? up|giving up|gave up|surrender\w*)\b", re.IGNORECASE)


def _sentence_violation(what: str, sentence: str, remedy: str) -> str:
    return f'The text {what} in the sentence "{sentence}". {remedy}'


def _word_violations(sentences: Sequence[str]) -> list[str]:
    out = []
    for rule in WEEK_NEVER_WORDS:
        sentence = next((s for s in sentences if rule.pattern.search(s)), None)
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


def _unit_violations(sentences: Sequence[str], season: int) -> list[str]:
    out = []
    for sentence in sentences:
        bare = [
            raw
            for raw, _, start, end in figures_of(sentence, season)
            if not raw.endswith("%")
            and not _UNIT_AFTER.match(sentence[end:])
            and not _ORDINAL_OF_BEFORE.search(sentence[:start])
        ]
        if bare:
            quoted = ", ".join(f'"{raw}"' for raw in bare)
            out.append(
                _sentence_violation(
                    f"states {quoted} without its unit",
                    sentence,
                    'Every figure carries its unit or basis right after it: "32 points", "25.9 PPR points a game", '
                    '"28th of 32", "61 degrees".',
                )
            )
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
    """A figure the page draws in no cell, and more figures than the read may state (Lane 100)."""
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
                    "Quote only a figure the page prints as a cell (the opponent's rank, his points a game, a "
                    "game's points, his rest-of-season points, the expected score, the kickoff weather), named as "
                    "the cell names it, or say it in words.",
                )
            )
    count = sum(len(stated_figures(s, sheet.season)) for s in sentences)
    cap = max_figures(sheet)
    if count > cap:
        out.append(
            f"The read states {count} figures. The cells above it carry his numbers: state at most {cap}, "
            "and say in words what the cells cannot, why his figure is what it is and what to do this week."
        )
    return out


def max_figures(sheet: WeekSheet) -> int:
    """The figures a read may state: `MAX_FIGURES`, and `ANGLE_FIGURES` more on a sheet with angles (Lane 300)."""
    return MAX_FIGURES + (ANGLE_FIGURES if sheet.angles else 0)


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


def _code_violations(sentences: Sequence[str]) -> list[str]:
    out = []
    for s in sentences:
        found = _CLUB_CODE.search(s)
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
# practice report", "Sunday's injury list".
_REPORT_DAY: Final = re.compile(
    r"\b(?:the\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:(?:'|\u2019)s)?\s+"
    r"(?:injury\s+|practice\s+|game status\s+)?(?:report|list)\b",
    re.IGNORECASE,
)


# The words between a day and its report that name no other report (review R1-L2): "Friday's injury
# report" is the sheet's "Friday's report".
_KIND: Final = re.compile(r"\s(?:injury|practice|game status)\s")


def _named(text: str) -> set[str]:
    """Each report or list named by its day, as one phrase: lower case, no leading "the", no kind word."""
    return {
        _KIND.sub(" ", m.group(0).lower().replace("\u2019", "'").removeprefix("the "))
        for m in _REPORT_DAY.finditer(text)
    }


def _report_day_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """A report or a list named by its day is one the sheet's own words name (Lane 96, B16 and review
    L1): never a day no report was issued on by the write."""
    named = report_words(sheet.status, sheet.written_at, sheet.game)
    allowed = _named(named)
    out: list[str] = []
    for s in sentences:
        for found in _REPORT_DAY.finditer(s):
            if _named(found.group(0)) <= allowed:
                continue
            out.append(
                _sentence_violation(
                    f"names {found.group(0)}, a report the facts do not name", s, f'Name it as the facts do: "{named}".'
                )
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


def _carries_the_point(text: str, season: int) -> bool:
    """Whether a stretch of a read states a figure, a rank, the call, his status or that he does not play."""
    return bool(
        stated_figures(text, season)
        or _RANK_WORD.search(text)
        or _CALL_WORDS.search(text)
        or _STATUS_WORDS.search(text)
        or _DOES_NOT_PLAY.search(text)
    )


def _set_up_head(first: str, season: int) -> str | None:
    """The clause a read's first sentence sets up on, ended by a colon ("Bye week for Kittle"), else None. A
    first clause a colon ends is refused whatever it names (B282); a colon after the first clause is held to
    main's test (C25, the Lane 286 review's H2): refused unless the text before it carries the point. "For the
    Rams, the story is simple: ..." sets a scene; "The Lions are off in week 6 of 2026, and the reason is
    simple: ..." does not."""
    colon = _SET_UP.search(first)
    if colon is None:
        return None
    head = first[: colon.start()]
    if _CLAUSE_END.search(head) and _carries_the_point(head, season):
        return None
    return head.strip()


def _opener_violation(sentences: Sequence[str], season: int) -> list[str]:
    """The read leads with the verb or the fact (Lane 139, C25): its first sentence carries the call, a
    figure or his status, and it opens on no clause a colon ends that sets up the rest (`_set_up_head`)."""
    if not sentences:
        return []
    first = sentences[0]
    head = _set_up_head(first, season)
    if head is not None:
        return [
            _sentence_violation(
                f'opens on a set-up clause ended by a colon ("{head}")',
                first,
                "Lead with the call or the fact that decides his week, and drop the clause before the colon.",
            )
        ]
    if not _carries_the_point(first, season):
        return [
            _sentence_violation(
                "opens without the call, a figure or his status",
                first,
                "Open on the call or the fact that decides his week, with its figure or his status, never a scene "
                "set first.",
            )
        ]
    return []


# A rank in any of its forms (B282): "11th of 32", "11th-fewest", "the 11th most", "ranked 11th".
_RANK: Final = re.compile(r"\b(\d+)(?:st|nd|rd|th)\b", re.IGNORECASE)
# What follows the opponent's rank (Opp rank): "of 32" or "against receivers".
_OPPONENT_RANK_AFTER: Final = re.compile(r"^(?:\s+of\s+\d+|\s+against\b)", re.IGNORECASE)
# An end a rank counts from ("the 11th-fewest", "the 26th most").
_END_AFTER: Final = re.compile(r"^[\s-]+(most|fewest|least)\b", re.IGNORECASE)
_NEXT_WORD: Final = re.compile(r"^[\s-]*(\w+)")
# The clubs a rank against a position counts (`Allowed.of`): "the 26th-most" is 7th of 32 from the fewest.
_CLUBS: Final = 32


def _rank_key(sentence: str, match: re.Match[str]) -> tuple[str, int]:
    """The fact a rank states, so one rank in two forms is one key and two facts with one number are two (the
    Lane 286 review's M1): the opponent's rank counted from the fewest end however it is said, or another
    rank by the word it ranks ("26th in our order", "3rd-most targets")."""
    rank, after = int(match.group(1)), sentence[match.end() :]
    if _OPPONENT_RANK_AFTER.match(after):
        return ("opponent", rank)
    end = _END_AFTER.match(after)
    if end is not None and _ALLOWS.search(sentence):
        return ("opponent", _CLUBS + 1 - rank if end.group(1).lower() == "most" else rank)
    word = _NEXT_WORD.match(after)
    return (f"other {'' if word is None else word.group(1).lower()}", rank)


def _twice_ranked_violations(sentences: Sequence[str]) -> list[str]:
    """The same rank stated twice in one read (B282): "the 11th-fewest PPR points a game to receivers, 11th
    of 32" says one rank in two forms."""
    seen: set[tuple[str, int]] = set()
    out = []
    for s in sentences:
        for match in _RANK.finditer(s):
            key = _rank_key(s, match)
            if key not in seen:
                seen.add(key)
                continue
            out.append(
                _sentence_violation(
                    f'states the rank "{match.group(0)}" twice',
                    s,
                    f'Say a rank once, in one form ("{match.group(0)} of 32" or its words), never in two.',
                )
            )
            break
    return out


# The member's own sheet, lineup or roster addressed (B282): "on your sheet", "in your lineup", "your roster",
# and the slots and league they are in ("your flex", "your RB2", "your league").
_ADDRESSES_THE_MEMBER: Final = re.compile(
    r"\byour (?:fantasy )?(?:sheet|lineup|starting lineup|roster|bench|flex|league|(?:qb|rb|wr|te)\d?)s?\b",
    re.IGNORECASE,
)


def _addressed_violations(sentences: Sequence[str]) -> list[str]:
    """The read is about the player's week, and the call carries the advice: it never addresses the member's
    sheet, lineup or roster (B282)."""
    out = []
    for s in sentences:
        found = _ADDRESSES_THE_MEMBER.search(s)
        if found is not None:
            out.append(
                _sentence_violation(
                    f'addresses the member\'s sheet ("{found.group(0)}")',
                    s,
                    "The read is about his week, and the call carries the advice: say what his week holds, never "
                    "your sheet, your lineup or your roster.",
                )
            )
    return out


# A figure spelled out (B282): a number word with a figure's unit after it, whose value a cell prints
# ("Fourteen PPR points" where his Avg is 14). A count no cell prints ("his last three games") stays words,
# as the cell rule asks of its digits (the Lane 286 review's H1), so one of the two forms always stands. Zero
# is never a figure ("he scores zero points" on a bye).
_ONES: Final = ("one", "two", "three", "four", "five", "six", "seven", "eight", "nine")
_TEENS: Final = ("ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen")
_TENS: Final = ("twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")
_WORD_VALUES: Final = {
    **{word: n for n, word in enumerate(_ONES, 1)},
    **{word: n for n, word in enumerate((*_TEENS, "nineteen"), 10)},
    **{word: 10 * n for n, word in enumerate(_TENS, 2)},
}
_SPELLED_FIGURE: Final = re.compile(
    rf"\b((?:{'|'.join(_TENS)})(?:-(?:{'|'.join(_ONES)}))?|{'|'.join((*_TEENS, 'nineteen', *_ONES))})[\s-]+"
    r"(?:(?:half-)?ppr\s+)?(?:fantasy\s+)?"
    r"(?:points?|pts|a game|per game|games?|degrees|mph|percent|touchdowns?|tds?|targets?|carries|"
    r"receptions?|catches|yards?|snaps?)\b",
    re.IGNORECASE,
)


def spelled_value(word: str) -> int:
    """A number word's value: "fourteen" 14, "twenty-five" 25."""
    return sum(_WORD_VALUES[part] for part in word.lower().split("-"))


def _spelled_figure_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    """Every figure a cell prints is digits, as the cell prints it (B282): never "Fourteen PPR points" for his
    Avg's 14."""
    cells = cell_figures(sheet)
    out = []
    for s in sentences:
        found = next((m for m in _SPELLED_FIGURE.finditer(s) if float(spelled_value(m.group(1))) in cells), None)
        if found is not None:
            out.append(
                _sentence_violation(
                    f'spells out a figure ("{found.group(0)}")',
                    s,
                    'Write every figure a cell prints in digits, as the cell prints it: "14 PPR points", "5 games".',
                )
            )
    return out


def _season_violation(text: str, season: int) -> list[str]:
    count = len(re.findall(rf"\b{season}\b", text))
    if count <= 1:
        return []
    return [
        f"The read names the season {count} times. Name it once, with the first week you name "
        f'("week 6 of {season}"), and say the weeks after it as "week 5" or "week 7".'
    ]


def _count_violation(sentences: Sequence[str]) -> list[str]:
    if MIN_SENTENCES <= len(sentences) <= MAX_SENTENCES:
        return []
    return [f"The read has {len(sentences)} sentences. Write {MIN_SENTENCES} to {MAX_SENTENCES} sentences."]


def _call_violation(call: str | None) -> list[str]:
    if call in CALLS:
        return []
    return [f'The answer gave no call. Give "call" as one word of {", ".join(CALLS)}: what the read tells a manager.']


def week_rule_violations(text: str, sheet: WeekSheet, call: str | None = "none") -> list[str]:
    """Every week rule `text` breaks for `sheet`, given the writer's `call` for it; empty is clean."""
    sentences = split_sentences(text.strip())
    return [
        *_paragraph_violation(text),
        *_count_violation(sentences),
        *_call_violation(call),
        *_word_violations(sentences),
        *_projection_violations(sentences, sheet),
        *_cannot_start_violations(sentences, sheet, call),
        *_returning_violations(sentences, sheet),
        *_unit_violations(sentences, sheet.season),
        *_cell_violations(sentences, sheet),
        *_misnamed_violations(sentences, sheet),
        *_order_violations(sentences, sheet),
        *_report_day_violations(sentences, sheet),
        *_season_violation(text, sheet.season),
        *_wait_violation(text, sheet, call),
        *_code_violations(sentences),
        *_superlative_violations(sentences, sheet),
        *_opener_violation(sentences, sheet.season),
        *_twice_ranked_violations(sentences),
        *_addressed_violations(sentences),
        *_spelled_figure_violations(sentences, sheet),
        *place_violations(sentences, sheet),
        *week_figure_violations(sentences, sheet),
        *weather_violations(sentences, sheet),
        *angle_figure_violations(sentences, sheet, _stated),
        *angle_place_violations(sentences, sheet),
        *ordinary_rank_violations(sentences, sheet),
    ]


def body_rule_violations(text: str, season: int) -> list[str]:
    """The week rules `text` breaks that judge the body alone, never a sheet (the Lane 286 re-review): its
    paragraph and sentence count, the never words, the projection or card named, every figure's unit, the season
    named once, a club's code, the opener, a rank stated twice, the member addressed. The cadence's check on a
    stored read (`cadence.RULE_STALE`): a rule that reads today's sheet (the cells, the status, the report day,
    a spelled number's cell) would refuse a read that was right when it was written."""
    sentences = split_sentences(text.strip())
    named = [] if not names_the_projection(text) else ["The read names the published projection or the card."]
    return [
        *_paragraph_violation(text),
        *_count_violation(sentences),
        *_word_violations(sentences),
        *named,
        *_unit_violations(sentences, season),
        *_season_violation(text, season),
        *_code_violations(sentences),
        *_opener_violation(sentences, season),
        *_twice_ranked_violations(sentences),
        *_addressed_violations(sentences),
    ]


def shown_week_words() -> tuple[str, ...]:
    """The week's own refused words, as the prompt lists them."""
    return tuple(dict.fromkeys(word for rule in WEEK_NEVER_WORDS for word in rule.shown))
