"""THE WEEK READ'S OWN RULES, on top of the writer's (`capsules.validate`).

This week's rulings and the Lane 72 review's, each a rule the validator reads:
- No betting word in any sense: the writer's list and this read's stricter four ("line" outside football's
  own senses, "lines up" included; "favoured"; "underdog"; "spread" outside spreading the ball). No
  provider's name, no rival product, no tip.
- The week's number is the published projection, never ours (`sheet.PROJECTION_BASIS`). A sentence naming
  the published projection carries its figure exactly as the sheet prints it, and no other figure is put
  on it; a read with a projection names it; nothing calls a weekly number ours (H4).
- A player the sheet says may not be started (on his bye, out, on a season-long list, Doubtful) is never
  recommended to start: the writer's own call for its read must not be "start" (`CALLS`), and a sentence
  that tells a manager to start him, in his name or a pronoun, outside a negation of its own clause,
  refuses the read too (H2). A player who cannot play is said not to play.
- Every figure carries its unit or basis (points, PPR points, a game, degrees, mph, a percent, a count's
  noun, a rank's "of 32"); week numbers, the season and clock times are exempt (M1).
- A rank in our order says which order it is: "in our preseason order" or "in our rest-of-season order" (M2).
- The season is named at most once; weeks after it are "week 5" (the coordinator's ruling on L5).
- Three to five sentences.

Each violation names its sentence in the writer's form (`the sentence "..."`), so a correction hands it
back word for word (`rule_notes`).
"""

import re
from collections.abc import Sequence
from typing import Final

from research.capsules.sentences import split_sentences
from research.capsules.voice_rules import named_rule
from research.capsules.week.sheet import WeekSheet, points_text

MIN_SENTENCES: Final = 3
MAX_SENTENCES: Final = 5
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
_PUBLISHED: Final = re.compile(r"\bpublished\b", re.IGNORECASE)
_NAMES_PROJECTION: Final = re.compile(r"\bpublished (?:weekly )?projection\b", re.IGNORECASE)
_DOES_NOT_PLAY: Final = re.compile(
    r"\bbye\b|\b(?:does not|doesn't|will not|won't|cannot|can't) play\b|\bno game\b|\bruled out\b|"
    r"\binjured reserve\b|\bsits? out\b|\bis out\b",
    re.IGNORECASE,
)
_CLAUSE_BREAK: Final = re.compile(r"[,;:.!?]|\b(?:but|so|and then|then)\b", re.IGNORECASE)
_NEGATION: Final = re.compile(r"\b(?:not|never|no|don't|do not|can't|cannot|won't|shouldn't)\b|n't\b", re.IGNORECASE)
_VACANCY: Final = re.compile(r"\b(?:zero|nothing|hole|empty|out of)\b", re.IGNORECASE)
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


def _published_figures(sheet: WeekSheet) -> set[float]:
    """The figures the sheet puts on the published projection: it, the one before it, and the changes."""
    p = sheet.projection
    if p is None:
        return set()
    last = sheet.last_read
    values = [p.points, p.previous_points, sheet.projection_change, sheet.change_since_last_read]
    values.append(None if last is None else last.projection_points)
    return {round(abs(v), 1) for v in values if v is not None}


def _projection_violations(sentences: Sequence[str], sheet: WeekSheet) -> list[str]:
    out = [
        _sentence_violation(
            "calls a weekly number ours",
            s,
            "The week's number is the published projection, never ours: call it the published projection.",
        )
        for s in sentences
        if _OURS.search(s)
    ]
    projection = sheet.projection
    if projection is None or sheet.bye:
        return out + [
            _sentence_violation(
                "names a published projection the facts do not hold", s, "There is none for this week: leave it out."
            )
            for s in sentences
            if _NAMES_PROJECTION.search(s)
        ]
    figure, value = points_text(projection.points), round(projection.points, 1)
    allowed = _published_figures(sheet)
    for s in sentences:
        stated = {round(v, 1) for _, v, _, _ in figures_of(s, sheet.season)}
        if _NAMES_PROJECTION.search(s) and value not in stated:
            out.append(
                _sentence_violation(
                    "names the published projection without its figure",
                    s,
                    f'Give its figure exactly: "the published projection has him at {figure} points".',
                )
            )
        if _PUBLISHED.search(s) and stated - allowed:
            other = ", ".join(sorted(points_text(v) for v in stated - allowed))
            out.append(
                _sentence_violation(
                    f"puts {other} on the published projection",
                    s,
                    f"The published projection is {figure} points. Say other figures in a sentence of their own.",
                )
            )
        if value in stated and not _PUBLISHED.search(s):
            out.append(
                _sentence_violation(
                    f"quotes the {figure} points without saying it is published",
                    s,
                    f'Say it is the published projection in that sentence: "the published projection has him at {figure} points".',
                )
            )
    if not any(_NAMES_PROJECTION.search(s) for s in sentences):
        out.append(
            "The read never names the published projection for the week. Name it as the published projection, "
            f"with its {figure} points, in a sentence of your own."
        )
    return out


def _name_forms(name: str) -> list[str]:
    words = [w for w in name.split() if w.rstrip(".") not in {"Jr", "Sr", "II", "III", "IV"}]
    return list(dict.fromkeys([name, " ".join(words), words[0], words[-1]])) if words else [name]


def _start_advice(name: str) -> re.Pattern[str]:
    him = "|".join(["him", "them", *(re.escape(form) for form in _name_forms(name))])
    return re.compile(
        rf"\b(?:start|play|use|deploy|trust|roll with|fire up|plug in|slot in|lock in)\s+(?:{him})\b|"
        rf"\b(?:put|keep|leave|slot|plug|lock|get|have)\s+(?:{him})\s+(?:in|into)\s+(?:your\s+)?(?:starting\s+)?lineups?\b|"
        r"\bmust[- ]start\b|\bworth a start\b|\bin your (?:starting )?lineup this week\b",
        re.IGNORECASE,
    )


def _recommends(sentence: str, advice: re.Pattern[str]) -> str | None:
    for match in advice.finditer(sentence):
        before = sentence[: match.start()]
        breaks = list(_CLAUSE_BREAK.finditer(before))
        clause = before[breaks[-1].end() :] if breaks else before
        if _NEGATION.search(clause):
            continue
        if match.group(0).lower().startswith("in your") and _VACANCY.search(sentence):
            continue
        return match.group(0)
    return None


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
    advice = _start_advice(sheet.name)
    for s in sentences:
        found = _recommends(s, advice)
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
        *_count_violation(sentences),
        *_call_violation(call),
        *_word_violations(sentences),
        *_projection_violations(sentences, sheet),
        *_cannot_start_violations(sentences, sheet, call),
        *_unit_violations(sentences, sheet.season),
        *_order_violations(sentences, sheet),
        *_season_violation(text, sheet.season),
    ]


def shown_week_words() -> tuple[str, ...]:
    """The week's own refused words, as the prompt lists them."""
    return tuple(dict.fromkeys(word for rule in WEEK_NEVER_WORDS for word in rule.shown))
