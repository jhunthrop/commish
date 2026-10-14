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
from collections.abc import Sequence
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


def named_rule(name: str, pattern: str, flags: int = re.IGNORECASE) -> NamedPattern:
    """A rule named for the violation it raises, matched ASCII-only (case-insensitive unless `flags` says)."""
    return NamedPattern(name, re.compile(pattern, flags | re.ASCII))


# The "the honest <noun>" frame, whatever the noun.
_HONEST_FRAME: Final = named_rule("the honest ... frame", r"\bthe honest [a-z]+\b")

# The model talking to itself or its editor. Narrow: "wait" and "actually" are drafting words.
ASIDE_PATTERNS: Final = (
    named_rule("let me", r"\blet me (?:say|put|try|rephrase|start|be (?:clear|plain|honest))\b"),
    named_rule("not that word", r"\bnot that word\b"),
    named_rule("the wrong word", r"\b(?:that'?s|that is) (?:the wrong|not the right) word\b"),
    named_rule("scratch that", r"\b(?:scratch|strike) that\b"),
    named_rule("or rather", r"\bor rather\b"),
    named_rule("put plainly", r"\b(?:to )?put (?:it )?(?:plainly|simply|another way)\b"),
    named_rule("in other words", r"\bin other words\b"),
    named_rule("I mean", r"\bI mean\b", 0),
    named_rule("a rewrite note", r"\bhere'?s (?:my|the|a) (?:rewrite|revision|draft|version)\b"),
    named_rule("an editorial bracket", r"\[[^\]]*\]"),
    named_rule("the model naming itself", r"\bas an? (?:AI|language model|assistant)\b"),
    # The capsule speaks as "we" (our board, our projection); a single writer's "I" is an aside
    # (phase D review L10: "I would still spend it elsewhere"). Case-sensitive, so "Week I" and a
    # name's "III" never match a lone "I".
    named_rule("the first person singular", r"(?<![\w'])I(?:'d|'m|'ll|'ve)?(?![\w'])", 0),
    # And its other cases (fix round 2, N8: "gives me pause", "in my mind"); a name is masked first.
    named_rule("the first person singular", r"\b(?:[Mm]e|[Mm]y|[Mm]ine|[Mm]yself)\b", 0),
    # The writer's fact sheet is its own input, never the reader's (fix round 2, N13: "nothing on the
    # sheet says that changes"). The page shows numbers, not a sheet.
    named_rule("the writer's sheet", r"\b(?:the|this|his|our) (?:fact |facts )?sheet\b|\bfacts? sheet\b"),
)

# Betting words, named. Football's own senses (the offensive line, the line of scrimmage, the Las
# Vegas Raiders, spreading the ball) are not bets and pass.
BETTING_PATTERNS: Final = (
    named_rule("the books", r"\bthe books\b"),
    named_rule("a sportsbook", r"\bsports ?books?\b|\b(?:book|odds)makers?\b"),
    named_rule("odds", r"\bodds\b"),
    named_rule(
        "a posted line", r"\bposted (?:him at|a line|his line|their line)\b|\b(?:prop|betting|player|season) lines?\b"
    ),
    named_rule(
        "the line as a bet",
        r"\bthe (?:posted |opening |closing )?line (?:on|for|at|sits|is set|was set|moved|opened|closed)\b",
    ),
    named_rule(
        "a line as a number",
        r"(?<!stat )(?<!offensive )(?<!defensive )\bline (?:is|was|of|at|sits at|sat at|set at|opened at|closed at)"
        r" (?:about |around |roughly )?[0-9]",
    ),
    named_rule(
        "over or under as a bet", r"\bthe (?:over|under)\b(?!-)|\bover/under\b|\bo/u\b|\b(?:over|under) [0-9]+\.5\b"
    ),
    named_rule("a win total", r"\bwin totals?\b"),
    named_rule("a prop", r"\bprops?\b"),
    named_rule("a spread", r"\bpoint spread\b|\bthe spread\b"),
    named_rule("Vegas as a bettor", r"(?<!las )\bvegas\b"),
    named_rule("a bet", r"\bbet(?:s|ting|tor|tors)?\b|\bwagers?\b|\bparlays?\b|\bmoneylines?\b|\bvig\b"),
    named_rule("an implied total", r"\bimplied (?:team )?totals?\b"),
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
    "bought",
    "sell",
    "sold",
    "fade",
    "trade at",
    "trades at",
    "trading at",
    "undervalued",
    "overvalued",
    "undervalue",
    "overvalue",
    "premium",
    "discount",
    "dividend",
    "return on",
    "fetch",
)
DRAFTING_SENTENCES: Final = (
    ("the price is right", "he is going a round later than he should"),
    ("at this price", "drafters are taking him around pick 100"),
    ("the price is too high", "a reach at his ADP"),
)
# The same three in season, when the draft is behind the reader (`season_voice`).
IN_SEASON_SENTENCES: Final = (
    ("the price is right", "he is giving you more than where he went"),
    ("at this price", "for where he went before the season"),
    ("the price is too high", "he has not been worth where he went"),
)
_PRICE: Final = tuple(write for _, write in DRAFTING_SENTENCES)
_ADP_PICK: Final = ("drafters are taking him around pick 100",)
TRADING_REPLACEMENTS: Final = MappingProxyType(
    {
        "market": ("drafters", "where drafters take him"),
        "price": _PRICE,
        "priced": _PRICE,
        "buy": ("draft him", "take him at that pick"),
        "bought": ("drafted him", "took him at that pick"),
        "sell": ("let him go",),
        "sold": ("let him go",),
        "fade": ("let him fall", "pass on him"),
        "trade at": _ADP_PICK,
        "trades at": _ADP_PICK,
        "trading at": _ADP_PICK,
        "undervalued": ("he is going a round later than he should",),
        "overvalued": ("a reach at his ADP",),
        "undervalue": ("he is going a round later than he should",),
        "overvalue": ("a reach at his ADP",),
        "premium": ("a reach",),
        "discount": ("a steal",),
        "dividend": ("points over replacement",),
        "return on": ("what he gives back",),
        "fetch": ("what he would bring back in a trade",),
    }
)
_SPENT: Final = ("where he went before the season",)
# The drafting phrases above speak to a draft still ahead; in season the same words for a roster.
IN_SEASON_REPLACEMENTS: Final = MappingProxyType(
    {
        "market": ("managers", "where he went before the season"),
        "price": _SPENT,
        "priced": _SPENT,
        "buy": ("trade for him", "pick him up"),
        "bought": ("traded for him", "picked him up"),
        "sell": ("trade him away", "let him go"),
        "sold": ("traded him away", "let him go"),
        "fade": ("bench him", "pass on him"),
        "trade at": ("where he went before the season",),
        "trades at": ("where he went before the season",),
        "trading at": ("where he went before the season",),
        "undervalued": ("better than where he went",),
        "overvalued": ("not worth where he went",),
        "undervalue": ("better than where he went",),
        "overvalue": ("not worth where he went",),
        "premium": ("a reach",),
        "discount": ("a steal", "a waiver steal"),
        "dividend": ("points over replacement",),
        "return on": ("what he gives back",),
        "fetch": ("what he would bring back in a trade",),
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


# Trading words with a football sense too (fix round 3, R6): a player "fading" or a "fade route" is
# decline or a route, a defense "sold out to stop the run", a coach "bought into him". Only the trading
# sense is banned: fading him, selling, buying him.
_FOOTBALL_SENSES: Final = MappingProxyType(
    {
        "fade": r"\bfad(?:e|es|ed|ing) (?:him|them|this|that|the)\b(?! route)",
        "sold": r"\bsold\b(?! (?:out|on|the (?:dummy|defense|fake|run|play-action))\b)",
        "bought": r"\bbought\b(?! (?:in(?:to)?|time|himself time|him time)\b)",
    }
)


def banned_term_pattern(term: str) -> re.Pattern[str]:
    """A single word whole, with every inflection (a final "e" dropped before "ing" and "y": "pricing",
    "pricey", fix round 2 N7); a phrase as written."""
    if term in _FOOTBALL_SENSES:
        return re.compile(_FOOTBALL_SENSES[term], re.IGNORECASE | re.ASCII)
    if re.fullmatch(r"[a-z]+e", term):
        return re.compile(rf"\b{term[:-1]}(?:e|es|ed|ing|ey|y)\b", re.IGNORECASE | re.ASCII)
    if re.fullmatch(r"[a-z]+", term):
        return re.compile(rf"\b{term}(?:s|es|d|ed|ing|er|ers)?\b", re.IGNORECASE | re.ASCII)
    return re.compile(re.escape(term), re.IGNORECASE)


_SET_PHRASE_PATTERNS: Final = tuple(named_rule(phrase, rf"\b{re.escape(phrase)}\b") for phrase in SET_PHRASES)


# A word written twice in a row ("the the", the live review's M2). Two doublings are English.
_DOUBLED_WORD: Final = re.compile(r"\b([A-Za-z]+)\s+\1\b", re.IGNORECASE)
_DOUBLINGS_THAT_ARE_ENGLISH: Final = frozenset({"had", "that"})


def doubled_words(text: str) -> list[str]:
    """Every word the text writes twice in a row, as written."""
    return [
        match.group(0)
        for match in _DOUBLED_WORD.finditer(text)
        if match.group(1).lower() not in _DOUBLINGS_THAT_ARE_ENGLISH
    ]


@dataclass(frozen=True, slots=True)
class VoiceRuleHit:
    rule: str
    found: str
    # The sentence the hit stands in, when the rule knows it (the time frame rules read sentence by
    # sentence): the correction names that sentence, never the first one that happens to hold `found`.
    sentence: str = ""


def _normalise_apostrophes(text: str) -> str:
    return text.translate(_APOSTROPHES)


def mask_names(text: str, names: Sequence[str]) -> str:
    """`text` with every proper name in `names` (a capitalised ledger entry) masked, so a player
    called Price or Bet never reads as a banned word. Matched whole and case-sensitively."""
    for name in sorted((n for n in names if n[:1].isupper()), key=len, reverse=True):
        text = re.sub(rf"(?<![A-Za-z]){re.escape(name)}(?![A-Za-z])", "Him", text)
    return text


def voice_rule_hits(text: str, names: Sequence[str]) -> list[VoiceRuleHit]:
    """Every set phrase, aside and betting word in `text`, in rule order. Empty is clean. The
    validator reads these as sentence rewrites; trading words it reads as banned terms, with the
    drafting phrase to use (`validate.py`)."""
    normalised = _normalise_apostrophes(mask_names(text, names))
    hits = [VoiceRuleHit("set phrase", p.name) for p in _SET_PHRASE_PATTERNS if p.pattern.search(normalised)]
    honest = _HONEST_FRAME.pattern.search(normalised)
    if honest is not None and not any(hit.found == honest.group(0).lower() for hit in hits):
        hits.append(VoiceRuleHit("set phrase", honest.group(0)))
    for rules, kind in ((ASIDE_PATTERNS, "aside"), (BETTING_PATTERNS, "betting word")):
        for rule in rules:
            match = rule.pattern.search(normalised)
            if match is not None:
                hits.append(VoiceRuleHit(f"{kind} ({rule.name})", match.group(0)))
    # Read on the text as written: a masked name ("Him") beside another would read as one doubled.
    hits += [VoiceRuleHit("doubled word", doubled) for doubled in dict.fromkeys(doubled_words(text))]
    return hits


def gate_hits(text: str, names: Sequence[str]) -> list[VoiceRuleHit]:
    """What the nightly gate refuses a stored capsule for: every voice-rule hit, and every trading
    word (fantasy words only, on the page as in the writer)."""
    normalised = _normalise_apostrophes(mask_names(text, names))
    trading = [
        VoiceRuleHit("trading word", match.group(0))
        for term in TRADING_TERMS
        if (match := banned_term_pattern(term).search(normalised)) is not None
    ]
    return [*voice_rule_hits(text, names), *trading]


# A law's own quantity, named in betting words by the law store ("incoming team win total"), said in
# fantasy words wherever the writer or a reader sees it. The number is the same expectation.
_HEADLINE_WORDS: Final = (
    (re.compile(r"\b(?:incoming )?team win total\b|\bwin total\b", re.IGNORECASE), "expected team wins"),
)


def in_fantasy_words(headline: str) -> str:
    """A law headline with any betting phrase in it said the fantasy way."""
    for pattern, words in _HEADLINE_WORDS:
        headline = pattern.sub(words, headline)
    return headline
