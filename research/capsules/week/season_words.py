"""THE READ'S SEASON, SAID ONCE: a deterministic pass over the writer's answer before the validator reads it
(Lane 303, ruling 1).

The rules stand as they are: every week a read names carries its season (`season_voice`, "a week without its
season"), and the read names the season once (`rules._season_violation`). A writer that breaks either on the
exact pattern the rule refuses loses nothing a reader needs, so the pass mends the pattern instead of asking
again:

- This week's own report said by its week ("week 8's game status report") is said as the sheet says it, "this
  week's game status report" (the review's L2).
- The first week the read names, when it names no season and comes before the read's first naming of this
  season, takes it: "week 7's 15.1 PPR points" is "week 7 of 2026's 15.1 PPR points". A range takes it after its
  last week ("weeks 3 through 5 of 2026", the review's H3). The weeks after it are read as that season's by the
  validator (`validate.with_season`).
- A later "week 7 of 2026" (or "in 2026", ", 2026") after the read has named this season once is said as
  "week 7", only in the forms the rule's remedy writes, before a possessive, clause punctuation or the end
  (the review's H2).

What it never touches: any season but the read's own ("week 7 of 2025", "in 2025" stay); a week in a sentence
that speaks of another season, of his career, a rookie year, college or the playoffs, or a week followed by "of"
("week 3 of his career", the review's M1); this season named any other way ("his best game of 2026", "the 2026
season"); and quoted words (the review's L1). Such a read is still the rule's to refuse.

Week reads only, on purpose (the review's L3): the season capsules hold the other rule, the season beside every
week (`corrections`, "Name the season beside every week"), with no say-it-once rule, so dropping a repeat there
would break their rule. Never wire it into `capsules/write.py`.
"""

import re
from typing import Final

from research.capsules.season_voice import week_references

_YEAR: Final = re.compile(r"\b(?:19|20)\d\d\b")
# What places a week outside this season (the review's M1): an earlier season in words, his career, a rookie or
# college year, the playoffs, "as a" with a year or a role, "his first season".
_OUTSIDE_THIS_SEASON: Final = re.compile(
    r"\b(?:last|previous|prior|rookie) (?:season|year)\b|\ba year (?:ago|earlier)\b|\bseasons? ago\b|"
    r"\bcareer\b|\brookie\b|\bcollege\b|\bplayoffs?\b|\bpostseason\b|\bas a (?:freshman|sophomore|junior|senior|pro)\b|"
    r"\bhis (?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)) (?:nfl )?season\b",
    re.IGNORECASE,
)
_SENTENCE_END: Final = re.compile(r"[.!?](?=\s+[A-Z0-9\"'\u201c])")
# A week or a range of weeks ("week 7", "weeks 3-5", "weeks 3 through 5"): a range's last number is never a
# decimal's head, though a sentence's period may follow it (the review's H3; `validate._BARE_WEEK` reads the same).
_WEEK: Final = re.compile(
    r"\bweeks?\s+\d{1,2}(?:\s*(?:,|and|or|to|through|-)\s*(?:weeks?\s+)?\d{1,2}(?!\d|\.\d))*\b(?!\.\d)", re.IGNORECASE
)
_QUOTED: Final = re.compile(r"\"[^\"]*\"|\u201c[^\u201d]*\u201d")


def _season_after(season: int) -> re.Pattern[str]:
    """This season said right after a week in the rule's remedy forms: " of 2026" or " in 2026" before a
    possessive, clause punctuation or the end; ", 2026" before clause punctuation or the end (the review's H2)."""
    return re.compile(rf"\s+(?:of|in)\s+{season}(?=['\u2019]s\b|[.,;:!?)]|$)|\s*,\s*{season}(?=[.,;:!?)]|$)")


def _quoted_spans(text: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in _QUOTED.finditer(text)]


def _quoted(at: int, spans: list[tuple[int, int]]) -> bool:
    return any(start <= at < end for start, end in spans)


def _sentence_around(text: str, at: int) -> str:
    """The sentence of `text` that holds the character at `at`."""
    starts = [m.end() for m in _SENTENCE_END.finditer(text) if m.end() <= at]
    start = starts[-1] if starts else 0
    end = next((m.end() for m in _SENTENCE_END.finditer(text) if m.end() > at), len(text))
    return text[start:end]


def _outside_this_season(sentence: str, season: int) -> bool:
    """Whether a sentence names a season other than `season`, or places a week outside it in words."""
    return (
        any(int(year) != season for year in _YEAR.findall(sentence))
        or _OUTSIDE_THIS_SEASON.search(sentence) is not None
    )


def _first_season_at(text: str, season: int) -> int | None:
    found = re.search(rf"\b{season}\b", text)
    return None if found is None else found.start()


def _this_weeks_report(text: str, week: int | None) -> str:
    """This week's report said by its week ("week 8's game status report") as the sheet says it."""
    if week is None:
        return text
    return re.sub(
        rf"\bweek {week}(?:'|\u2019)s game status report\b", "this week's game status report", text, flags=re.I
    )


def _add_to_first_week(text: str, season: int) -> str:
    """`text` with this season added after its first week (the whole range), when that week names none and comes
    before the first naming of this season, outside quotes and never in a sentence that places it elsewhere."""
    first_season = _first_season_at(text, season)
    first = next((r for r in week_references(text) if r.season is None), None)
    if first is None:
        return text
    match = next((m for m in _WEEK.finditer(text) if m.start() == len(first.before)), None)
    if match is None or (first_season is not None and first_season < match.start()):
        return text
    if _quoted(match.start(), _quoted_spans(text)) or re.match(r"\s+of\b", text[match.end() :]):
        return text
    if _outside_this_season(_sentence_around(text, match.start()), season):
        return text
    return f"{text[: match.end()]} of {season}{text[match.end() :]}"


def _drop_repeats(text: str, season: int) -> str:
    """`text` with this season dropped from every week after its first naming of this season, except in quotes
    and in a sentence that speaks of another season (its bare week would be read as that one's)."""
    first_season = _first_season_at(text, season)
    if first_season is None:
        return text
    after, spans = _season_after(season), _quoted_spans(text)
    kept: list[str] = []
    cursor = 0
    for match in _WEEK.finditer(text):
        tail = after.match(text, match.end())
        if tail is None or tail.end() <= first_season + len(str(season)) or _quoted(match.start(), spans):
            continue
        if _outside_this_season(_sentence_around(text, match.start()), season):
            continue
        kept.append(text[cursor : match.end()])
        cursor = tail.end()
    return "".join([*kept, text[cursor:]])


def said_once(text: str, season: int, week: int | None = None) -> str:
    """The writer's `text` with this season said once, at the first week it names, and this `week`'s report said
    as the sheet says it (the module's moves)."""
    return _drop_repeats(_add_to_first_week(_this_weeks_report(text, week), season), season)
