"""LANE 281, HOW AUDIBLE A VOICE IS: how far one voice's reads sit from the voices-off reads of the same players.

B270: Lane 266 found matchup, story and table talk opening on his status like a read with no voice. The tally
scores a voice on three measures, each from 0 (sounds like no voice) to 1, and their mean:

- opener shape: the total variation distance between the classes the reads' first sentences open on (the
  call, a figure, a club, his status, him otherwise, anything else), the voice's against the voices-off reads';
- sentence lengths: the two-sample Kolmogorov-Smirnov distance between their sentences' word counts;
- the lean: how much more often the voice's reads carry what its brief leans on (`LEANS`) than the voices-off
  reads do, floored at 0.

Lane 281's ruling 2 basis is the written first-draft reads (`voiced`), corrected reads counted apart. Two wider
bases sit beside it (`BASES`): every read's first draft, written or not (the voice as asked), and every written
read (the voice as the page shows it, Lane 282's bar, since a correction now carries the voice's reminder). The
voices-off side is held to the same cut.
"""

import re
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final

from research.capsules.facts.team_names import NFL_TEAM_NAMES
from research.capsules.narrative import CLUB_MARK, NUMBER_MARK, PLAYER_MARK, ShapeMasks, sentences_verbatim
from research.capsules.store import WRITTEN_SOURCE

Json = Mapping[str, Any]
CALL: Final = "call"
FIGURE: Final = "figure"
CLUB: Final = "club"
STATUS: Final = "status"
HIM: Final = "him"
OTHER: Final = "other"
OPENER_CLASSES: Final = (CALL, FIGURE, CLUB, STATUS, HIM, OTHER)
# How far into the first sentence an opener's class is read (masked words).
_LEAD_WORDS: Final = 4
_STATUS_REACH: Final = 10
# A club among the first two words ("the Cardinals") leads the sentence before any figure after it.
_CLUB_LEAD: Final = 2
_CALL_VERBS: Final = frozenset(
    {"start", "sit", "bench", "keep", "hold", "find", "play", "plug", "stash", "leave", "get", "slot", "roll",
     "fire", "trust", "ride", "put", "lock", "grab", "drop", "write", "fill", "set", "move", "pencil"}
)  # fmt: skip
_CALL_LEADS: Final = frozenset({"you", "just", "go", "don", "do", "never", "simply"})
_HIM_WORDS: Final = frozenset({PLAYER_MARK, "he", "his", "he's", "hes"})
_STATUS: Final = re.compile(
    r"\b(?:designation|designated|injury list|injured reserve|questionable|doubtful|out|healthy|cleared|bye|"
    r"(?:does not|doesn't|won't|will not|cannot|can't) play|ruled out|on the list|active|limited|practice)\b",
    re.IGNORECASE,
)
_DEPTH: Final = re.compile(
    r"\b(?:depth chart|first among|second among|third among|ahead of|behind|backfield|lead (?:back|receiver)|"
    r"top (?:back|receiver|target|option)|role|snaps?|workload|work|touches|targets|carries|starter|slot)\b",
    re.IGNORECASE,
)
_SEASON_TURN: Final = re.compile(
    r"\b(?:season|through week|last (?:two|three|four|\d+) (?:weeks|games)|since week|back from|again|still|"
    r"missed|miss(?:es|ing)?|returns?|returning|streak|straight|after|so far|all year|this year|rolling)\b",
    re.IGNORECASE,
)
_TALK: Final = re.compile(
    r"n['\u2019]t\b|['\u2019](?:re|ll|ve|d)\b|\b(?:he|it|that|there|what)['\u2019]s\b|\byou\b", re.IGNORECASE
)
_FIGURE_LEAD: Final = 6


@dataclass(frozen=True, slots=True)
class VoiceAudibility:
    """One voice's reads in a voiced arm against the voices-off reads of the same players."""

    voice: str
    voiced_reads: int
    corrected_reads: int
    off_reads: int
    opener_distance: float
    length_distance: float
    lean_on: float
    lean_off: float
    lean_gain: float
    score: float
    status_openers_on: float
    status_openers_off: float
    openers_on: tuple[tuple[str, int], ...]
    openers_off: tuple[tuple[str, int], ...]


def first_sentence(text: str) -> str:
    found = sentences_verbatim(text)
    return found[0] if found else ""


def opener_class(sentence: str, masks: ShapeMasks) -> str:
    """What a first sentence opens on, read from its first masked words."""
    words = masks.shape(sentence).split()
    lead = words[:_LEAD_WORDS]
    if not lead:
        return OTHER
    first = lead[0]
    if first in _CALL_VERBS or (first in _CALL_LEADS and any(w in _CALL_VERBS for w in lead[1:3])):
        return CALL
    if CLUB_MARK in lead[:_CLUB_LEAD]:
        return CLUB
    if NUMBER_MARK in lead:
        return FIGURE
    if first in _HIM_WORDS or (first == "the" and len(lead) > 1 and lead[1] == PLAYER_MARK):
        reach = " ".join(sentence.split()[:_STATUS_REACH])
        return STATUS if _STATUS.search(reach) else HIM
    return OTHER


def _club_names(code: str | None) -> tuple[str, ...]:
    if code is None or code not in NFL_TEAM_NAMES:
        return ()
    city, nickname = NFL_TEAM_NAMES[code]
    return (city, nickname)


def _names_opponent(read: Json) -> bool:
    sentence = first_sentence(read["text"])
    return any(re.search(rf"\b{re.escape(name)}\b", sentence) for name in _club_names(read.get("opponent")))


def _figure_leads(read: Json) -> bool:
    words = first_sentence(read["text"]).split()[:_FIGURE_LEAD]
    return any(re.match(r"\d", w) for w in words)


def _opens_on_call(read: Json) -> bool:
    words = first_sentence(read["text"]).lower().split()
    return bool(words) and words[0].strip(",.") in _CALL_VERBS


def _search_first(pattern: re.Pattern[str]) -> Callable[[Json], bool]:
    return lambda read: pattern.search(first_sentence(read["text"])) is not None


# What each brief leans on, as a first sentence shows it.
LEANS: Final[Mapping[str, Callable[[Json], bool]]] = {
    "verdict": _opens_on_call,
    "matchup": _names_opponent,
    "role": _search_first(_DEPTH),
    "numbers": _figure_leads,
    "story": _search_first(_SEASON_TURN),
    "table_talk": _search_first(_TALK),
}


def is_written(read: Json) -> bool:
    return bool(read["source"] == WRITTEN_SOURCE)


def corrected(read: Json) -> bool:
    """A written read whose words came from a correction or the retry writer, asked without the brief."""
    return len(read["drafts"]) > 1 or int(read.get("retry_asks") or 0) > 0


def voiced(reads: Iterable[Json]) -> list[Json]:
    """The written first-draft reads: the reads that carry the voice's brief (ruling 2's basis)."""
    return [r for r in reads if is_written(r) and not corrected(r)]


def first_drafts(reads: Iterable[Json]) -> list[Json]:
    """Every read's first draft, written or not: every one was asked with the brief (the voice as asked)."""
    return [{**r, "text": r["drafts"][0]["body"]} for r in reads if r["drafts"] and r["drafts"][0].get("body")]


def written(reads: Iterable[Json]) -> list[Json]:
    """Every written read, corrected or not: the voice as the page shows it."""
    return [r for r in reads if is_written(r)]


Cut = Callable[[Iterable[Json]], list[Json]]
# The reads a tally is taken on: ruling 2's first-draft written reads, and two wider bases beside it (Lane 281:
# about nine written reads in ten are corrected, which leaves ruling 2's basis a few reads a voice).
BASES: Final[Mapping[str, Cut]] = {
    "written first drafts": voiced,
    "every first draft": first_drafts,
    "every written read": written,
}


def ks_distance(a: Sequence[int], b: Sequence[int]) -> float:
    """The two-sample Kolmogorov-Smirnov statistic: the largest gap between the two empirical distributions."""
    if not a or not b:
        return 0.0
    points = sorted({*a, *b})
    sa, sb = sorted(a), sorted(b)
    return max(abs(_cdf(sa, x) - _cdf(sb, x)) for x in points)


def _cdf(ordered: Sequence[int], x: int) -> float:
    return sum(v <= x for v in ordered) / len(ordered)


def tv_distance(a: Counter[str], b: Counter[str]) -> float:
    """The total variation distance between two class counts, as shares."""
    na, nb = sum(a.values()), sum(b.values())
    if not na or not nb:
        return 0.0
    return sum(abs(a[k] / na - b[k] / nb) for k in {*a, *b}) / 2


def _lengths(reads: Iterable[Json]) -> list[int]:
    return [len(s.split()) for r in reads for s in sentences_verbatim(r["text"])]


def _rate(reads: Sequence[Json], test: Callable[[Json], bool]) -> float:
    return sum(test(r) for r in reads) / len(reads) if reads else 0.0


def voice_audibility(
    voice: str, on: Sequence[Json], off: Sequence[Json], masks: ShapeMasks, cut: Cut = voiced
) -> VoiceAudibility:
    """`voice`'s reads in a voiced arm (`on`, every read of its players) against the voices-off arm's reads of
    the same players (`off`), both cut the same way (`cut`, the written first drafts by default)."""
    players = {r["player_id"] for r in on}
    mine, theirs = cut(on), cut(r for r in off if r["player_id"] in players)
    open_on = Counter(opener_class(first_sentence(r["text"]), masks) for r in mine)
    open_off = Counter(opener_class(first_sentence(r["text"]), masks) for r in theirs)
    lean = LEANS[voice]
    lean_on, lean_off = _rate(mine, lean), _rate(theirs, lean)
    opener_distance = tv_distance(open_on, open_off)
    length_distance = ks_distance(_lengths(mine), _lengths(theirs))
    gain = max(0.0, lean_on - lean_off)
    return VoiceAudibility(
        voice=voice,
        voiced_reads=len(mine),
        corrected_reads=sum(is_written(r) and corrected(r) for r in on),
        off_reads=len(theirs),
        opener_distance=opener_distance,
        length_distance=length_distance,
        lean_on=lean_on,
        lean_off=lean_off,
        lean_gain=gain,
        score=(opener_distance + length_distance + gain) / 3,
        status_openers_on=open_on[STATUS] / len(mine) if mine else 0.0,
        status_openers_off=open_off[STATUS] / len(theirs) if theirs else 0.0,
        openers_on=tuple(open_on.most_common()),
        openers_off=tuple(open_off.most_common()),
    )


def audibility(
    on: Sequence[Json], off: Sequence[Json], masks: ShapeMasks, cut: Cut = voiced
) -> dict[str, VoiceAudibility]:
    """Every voice's audibility: `on` and `off` are two arms' reads, each carrying its player's `voice`."""
    keys = list(dict.fromkeys(r["voice"] for r in on))
    return {key: voice_audibility(key, [r for r in on if r["voice"] == key], off, masks, cut) for key in keys}
