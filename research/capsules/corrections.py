"""THE CORRECTIONS: each violation the validator raises, read back into the request the writer gets.

Split from `validate.py` (which raises the violations) so each file holds one job. A soft violation
is handed back as a sentence-level fix ("rewrite this sentence ..."); one this module has no
correction for costs the read a full rewrite. The time frame rules (`season_voice`) each carry the
advice their slip calls for: a week's season, a week still to play, a month, a draft already behind
the reader, the weeks he has missed. The page's own facts (`claims`), a label of the facts copied into
prose and a read that stops mid-sentence (`prose_checks`) each name the sentence and what to say.
The downside a read must cite is asked for in the form the validator reads (Lane 52): its number with
a cost word beside it (`validate.COST_WORDS`), since "worth 6.2 a game" alone does not read as a cost.
"""

import re
from typing import Final

from research.capsules.claims import CLAIM_RULES
from research.capsules.multiples import MULTIPLE_VIOLATION
from research.capsules.prose_checks import LABEL_VIOLATION, UNFINISHED_VIOLATION
from research.capsules.season_voice import MISSED_WEEKS_UNNAMED
from research.capsules.validate import (
    ADP_FIGURE_VIOLATION,
    COST_WORDS_SHOWN,
    NO_PAGE_NUMBER_VIOLATION,
    UNFRAMED_FLOOR_VIOLATION,
)

SOFT_CORRECTIONS: Final = {
    UNFRAMED_FLOOR_VIOLATION: 'One sentence uses "floor" beside a number. Rewrite that sentence, in your own words, so a '
    'reader knows the number comes from seasons shortened by injury, or take the word "floor" out of it.',
}
BANNED_TERM_VIOLATION: Final = re.compile(
    r'^The text uses the banned term "([^"]+)" in the sentence "(.+)"\. '
    r"(?:Rewrite without it\.|Say it in (drafting|fantasy) words instead: (.+)\.)$"
)
VOICE_RULE_VIOLATION: Final = re.compile(
    r"^The text carries an? (set phrase|doubled word|(?:aside|betting word|draft voice|time frame) \([^)]+\)), "
    r'"([^"]+)", in the sentence "(.+)"\. Rewrite that sentence\.$'
)
TENSION_NUMBER: Final = re.compile(r"\((-?\d+(?:\.\d+)?) pts/game\)")
_PLAIN: Final = "Use fantasy football words, never betting or trading words. Then leave everything else as it is."
# What each kind of voice slip asks of the rewrite, beyond losing the words caught.
_ADVICE: Final = (
    ("time frame (a week without its season)", "Name the season beside every week in it, as in week 7 of 2025."),
    (
        "time frame (a week still to play told as past)",
        "That week of this season has not been played yet: look ahead to it, or leave it out.",
    ),
    ("time frame (a month)", "Place it by week and season, never by a month."),
    (
        "draft voice",
        "His draft is behind the reader: say it for a manager running his roster now (start him, hold him, bench him, "
        "trade for him, pick him up, let him go).",
    ),
    ("doubled word", "Write the repeated word once."),
)


def is_voice_rule_violation(violation: str) -> bool:
    return VOICE_RULE_VIOLATION.match(violation) is not None


def _advice(kind: str) -> str:
    return next((advice for prefix, advice in _ADVICE if kind.startswith(prefix)), "Say only what it means, plainly.")


def voice_rule_correction_for(violation: str) -> str | None:
    match = VOICE_RULE_VIOLATION.match(violation)
    if match is None:
        return None
    return (
        f'Rewrite this sentence: "{match.group(3)}". {_advice(match.group(1))} In your own words, without '
        f'"{match.group(2)}" or anything like it. {_PLAIN}'
    )


def _page_correction(violation: str) -> str | None:
    """The corrections that hand the writer the page's own numbers or facts: its ADP, the renderings
    that count, the weeks he has missed."""
    if violation.startswith(ADP_FIGURE_VIOLATION):
        return f"{violation.removeprefix(ADP_FIGURE_VIOLATION + ': ')} Rewrite only that sentence and leave everything else as it is."
    if violation.startswith(NO_PAGE_NUMBER_VIOLATION):
        choices = violation.removeprefix(NO_PAGE_NUMBER_VIOLATION).removeprefix(": ").removesuffix(".")
        return (
            "Work one of these numbers into one sentence, printed exactly as written here, in your own words: "
            f"{choices}. Leave everything else as it is."
        )
    if violation.startswith(MISSED_WEEKS_UNNAMED):
        return f"{violation.removeprefix(MISSED_WEEKS_UNNAMED + ': ')} Leave everything else as it is."
    if violation.startswith((UNFINISHED_VIOLATION, LABEL_VIOLATION, MULTIPLE_VIOLATION)):
        return f"{violation} Leave everything else as it is."
    rule = next((rule for rule in CLAIM_RULES if violation.startswith(f"{rule}: ")), None)
    if rule is not None:
        return f"{violation.removeprefix(f'{rule}: ')} Rewrite only that sentence and leave everything else as it is."
    return None


def soft_correction_for(violation: str) -> str | None:
    """The correction a soft violation is handed back with, or None for one that costs a rewrite."""
    if violation in SOFT_CORRECTIONS:
        return SOFT_CORRECTIONS[violation]
    page = _page_correction(violation)
    if page is not None:
        return page
    banned = BANNED_TERM_VIOLATION.match(violation)
    if banned is not None and banned.group(4) is not None:
        return (
            f'Your text uses the trading word "{banned.group(1)}". Rewrite this sentence: "{banned.group(2)}". Say it in '
            f"your own words, with {banned.group(3)} words instead: {banned.group(4)}. Then leave everything else as it is."
        )
    voice = voice_rule_correction_for(violation)
    if voice is not None:
        return voice
    if violation.startswith("Mixed evidence:"):
        return _downside_correction(violation)
    return None


def _downside_correction(violation: str) -> str:
    number = TENSION_NUMBER.search(violation)
    downside = "the strongest downside on the sheet" if number is None else f"the {number.group(1)} pts/game downside"
    figure = "its number" if number is None else number.group(1).lstrip("-")
    return (
        f"Your text never cites {downside} as a cost. Work it in before your last sentence, in your own words, with "
        f'the number and a cost word beside it in the same sentence ({COST_WORDS_SHOWN}), as in "costs him {figure} points a '
        f'game". "Worth {figure}" alone does not say it is a cost. Leave everything else as it is.'
    )
