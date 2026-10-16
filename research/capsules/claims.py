"""THE CLAIMS A READ MAKES AGAINST THE PAGE'S OWN FACTS (Lane 29, the live review of 2026-10-15, H2 and
M5): each sentence the review found contradicting the page it sat on, made a rule.

- **Scoring** (De'Von Achane, 0 touchdowns in 3 games: "Bobby Slowik is funneling him scores", "the
  worry under the touchdowns"). In season, a sentence about this season that speaks of touchdowns,
  scores, the end zone or the goal line as a positive needs a touchdown on the sheet's totals for
  this season. "Zero touchdowns", "has not found the end zone" and a sentence about an earlier
  season pass.
- **The opener** (Achane: "the 2026 season to open with 1.7 points in week 3", when week 1 was
  10.6). "Opened" means week 1 or his first game: a week the sentence names must be one of those,
  and a points figure with no week must be his first game's.
- **ADP against our number** (Justin Jefferson: "The 8.8 ADP ... is above our 11.7", the page
  printing our pick 11 and ADP 11.7). A figure called ours may not be his ADP, and a comparison of
  the two must run the page's way: "above", "ahead of", "earlier than" and "before" mean the earlier
  pick, the smaller number; "below", "behind", "later than" and "after" the later one.
- **A round from an ADP** (Troy Franklin: "seventh round money at ADP 177.1"). A round named beside
  his ADP is the ADP over the board's teams, rounded up (177.1 is round 15 at twelve teams).
- **A missing ADP** (M5: "no ADP on file, which tells you nobody spent a pick"). No ADP means we have
  no ADP, nothing more: no sentence concludes that nobody drafted him.

Each violation names its rule before a colon, so a test, a correction and an operator read the same
words; every one is handed back as a sentence correction (`corrections`).
"""

import math
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Final

from research.capsules.pull_figures import renderings_of
from research.capsules.season_voice import SeasonClock, clock_of, week_references
from research.capsules.sentences import split_sentences
from research.nightly.config import TEAMS

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

SCORING_CLAIM: Final = "unbacked scoring claim"
OPENER_CLAIM: Final = "the wrong opening week"
ADP_SWAPPED: Final = "our number and his ADP swapped"
ADP_REVERSED: Final = "an ADP comparison the wrong way round"
ROUND_CLAIM: Final = "a round his ADP does not make"
NO_ADP_CLAIM: Final = "a claim about drafters from a missing ADP"
CLAIM_RULES: Final = (SCORING_CLAIM, OPENER_CLAIM, ADP_SWAPPED, ADP_REVERSED, ROUND_CLAIM, NO_ADP_CLAIM)


@dataclass(frozen=True, slots=True)
class ClaimLedger:
    """What a read's claims are checked against: the run's day, this season's touchdowns (None when
    the sheet prints none), his first game this season as (week, points), the page's ADP and our
    overall rank, and the board's teams."""

    clock: SeasonClock
    touchdowns: float | None = None
    first_game: tuple[int, float | None] | None = None
    adp: float | None = None
    board_rank: int | None = None
    teams: int = TEAMS


def claims_of(facts: "PlayerFacts") -> ClaimLedger:
    season = facts.season
    first = None if season is None else next(((w.week, w.points) for w in season.weeks if w.status == "played"), None)
    return ClaimLedger(
        clock_of(facts),
        None if season is None else season.totals.touchdowns,
        first,
        facts.market.adp,
        facts.market.board_rank,
    )


_YEAR: Final = re.compile(r"\b((?:19|20)\d\d)\b")
_EARLIER_SEASON: Final = re.compile(
    r"\blast (?:season|year)\b|\ba year ago\b|\bin his career\b|\bcareer\b|\bas a rookie\b|\bin college\b",
    re.IGNORECASE,
)


def _about_earlier_season(sentence: str, season: int) -> bool:
    """The sentence speaks of an earlier season and not of this one."""
    years = {int(year) for year in _YEAR.findall(sentence)}
    names_this = season in years or re.search(r"\bthis (?:season|year)\b|\bso far\b", sentence, re.IGNORECASE)
    return not names_this and (any(year < season for year in years) or _EARLIER_SEASON.search(sentence) is not None)


# A clause of a sentence: a claim is read with the season and the figures its own clause names.
_CLAUSE: Final = re.compile(r"[,;:]|\bbut\b", re.IGNORECASE)


def _clauses(sentence: str) -> list[str]:
    return [clause for clause in _CLAUSE.split(sentence) if clause.strip()]


# SCORING: an assertion that he is getting scores, never touchdowns as a factor ("a 1.1x touchdown share
# costs him 0.7 a game", "until the touchdowns show up", read 47 times on the live board): a verb of
# getting or finding them, or a phrase that presumes them ("the worry under the touchdowns").
_SCORING: Final = re.compile(
    r"\b(?:funnel\w*|feed(?:s|ing)?|fed|giv(?:es|ing)|gave|hand(?:s|ed|ing)|throw(?:s|ing|n)?|threw|get(?:s|ting)?|got|"
    r"find(?:s|ing)?|found|scor(?:es|ing|ed)|(?:pil|rack)(?:es|ed|ing|s)? up)\s+"
    r"(?:him\s+|his\s+|the\s+|a\s+|those\s+)?(?:\w+\s+)?(?:scores|touchdowns?|TDs?|end zone)\b"
    # Touchdown points or a touchdown share are a quantity, never a claim he is scoring.
    r"(?![\s-]+(?:points|share|rate)\b)"
    r"|\b(?:under|behind|beneath|despite|beyond|besides|on top of)\s+(?:all\s+)?(?:the|those|his)\s+(?:touchdowns|scores)\b"
    # Touchdowns as the subject of a verb that has them happen ("his touchdowns carried him", "the
    # touchdowns came in bunches"); "the touchdowns have not come" names none.
    r"|\b(?:the|those|his)\s+(?:touchdowns|scores)\s+(?:carr(?:y|ies|ied)|came|come|kept|keep|keeps|piled|made|"
    r"make|makes|saved|propped|drove|drive|drives|are coming|kept coming|keep coming)\b",
    re.IGNORECASE,
)
# A statement of none, or one still to come, read in the verb phrase only: "has not found the end
# zone", "anyone is throwing him scores", "can find the end zone". "There is no doubt Slowik is feeding
# him scores" is a claim: its "no" is four words before the verb.
_NONE_BEFORE: Final = re.compile(
    r"(?:\b(?:zero|no|0|none|without|not|never|nobody|no one|anyone|yet to|lacks?|lacking|missing|needs?|would|"
    r"could|might|may|can|to)|n't)\b(?:\W+\w+){0,2}\W*$",
    re.IGNORECASE,
)
# A wait earlier in the clause makes it a condition ("bench him until he is back at full practice and
# scores his first touchdown"), unless a new subject takes over after it ("when it gets close and Slowik
# keeps feeding him touchdowns").
_CONDITION: Final = re.compile(r"\b(?:until|once|unless|if|when|before|wait(?:ing)? for)\b", re.IGNORECASE)
_NEW_SUBJECT: Final = re.compile(r"\band\s+(?:[A-Z][a-z]+|he|she|it|they|we)\b")
_NONE_AFTER: Final = re.compile(
    r"^\W*(?:\w+\W+){0,3}?(?:have not|haven't|has not|hasn't|never|are missing|is missing|yet to|at zero)\b",
    re.IGNORECASE,
)


def _a_condition(before: str) -> bool:
    conditions = list(_CONDITION.finditer(before))
    return bool(conditions) and _NEW_SUBJECT.search(before[conditions[-1].end() :]) is None


def _asserted(clause: str) -> list[str]:
    """The scoring claims a clause asserts: never negated, never a condition."""
    found = []
    for match in _SCORING.finditer(clause):
        before = clause[: match.start()]
        if _NONE_BEFORE.search(before) or _a_condition(before) or _NONE_AFTER.match(clause[match.end() :]):
            continue
        found.append(match.group(0))
    return found


def _names_a_week_this_season(clause: str, season: int) -> bool:
    return any(r.season in (None, season) for r in week_references(clause))


def _scoring_claims(sentence: str, ledger: ClaimLedger) -> list[str]:
    """A claim he is scoring needs this season's touchdowns; a claim tied to a named week cannot be
    backed at all, because the sheet prints touchdowns for the season, never by week."""
    season = ledger.clock.season
    for clause in _clauses(sentence):
        if _about_earlier_season(clause, season):
            continue
        claims = _asserted(clause)
        if not claims:
            continue
        if _names_a_week_this_season(clause, season):
            return [
                f'{SCORING_CLAIM}: "{claims[0]}" in the sentence "{sentence}" is tied to a week, and our numbers '
                "carry his touchdowns for the season only. Say the season's total, or leave scoring out."
            ]
        if (ledger.touchdowns or 0) <= 0:
            held = "no touchdown" if ledger.touchdowns == 0 else "no touchdown figure"
            return [
                f'{SCORING_CLAIM}: "{claims[0]}" in the sentence "{sentence}", and this season\'s totals show {held} '
                "for him. Say what he has scored as the totals print it, or leave scoring out."
            ]
    return []


# THE OPENER.
_OPENER: Final = re.compile(
    r"\bopen(?:ed|s|ing)?\s+(?:the\s+|his\s+|its\s+)?(?:\d{4}\s+)?(?:season|year|campaign)\b"
    r"|\b(?:season|year|campaign)\s+(?:to\s+)?open(?:ed|s)?\b|\b(?:season|year)[- ]opener\b|\bopened\s+with\b"
    r"|\bto\s+open\s+(?:the\s+)?(?:\d{4}\s+)?(?:season|year)\b",
    re.IGNORECASE,
)
# "Before the season opened" is the preseason, never a claim about the opener.
_BEFORE_OPENER: Final = re.compile(r"\bbefore\s+(?:the\s+|his\s+)?(?:\d{4}\s+)?$", re.IGNORECASE)
# Two points figures this close are the same figure, rounded.
_SAME_POINTS: Final = 0.05
_POINTS: Final = re.compile(
    r"\b(\d+(?:\.\d+)?)(?:-point|\s+(?:fantasy\s+)?points?\b)(?!\s+(?:a|per)\s+game)", re.IGNORECASE
)


def _opener_wrong(clause: str, ledger: ClaimLedger) -> bool:
    """The clause calls a week the opener that was not week 1 or his first game, or gives the opener
    points his first game did not score."""
    opener = None if ledger.first_game is None else _OPENER.search(clause)
    if ledger.first_game is None or opener is None or _BEFORE_OPENER.search(clause[: opener.start()]):
        return False
    week, points = ledger.first_game
    # The week the opener names follows it ("to open with 1.7 points in week 3"); a week before it in the
    # clause is another week ("a zero in week 4 after the 10.6 in the season opener").
    after = clause[opener.start() :]
    named = [w for r in week_references(after) if r.season in (None, ledger.clock.season) for w in r.weeks]
    if named:
        return any(w not in {1, week} for w in named)
    figures = [float(m.group(1)) for m in _POINTS.finditer(clause)]
    return (
        points is not None
        and bool(figures)
        and not any(f"{f:g}" in renderings_of(points) or abs(f - points) < _SAME_POINTS for f in figures)
    )


def _opener_claims(sentence: str, ledger: ClaimLedger) -> list[str]:
    if ledger.first_game is None or not any(_opener_wrong(clause, ledger) for clause in _clauses(sentence)):
        return []
    week, points = ledger.first_game
    first = "with no points figure" if points is None else f"{points:g} points"
    return [
        f'{OPENER_CLAIM}: the sentence "{sentence}" says the season opened with a week that was not his first. '
        f"His first game was week {week} of {ledger.clock.season}, {first}. Say that, or do not call it the opener."
    ]


# ADP AGAINST OUR NUMBER.
_FIGURE: Final = r"(\d+(?:\.\d+)?)"
# A four-digit year before "ADP" is its season ("his 2026 ADP of 11.7"), never the figure.
_ADP_FIGURE: Final = re.compile(
    rf"(?<![\d.])(?!(?:19|20)\d\d\b){_FIGURE}\s+ADP\b|\bADP(?:\s+(?:of|is|at|was|sits at|before the season))*\s+{_FIGURE}"
)
_NOT_A_PICK: Final = r"(?!\s*(?:points?|pts|a game|per game|%|-point|games?)\b)(?!\d|\.\d)"
_OUR_FIGURE: Final = re.compile(
    rf"\bour(?:\s+own)?(?:\s+(?:board's\s+)?(?:number|rank|pick|board|spot|slot))?(?:\s+(?:of|at|is))?\s+(?:pick\s+|No\.\s*)?{_FIGURE}{_NOT_A_PICK}"
    rf"|\bwe (?:have|had|rank|ranked|put|slot) him (?:at\s+)?(?:pick\s+|No\.\s*)?{_FIGURE}{_NOT_A_PICK}",
    re.IGNORECASE,
)
# A comparison counts only beside the second figure ("is above our 11", "ahead of his 11.7 ADP"): at
# most two words between the word and the figure. "Before" and "after" in their time sense ("ADP 11.7
# before the season, and we have him at pick 11") are not pick order.
_COMPARISON: Final = re.compile(
    r"\b(?:(?P<earlier>above|ahead of|earlier than|before|higher than|sooner than)"
    r"|(?P<later>below|behind|later than|after|lower than))"
    r"(?!\s+(?:the\s+)?(?:season|week\s+\d|opener|camp|draft)\b)(?P<gap>(?:\s+\w+){0,2}?)\s*$",
    re.IGNORECASE,
)


def _first(match: re.Match[str]) -> float:
    return float(next(group for group in match.groups() if group is not None))


def _adp_comparison_claims(sentence: str, ledger: ClaimLedger) -> list[str]:
    adp_match, our_match = _ADP_FIGURE.search(sentence), _OUR_FIGURE.search(sentence)
    if our_match is None:
        return []
    ours = _first(our_match)
    found = []
    adp_renderings = [] if ledger.adp is None else renderings_of(ledger.adp)
    if f"{ours:g}" in adp_renderings and ours != ledger.board_rank:
        found.append(
            f'{ADP_SWAPPED}: the sentence "{sentence}" calls {ours:g} ours, and {ours:g} is his ADP. Our pick for him is '
            f"{ledger.board_rank if ledger.board_rank is not None else 'not on the page'}."
        )
    if adp_match is None or ledger.adp is None or ledger.board_rank is None or ledger.adp == ledger.board_rank:
        return found
    between = sentence[min(adp_match.end(), our_match.end()) : max(adp_match.start(), our_match.start())]
    comparison = _COMPARISON.search(between)
    if comparison is None:
        return found
    says_earlier = comparison.group("earlier") is not None
    adp_first = adp_match.start() < our_match.start()
    first, second = (ledger.adp, ledger.board_rank) if adp_first else (ledger.board_rank, ledger.adp)
    if (first < second) != says_earlier:
        found.append(
            f'{ADP_REVERSED}: the sentence "{sentence}" has it the wrong way round. His ADP is '
            f"{' or '.join(adp_renderings)} and we have him at pick {ledger.board_rank}, so drafters took him "
            f"{'later' if ledger.adp > ledger.board_rank else 'earlier'} than we would. Say it that way."
        )
    return found


# A ROUND NAMED FROM AN ADP.
_ORDINALS: Final = [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "eleventh",
    "twelfth",
    "thirteenth",
    "fourteenth",
    "fifteenth",
    "sixteenth",
    "seventeenth",
    "eighteenth",
    "nineteenth",
    "twentieth",
]
_CARDINALS: Final = [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
]
_ROUND: Final = re.compile(
    rf"\b(?P<ordinal>{'|'.join(_ORDINALS)}|\d{{1,2}}(?:st|nd|rd|th))[- ]round\b"
    rf"|\bround\s+(?P<number>\d{{1,2}}|{'|'.join(_CARDINALS)})\b",
    re.IGNORECASE,
)
_ADP_TALK: Final = re.compile(r"\bADP\b|\bdrafters?\b|\bwhere he went\b", re.IGNORECASE)
_NFL_DRAFT: Final = re.compile(r"\bNFL draft\b|\b(?:19|20)\d\d draft\b|\bdrafted in (?:19|20)\d\d\b|\bby [A-Z]{2,3}\b")
_NFL_ROUND_AFTER: Final = re.compile(
    r"^\s*(?:rookie|pick in|selection|choice|draft pick|talent|type)\b|^\s*pick\s+(?:in|out of|by)\b", re.IGNORECASE
)


def _round_number(match: re.Match[str]) -> int:
    word = (match.group("ordinal") or match.group("number")).lower()
    if word in _ORDINALS:
        return _ORDINALS.index(word) + 1
    if word in _CARDINALS:
        return _CARDINALS.index(word) + 1
    return int(re.sub(r"\D", "", word))


def _adp_rounds(clause: str) -> list[re.Match[str]]:
    """The rounds a clause names beside his ADP: not an NFL draft's ("a fifth-round rookie", "a
    sixth-round pick in 2025", read on ten live pages with no ADP)."""
    if _ADP_TALK.search(clause) is None or _NFL_DRAFT.search(clause):
        return []
    return [match for match in _ROUND.finditer(clause) if not _NFL_ROUND_AFTER.match(clause[match.end() :])]


def _round_claims(sentence: str, ledger: ClaimLedger) -> list[str]:
    rounds = [match for clause in _clauses(sentence) for match in _adp_rounds(clause)]
    if not rounds:
        return []
    if ledger.adp is None:
        return [f'{ROUND_CLAIM}: the sentence "{sentence}" names a round, and the page has no ADP for him. Name none.']
    expected = math.ceil(ledger.adp / ledger.teams)
    named = [_round_number(match) for match in rounds]
    if all(number == expected for number in named):
        return []
    return [
        f'{ROUND_CLAIM}: the sentence "{sentence}" names round {named[0]}. His ADP of '
        f"{' or '.join(renderings_of(ledger.adp))} is round {expected} of a {ledger.teams}-team draft. Say round "
        f"{expected}, or name no round."
    ]


# A MISSING ADP.
_NOBODY_DRAFTED: Final = re.compile(
    r"\b(?:nobody|no one|no league|no drafters?|no managers?)\b[^.]{0,40}?\b(?:draft(?:ed|ing|s)?|spent|spend(?:ing|s)?|"
    r"(?:took|taken|picked|selected|wanted)\s+(?:him|them|a pick|a flier))\b"
    r"|\bdrafters?\b[^.]{0,30}?\b(?:never|did not|didn't|passed|ignored|skipped|wanted no)\b"
    r"|\bundrafted in (?:fantasy|drafts|leagues|most leagues)\b",
    re.IGNORECASE,
)
# The claims this rule refuses as the writer's prompt names them (`prompt`), each held to the rule by a
# test: the shapes that ended Lane 50's sample pages in a facts block.
NO_ADP_EXAMPLES: Final = (
    "nobody drafted him",
    "no one spent a pick on him",
    "drafters passed on him",
    "undrafted in most leagues",
)
_NFL_CONTEXT: Final = re.compile(r"\bcollege\b|\bNFL\b|\bout of\b|\bfree agent\b|\bno team\b", re.IGNORECASE)


def _missing_adp_claims(sentence: str, ledger: ClaimLedger) -> list[str]:
    """Only a page with no ADP: with one, "where drafters took him" is the in-season ADP sentence itself."""
    if ledger.adp is not None:
        return []
    match = _NOBODY_DRAFTED.search(sentence)
    if match is None or _NFL_CONTEXT.search(sentence):
        return []
    return [
        f'{NO_ADP_CLAIM}: the sentence "{sentence}" says "{match.group(0)}". The page has no ADP for him, which '
        "means only that our sources have none, and that says nothing about who drafted him. Leave drafters out of it."
    ]


def claim_violations(text: str, ledger: ClaimLedger) -> list[str]:
    """Every claim in `text` its page's facts contradict, sentence by sentence, each named by its rule."""
    found: list[str] = []
    for sentence in split_sentences(text):
        found += _adp_comparison_claims(sentence, ledger)
        found += _round_claims(sentence, ledger)
        found += _missing_adp_claims(sentence, ledger)
        if ledger.clock.in_season and not _about_earlier_season(sentence, ledger.clock.season):
            found += _scoring_claims(sentence, ledger)
            found += _opener_claims(sentence, ledger)
    return found
