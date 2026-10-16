"""THE TIME FRAME A CAPSULE IS HELD TO: the floor under the writer for the run's day.

UX review H2 (2026-10-14): capsules written for a September drafter were served on an October page
("needs to be back on the field by October", "that 5.2 in week 7" meaning 2025 under a 2026 page,
"we expect 15 games this year" under two "Did not play" rows). The voice is chosen by the date, not
a flag: a sheet carries this season so far once the season's first kickoff has passed
(`facts.season_so_far`), and that is what puts a capsule in season. The rules:

- Every week a capsule names carries its season ("week 7 of 2025", "weeks 2 and 3 of 2026", "2025's
  week 7"), in either voice.
- In season, a week of this season still to play is only looked ahead to: never a score in it,
  never a past-tense verb told of it.
- In season, nothing speaks to a draft still ahead ("draft him", "take him at his ADP", "on draft
  day", a round or pick to spend), and nothing about this season is placed by a month ("by
  October"): weeks place it. A month in a sentence about an earlier season is history and passes.
- In season, a long note for a player who has missed weeks this season names them (by week, or by
  their count with a word for missing them).

`time_frame_hits` is the validator's and the page gate's reading; each hit names its rule.
"""

import re
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Final

from research.capsules.render_season import week_list
from research.capsules.sentences import split_sentences
from research.capsules.voice_rules import NamedPattern, VoiceRuleHit, named_rule

if TYPE_CHECKING:
    from research.capsules.facts.build import PlayerFacts

_NUMBER_WORDS: Final = (
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
    "sixteen",
    "seventeen",
    "eighteen",
)
# The longer words first, so "fourteen" is never read as "four" (an alternation takes its first match).
_WEEK_NUMBER: Final = rf"(?:\d{{1,2}}|{'|'.join(sorted(_NUMBER_WORDS, key=len, reverse=True))})"
_JOINER: Final = r"\s*(?:,|and|or|to|through|-)\s*(?:weeks?\s+)?"
# "week 7", "weeks 2, 3 and 5", "weeks 15 to 17": one reference, its numbers captured whole.
_WEEK_REFERENCE: Final = re.compile(
    rf"\bweeks?\s+(?P<weeks>{_WEEK_NUMBER}(?:{_JOINER}{_WEEK_NUMBER})*)\b", re.IGNORECASE | re.ASCII
)
_SEASON_AFTER: Final = re.compile(r"^\s*(?:of|in|,)\s*(?:the\s+)?(?P<season>(?:19|20)\d\d)\b", re.ASCII)
_SEASON_BEFORE: Final = re.compile(r"\b(?P<season>(?:19|20)\d\d)(?:'s|,)?\s+$", re.ASCII)
_SCORE_BEFORE: Final = re.compile(
    r"\d+(?:\.\d+)?\s*(?:fantasy\s+)?(?:points?|pts)?\s+(?:in|during|from|on)\s+(?:his\s+)?$", re.IGNORECASE
)
# A score said of a week ahead as a need or a hope ("he needs 15 points in week 7 of 2026") looks
# ahead; the cue sits just before the score.
# How far before a week reference a score is read as told of that week.
_SCORE_WINDOW: Final = 60
_FORWARD_CUE: Final = re.compile(
    r"\b(?:needs?|wants?|would|could|should|can|will|might|must)\s+(?:\w+\s+){0,2}$", re.IGNORECASE
)
_PAST_AFTER: Final = re.compile(
    r"^\s*,?\s*(?:when\s+|where\s+)?(?:he\s+)?(?:scored|had|was|went|missed|played|caught|ran|posted|finished|sat|"
    r"put up|managed|logged|dropped)\b",
    re.IGNORECASE,
)
_MISSED_WORDS: Final = re.compile(
    r"\b(?:miss(?:ed|ing)?|sat(?: out)?|did not play|didn't play|inactive|out for|without him|sidelined)\b",
    re.IGNORECASE,
)
MISSED_WEEKS_UNNAMED: Final = "The long note never names the weeks he has missed this season"
# A month places a capsule on a calendar a reader reads on another day (H2: "back by October"). "May"
# is a verb far more often than a month, and no season runs through it.
MONTHS: Final = named_rule(
    "time frame (a month)",
    r"\b(?:January|February|March|April|June|July|August|September|October|November|December|Sept?\.?|Oct\.|"
    r"Nov\.|Dec\.)(?![a-z])",
    0,
)
# How many characters may stand between a spend verb and the round pick it spends.
_SPEND_GAP: Final = 20
# What speaks to a draft that is still ahead: the in-season voice never does (H2).
DRAFT_VOICE_PATTERNS: Final = (
    named_rule("draft voice (draft him)", r"\bdraft(?:s|ing)? (?:him|them)\b"),
    named_rule("draft voice (draft day)", r"\bdraft day\b|\b(?:in|at|for|before) your draft\b"),
    named_rule("draft voice (when you draft)", r"\bwhen (?:you|you're|you are) (?:draft|on the clock)"),
    named_rule(
        "draft voice (a pick to spend)",
        r"\b(?:take|takes|taking|grab|grabbing|snag|snagging|select|target|targeting) (?:him|them) "
        r"(?:at|around|near|before(?! (?:the |your |your league's )?trade deadline)|after|ahead of|in the|"
        r"with your|over)\b",
    ),
    named_rule("draft voice (a round to spend)", r"\bin (?:the )?round (?:one|two|three|four|five|six|seven|\d+)\b"),
    named_rule(
        "draft voice (a round-pick to spend)",
        rf"\b(?:worth|spend|spending|use|using|burn|burning)\b[^.]{{0,{_SPEND_GAP}}}?\b(?:a|an|your)\s+[a-z0-9]+[- ]round "
        r"(?:pick|selection)\b",
    ),
    named_rule(
        "draft voice (let him fall)",
        r"\blet (?:him|them) (?:fall|slide)\b|\bwait on (?:him|them) (?:until|a round|in the)\b",
    ),
    named_rule("draft voice (reach for him)", r"\breach(?:ing)? for (?:him|them)\b"),
    # Drafters' history ("backs drafted at his ADP", "taken at his ADP") is past and passes.
    named_rule(
        "draft voice (at his ADP)",
        r"(?<!drafted )(?<!taken )(?<!picked )(?<!went )(?<!go )(?<!going )"
        r"\b(?:at|worth|below|above|past|before|after) (?:his|their|that) ADP\b",
    ),
    named_rule(
        "draft voice (rounds and picks ahead)",
        r"\b(?:a|one|two|three) rounds? (?:earlier|later|early|late|sooner)\b|\bpicks? (?:earlier|later|sooner)\b",
    ),
    named_rule(
        "draft voice (your early pick)",
        r"\byour (?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th))[- ]round (?:pick|selection)\b",
    ),
)


@dataclass(frozen=True, slots=True)
class SeasonClock:
    """What the time frame rules read from a sheet: the product season, and in season how far it has
    gone and the weeks he has played and missed. `through` None is the preseason voice."""

    season: int
    through: int | None = None
    played: tuple[int, ...] = ()
    missed: tuple[int, ...] = ()

    @property
    def in_season(self) -> bool:
        return self.through is not None


def clock_of(facts: "PlayerFacts") -> SeasonClock:
    season = facts.season
    if season is None:
        return SeasonClock(facts.product_season)
    played = tuple(w.week for w in season.weeks if w.status == "played")
    return SeasonClock(season.season, season.through, played, season.missed_weeks)


def _week_numbers(raw: str) -> tuple[int, ...]:
    words = {word: index + 1 for index, word in enumerate(_NUMBER_WORDS)}
    tokens = re.findall(rf"\b{_WEEK_NUMBER}\b", raw, re.IGNORECASE | re.ASCII)
    return tuple(int(token) if token.isdigit() else words[token.lower()] for token in tokens)


@dataclass(frozen=True, slots=True)
class WeekReference:
    text: str
    weeks: tuple[int, ...]
    season: int | None
    before: str
    after: str


def week_references(text: str) -> list[WeekReference]:
    """Every week the text names, with the season it names beside it (None when it names none)."""
    text = text.replace(chr(0x2019), "'").replace(chr(0x2013), "-")
    references = []
    for match in _WEEK_REFERENCE.finditer(text):
        before, after = text[: match.start()], text[match.end() :]
        tail, head = _SEASON_AFTER.match(after), _SEASON_BEFORE.search(before)
        named = tail or head
        season = None if named is None else int(named.group("season"))
        # What follows the reference is read past the season it names ("week 9 of 2026 he scored").
        rest = after if tail is None else after[tail.end() :]
        references.append(WeekReference(match.group(0), _week_numbers(match.group("weeks")), season, before, rest))
    return references


def _unplayed_told_as_past(reference: WeekReference, clock: SeasonClock) -> bool:
    if not clock.in_season or reference.season != clock.season or clock.through is None:
        return False
    ahead = [week for week in reference.weeks if week > clock.through and week not in clock.played]
    if not ahead:
        return False
    before = reference.before[-_SCORE_WINDOW:]
    score = _SCORE_BEFORE.search(before)
    told_as_past = score is not None and _FORWARD_CUE.search(before[: score.start()]) is None
    return told_as_past or _PAST_AFTER.match(reference.after) is not None


def _sentence_hits(sentence: str, clock: SeasonClock) -> list[VoiceRuleHit]:
    references = week_references(sentence)
    # A bare week beside a week this sentence dates takes that date ("27.7 in week 4 of 2026 and 37.7 in
    # week 5"): the season is not in doubt, so the rule (whose law is an unambiguous season) passes it.
    seasons = {r.season for r in references if r.season is not None}
    inherited = next(iter(seasons)) if len(seasons) == 1 else None
    references = [r if r.season is not None else replace(r, season=inherited) for r in references]
    hits = [VoiceRuleHit("time frame (a week without its season)", r.text) for r in references if r.season is None]
    hits += [
        VoiceRuleHit("time frame (a week still to play told as past)", r.text)
        for r in references
        if _unplayed_told_as_past(r, clock)
    ]
    if clock.in_season:
        hits += _month_hits(sentence, clock)
        hits += _draft_voice_hits(sentence, DRAFT_VOICE_PATTERNS)
        hits += [VoiceRuleHit(PER_GAME_AGAINST_SEASON.name, m.group(0)) for m in _per_game_against_season(sentence)]
    return [replace(hit, sentence=sentence) for hit in hits]


def time_frame_hits(text: str, clock: SeasonClock) -> list[VoiceRuleHit]:
    """Every time frame slip in `text` for a page on the clock's day, sentence by sentence, each hit
    carrying the sentence it stands in."""
    return [hit for sentence in split_sentences(text) for hit in _sentence_hits(sentence, clock)]


# In season, points a game set against our full-season number compare two different things (the
# live review of Lane 17, M7: "at 25.9 points a game he is tracking exactly where our 344-point
# projection wanted him"). A sentence carrying both is handed back.
# How many characters may stand between "our number" and the season figure it names.
_SEASON_FIGURE_GAP: Final = 30
PER_GAME_AGAINST_SEASON: Final = named_rule(
    "time frame (points a game against the season number)",
    r"\b(?P<a>\d{2,3}(?:\.\d)?)(?:-point| points?)\s+(?:preseason\s+)?(?:projection|number|preseason number)\b|"
    rf"\b(?:projection|preseason number|our number)\b[^.]{{0,{_SEASON_FIGURE_GAP}}}?\b(?P<b>\d{{2,3}}(?:\.\d)?)(?: points?)?\b",
)
# A points-a-game figure ("12.4 a game", "13 points per game"); "has not missed a game" is not one.
_PER_GAME: Final = re.compile(r"\b(?P<rate>\d+(?:\.\d+)?)\s*(?:points?\s+)?(?:a|per)\s+game\b", re.IGNORECASE)
# The games a sentence states: "15 games", "15 expected games", and (the coordinator's ruling for Lane 52)
# "over the 15 we expected" without the word; `_honest_rate` still holds the rate to them.
_GAMES: Final = re.compile(
    r"\b(\d{1,2})\s+(?:expected\s+)?games\b|\bover the (\d{1,2}) (?:games )?we expected\b", re.IGNORECASE
)
_FULL_SEASON_GAMES: Final = 17
_RATE_TOLERANCE: Final = 0.1


def _honest_rate(season_points: float, rate: float, sentence: str) -> bool:
    """The season number read as points a game over the games the sentence states (or a full
    season): the per-game reading the TIME rule asks for, not a comparison of unlike things."""
    games = [int(m.group(1) or m.group(2)) for m in _GAMES.finditer(sentence)] + [_FULL_SEASON_GAMES]
    return any(g > 0 and abs(season_points / g - rate) <= _RATE_TOLERANCE for g in games)


def _per_game_against_season(text: str) -> list[re.Match[str]]:
    found = []
    for sentence in split_sentences(text):
        match = PER_GAME_AGAINST_SEASON.pattern.search(sentence)
        rate = _PER_GAME.search(sentence)
        if match is None or rate is None:
            continue
        season_points = float(match.group("a") or match.group("b"))
        if not _honest_rate(season_points, float(rate.group("rate")), sentence):
            found.append(match)
    return found[:1]


_EARLIER_BESIDE: Final = re.compile(
    r"^\W{0,2}(?:of\s+|in\s+)?(?P<year>(?:19|20)\d\d)\b|^[\w-]*\s+\w+\s+last (?:season|year)\b|^[\w-]*\s+last (?:season|year)\b",
    re.IGNORECASE,
)
_DEADLINE_BEFORE: Final = re.compile(
    r"\b(?:by|until|till|before|into|through)\s+(?:early\s+|mid\s*-?\s*|late\s+)?$", re.IGNORECASE
)
_THIS_SEASON: Final = re.compile(r"\bthis (?:season|year|fall)\b", re.IGNORECASE)


def _month_is_history(sentence: str, month: re.Match[str], season: int) -> bool:
    """History only when an earlier season stands right beside the month ("October of 2025", "an
    early-October dud last season") and nothing in the sentence puts it on this season's calendar."""
    if _DEADLINE_BEFORE.search(sentence[: month.start()]) or _THIS_SEASON.search(sentence) or str(season) in sentence:
        return False
    beside = _EARLIER_BESIDE.search(sentence[month.end() :])
    return beside is not None and (beside.group("year") is None or int(beside.group("year")) < season)


def _month_hits(text: str, clock: SeasonClock) -> list[VoiceRuleHit]:
    """Every month that places something on this season's calendar."""
    hits = []
    for sentence in split_sentences(text):
        hits += [
            VoiceRuleHit(MONTHS.name, month.group(0))
            for month in MONTHS.pattern.finditer(sentence)
            if not _month_is_history(sentence, month, clock.season)
        ]
    return hits[:1]


def _draft_voice_hits(text: str, rules: tuple[NamedPattern, ...]) -> list[VoiceRuleHit]:
    return [VoiceRuleHit(rule.name, match.group(0)) for rule in rules if (match := rule.pattern.search(text))]


def names_missed_weeks(text: str, clock: SeasonClock) -> bool:
    """A long note in season names the weeks he has missed this season: one of them by week and
    season, or their count beside a word for missing them. True when he has missed none."""
    if not clock.in_season or not clock.missed:
        return True
    missed = set(clock.missed)
    if any(r.season == clock.season and missed & set(r.weeks) for r in week_references(text)):
        return True
    count = len(clock.missed)
    count_words = {str(count), _NUMBER_WORDS[count - 1] if count <= len(_NUMBER_WORDS) else str(count)}
    return any(
        _MISSED_WORDS.search(sentence)
        and any(re.search(rf"\b{word}\b", sentence, re.IGNORECASE) for word in count_words)
        for sentence in split_sentences(text)
    )


def missed_weeks_violation(clock: SeasonClock) -> str:
    return (
        f"{MISSED_WEEKS_UNNAMED}: he did not play {week_list(clock.missed, clock.season)}. Name them, by week and "
        "season, in one sentence of your own before any talk of how many games to expect."
    )
