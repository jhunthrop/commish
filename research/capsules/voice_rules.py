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
from research.capsules.facts.team_names import NFL_TEAM_NAMES
from research.capsules.names import name_pattern
from research.capsules.sentences import phrase_pattern
from research.capsules.site_words import SITE_PATTERN, SITE_SHOWN

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
    # The words the rule refuses as the writer's prompt lists them (`prompt.NEVER_ON_THE_PAGE`); a test
    # holds each to the rule's own pattern, so the list and the rule cannot drift (Lane 52).
    shown: tuple[str, ...] = ()


def named_rule(name: str, pattern: str, flags: int = re.IGNORECASE, shown: tuple[str, ...] = ()) -> NamedPattern:
    """A rule named for the violation it raises, matched ASCII-only (case-insensitive unless `flags` says)."""
    return NamedPattern(name, re.compile(pattern, flags | re.ASCII), shown)


# The "the honest <noun>" frame, whatever the noun.
HONEST_FRAME: Final = named_rule(
    "the honest ... frame", r"\bthe honest [a-z]+\b", shown=('"the honest" followed by any noun',)
)

# The model talking to itself or its editor. Narrow: "wait" and "actually" are drafting words.
ASIDE_PATTERNS: Final = (
    named_rule(
        "let me",
        r"\blet me (?:say|put|try|rephrase|start|be (?:clear|plain|honest))\b",
        shown=("let me say", "let me be clear"),
    ),
    named_rule("not that word", r"\bnot that word\b", shown=("not that word",)),
    named_rule(
        "the wrong word",
        r"\b(?:that'?s|that is) (?:the wrong|not the right) word\b",
        shown=("that is the wrong word",),
    ),
    named_rule("scratch that", r"\b(?:scratch|strike) that\b", shown=("scratch that",)),
    named_rule("or rather", r"\bor rather\b", shown=("or rather",)),
    named_rule(
        "put plainly",
        r"\b(?:to )?put (?:it )?(?:plainly|simply|another way)\b",
        shown=("put simply", "to put it plainly"),
    ),
    named_rule("in other words", r"\bin other words\b", shown=("in other words",)),
    named_rule("I mean", r"\bI mean\b", 0, shown=("I mean",)),
    named_rule(
        "a rewrite note",
        r"\bhere'?s (?:my|the|a) (?:rewrite|revision|draft|version)\b",
        shown=("here's my rewrite",),
    ),
    named_rule("an editorial bracket", r"\[[^\]]*\]", shown=("[a note in brackets]",)),
    named_rule("the model naming itself", r"\bas an? (?:AI|language model|assistant)\b", shown=("as an AI",)),
    # The capsule speaks as "we" (our board, our projection); a single writer's "I" is an aside
    # (phase D review L10: "I would still spend it elsewhere"). Case-sensitive, so "Week I" and a
    # name's "III" never match a lone "I".
    named_rule("the first person singular", r"(?<![\w'])I(?:'d|'m|'ll|'ve)?(?![\w'])", 0, shown=("I", "I'd", "I'm")),
    # And its other cases (fix round 2, N8: "gives me pause", "in my mind"); a name is masked first.
    named_rule(
        "the first person singular", r"\b(?:[Mm]e|[Mm]y|[Mm]ine|[Mm]yself)\b", 0, shown=("me", "my", "mine", "myself")
    ),
    # The writer's fact sheet is its own input, never the reader's (fix round 2, N13: "nothing on the
    # sheet says that changes"). The page shows numbers, not a sheet.
    named_rule(
        "the writer's sheet",
        r"\b(?:the|this|his|our) (?:fact |facts )?sheet\b|\bfacts? sheet\b",
        shown=("the sheet", "the fact sheet"),
    ),
)

# Betting words, named. Football's own senses (the offensive line, the line of scrimmage, the Las
# Vegas Raiders, spreading the ball) are not bets and pass.
BETTING_PATTERNS: Final = (
    named_rule("the books", r"\bthe books\b", shown=("the books",)),
    named_rule(
        "a sportsbook", r"\bsports ?books?\b|\b(?:book|odds)makers?\b", shown=("sportsbook", "bookmaker", "oddsmaker")
    ),
    named_rule("odds", r"\bodds\b", shown=("odds",)),
    named_rule(
        "a posted line",
        r"\bposted (?:him at|a line|his line|their line)\b|\b(?:prop|betting|player|season) lines?\b",
        shown=("posted a line", "a betting line", "a season line", "a player line"),
    ),
    named_rule(
        "the line as a bet",
        r"\bthe (?:posted |opening |closing )?line (?:on|for|at|sits|is set|was set|moved|opened|closed)\b",
        shown=("the line on him", "the line opened"),
    ),
    named_rule(
        "a line as a number",
        r"(?<!stat )(?<!offensive )(?<!defensive )\bline (?:is|was|of|at|sits at|sat at|set at|opened at|closed at)"
        r" (?:about |around |roughly )?[0-9]",
        shown=("a line of 8.5",),
    ),
    named_rule(
        "over or under as a bet",
        r"\bthe (?:over|under)\b(?!-)|\bover/under\b|\bo/u\b|\b(?:over|under) [0-9]+\.5\b",
        shown=("the over", "the under", "over/under", "over 8.5"),
    ),
    named_rule("a win total", r"\bwin totals?\b", shown=("win total",)),
    named_rule("a prop", r"\bprops?\b", shown=("prop",)),
    named_rule("a spread", r"\bpoint spread\b|\bthe spread\b", shown=("the spread", "point spread")),
    # The club's city is masked before any rule reads the text (`CLUB_SPELLINGS`), so "Las Vegas" is a
    # name and every other "Vegas" the bettor's.
    named_rule("Vegas as a bettor", r"\bvegas\b", shown=("Vegas",)),
    named_rule(
        "a bet",
        r"\bbet(?:s|ting|tor|tors)?\b|\bwagers?\b|\bparlays?\b|\bmoneylines?\b|\bvig\b",
        # "A safe bet" and "a better bet" (Lane 50's samples) are the word itself.
        shown=("bet", "a safe bet", "betting", "bettor", "wager", "parlay", "moneyline", "vig"),
    ),
    named_rule("an implied total", r"\bimplied (?:team )?totals?\b", shown=("implied total",)),
)

# THE SITE'S ONE LIST (`capsules.site_words`, the file the site's copy guard reads): every word and mark
# the site never prints, refused in every new write (`writer_only_hits`), so prose that passes the writer
# passes the site. A stored page is not refused for it at the gate: measured on the dev store of
# 2026-10-14, 244 of 621 written pages carry one ("total" 102, "line" 94), and failing them in one night
# would put the board past its unwritten line; each is rewritten when his facts next move.
SITE_WORDS: Final = NamedPattern("the site's list", SITE_PATTERN, SITE_SHOWN)
# The marks the copy rules already name on their own (`validate._copy_violations`).
_MARKS_RULED: Final = frozenset({EM_DASH, SEMICOLON})

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
    # The live review of 2026-10-15 (H3, L5): on eight public pages.
    "cash in",
    "asset",
    "investment",
    "invest",
    "money",
    "paid",
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
        "cash in": ("draft him", "start him"),
        "asset": ("a starter", "a pick"),
        "investment": ("a pick", "where drafters take him"),
        "invest": ("draft him", "take him at that pick"),
        "money": ("a pick", "where drafters take him"),
        "paid": ("drafted him", "took him at that pick"),
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
        "fade": ("sit him", "drop him"),
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
        "cash in": ("start him", "hold him"),
        "asset": ("a starter", "a bench piece", "a roster spot"),
        "investment": ("a roster spot", "where he went before the season"),
        "invest": ("hold him", "add him"),
        "money": ("where he went before the season", "a roster spot"),
        "paid": ("where drafters took him", "drafted"),
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
# sense is banned: fading him, "a fade" as a verdict (Lane 29: "a fade everyone hoped would bounce
# back"), selling, buying him. A phrase with its inflections ("cashed in") is read the same way.
_FOOTBALL_SENSES: Final = MappingProxyType(
    {
        "fade": r"\bfad(?:e|es|ed|ing) (?:him|them|this|that|the)\b(?! route)"
        r"|(?<!on )(?<!caught )(?<!threw )(?<!ran )(?<!run )(?<!won )\ba fade\b"
        # Only a football place makes it a route ("a fade to the corner", "a fade in the end zone");
        # "a fade for me" and "a fade in every league" are the verdict.
        r"(?! route| pattern| (?:in|into|to|toward|down|up|along|near|at) the (?:end zone|corner|sideline|back|pylon)\b)",
        "cash in": r"\bcash(?:es|ed|ing)? (?:in|out)\b",
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


# The banned vocabulary as the validator refuses it (`validate.banned_term_in`): a site word it already
# refuses is not refused twice (review 81 finding 5: "His price is high." took two corrections).
_VOCABULARY_PATTERNS: Final = tuple(banned_term_pattern(term) for term in BANNED_VOCABULARY)

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


# Every club's city and nickname, alone and together (`facts.team_names`): names the writer may always
# use, masked as ledger names are, the way the site skips a club's city and nickname as data (review 81
# finding 9: "the Las Vegas Raiders" is a club, never the bettor's Vegas).
CLUB_SPELLINGS: Final = tuple(
    dict.fromkeys(form for city, nickname in NFL_TEAM_NAMES.values() for form in (f"{city} {nickname}", city, nickname))
)


def mask_names(text: str, names: Sequence[str]) -> str:
    """`text` with every proper name in `names` (a capitalised ledger entry) and every club spelling
    masked, so a player called Price or Bet, or the Las Vegas Raiders, never reads as a banned word.
    Matched whole and case-sensitively, each accent written or not (`names.name_pattern`)."""
    every = dict.fromkeys((*names, *CLUB_SPELLINGS))
    for name in sorted((n for n in every if n[:1].isupper()), key=len, reverse=True):
        text = re.sub(rf"(?<![^\W\d_]){name_pattern(name)}(?![^\W\d_])", "Him", text)
    return text


def voice_rule_hits(text: str, names: Sequence[str]) -> list[VoiceRuleHit]:
    """Every set phrase, aside and betting word in `text`, in rule order. Empty is clean. The
    validator reads these as sentence rewrites; trading words it reads as banned terms, with the
    drafting phrase to use (`validate.py`)."""
    normalised = _normalise_apostrophes(mask_names(text, names))
    hits = [VoiceRuleHit("set phrase", p.name) for p in _SET_PHRASE_PATTERNS if p.pattern.search(normalised)]
    honest = HONEST_FRAME.pattern.search(normalised)
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


def _site_hit(normalised: str, hits: Sequence[VoiceRuleHit]) -> VoiceRuleHit | None:
    """The first word or mark of the site's list that no earlier rule has named, so one word is
    refused once: a voice rule's hit, a banned term the validator refuses on its own (the trading
    words), and the marks the copy rules name are theirs."""
    named = {hit.found.lower() for hit in hits}
    for match in SITE_WORDS.pattern.finditer(normalised):
        found = match.group(0)
        if found.lower() in named or found in _MARKS_RULED:
            continue
        if any(pattern.fullmatch(found) for pattern in _VOCABULARY_PATTERNS):
            continue
        return VoiceRuleHit(f"site word ({SITE_WORDS.name})", found)
    return None


_WRITER_ONLY_PATTERNS: Final = tuple(
    NamedPattern(phrase, phrase_pattern(phrase)) for phrase in CAPSULE_CONFIG.repetition.validator_only_stems
)


def writer_only_hits(text: str, names: Sequence[str]) -> list[VoiceRuleHit]:
    """What binds new writes only: the worn phrases (`Repetition.validator_only_stems`, non-stat phrases
    only: a sentence restating a number the sheet prints is a stat sentence, never a worn stem), which
    the validator refuses as set phrases, each hit as written, so the correction names its sentence;
    and the first word of the site's list no other rule names (`SITE_WORDS`). The page gate
    (`gate_hits`) never reads them on a stored page."""
    normalised = _normalise_apostrophes(mask_names(text, names))
    matches = (p.pattern.search(normalised) for p in _WRITER_ONLY_PATTERNS)
    worn = [VoiceRuleHit("set phrase", match.group(0)) for match in matches if match is not None]
    site = _site_hit(normalised, voice_rule_hits(text, names))
    return worn if site is None else [*worn, site]


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
