"""THE OPPONENT'S RANK IN WORDS (Lane 139, C01): what "the most" and "the fewest" may say of a rank.

Opp rank counts points allowed to his position, 1st the fewest (the page's footer). So only the last rank
allowed the most and only the first the fewest: "the most" at 32nd of 32, "the second most" at 31st, "among
the most" from 29th to 31st, and the same from the other end. A rank between says no superlative and is
said by its rank. The sheet hands the writer these words (`render`), and the validator holds a read to them
(`rules`), so a sentence the verb rests on never calls 31st of 32 "the most".
"""

import re
from dataclasses import dataclass
from typing import Final, Literal

# How far from either end "among the" reaches: the last four ranks of 32, the end's own included.
AMONG_REACH: Final = 3
End = Literal["most", "fewest"]


@dataclass(frozen=True, slots=True)
class Superlative:
    """A superlative as a read writes it: "among" or not, its place from the end (1 the end itself, 2 the
    second), and which end."""

    among: bool
    place: int
    end: End


_PLACES: Final = {"": 1, "second": 2, "third": 3}
# The places from an end a rank is named by: the end itself and the one next to it.
_PLACE_WORDS: Final = {1: "", 2: "second "}
# "the most PPR points", "among the fewest points", "the second-most fantasy points".
_SUPERLATIVE: Final = re.compile(
    r"\b(among\s+)?the\s+(?:(second|third)[\s-]+)?(most|fewest|least)\s+"
    r"(?:(?:half-)?ppr\s+)?(?:fantasy\s+)?points?\b",
    re.IGNORECASE,
)


def _from_end(rank: int, of: int, end: End) -> int:
    """His place counted from `end`: 1 at the end itself."""
    return of - rank + 1 if end == "most" else rank


def fits(said: Superlative, rank: int, of: int) -> bool:
    """Whether the superlative is true of `rank` of `of` (1 the fewest)."""
    place = _from_end(rank, of, said.end)
    if said.among:
        return 1 <= place <= 1 + AMONG_REACH and 2 * place <= of
    return place == said.place


def superlatives_in(sentence: str) -> list[tuple[str, Superlative]]:
    """Each points superlative a sentence states, as written, with what it says."""
    out = []
    for match in _SUPERLATIVE.finditer(sentence):
        among, place, end = match.group(1), (match.group(2) or "").lower(), match.group(3).lower()
        said = Superlative(among is not None, _PLACES[place], "fewest" if end in ("fewest", "least") else "most")
        out.append((match.group(0), said))
    return out


def rank_words(rank: int, of: int) -> str | None:
    """The words a rank is said with: "the most" or "the second most" at the end itself and next to it,
    "among the most" a little further in, the same from the fewest end; None for a rank between, which is
    said by its rank alone."""
    # The nearer end first, so a short list never names the far one (review LOW-2).
    ends: tuple[End, End] = ("most", "fewest") if 2 * rank > of + 1 else ("fewest", "most")
    for end in ends:
        place = _from_end(rank, of, end)
        if place in _PLACE_WORDS:
            return f"the {_PLACE_WORDS[place]}{end}"
        if place <= 1 + AMONG_REACH:
            return f"among the {end}"
    return None
