"""THE WRITER'S VOICE RULES, in one config file: what a capsule may never ship with, however well
grounded its numbers are.

Ported from `research-ts/src/capsules/{voice-rules,config}.ts`, with the rulings of the prep-site
reviews applied:
- Set phrases are the stock frames, the "the honest ..." frame whatever its noun ("the honest worry",
  "the honest read", "the honest answer", the "honest snag" the preview carried), and every phrase
  measured recurring across players (`Repetition.refrain_stems`). The oracle dropped two of these
  because a test fixture used them; the fixture changes, not the rule.
- The register is fantasy football's. Trading words are banned with the drafting phrase to use
  instead; betting words join them (UX review finding 6 and the Lane 5 re-review: 29 preview
  capsules quoted sportsbook lines): the books, a sportsbook, a posted line, odds, over and under as
  bets, a win total, a prop, a spread, Vegas as a bettor (never the Raiders' city), a bet. The fact
  sheet the writer reads no longer carries a sportsbook number at all (`render.py`).
- Lab-report and all-time words, rival products, the em-dash and the semicolon, as before.

`voice_rule_hits` is the gate's reading (the nightly fails a capsule carrying any hit) and the
validator's: set phrases, asides, then the register words, each named so a violation says which.
"""

import re
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

from research.capsules.config import CAPSULE_CONFIG

EM_DASH: Final = chr(0x2014)
# Curly apostrophes read as straight ones before a phrase is matched.
_APOSTROPHES: Final = str.maketrans({chr(0x2019): "'", chr(0x2018): "'"})
SEMICOLON: Final = ";"

_SET_PHRASES_FIXED: Final = (
    "the honest worry",
    "the honest hesitation",
    "the honest read",
    "the honest answer",
    "the stat that sells me",
    "the price is wrong",
    "with a plan behind him",
    "let's talk about",
    "here's the thing",
    "make no mistake",
    "at the end of the day",
    "the bottom line",
    "all things considered",
    "it's worth noting",
    "needless to say",
)
# Every stock frame, the board's measured refrains included, each once.
SET_PHRASES: Final = tuple(dict.fromkeys((*_SET_PHRASES_FIXED, *CAPSULE_CONFIG.repetition.refrain_stems)))


@dataclass(frozen=True, slots=True)
class NamedPattern:
    name: str
    pattern: re.Pattern[str]


def _rule(name: str, pattern: str, flags: int = re.IGNORECASE) -> NamedPattern:
    return NamedPattern(name, re.compile(pattern, flags | re.ASCII))


# The "the honest <noun>" frame, whatever the noun.
_HONEST_FRAME: Final = _rule("the honest ... frame", r"\bthe honest [a-z]+\b")

# The model talking to itself or its editor. Narrow: "wait" and "actually" are drafting words.
ASIDE_PATTERNS: Final = (
    _rule("let me", r"\blet me (?:say|put|try|rephrase|start|be (?:clear|plain|honest))\b"),
    _rule("not that word", r"\bnot that word\b"),
    _rule("the wrong word", r"\b(?:that'?s|that is) (?:the wrong|not the right) word\b"),
    _rule("scratch that", r"\b(?:scratch|strike) that\b"),
    _rule("or rather", r"\bor rather\b"),
    _rule("put plainly", r"\b(?:to )?put (?:it )?(?:plainly|simply|another way)\b"),
    _rule("in other words", r"\bin other words\b"),
    _rule("I mean", r"\bI mean\b", 0),
    _rule("a rewrite note", r"\bhere'?s (?:my|the|a) (?:rewrite|revision|draft|version)\b"),
    _rule("an editorial bracket", r"\[[^\]]*\]"),
    _rule("the model naming itself", r"\bas an? (?:AI|language model|assistant)\b"),
)

# Betting words, named. Football's own senses (the offensive line, the line of scrimmage, the Las
# Vegas Raiders, spreading the ball) are not bets and pass.
BETTING_PATTERNS: Final = (
    _rule("the books", r"\bthe books\b"),
    _rule("a sportsbook", r"\bsports ?books?\b|\b(?:book|odds)makers?\b"),
    _rule("odds", r"\bodds\b"),
    _rule(
        "a posted line", r"\bposted (?:him at|a line|his line|their line)\b|\b(?:prop|betting|player|season) lines?\b"
    ),
    _rule(
        "the line as a bet",
        r"\bthe (?:posted |opening |closing )?line (?:on|for|at|sits|is set|was set|moved|opened|closed)\b",
    ),
    _rule("over or under as a bet", r"\bthe (?:over|under)\b(?!-)|\bover/under\b|\bo/u\b|\b(?:over|under) [0-9]+\.5\b"),
    _rule("a win total", r"\bwin totals?\b"),
    _rule("a prop", r"\bprops?\b"),
    _rule("a spread", r"\bpoint spread\b|\bthe spread\b"),
    _rule("Vegas as a bettor", r"(?<!las )\bvegas\b"),
    _rule("a bet", r"\bbet(?:s|ting|tor|tors)?\b|\bwagers?\b|\bparlays?\b|\bmoneylines?\b|\bvig\b"),
    _rule("an implied total", r"\bimplied (?:team )?totals?\b"),
)

LAB_REPORT_TERMS: Final = (
    "p10",
    "p90",
    "percentile",
    "evidence",
    "measured",
    "effect size",
    "coefficient",
    "standard deviation",
    "implying",
    "implied",
)
ALL_TIME_TERMS: Final = (
    "best ever",
    "greatest ever",
    "ever seen",
    "ever played",
    "ever had",
    "all-time",
    "all time",
    "in nfl history",
    "greatest of all time",
    "goat",
)
TRADING_TERMS: Final = (
    "market",
    "price",
    "priced",
    "buy",
    "sell",
    "fade",
    "trade at",
    "trades at",
    "trading at",
    "undervalued",
    "overvalued",
    "premium",
    "discount",
    "dividend",
    "return on",
)
DRAFTING_SENTENCES: Final = (
    ("the price is right", "he is going a round later than he should"),
    ("at this price", "drafters are taking him around pick 100"),
    ("the price is too high", "a reach at his ADP"),
)
_PRICE: Final = tuple(write for _, write in DRAFTING_SENTENCES)
_ADP_PICK: Final = ("drafters are taking him around pick 100",)
TRADING_REPLACEMENTS: Final = MappingProxyType(
    {
        "market": ("drafters", "where drafters take him"),
        "price": _PRICE,
        "priced": _PRICE,
        "buy": ("draft him", "take him at that pick"),
        "sell": ("let him go",),
        "fade": ("let him fall", "pass on him"),
        "trade at": _ADP_PICK,
        "trades at": _ADP_PICK,
        "trading at": _ADP_PICK,
        "undervalued": ("he is going a round later than he should",),
        "overvalued": ("a reach at his ADP",),
        "premium": ("a reach",),
        "discount": ("a steal",),
        "dividend": ("points over replacement",),
        "return on": ("what he gives back",),
    }
)
BANNED_VOCABULARY: Final = (*LAB_REPORT_TERMS, *ALL_TIME_TERMS, *TRADING_TERMS)

COMPETITOR_NAMES: Final = (
    "espn",
    "yahoo",
    "sleeper",
    "cbs sports",
    "nfl.com",
    "ffpc",
    "underdog",
    "draftkings",
    "fanduel",
    "apex fantasy",
    "rtsports",
)
# Competitors whose names are English words: the product only when the prose treats it as one.
COMPETITOR_NAMES_THAT_ARE_WORDS: Final = ("sleeper", "underdog")
COMPETITOR_PRODUCT_CUES: Final = ("app", "league", "leagues", "draft", "drafts", "adp", "rankings", "ranking")


def banned_term_pattern(term: str) -> re.Pattern[str]:
    """A single word whole, with its plain inflections; a phrase as written."""
    if re.fullmatch(r"[a-z]+", term):
        return re.compile(rf"\b{term}(?:s|d|ed|ing)?\b", re.IGNORECASE | re.ASCII)
    return re.compile(re.escape(term), re.IGNORECASE)


_SET_PHRASE_PATTERNS: Final = tuple(_rule(phrase, rf"\b{re.escape(phrase)}\b") for phrase in SET_PHRASES)


@dataclass(frozen=True, slots=True)
class VoiceRuleHit:
    rule: str
    found: str


def _normalise_apostrophes(text: str) -> str:
    return text.translate(_APOSTROPHES)


def voice_rule_hits(text: str) -> list[VoiceRuleHit]:
    """Every set phrase, aside and betting word in `text`, in rule order. Empty is clean. The
    validator reads these as sentence rewrites; trading words it reads as banned terms, with the
    drafting phrase to use (`validate.py`)."""
    normalised = _normalise_apostrophes(text)
    hits = [VoiceRuleHit("set phrase", p.name) for p in _SET_PHRASE_PATTERNS if p.pattern.search(normalised)]
    honest = _HONEST_FRAME.pattern.search(normalised)
    if honest is not None and not any(hit.found == honest.group(0).lower() for hit in hits):
        hits.append(VoiceRuleHit("set phrase", honest.group(0)))
    for rules, kind in ((ASIDE_PATTERNS, "aside"), (BETTING_PATTERNS, "betting word")):
        for rule in rules:
            match = rule.pattern.search(normalised)
            if match is not None:
                hits.append(VoiceRuleHit(f"{kind} ({rule.name})", match.group(0)))
    return hits


def gate_hits(text: str) -> list[VoiceRuleHit]:
    """What the nightly gate refuses a stored capsule for: every voice-rule hit, and every trading
    word (fantasy words only, on the page as in the writer)."""
    normalised = _normalise_apostrophes(text)
    trading = [
        VoiceRuleHit("trading word", match.group(0))
        for term in TRADING_TERMS
        if (match := banned_term_pattern(term).search(normalised)) is not None
    ]
    return [*voice_rule_hits(text), *trading]
