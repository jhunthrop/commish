"""THE WEEK READ'S OWN RULES, on top of the writer's (`capsules.validate`).

This week's rulings, each a rule the validator reads:
- No betting word in any sense: the writer's list (`voice_rules.BETTING_PATTERNS`: odds, the books, a bet,
  the spread, Vegas) and this read's stricter four, since a week read sits beside a game: "line" outside
  football's own senses (the offensive line, the goal line, a stat line), "favoured", "underdog" and
  "spread" outside spreading the ball. No provider's name and no rival product; no tip.
- The week's number is the published projection, never ours (`sheet.PROJECTION_BASIS`): the read names
  the published projection when the sheet has one, every sentence that quotes its figure says
  "published", and nothing calls a weekly number ours.
- A player who cannot play this week (a bye, out, on a season-long list) is never recommended to start,
  and the read says he does not play.
- Three to five sentences.

Each violation names its sentence in the writer's form (`the sentence "..."`), so a correction hands it
back word for word (`rule_notes`).
"""

import re
from typing import Final

from research.capsules.sentences import split_sentences
from research.capsules.voice_rules import named_rule
from research.capsules.week.sheet import WeekSheet
from research.model.jsmath import js_to_fixed
from research.pipeline.jscompat import js_number, js_string

MIN_SENTENCES: Final = 3
MAX_SENTENCES: Final = 5
# The words a week read never carries beyond the writer's lists: each a named rule, shown to the writer.
WEEK_NEVER_WORDS: Final = (
    named_rule(
        "a betting word (a line)",
        r"(?<!offensive )(?<!defensive )(?<!goal )(?<!stat )(?<!o-)(?<!d-)(?<!front )\blines?\b(?! of scrimmage)",
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
# A recommendation to play him: a start verb on him, or putting him in a lineup. "A zero in your lineup"
# is what a bye does to a roster, not advice (the recording's first draft for Jahmyr Gibbs).
_RECOMMEND: Final = re.compile(
    r"\b(?:start|play|use|deploy|trust|roll with|fire up) (?:him|them)\b|"
    r"\b(?:put|keep|leave|slot|plug|lock|get) (?:him|them) (?:in|into) (?:your )?(?:starting )?lineups?\b",
    re.IGNORECASE,
)
_NEGATION_BEFORE: Final = re.compile(r"(?:\b(?:not|never|no)\b|n't)\W+(?:\w+\W+){0,2}$", re.IGNORECASE)
_DOES_NOT_PLAY: Final = re.compile(
    r"\bbye\b|\b(?:does not|doesn't|will not|won't|cannot|can't) play\b|\bno game\b|\bruled out\b|"
    r"\binjured reserve\b|\bsits? out\b|\bis out\b",
    re.IGNORECASE,
)


def _figure(points: float) -> str:
    return js_string(js_number(js_to_fixed(points, 1)))


def _sentence_violation(what: str, sentence: str, remedy: str) -> str:
    return f'The text {what} in the sentence "{sentence}". {remedy}'


def _word_violations(sentences: list[str]) -> list[str]:
    out = []
    for rule in WEEK_NEVER_WORDS:
        sentence = next((s for s in sentences if rule.pattern.search(s)), None)
        if sentence is not None:
            out.append(_sentence_violation(f"carries {rule.name}", sentence, "Rewrite that sentence without it."))
    return out


def _projection_violations(sentences: list[str], sheet: WeekSheet) -> list[str]:
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
        return out
    figure = re.compile(rf"(?<![\d.]){re.escape(_figure(projection.points))}(?![\d])")
    out += [
        _sentence_violation(
            f"quotes the {_figure(projection.points)} points without saying it is published",
            s,
            'Say it is the published projection in that sentence, as in "the published projection has him at '
            f'{_figure(projection.points)} points".',
        )
        for s in sentences
        if figure.search(s) and not _PUBLISHED.search(s)
    ]
    if not any(_PUBLISHED.search(s) for s in sentences):
        out.append(
            "The read never names the published projection for the week. Name it as the published projection, "
            f"with its {_figure(projection.points)} points, in a sentence of your own."
        )
    return out


def _recommends(sentence: str) -> str | None:
    for match in _RECOMMEND.finditer(sentence):
        if _NEGATION_BEFORE.search(sentence[: match.start()]) is None:
            return match.group(0)
    return None


def _cannot_play_violations(sentences: list[str], sheet: WeekSheet) -> list[str]:
    if sheet.can_play:
        return []
    why = "is on his bye" if sheet.bye else "cannot play on his status"
    out = []
    for s in sentences:
        found = _recommends(s)
        if found is not None:
            out.append(
                _sentence_violation(
                    f'recommends a player who cannot play this week ("{found}")',
                    s,
                    f"He {why} in week {sheet.week} of {sheet.season}: say what that means for a roster, and never "
                    "recommend him for this week.",
                )
            )
    if not any(_DOES_NOT_PLAY.search(s) for s in sentences):
        out.append(
            f"The read never says he does not play in week {sheet.week} of {sheet.season}. He {why}: say so, "
            "and what it means for a roster that has him."
        )
    return out


def _count_violation(sentences: list[str]) -> list[str]:
    if MIN_SENTENCES <= len(sentences) <= MAX_SENTENCES:
        return []
    return [f"The read has {len(sentences)} sentences. Write {MIN_SENTENCES} to {MAX_SENTENCES} sentences."]


def week_rule_violations(text: str, sheet: WeekSheet) -> list[str]:
    """Every week rule `text` breaks for `sheet`; empty is clean."""
    sentences = split_sentences(text.strip())
    return [
        *_count_violation(sentences),
        *_word_violations(sentences),
        *_projection_violations(sentences, sheet),
        *_cannot_play_violations(sentences, sheet),
    ]


def shown_week_words() -> tuple[str, ...]:
    """The week's own refused words, as the prompt lists them."""
    return tuple(dict.fromkeys(word for rule in WEEK_NEVER_WORDS for word in rule.shown))
