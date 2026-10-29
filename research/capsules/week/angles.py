"""THE WEEK'S ANGLES (Lane 300, the founder 2026-10-29: "They all read the same to me"): what is distinct about
this player's week, chosen by code.

Every board player's candidates (`angle_candidates`) are built from the stored usage (`usage_reads`), his games'
points and the night's facts, then each is scored by how unusual it is: its measure's distance from his
position's peers, in their standard deviations (a z-score among the board players at his position whose basis
clears the thin floors, `MIN_PEERS` of them at least). A trend is his last three games against his games before
them, so its score is unusual against his own baseline as well as his peers'. A candidate with no peer measure
(work vacated by a teammate ruled out, a return from missed games) carries a score of its own. One angle a
family (his snaps, his targets, his carries, his air yards, his red-zone work, his spread, the club's expected
score, vacated work, his return), the strongest.

The sheet carries at most `MAX_ANGLES`, most unusual first (`render`), and only angles that score
`MIN_ANGLE_SCORE` or more: a sheet with none over it carries none, and the writer leans on his status and his game
(the coordinator's fix round 1). An angle on a thin basis (`THIN_FLOORS`: under three games, a share on fewer than 20 snaps or
10 targets or carries) is never carried, so it never leads. `ANGLES_ON` is the one switch: off, the sheet, the
prompt and the validator are main's before Lane 300.
"""

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Final

from research.capsules.page_figures import page_tenth, page_tenth_text
from research.capsules.render_words import ordinal
from research.capsules.week.angle_candidates import (
    CARRIES,
    GAMES,
    PASS_CATCHERS,
    POSITION_WORDS,
    RED_ZONE,
    RETURN_GAMES_BACK,
    RETURN_GAMES_BEFORE,
    RUNNERS,
    SHARE_KINDS,
    SNAPS,
    TARGETS,
    Basis,
    Candidate,
    club_possessive,
    percent,
    percent_text,
    red_zone,
    share_level,
    share_of,
    share_trend,
    spread,
    target_depth,
)
from research.capsules.week.usage_reads import UsageWeek

# The switch (Lane 300): on, merging turns the angles on (the coordinator's fix round 1). False and every sheet,
# ask and check is main's before the angles and the nightly reads no usage for them; the bake-off's `--angles`
# sets it for a run's arm.
ANGLES_ON: Final = True


def angles_on() -> bool:
    """The switch as it stands at the call (a run's arm sets it on this module)."""
    return ANGLES_ON


# The thin floors (the brief's ruling 4): an angle under them is never carried.
THIN_FLOORS: Final = {SNAPS: 20.0, TARGETS: 10.0, CARRIES: 10.0, RED_ZONE: 10.0, GAMES: 3.0}
THIN_GAMES: Final = 3
# A peer z-score needs this many peers at his position, or the candidate has no score.
MIN_PEERS: Final = 8
# The sheet carries two angles, and a third only when it is about one standard deviation out (the top sixth).
# Two angles at most (fix round 1): a third ran the reads past the figure cap and the word band, the two
# largest of the angles arm's fall causes in Lane 300's first three pairs.
MAX_ANGLES: Final = 2
# An angle under this score never reaches the sheet (fix round 1): about three quarters of a standard deviation
# from his position's middle, so "the 26th-highest snap share among tight ends" is left to his card.
MIN_ANGLE_SCORE: Final = 0.75
# Work vacated: a teammate ruled out this week who drew at least this share of his club's targets (or carries,
# for a back) in his games, and played within this many weeks of this one (a player out for a month has had
# his work taken already). Its score is the share over `VACATED_SHARE_PER_SCORE`: 15% scores 1.5.
VACATED_MIN_SHARE: Final = 0.15
VACATED_RECENT_WEEKS: Final = 3
VACATED_SHARE_PER_SCORE: Final = 0.10
# The club's expected score is an angle at the week's top or bottom three clubs alone.
EXPECTED_EDGE: Final = 3
# A return from missed games scores this: it decides how a manager reads his last games. Its games back are its
# basis, so it reaches the sheet only after three games back (the thin rule).
RETURN_SCORE_FLOOR: Final = 1.5
# The club's expected score is the club's fact more than his: its z-score among the week's clubs counts at this
# weight against his own usage's.
CLUB_FACT_WEIGHT: Final = 0.75
_ORDER_WORDS: Final = ("", "second-", "third-")


@dataclass(frozen=True, slots=True)
class Angle:
    """One fact the read is built on: its key, the sentence the sheet states it in, the figures and names that
    sentence prints, its score (how unusual, in peer standard deviations) and its basis."""

    key: str
    text: str
    figures: tuple[float, ...]
    names: tuple[str, ...]
    score: float
    basis: Basis

    @property
    def basis_words(self) -> str:
        count = page_tenth_text(self.basis.count)
        return f"{self.basis.games} games, {count} {self.basis.unit}"


@dataclass(frozen=True, slots=True)
class AnglePlayer:
    """One board player as the angles read him: his universe id, name, position, club this week, his weeks of
    usage (oldest first), his games' points in week order, the weeks he missed, and whether the injury report
    rules him out this week (with its words, "Out")."""

    player_id: str
    name: str
    position: str
    team: str | None
    weeks: tuple[UsageWeek, ...]
    points: tuple[tuple[int, float], ...]
    missed: tuple[int, ...]
    out_words: str | None = None


def _thin(basis: Basis) -> bool:
    return basis.games < THIN_GAMES or basis.count < THIN_FLOORS.get(basis.unit, 0.0)


def _club_weeks(player: AnglePlayer) -> tuple[UsageWeek, ...]:
    """His weeks with his club this week: a share is his club's, so a traded player's old club is left out."""
    return tuple(w for w in player.weeks if w.team == player.team)


def own_candidates(player: AnglePlayer) -> list[Candidate]:
    """Every candidate read from his own weeks alone."""
    weeks = _club_weeks(player)
    built: list[Candidate | None] = []
    for kind in SHARE_KINDS:
        built.extend(
            (
                share_level(kind, player.position, player.team, weeks),
                share_trend(kind, player.position, player.team, weeks),
            )
        )
    built.extend(
        (
            target_depth(player.position, weeks),
            red_zone(player.position, player.team, weeks),
            spread([points for _, points in player.points]),
            _returned(player, weeks),
        )
    )
    return [c for c in built if c is not None]


def _returned(player: AnglePlayer, weeks: Sequence[UsageWeek]) -> Candidate | None:
    """Back from missed games: his snap share in his games back against his games before the stretch."""
    if not player.missed or not weeks:
        return None
    last_missed = max(player.missed)
    back = [w for w in weeks if w.week > last_missed]
    before = [w for w in weeks if w.week < min(player.missed)]
    missed = [m for m in player.missed if not back or m < back[0].week]
    if not 1 <= len(back) <= RETURN_GAMES_BACK or len(before) < RETURN_GAMES_BEFORE:
        return None
    now = share_of(back, lambda w: (w.snaps, w.team_snaps))
    then = share_of(before, lambda w: (w.snaps, w.team_snaps))
    if now is None or then is None:
        return None
    games = "game" if len(missed) == 1 else "games"
    text = (
        f"Back in the lineup: since the {games} he missed, he has played {percent_text(now[0] / now[1])} of "
        f"{club_possessive(player.team)} offensive snaps, against {percent_text(then[0] / then[1])} before"
    )
    figures = (percent(now[0] / now[1]), percent(then[0] / then[1]))
    return Candidate(
        "return", "return", None, text, figures, Basis(len(back), now[1], SNAPS),
        fixed=RETURN_SCORE_FLOOR,
    )  # fmt: skip


def vacated(player: AnglePlayer, teammates: Iterable[AnglePlayer], week: int) -> Candidate | None:
    """The largest share of his club's targets (or a back's carries) a teammate ruled out this week drew."""
    best: Candidate | None = None
    for mate in teammates:
        if mate.out_words is None or mate.player_id == player.player_id or not mate.weeks:
            continue
        weeks = _club_weeks(mate)
        if not weeks or weeks[-1].week < week - VACATED_RECENT_WEEKS:
            continue
        for unit, picks, noun in _vacated_kinds(player.position, mate.position):
            held = share_of(weeks, picks)
            if held is None or held[0] / held[1] < VACATED_MIN_SHARE:
                continue
            share = held[0] / held[1]
            text = (
                f"Vacated work: {mate.name} is {mate.out_words} this week, and he drew {percent_text(share)} of "
                f"{club_possessive(player.team)} {noun} this season"
            )
            found = Candidate(
                "vacated", "vacated", None, text, (percent(share),), Basis(len(weeks), held[1], unit),
                names=(mate.name,), fixed=share / VACATED_SHARE_PER_SCORE,
            )  # fmt: skip
            if best is None or (found.fixed or 0.0) > (best.fixed or 0.0):
                best = found
    return best


Pick = Callable[[UsageWeek], tuple[float | None, float | None]]


def _vacated_kinds(position: str, mate_position: str) -> list[tuple[str, Pick, str]]:
    kinds: list[tuple[str, Pick, str]] = []
    if position in PASS_CATCHERS and mate_position in PASS_CATCHERS:
        kinds.append((TARGETS, lambda w: (w.targets, w.team_targets), "targets"))
    if position in RUNNERS and mate_position in RUNNERS:
        kinds.append((CARRIES, lambda w: (w.carries, w.team_carries), "carries"))
    return kinds


def expected(team: str | None, clubs: Mapping[str, float]) -> Candidate | None:
    """His club's expected score at the week's top or bottom `EXPECTED_EDGE` clubs."""
    if team is None or team not in clubs or len(clubs) < MIN_PEERS:
        return None
    points = clubs[team]
    ordered = sorted(clubs.values(), reverse=True)
    high, low = ordered.index(points), len(ordered) - 1 - ordered[::-1].index(points)
    from_low = len(ordered) - 1 - low
    if high < EXPECTED_EDGE:
        place = f"the {_ORDER_WORDS[high]}highest of the week"
    elif from_low < EXPECTED_EDGE:
        place = f"the {_ORDER_WORDS[from_low]}lowest of the week"
    else:
        return None
    figure = page_tenth(points)
    text = f"Expected score: {club_possessive(team)} expected score is {page_tenth_text(figure)} points, {place}"
    return Candidate(
        "expected", "expected", None, text, (figure,), Basis(THIN_GAMES, THIN_FLOORS[GAMES], GAMES),
        fixed=CLUB_FACT_WEIGHT * abs(_z(points, list(clubs.values())) or 0.0),
    )  # fmt: skip


def _z(value: float, pool: Sequence[float]) -> float | None:
    if len(pool) < MIN_PEERS:
        return None
    mean = sum(pool) / len(pool)
    sd = (sum((v - mean) ** 2 for v in pool) / len(pool)) ** 0.5
    return None if sd <= 0 else (value - mean) / sd


# --- the ranking pass ------------------------------------------------------------------------------------------


def _red_zone_rates(players: Sequence[AnglePlayer], own: Mapping[str, Sequence[Candidate]]) -> dict[str, float]:
    """His position's touchdowns a red-zone chance across the board, for the red-zone gap."""
    chances: dict[str, float] = {}
    touchdowns: dict[str, float] = {}
    for player in players:
        for c in own[player.player_id]:
            if c.key == "red_zone" and c.measure is not None and not _thin(c.basis):
                chances[player.position] = chances.get(player.position, 0.0) + c.measure
                touchdowns[player.position] = touchdowns.get(player.position, 0.0) + c.figures[1]
    return {position: touchdowns[position] / n for position, n in chances.items() if n > 0}


def _with_gap(c: Candidate, rates: Mapping[str, float], position: str) -> Candidate | None:
    """The red-zone candidate measured by its gap: his touchdowns less his chances at his position's rate."""
    if c.key != "red_zone" or c.measure is None:
        return c
    rate = rates.get(position)
    return None if rate is None else replace(c, measure=c.figures[1] - c.measure * rate)


def _pools(
    players: Sequence[AnglePlayer], own: Mapping[str, Sequence[Candidate]]
) -> dict[tuple[str, str], list[float]]:
    pools: dict[tuple[str, str], list[float]] = {}
    for player in players:
        for c in own[player.player_id]:
            if c.measure is not None and not _thin(c.basis):
                pools.setdefault((c.key, player.position), []).append(c.measure)
    return pools


def _scored(c: Candidate, pool: Sequence[float], position: str) -> Angle | None:
    if c.fixed is not None:
        return Angle(c.key, f"{c.text}.", c.figures, c.names, round(c.fixed, 2), c.basis)
    z = None if c.measure is None else _z(c.measure, pool)
    if z is None:
        return None
    text, figures = c.text, c.figures
    if c.ends is not None and c.measure is not None:
        text = f"{text}, {place_words(c.measure, pool, c.ends)} among the {POSITION_WORDS[position]} we rank"
    if c.key == "spread":
        text = f"{'Boom or bust' if z > 0 else 'Steady week to week'}: {text}"
    return Angle(c.key, f"{text}.", figures, c.names, round(abs(z), 2), c.basis)


def place_words(value: float, pool: Sequence[float], ends: tuple[str, str]) -> str:
    """His place among `pool` from the nearer end, in words: "the highest", "the 4th-lowest"."""
    above = 1 + sum(v > value for v in pool)
    below = 1 + sum(v < value for v in pool)
    place, end = (above, ends[0]) if above <= below else (below, ends[1])
    return f"the {end}" if place == 1 else f"the {ordinal(place)}-{end}"


# Each key's family, one angle a family (a level and its trend say one thing twice).
_FAMILY: Final = {
    **{f"{kind.key}_{part}": kind.family for kind in SHARE_KINDS for part in ("share", "trend")},
    "target_depth": "air",
}


def chosen(angles: Iterable[Angle]) -> tuple[Angle, ...]:
    """The strongest angle a family, most unusual first, `MAX_ANGLES` of those at `MIN_ANGLE_SCORE` or more."""
    best: dict[str, Angle] = {}
    for angle in angles:
        family = _FAMILY.get(angle.key, angle.key)
        if family not in best or angle.score > best[family].score:
            best[family] = angle
    ordered = sorted(best.values(), key=lambda a: (-a.score, a.key))
    return tuple(a for a in ordered if a.score >= MIN_ANGLE_SCORE)[:MAX_ANGLES]


def board_angles(players: Sequence[AnglePlayer], clubs: Mapping[str, float], week: int) -> dict[str, tuple[Angle, ...]]:
    """Every board player's angles by universe id: his candidates, scored against his position's peers, the
    thin ones left off, the strongest a family carried."""
    built = {p.player_id: own_candidates(p) for p in players}
    rates = _red_zone_rates(players, built)
    own = {
        p.player_id: [g for c in built[p.player_id] if (g := _with_gap(c, rates, p.position)) is not None]
        for p in players
    }
    pools = _pools(players, own)
    by_club: dict[str | None, list[AnglePlayer]] = {}
    for player in players:
        by_club.setdefault(player.team, []).append(player)
    out: dict[str, tuple[Angle, ...]] = {}
    for player in players:
        candidates = [
            *own[player.player_id],
            vacated(player, by_club.get(player.team, ()), week),
            expected(player.team, clubs),
        ]
        scored = (
            _scored(c, pools.get((c.key, player.position), ()), player.position)
            for c in candidates
            if c is not None and not _thin(c.basis)
        )
        out[player.player_id] = chosen(a for a in scored if a is not None)
    return out
