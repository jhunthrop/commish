"""THE ANGLE CANDIDATES (Lane 300): every fact about one player's week the angles step can choose from.

Each candidate is a measure (the number it is ranked on against his position's peers), the sentence the sheet
states it in, the figures that sentence prints (the read may quote them, `cells.quotable_figures`), the names
it prints, and its basis: the games and the count the figure was taken over. Every figure is a ratio of two
sums over the same weeks (`usage_reads`), never an average of weekly shares, and printed as a whole percent.

Candidates the store cannot back are not built (Lane 300 report): routes run (no route counts are stored),
the opponent's points allowed to his role (slot or outside, pass-catching backs; the store splits allowances by
position only), and the rest.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final

from research.capsules.facts.team_names import NFL_TEAM_NAMES
from research.capsules.page_figures import page_tenth, page_tenth_text
from research.capsules.week.usage_reads import UsageWeek
from research.model.jsmath import js_round
from research.pipeline.jscompat import js_string

# His newest games, the window a trend is read over (the brief: his last three games).
RECENT_GAMES: Final = 3
# A trend needs this many of his games before the window, so "before" is more than one game's noise.
BEFORE_GAMES: Final = 2
# The spread needs this many games and this many points a game: under them a range is a game or two of noise.
SPREAD_GAMES: Final = 4
SPREAD_MIN_POINTS: Final = 5.0
# A return is a stretch of missed games just before at most this many games back, with this many before it.
RETURN_GAMES_BACK: Final = 3
RETURN_GAMES_BEFORE: Final = 2

PASS_CATCHERS: Final = frozenset({"RB", "WR", "TE"})
RECEIVERS: Final = frozenset({"WR", "TE"})
RUNNERS: Final = frozenset({"RB"})
# A quarterback's carries are his own angle (a running quarterback), and no back's vacated work.
CARRIERS: Final = frozenset({"QB", "RB"})
POSITION_WORDS: Final = {"QB": "quarterbacks", "RB": "running backs", "WR": "wide receivers", "TE": "tight ends"}

# The basis units the thin rule reads (`angles.THIN_FLOORS`).
SNAPS: Final = "snaps"
TARGETS: Final = "targets"
CARRIES: Final = "carries"
RED_ZONE: Final = "red-zone carries and targets"
GAMES: Final = "games"


@dataclass(frozen=True, slots=True)
class Basis:
    """What a figure was taken over: his games and the denominator's count in its unit."""

    games: int
    count: float
    unit: str


@dataclass(frozen=True, slots=True)
class Candidate:
    """One fact about his week before it is ranked: `measure` against his position's peers (None for a
    candidate scored on its own, `fixed`), the sentence, its figures and names, and its basis. `ends` asks the
    ranking pass to add his place among his peers in words, from the nearer end ("the 2nd-highest among the
    receivers we rank"), so the sentence carries one figure, not two."""

    key: str
    family: str
    measure: float | None
    text: str
    figures: tuple[float, ...]
    basis: Basis
    names: tuple[str, ...] = ()
    fixed: float | None = None
    ends: tuple[str, str] | None = None


# The words for a level's ends, the high one first.
HIGH_LOW: Final = ("highest", "lowest")
DEEP_SHORT: Final = ("deepest", "shortest")


def club_possessive(code: str | None) -> str:
    """ "the Rams'": his club by its nickname, possessive."""
    names = NFL_TEAM_NAMES.get(code or "")
    if names is None:
        return "his club's"
    return f"the {names[1]}'"


def percent(share: float) -> float:
    """A share as the whole percent the sheet prints."""
    return js_round(100 * share)


def percent_text(share: float) -> str:
    return f"{js_string(percent(share))}%"


Pick = Callable[[UsageWeek], tuple[float | None, float | None]]


def share_of(weeks: Sequence[UsageWeek], pick: Pick) -> tuple[float, float] | None:
    """(his sum, his club's sum) over the weeks both are held, None when the club's is none."""
    own = club = 0.0
    for week in weeks:
        mine, theirs = pick(week)
        if mine is None or theirs is None:
            continue
        own, club = own + mine, club + theirs
    return None if club <= 0 else (own, club)


def _snaps(w: UsageWeek) -> tuple[float | None, float | None]:
    return w.snaps, w.team_snaps


def _targets(w: UsageWeek) -> tuple[float | None, float | None]:
    return w.targets, w.team_targets


def _carries(w: UsageWeek) -> tuple[float | None, float | None]:
    return w.carries, w.team_carries


def _air(w: UsageWeek) -> tuple[float | None, float | None]:
    return w.air_yards, w.team_air_yards


@dataclass(frozen=True, slots=True)
class ShareKind:
    key: str
    family: str
    pick: Pick
    noun: str
    unit: str
    positions: frozenset[str]


SHARE_KINDS: Final = (
    ShareKind("snap", "snaps", _snaps, "offensive snaps", SNAPS, frozenset(POSITION_WORDS)),
    ShareKind("target", "targets", _targets, "targets", TARGETS, PASS_CATCHERS),
    ShareKind("carry", "carries", _carries, "carries", CARRIES, CARRIERS),
    ShareKind("air_yards", "air", _air, "air yards", TARGETS, RECEIVERS),
)


def share_level(kind: ShareKind, position: str, team: str | None, weeks: Sequence[UsageWeek]) -> Candidate | None:
    """His share this season over every game of his, with his place among his position's peers."""
    if position not in kind.positions:
        return None
    held = share_of(weeks, kind.pick)
    if held is None:
        return None
    own, club = held
    share = own / club
    count = sum(w.air_yard_targets or 0.0 for w in weeks) if kind.key == "air_yards" else club
    text = f"{kind.noun.capitalize()}: {percent_text(share)} of {club_possessive(team)} {kind.noun} this season"
    return Candidate(
        f"{kind.key}_share", kind.family, share, text, (percent(share),), Basis(len(weeks), count, kind.unit),
        ends=HIGH_LOW,
    )  # fmt: skip


def share_trend(kind: ShareKind, position: str, team: str | None, weeks: Sequence[UsageWeek]) -> Candidate | None:
    """His share over his last three games against his games before them."""
    if position not in kind.positions or kind.key == "air_yards" or len(weeks) < RECENT_GAMES + BEFORE_GAMES:
        return None
    recent, before = weeks[-RECENT_GAMES:], weeks[:-RECENT_GAMES]
    now, then = share_of(recent, kind.pick), share_of(before, kind.pick)
    if now is None or then is None:
        return None
    a, b = now[0] / now[1], then[0] / then[1]
    text = (
        f"{kind.noun.capitalize()} lately: {percent_text(a)} of {club_possessive(team)} {kind.noun} over his last "
        f"three games, against {percent_text(b)} in his games before them"
    )
    return Candidate(
        f"{kind.key}_trend", kind.family, a - b, text, (percent(a), percent(b)), Basis(RECENT_GAMES, now[1], kind.unit)
    )


def target_depth(position: str, weeks: Sequence[UsageWeek]) -> Candidate | None:
    """How far downfield his targets are thrown: his air yards over the targets they were taken over."""
    if position not in RECEIVERS:
        return None
    yards = sum(w.air_yards or 0.0 for w in weeks if w.air_yard_targets is not None)
    targets = sum(w.air_yard_targets or 0.0 for w in weeks)
    if targets <= 0:
        return None
    depth = page_tenth(yards / targets)
    text = f"Target depth: his targets have travelled {page_tenth_text(depth)} yards downfield on average this season"
    return Candidate("target_depth", "air", depth, text, (depth,), Basis(len(weeks), targets, TARGETS), ends=DEEP_SHORT)


def red_zone(position: str, team: str | None, weeks: Sequence[UsageWeek]) -> Candidate | None:
    """His red-zone work against his touchdowns: the gap is measured against his peers' touchdowns a chance
    (`angles`), the sentence states the share and the touchdowns."""
    if position not in PASS_CATCHERS:
        return None
    held = share_of(weeks, lambda w: (w.red_zone, w.team_red_zone))
    touchdowns = sum(w.touchdowns or 0.0 for w in weeks)
    if held is None:
        return None
    own, club = held
    # No touchdown is said in words, never "0 touchdowns" (a zero beside a scoring word reads as a claim).
    scored = (
        "no touchdown yet"
        if touchdowns == 0
        else f"{js_string(touchdowns)} {'touchdown' if touchdowns == 1 else 'touchdowns'}"
    )
    text = (
        f"Red zone: {percent_text(own / club)} of {club_possessive(team)} red-zone carries and targets in his "
        f"games this season, and {scored}"
    )
    # The measure is set by the ranking pass (touchdowns less his chances at his peers' rate); `own` rides here.
    return Candidate(
        "red_zone", "red_zone", own, text, (percent(own / club), touchdowns), Basis(len(weeks), club, RED_ZONE)
    )


def spread(points: Sequence[float]) -> Candidate | None:
    """His week-to-week spread: the spread of his games' points over their mean, a steady floor or boom and bust
    (the sentence's words are the ranking pass's, by which end he is at)."""
    if len(points) < SPREAD_GAMES:
        return None
    mean = sum(points) / len(points)
    if mean < SPREAD_MIN_POINTS:
        return None
    sd = (sum((p - mean) ** 2 for p in points) / len(points)) ** 0.5
    low, high = page_tenth(min(points)), page_tenth(max(points))
    # Each end with its unit (a range's "14.2 to 28.9 PPR points" lost its first unit in the reads).
    text = (
        f"his lowest game this season is {page_tenth_text(low)} PPR points and his highest "
        f"{page_tenth_text(high)} PPR points"
    )
    return Candidate("spread", "spread", sd / mean, text, (low, high), Basis(len(points), len(points), GAMES))
