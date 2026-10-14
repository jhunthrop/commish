"""THE SHARED SPANS: any six words in a row that two players' written pages both carry.

The live review of 2026-10-14 (M1) found stock language the sentence check could not see, because
the sentences around it differed: "is the whole story", "comes from seasons cut short by injury",
"a realistic range of 9 to 17 once injury risk is in". The founder's rule treats a stock sentence
across players as a defect, so the capsule gate holds every written page to this: no span of
`SPAN_WORDS` words appears on two pages.

A page's words are read across both sizes of its read, case folded with the punctuation stripped
(a decimal keeps its point, a contraction its apostrophe). Player and club names are not words of a
span: a name breaks the run, so two pages that name the same teammate or club do not share a span
for it. A name is a capitalised word of any player's name in the store or any spelling of a club.
"""

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from research.capsules.facts.team_names import NFL_TEAM_NAMES

SPAN_WORDS: Final = 6
_TOKEN: Final = re.compile(r"[A-Za-z0-9]+(?:\.[0-9]+)?(?:'[A-Za-z]+)?")
_POSSESSIVE: Final = re.compile(r"'s?$")
# A token stream with the names cut out: each run is the words between two names.
Runs = tuple[tuple[str, ...], ...]


@dataclass(frozen=True, slots=True)
class SharedSpan:
    span: str
    player_ids: tuple[str, ...]


def club_name_words() -> frozenset[str]:
    """Every word of every club's city and nickname."""
    return frozenset(word for city, nickname in NFL_TEAM_NAMES.values() for word in (*city.split(), nickname))


def name_words(player_names: Iterable[str]) -> frozenset[str]:
    """The capitalised words that are names: every word of these player names, and of the clubs."""
    words = {word for name in player_names for word in _TOKEN.findall(name)} | club_name_words()
    # A lone initial ("A" of A.J. Brown) would cut every sentence that opens on "A".
    return frozenset(word for word in words if len(word) > 1)


def runs_of(text: str, names: frozenset[str]) -> Runs:
    """The text's words, lower case, split into runs wherever a name stands."""
    runs: list[tuple[str, ...]] = []
    run: list[str] = []
    for token in _TOKEN.findall(text.replace(chr(0x2019), "'")):
        if token[:1].isupper() and _POSSESSIVE.sub("", token) in names:
            runs.append(tuple(run))
            run = []
            continue
        run.append(token.lower())
    runs.append(tuple(run))
    return tuple(r for r in runs if len(r) >= SPAN_WORDS)


def spans_of(runs: Runs) -> frozenset[str]:
    return frozenset(" ".join(run[i : i + SPAN_WORDS]) for run in runs for i in range(len(run) - SPAN_WORDS + 1))


def page_runs(bodies: Sequence[str], names: frozenset[str]) -> Runs:
    """A page's runs over every size of its read."""
    return tuple(run for body in bodies for run in runs_of(body, names))


def shared_spans(pages: Mapping[str, Runs]) -> tuple[SharedSpan, ...]:
    """Every span on two pages or more, the most widely shared first."""
    holders: dict[str, list[str]] = {}
    for player_id, runs in pages.items():
        for span in spans_of(runs):
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
