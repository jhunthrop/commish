"""THE INPUT RULE AND ITS RECORDING WRAPPER: what every covered read may return for a game, and
the stamps G5's per-game clause reads.

Preregistration section 2, "The input rule": for season S, week W and game g, every input row is
from a week before W and stamped at or before t_g, one millisecond before g's kickoff; the filings
are the latest for week W stamped at or before t_g. Section 5, G5: each covered read
(`player_week_observations` for the lines, snaps, play-by-play touches and filings,
`team_week_observations` for the play-by-play club rows, `player_week_teams`) goes through one
wrapper that keeps the largest week and the largest stamp among the rows it returned, filings kept
apart, and the gate compares them with t_g and W - 1 (W for filings) for every game.

The wrapper refuses a row that breaks the rule as the read returns it (`admit`), so a run that
finishes kept it; the gate then checks that every scored game has each of its reads
(`per_game_clause`). Exempt by name (section 5): the `kickoff_instant` and `home_field` rows and the
pairing (schedule knowledge, `instant.py`), the fitted artifacts and the preseason board, and the
outcome readers (`outcomes.py`), whose ledgers G5's other clause reads.

Four kinds of read: `box` (the club's and the players' rows of weeks before W, at t_g), `filings`
(week W's, at t_g), `rate` (the rest-of-season model's week read, at the week's first kickoff, which
is at or before every t_g of the week: section 2 item 1) and `prior` (the season before, read once
at the season's first instant; its stamp's week is 0, the whole season).
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Final, Literal, Protocol

from research.errors import ResearchError
from research.model.reads.stamps import Newest, newest_of

ReadKind = Literal[
    "box",
    "filings",
    "rate",
    "prior",
    # Round 4's kinds (its preregistration, section 5 and amendment 1 item 3), on the same wrapper.
    "plays",
    "charted",
    "figures",
    "live_figures",
    "weather",
    "depth",
    "depth_prior",
    "forecast",
    "schedule",
]
KINDS: Final[tuple[ReadKind, ...]] = ("box", "filings", "rate", "prior")
SEASON_WIDE: Final = 0  # the week a `prior` stamp carries: the whole of the season before
ONE_MS: Final = timedelta(milliseconds=1)
# Week W's own rows: the filings (round 4 item 1), the game's figures (item 2, replay at the kickoff,
# live at or before t_g), the recorded weather (item 3), the depth chart (item 6), the live forecast
# and the schedule knowledge (item 4). Every other kind but `prior` reads weeks before W only.
_WEEK_W: Final[frozenset[ReadKind]] = frozenset(
    {"filings", "figures", "live_figures", "weather", "depth", "forecast", "schedule"}
)
# Item 6's fallback when the depth chart stamp check fails: week W-1's chart.
_WEEK_BEFORE: Final[frozenset[ReadKind]] = frozenset({"depth_prior"})
# Admitted at t_g by name whatever their stamp (item 3: "the window is no part of the rule"; item 4).
_UNSTAMPED: Final[frozenset[ReadKind]] = frozenset({"weather", "schedule"})


class InputRuleError(ResearchError):
    """A covered read returned a row the input rule does not admit for its game."""


class Stamped(Protocol):
    @property
    def season(self) -> int: ...
    @property
    def week(self) -> int: ...
    @property
    def as_of(self) -> datetime: ...


@dataclass(frozen=True, slots=True)
class Stamp:
    """One covered read: for which season, week and instant, of what kind, and its newest row."""

    season: int
    week: int
    moment: datetime
    kind: ReadKind
    newest: Newest | None
    rows: int


def _wanted_week(kind: ReadKind, week: int) -> int | None:
    """The one week a week-W kind reads, or None for a kind that reads weeks before W."""
    if kind in _WEEK_W:
        return week
    return week - 1 if kind in _WEEK_BEFORE else None


def _stamp_breaks(kind: ReadKind, moment: datetime, as_of: datetime) -> str | None:
    """Round 3's stamp rule with round 4's two exceptions: the closing figure is the figure at the
    kickoff, one millisecond after t_g, and the recorded weather and the schedule are admitted by name."""
    if kind in _UNSTAMPED:
        return None
    if kind == "figures":
        kickoff = moment + ONE_MS
        return (
            None if as_of <= kickoff else f"a row stamped {as_of.isoformat()}, after the kickoff {kickoff.isoformat()}"
        )
    return None if as_of <= moment else f"a row stamped {as_of.isoformat()}, after the instant {moment.isoformat()}"


def _week_breaks(kind: ReadKind, season: int, week: int, row_season: int, row_week: int) -> str | None:
    if kind == "prior":
        return None if row_season < season else f"a {row_season} row in the read of the season before {season}"
    if kind == "filings":
        same = row_season == season and row_week == week
        return None if same else f"a {row_season} week {row_week} filing in the read of {season} week {week}'s"
    wanted = _wanted_week(kind, week)
    if wanted is not None:
        same = row_season == season and row_week == wanted
        return None if same else f"a {row_season} week {row_week} row in the {kind} read of {season} week {week}"
    if row_season != season or row_week >= week:
        return f"a {row_season} week {row_week} row in a read for {season} week {week}"
    return None


def _row_breaks(kind: ReadKind, season: int, week: int, moment: datetime, row: Stamped) -> str | None:
    return _stamp_breaks(kind, moment, row.as_of) or _week_breaks(kind, season, week, row.season, row.week)


def admit(rows: Sequence[Stamped], season: int, week: int, moment: datetime, kind: ReadKind) -> Stamp:
    """The read's stamp, or the refusal of its first row that breaks the rule."""
    for row in rows:
        broken = _row_breaks(kind, season, week, moment, row)
        if broken is not None:
            raise InputRuleError(f"the input rule refuses {broken} ({kind})")
    newest = newest_of((row.season, row.week, row.as_of) for row in rows)
    return Stamp(season, week, moment, kind, newest, len(rows))


def violation(stamp: Stamp) -> str | None:
    """What the stamp's newest row breaks, or None (G5 reads every stamp again)."""
    found = stamp.newest
    if found is None:
        return None
    if _stamp_breaks(stamp.kind, stamp.moment, found.as_of) is not None:
        return f"{stamp.kind} read for {stamp.season} week {stamp.week} saw a row stamped after its instant"
    if stamp.kind == "prior":
        return None if found.season < stamp.season else f"prior read for {stamp.season} saw its own season"
    wanted = _wanted_week(stamp.kind, stamp.week)
    if wanted is not None:
        same = (found.season, found.week) == (stamp.season, wanted)
        return None if same else f"{stamp.kind} read for {stamp.season} week {stamp.week} saw another week"
    if (found.season, found.week) >= (stamp.season, stamp.week):
        return f"{stamp.kind} read for {stamp.season} week {stamp.week} saw week {found.week}"
    return None


def stamp_of(newest: Newest | None, season: int, week: int, moment: datetime, kind: ReadKind) -> Stamp:
    """A stamp for a read whose rows another module folded (the rate's), refused like `admit`."""
    stamp = Stamp(season, week, moment, kind, newest, 0 if newest is None else 1)
    broken = violation(stamp)
    if broken is not None:
        raise InputRuleError(f"the input rule refuses the {broken}")
    return stamp


@dataclass(frozen=True, slots=True)
class Game:
    """One club's game: the season, the week, the club and its instant t_g."""

    season: int
    week: int
    club: str
    moment: datetime


def _missing(game: Game, stamps: Sequence[Stamp]) -> list[str]:
    def has(kind: ReadKind, same_moment: bool) -> bool:
        return any(
            s.kind == kind
            and s.season == game.season
            and (s.week == game.week or kind == "prior")
            and (s.moment == game.moment if same_moment else s.moment <= game.moment)
            for s in stamps
        )

    wanted: tuple[tuple[ReadKind, bool], ...] = (("box", True), ("filings", True), ("rate", False), ("prior", False))
    return [kind for kind, same in wanted if not has(kind, same)]


def per_game_clause(games: Iterable[Game], stamps: Sequence[Stamp]) -> tuple[bool, str]:
    """G5's per-game clause: every game has its box and filings reads at its own instant and its rate
    and prior-season reads at or before it, and no read broke the rule."""
    found = sorted(set(games), key=lambda g: (g.season, g.week, g.moment, g.club))
    if not found:
        return False, "cannot answer: no game was scored"
    broken = [b for b in (violation(s) for s in stamps) if b is not None]
    short = [(g, missing) for g in found if (missing := _missing(g, stamps))]
    if broken or short:
        parts = broken[:3] + [f"{g.season} week {g.week} {g.club} lacks {', '.join(m)}" for g, m in short[:3]]
        return False, f"{len(broken)} reads broke the rule, {len(short)} games lack a read: " + "; ".join(parts)
    newest = max((s.newest.as_of - s.moment for s in stamps if s.newest is not None), default=None)
    detail = f"{len(found)} games, {len(stamps)} reads, every row before its instant"
    if newest is not None:
        detail += f" (closest {-newest.total_seconds() / 3600:.1f} h before)"
    return True, detail
