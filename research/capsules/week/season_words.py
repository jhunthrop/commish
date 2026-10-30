"""THE READ'S SEASON, SAID ONCE: a deterministic pass over the writer's answer before the validator reads it
(Lane 303, ruling 1).

The rules stand as they are: every week a read names carries its season (`season_voice`, "a week without its
season"), and the read names the season once (`rules._season_violation`). A writer that breaks either on the
exact pattern the rule refuses loses nothing a reader needs, so the pass mends the pattern instead of asking
again:

- The first week the read names, when it names no season and comes before the read's first naming of this
  season, takes it: "week 8's game status report" is "week 8 of 2026's game status report". The weeks after it
  are read as that season's by the validator (`validate.with_season`).
- A later "week 7 of 2026" (or "in 2026", ", 2026") after the read has named this season once is said as
  "week 7".

What it never touches: any season but the read's own ("week 7 of 2025", "in 2025" stay), a week in a sentence
that speaks of an earlier season ("last season", "last year", a year named), and this season named any other way
("his best game of 2026"): such a read is still the rule's to refuse.
"""

import re
from typing import Final

from research.capsules.season_voice import week_references

_YEAR: Final = re.compile(r"\b(?:19|20)\d\d\b")
_EARLIER_SEASON: Final = re.compile(
    r"\b(?:last|previous|prior|rookie) (?:season|year)\b|\ba year (?:ago|earlier)\b|\bseasons? ago\b", re.IGNORECASE
)
_SENTENCE_END: Final = re.compile(r"[.!?](?=\s+[A-Z0-9\"'])")
_WEEK: Final = re.compile(
    r"\bweeks?\s+\d{1,2}(?:\s*(?:,|and|or|to|through|-)\s*(?:weeks?\s+)?\d{1,2}(?![\d.]))*\b(?![.]\d)", re.IGNORECASE
)


def _season_after(season: int) -> re.Pattern[str]:
    """This season said right after a week: " of 2026", " in 2026", ", 2026" (matched at the week's end)."""
    return re.compile(rf"\s*(?:of|in|,)\s*(?:the\s+)?{season}\b")


def _sentence_around(text: str, at: int) -> str:
    """The sentence of `text` that holds the character at `at`."""
    starts = [m.end() for m in _SENTENCE_END.finditer(text) if m.end() <= at]
    start = starts[-1] if starts else 0
    end = next((m.end() for m in _SENTENCE_END.finditer(text) if m.end() > at), len(text))
    return text[start:end]


def _speaks_of_another_season(sentence: str, season: int) -> bool:
    """Whether a sentence names a season other than `season`, or an earlier season in words."""
    return any(int(year) != season for year in _YEAR.findall(sentence)) or _EARLIER_SEASON.search(sentence) is not None


def _first_season_at(text: str, season: int) -> int | None:
    found = re.search(rf"\b{season}\b", text)
    return None if found is None else found.start()


def _add_to_first_week(text: str, season: int) -> str:
    """`text` with this season added to its first week, when that week names none and comes before the first
    naming of this season."""
    first_season = _first_season_at(text, season)
    references = week_references(text)
    first = next((r for r in references if r.season is None), None)
    if first is None:
        return text
    match = next((m for m in _WEEK.finditer(text) if m.start() == len(first.before)), None)
    if match is None or (first_season is not None and first_season < match.start()):
        return text
    if _speaks_of_another_season(_sentence_around(text, match.start()), season):
        return text
    return f"{text[: match.end()]} of {season}{text[match.end() :]}"


def _drop_repeats(text: str, season: int) -> str:
    """`text` with this season dropped from every week after its first naming of this season, except in a
    sentence that speaks of another season (its bare week would be read as that one's)."""
    first_season = _first_season_at(text, season)
    if first_season is None:
        return text
    after = _season_after(season)
    kept: list[str] = []
    cursor = 0
    for match in _WEEK.finditer(text):
        tail = after.match(text, match.end())
        if tail is None or tail.end() <= first_season + len(str(season)):
            continue
        if _speaks_of_another_season(_sentence_around(text, match.start()), season):
            continue
        kept.append(text[cursor : match.end()])
        cursor = tail.end()
    return "".join([*kept, text[cursor:]])


def said_once(text: str, season: int) -> str:
    """The writer's `text` with this season said once, at the first week it names (the module's two moves)."""
    return _drop_repeats(_add_to_first_week(text, season), season)
