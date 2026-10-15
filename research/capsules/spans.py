"""THE SHARED SPANS: any six words in a row that two players' written pages both carry.

The live review of 2026-10-14 (M1) found stock language the sentence check could not see, because
the sentences around it differed: "is the whole story", "comes from seasons cut short by injury",
"a realistic range of 9 to 17 once injury risk is in". The founder's rule treats a stock sentence
across players as a defect, so the capsule gate counts every span of `SPAN_WORDS` words on two
pages or more and the repair rewrites them within the night's budget. Spans never fail a run (the
coordinator's Lane 17 ruling: one model writing a board from one sheet repeats six-word phrases by
nature); a whole sentence on two pages still does.

A page's words are read across both sizes of its read and its narrative sentences (each beside a
module on the page: prose too, and the most templated), case folded with the punctuation stripped
(a decimal keeps its point, a contraction its apostrophe). Player and club names are not words of a
span: a name breaks the run, so two pages that name the same teammate or club do not share a span
for it, and so does a week with its season, the citation every page must carry. A name is a
capitalised word of any player's name in the store or any spelling of a club.

`landing.TonightWindow` keeps the spans of the pages landed tonight (the most recent `window`), so each
writer call is told the phrasing tonight's pages already repeat, and collisions are avoided as they
are written rather than repaired after.
"""

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from research.capsules.facts.team_names import NFL_TEAM_NAMES
from research.capsules.sentences import phrase_pattern

SPAN_WORDS: Final = 6
_TOKEN: Final = re.compile(r"[A-Za-z0-9]+(?:\.[0-9]+)?(?:'[A-Za-z]+)?")
_POSSESSIVE: Final = re.compile(r"'s?$")
# A week with its season ("week 7 of 2025", "weeks 2 and 3 of 2026") is a citation the floor requires
# on every page (`season_voice`), so like a name it breaks a run rather than making one.
_DATED_WEEK: Final = re.compile(
    r"\bweeks?\s+\d{1,2}(?:\s*(?:,|and|or|to|through|-)\s*(?:weeks?\s+)?\d{1,2})*\s*(?:of|in|,)\s*(?:19|20)\d\d\b",
    re.IGNORECASE,
)
_BREAK: Final = "SPANBREAK"
# A token stream with the names cut out: each run is the words between two names.
Runs = tuple[tuple[str, ...], ...]


@dataclass(frozen=True, slots=True)
class SharedSpan:
    span: str
    player_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SpanRules:
    """What a span is judged against: the words that break a run (`names`), and the spans the fact
    sheets themselves print (`exempt`): a read that copies a sheet label or a stat name word for word
    ("red-zone share of his own touches") shares it with every page that names the same stat, which
    is the label, not stock prose. Both are built at run time, never a hand list."""

    names: frozenset[str]
    exempt: frozenset[str] = frozenset()


def cut_phrases(text: str, phrases: Iterable[str]) -> str:
    """`text` with each of `phrases` (case folded, a hyphen read as a space) replaced by a break, so no
    span runs through one."""
    for phrase in phrases:
        text = phrase_pattern(phrase).sub(f" {_BREAK} ", text)
    return text


def sheet_spans(sheets: Iterable[str], names: frozenset[str]) -> frozenset[str]:
    """Every span the rendered fact sheets print, read as a capsule's spans are read."""
    return frozenset(span for sheet in sheets for span in spans_of(runs_of(sheet, names)))


def club_name_words() -> frozenset[str]:
    """Every word of every club's city and nickname."""
    return frozenset(word for city, nickname in NFL_TEAM_NAMES.values() for word in (*city.split(), nickname))


def name_words(player_names: Iterable[str]) -> frozenset[str]:
    """The capitalised words that are names: every word of these player names, and of the clubs."""
    words = {word for name in player_names for word in _TOKEN.findall(name)} | club_name_words()
    # A lone initial ("A" of A.J. Brown) would cut every sentence that opens on "A".
    return frozenset(word for word in words if len(word) > 1)


def runs_of(text: str, names: frozenset[str]) -> Runs:
    """The text's words, lower case, split into runs wherever a name or a dated week stands."""
    runs: list[tuple[str, ...]] = []
    run: list[str] = []
    for token in _TOKEN.findall(_DATED_WEEK.sub(f" {_BREAK} ", text.replace(chr(0x2019), "'"))):
        if token == _BREAK or (token[:1].isupper() and _POSSESSIVE.sub("", token) in names):
            runs.append(tuple(run))
            run = []
            continue
        run.append(token.lower())
    runs.append(tuple(run))
    return tuple(r for r in runs if len(r) >= SPAN_WORDS)


def spans_of(runs: Runs) -> frozenset[str]:
    return frozenset(" ".join(run[i : i + SPAN_WORDS]) for run in runs for i in range(len(run) - SPAN_WORDS + 1))


def page_texts(compact: str, full: str, narrative: Mapping[str, str] | None) -> tuple[str, ...]:
    """Every prose text of a page: both reads and each narrative sentence."""
    return (compact, full, *(narrative or {}).values())


def page_runs(bodies: Sequence[str], names: frozenset[str]) -> Runs:
    """A page's runs over every size of its read."""
    return tuple(run for body in bodies for run in runs_of(body, names))


def shared_spans(pages: Mapping[str, Runs], exempt: frozenset[str] = frozenset()) -> tuple[SharedSpan, ...]:
    """Every span on two pages or more that no fact sheet prints, the most widely shared first."""
    holders: dict[str, list[str]] = {}
    for player_id, runs in pages.items():
        for span in spans_of(runs) - exempt:
            holders.setdefault(span, []).append(player_id)
    shared = [SharedSpan(span, tuple(sorted(ids))) for span, ids in holders.items() if len(ids) > 1]
    return tuple(sorted(shared, key=lambda s: (-len(s.player_ids), s.span)))


def phrases_on_page(runs: Runs, shared: frozenset[str]) -> tuple[str, ...]:
    """The page's shared spans joined where they overlap, so a repair quotes "comes from seasons cut
    short by injury" once rather than its two six-word windows."""
    phrases: list[str] = []
    for run in runs:
        starts = [i for i in range(len(run) - SPAN_WORDS + 1) if " ".join(run[i : i + SPAN_WORDS]) in shared]
        begin: int | None = None
        end = 0
        for start in starts:
            if begin is not None and start <= end:
                end = start + SPAN_WORDS
                continue
            if begin is not None:
                phrases.append(" ".join(run[begin:end]))
            begin, end = start, start + SPAN_WORDS
        if begin is not None:
            phrases.append(" ".join(run[begin:end]))
    return tuple(dict.fromkeys(phrases))
