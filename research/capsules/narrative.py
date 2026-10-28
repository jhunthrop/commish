"""THE NARRATIVE SLOTS: one validated sentence per module on the player's page.

Ported from `research-ts/src/capsules/{narrative,narrative-slots}.ts`. Each slot is asked for with a
brief and a word cap, validated like a read (no tension mandate), and a slot refused only for its
voice is rewritten once within the player's call ceiling. The books slot and its absence slot are
gone with the sportsbook register (the prep-site ruling): the page's modules no longer carry one.
"""

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Final

from research.capsules.config import CAPSULE_MODEL
from research.capsules.corrections import is_voice_rule_violation, voice_rule_correction_for
from research.capsules.facts.model import (
    ChangedTeamEvidence,
    EvidenceItem,
    LawEvidence,
    NewPlayCallerEvidence,
    RookieEvidence,
    ShareEvidence,
)
from research.capsules.facts.team_names import NFL_TEAM_NAMES
from research.capsules.sentences import split_sentences
from research.capsules.validate import grounding_of, validate_narrative_slot
from research.capsules.voice_rules import in_fantasy_words

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

CALL_WORDS: Final = 30
MODULE_WORDS: Final = 40
# A sentence's shape (Lane 265, Lane 261's bake-off normalization): the marks its names, clubs and numbers
# become, spelled so `normalize_sentence` keeps each one word, and the words the correction ask shows for each.
PLAYER_MARK: Final = "zzplayer"
CLUB_MARK: Final = "zzclub"
NUMBER_MARK: Final = "zznum"
_SHOWN_MARKS: Final = {PLAYER_MARK: "[name]", CLUB_MARK: "[club]", NUMBER_MARK: "[number]"}
# A number with its ordinal suffix, so "23rd" and "24th" are one shape.
_SHAPE_NUMBER: Final = re.compile(r"\d+(?:[.,]\d+)*(?:st|nd|rd|th)?")
# A possessive, a name's ("Nacua's") or a plural's ("the Rams'").
_POSSESSIVE: Final = re.compile(r"['\u2019]s?$")
# Main's word mask (Lane 72's review, M4), kept beside the placeholders so the check is never weaker than it
# was (the Lane 265 review's H1 and L1): every capitalised word, a pronoun or a first name among them, and
# every number.
_CAPITALISED: Final = re.compile(r"\b[A-Z][\w'\u2019.-]*")
_WORD_NUMBER: Final = re.compile(r"\d+(?:[.,]\d+)*%?")
# The two kinds of shape a sentence is held by, each its own namespace so one never equals the other.
NAMES_KIND: Final = "names: "
WORDS_KIND: Final = "words: "
_WORD_MARK: Final = "x"
# A name's suffix in every form a read may write it (B276, Lane 286): with and without the period.
NAME_SUFFIXES: Final = ("Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV", "V")
_NAME_SUFFIX_SET: Final = frozenset(NAME_SUFFIXES)


def why_group_slot_key(group_key: str) -> str:
    return f"whyGroup:{group_key}"


def absence_slot_key(module: str) -> str:
    return f"absence:{module}"


def normalize_sentence(text: str) -> str:
    """`normalizeSentence`: lower case, punctuation folded, decimals kept."""
    lowered = re.sub(r"(?<!\d)\.(?!\d)", " ", text.lower())
    folded = re.sub(r"[^a-z0-9%. ]+", " ", lowered)
    return re.sub(r"\s+", " ", folded).strip()


def sentences_verbatim(text: str) -> list[str]:
    return [s.strip() for s in split_sentences(text) if normalize_sentence(s.strip()) != ""]


def sentences_of(text: str) -> list[str]:
    return [normalize_sentence(s) for s in sentences_verbatim(text)]


def held_sentences(bodies: Sequence[str], min_words: int) -> set[str]:
    """A page's sentences held to uniqueness across pages: normalized, `min_words` long or longer."""
    normalized = {normalize_sentence(s) for body in bodies for s in sentences_verbatim(body)}
    return {s for s in normalized if len(s.split()) >= min_words}


def player_spellings(names: Iterable[str]) -> tuple[str, ...]:
    """Each player's name as a read may write it: his full name, the name without its suffix, his last name
    (the name's last word that is not a suffix) and his first name ("Puka", the Lane 265 review's L1: a read
    that calls him by it is the same shape as one that names him), and the bare full and last names with every
    suffix form when his name carries one (B276, Lane 286: "Harrison Jr." and "Marvin Harrison" are both Marvin
    Harrison Jr.)."""
    spellings: set[str] = set()
    for name in names:
        words = name.split()
        bare = _without_suffix(words)
        if not bare:
            continue
        full, last = " ".join(bare), bare[-1]
        spellings.update((name, full, bare[0], last))
        if len(bare) < len(words):
            spellings.update(f"{stem} {suffix}" for stem in (full, last) for suffix in NAME_SUFFIXES)
    return tuple(sorted(spellings))


def _without_suffix(words: Sequence[str]) -> list[str]:
    """A name's words with its trailing suffixes dropped ("Marvin Harrison Jr." to "Marvin Harrison")."""
    end = len(words)
    while end > 1 and words[end - 1] in _NAME_SUFFIX_SET:
        end -= 1
    return list(words[:end])


def club_spellings() -> tuple[str, ...]:
    """Every club spelling a read may use: the code, the city, the nickname and the two together."""
    spellings: set[str] = set()
    for code, (city, nickname) in NFL_TEAM_NAMES.items():
        spellings.update((code, city, nickname, f"{city} {nickname}"))
    return tuple(sorted(spellings))


@dataclass(frozen=True, slots=True)
class ShapeMasks:
    """The spellings a sentence's shape replaces, longest first so a full name goes before its last name."""

    pattern: re.Pattern[str]
    clubs: frozenset[str]

    @classmethod
    def of(cls, players: Iterable[str], clubs: Iterable[str] | None = None) -> "ShapeMasks":
        """Masks for `players`' names (full and last) and `clubs` (every club spelling by default)."""
        club_set = frozenset(club_spellings() if clubs is None else clubs)
        words = sorted({*player_spellings(players), *club_set}, key=lambda w: (-len(w), w))
        alternatives = "|".join(re.escape(w) for w in words) or r"(?!)"
        # A trailing possessive, a name's or a plural's; nothing word-like after it.
        possessive = r"(?:['\u2019]s|(?<=s)['\u2019])?"
        return cls(re.compile(rf"(?<![\w'])(?:{alternatives}){possessive}(?![\w'\u2019])"), club_set)

    def shape(self, sentence: str) -> str:
        """`sentence` with names, clubs and numbers masked, then normalized. Names match case-sensitively,
        so a lower-case word that spells a surname is kept. A name that is also a club spelling ("Washington")
        is marked a club (the word shape, `word_shape`, holds such a pair)."""

        def mark(match: re.Match[str]) -> str:
            bare = _POSSESSIVE.sub("", match.group(0))
            return f" {CLUB_MARK} " if bare in self.clubs else f" {PLAYER_MARK} "

        masked = _SHAPE_NUMBER.sub(f" {NUMBER_MARK} ", self.pattern.sub(mark, sentence))
        return normalize_sentence(masked)


def word_shape(sentence: str) -> str:
    """Main's shape: every capitalised word and every number masked, normalized (a number's mark drops out)."""
    return normalize_sentence(_WORD_NUMBER.sub("#", _CAPITALISED.sub(_WORD_MARK.upper(), sentence)))


def held_shapes(bodies: Sequence[str], masks: ShapeMasks, *, name_words: int, word_words: int) -> dict[str, str]:
    """Each sentence shape of `bodies` held to one page, to its first sentence as written: the placeholder shape
    (`masks`, `name_words` long or longer) and the word shape (`word_shape`, `word_words` or longer), each in its
    own namespace, so two sentences either shape equates share a shape."""
    out: dict[str, str] = {}
    for body in bodies:
        for sentence in sentences_verbatim(body):
            named, worded = masks.shape(sentence), word_shape(sentence)
            if len(named.split()) >= name_words:
                out.setdefault(NAMES_KIND + named, sentence)
            if len(worded.split()) >= word_words:
                out.setdefault(WORDS_KIND + worded, sentence)
    return out


def shown_shape(shape: str) -> str:
    """A shape as a correction ask shows it: "[name] is on injured reserve in week [number]"."""
    if shape.startswith(WORDS_KIND):
        return " ".join("[name]" if word == _WORD_MARK else word for word in shape.removeprefix(WORDS_KIND).split())
    return " ".join(_SHOWN_MARKS.get(word, word) for word in shape.removeprefix(NAMES_KIND).split())


@dataclass(frozen=True, slots=True)
class SlotRequest:
    key: str
    max_words: int
    brief: str


@dataclass(frozen=True, slots=True)
class RefusedSlot:
    key: str
    text: str
    violations: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class NarrativeResult:
    slots: Mapping[str, str] = field(default_factory=dict)
    model: str | None = None
    rejected: tuple[str, ...] = ()
    refused: tuple[RefusedSlot, ...] = ()
    failure: str | None = None


def failed_narrative(failure: str) -> NarrativeResult:
    return NarrativeResult(failure=failure)


def voice_rewritable(slot: RefusedSlot) -> bool:
    return bool(slot.violations) and all(is_voice_rule_violation(v) for v in slot.violations)


def slot_rewrite_prompt(request: SlotRequest, slot: RefusedSlot) -> str:
    corrections = [c for c in (voice_rule_correction_for(v) for v in slot.violations) if c is not None]
    return "\n\n".join(
        [
            f"This is one sentence you wrote for the {request.key} module: {request.brief}",
            f'What you wrote: "{slot.text}"',
            *corrections,
            f"Keep every number and name it already has, stay under {request.max_words} words, and answer with the rewritten sentence alone, no quotes and nothing around it.",
        ]
    )


def with_rewritten_slot(result: NarrativeResult, key: str, text: str, model: str) -> NarrativeResult:
    refused = tuple(slot for slot in result.refused if slot.key != key)
    rejected = tuple(
        f"{slot.key}: {slot.violations[0] if slot.violations else 'unknown violation'}" for slot in refused
    )
    return replace(result, slots={**result.slots, key: text}, model=model, refused=refused, rejected=rejected)


def _label(item: EvidenceItem) -> str:
    if isinstance(item, LawEvidence):
        return in_fantasy_words(item.headline)
    if isinstance(item, ShareEvidence):
        return (
            "his role grew this offseason"
            if item.kind == "offseason_share_gained"
            else "his role shrank this offseason"
        )
    if isinstance(item, ChangedTeamEvidence):
        return f"he changed teams, {item.from_} to {item.to}"
    if isinstance(item, NewPlayCallerEvidence):
        return f"a new play caller at {item.team}"
    if isinstance(item, RookieEvidence):
        return "he is a rookie"
    return "he has no ADP"


def narrative_requests_for(facts: "PlayerFacts") -> list[SlotRequest]:
    """`narrativeRequestsFor`: the slots this player's page has something to say in."""
    requests = [
        SlotRequest(
            "call",
            CALL_WORDS,
            "The lead. One sentence a sharp analyst would open with about THIS player, the thing you would say first if a friend asked about him. Take a side.",
        )
    ]
    if facts.availability is not None:
        requests.append(
            SlotRequest(
                "perGame",
                MODULE_WORDS,
                "The games question, beside the per-game figure the page already shows. Say what his expected games mean for what he is worth, and never restate the rank itself.",
            )
        )
    if facts.trend is not None and facts.trend.points_per_game is not None and facts.trend.points_per_game.material:
        requests.append(
            SlotRequest(
                "trend",
                MODULE_WORDS,
                "What his year-over-year move actually was, and whether it changes your read. The page prints the two seasons and the delta, so say what they mean.",
            )
        )
    if facts.last_season_story is not None:
        requests.append(
            SlotRequest(
                "story",
                MODULE_WORDS,
                "Last season in one line, the shape of it rather than the totals the page already lists beside you.",
            )
        )
    else:
        requests.append(
            SlotRequest(
                absence_slot_key("story"),
                MODULE_WORDS,
                "There is no prior season on record for him. Say that plainly, in a way that tells the reader what it means for him rather than apologising for a gap.",
            )
        )
    if facts.usage is None:
        requests.append(
            SlotRequest(
                absence_slot_key("usage"),
                MODULE_WORDS,
                "His role last season was never tracked. Say that without dressing it up, and say what a reader should watch instead.",
            )
        )
    if facts.market.players_left_in_tier is not None and facts.market.drop_to_next_tier is not None:
        requests.append(
            SlotRequest(
                "tier",
                MODULE_WORDS,
                "Where he sits in his tier and what the drop behind him is worth"
                + (" to a drafter" if facts.season is None else " on a roster now")
                + ". Never call a small step a cliff.",
            )
        )
    for item in facts.evidence:
        requests.append(
            SlotRequest(
                why_group_slot_key(item.group_key),
                MODULE_WORDS,
                f'The evidence line for "{_label(item)}": why it moves his outlook, in the words you would use out loud.',
            )
        )
    return requests


def settle_narrative(
    raw: Mapping[str, object] | None, facts: "PlayerFacts", requests: Sequence[SlotRequest], model: str = CAPSULE_MODEL
) -> NarrativeResult:
    """`settleNarrative`: every requested slot validated, kept or refused with its violations."""
    if raw is None:
        return failed_narrative("the answer carried no narrative object")
    grounding = grounding_of(facts)
    slots: dict[str, str] = {}
    refused: list[RefusedSlot] = []
    for request in requests:
        value = raw.get(request.key)
        if not isinstance(value, str) or value.strip() == "":
            continue
        text = value.strip()
        result = validate_narrative_slot(text, grounding, request.max_words)
        if result.ok:
            slots[request.key] = text
        else:
            refused.append(RefusedSlot(request.key, text, result.violations))
    rejected = tuple(
        f"{slot.key}: {slot.violations[0] if slot.violations else 'unknown violation'}" for slot in refused
    )
    return NarrativeResult(slots, model if slots else None, rejected, tuple(refused), None)
