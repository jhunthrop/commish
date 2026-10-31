"""THE WEEK'S FACTS IN FULL (Lane 300). The founder, 2026-10-29: "They all read the same to me", and the same day,
"just dump in all of the information we have (summarized) and let it make an intelligent read": every usage fact
the store holds for him this week, each with how unusual it is, most unusual first; the writer reads them all and
leads with what decides his week.

Every board player's candidates (`angle_candidates`) are built from the stored usage (`usage_reads`), his games'
points and the night's facts, then each is scored by how unusual it is: its measure's distance from his
position's peers, in their standard deviations (a z-score among the board players at his position whose basis
clears the thin floors, `MIN_PEERS` of them at least). A trend is his last three games against his games before
them, so its score is unusual against his own baseline as well as his peers'. A candidate with no peer measure
(work vacated by a teammate ruled out, a return from missed games, the club's expected score) carries a score of
its own. Each fact's sentence ends on its unusualness in plain words (`unusual_words`), and the sheet carries them
all, most unusual first (`summary`, `render`).

A fact on a thin basis (`THIN_FLOORS`, on HIS OWN counts: under three games, a share on fewer than 20 of his snaps
or 10 of his targets, carries or red-zone chances, each window of a trend and a return; the review's H2) is left
off the sheet, so it never leads. A trend or a return is built only while his usage reaches the newest game of his
log (review M4), so "his last three games" are the log's.

Every figure a fact prints is bound to what it measures (`AngleFigure`), and every place among his peers it states
is kept (`Angle.places`): the read may quote a figure only as its measure and a place only as stated
(`angle_rules`, the review's H1). `ANGLES_ON` is the one switch: off, the sheet, the prompt and the validator are
main's before Lane 300.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Final, cast

from research.capsules.page_figures import page_tenth, page_tenth_text
from research.capsules.render_words import ordinal
from research.capsules.week.angle_candidates import (
    CARRIES,
    GAMES,
    POSITION_WORDS,
    RECEIVERS,
    RED_ZONE,
    RETURN_GAMES_BACK,
    RUNNERS,
    SHARE_KINDS,
    SNAPS,
    TARGETS,
    AngleFigure,
    Basis,
    Candidate,
    Measure,
    Pick,
    club_possessive,
    held_weeks,
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
# The words for a fact's unusualness, by its score (peer standard deviations): under `ORDINARY_UNDER` it is
# ordinary (about the middle 55% of his peers), from `FAR_FROM` far out of the ordinary (about the outer 13%).
ORDINARY_UNDER: Final = 0.75
FAR_FROM: Final = 1.5
POSITION_ONE: Final = {"QB": "quarterback", "RB": "running back", "WR": "wide receiver", "TE": "tight end"}
# Work vacated: a teammate ruled out this week who drew at least this share of his club's targets (or carries,
# for a back) in his games, and played within this many weeks of this one (a player out for a month has had
# his work taken already). Targets pass only to the mate's own position, or between receivers and tight ends;
# carries only between backs (review M2). Its score is the share over `VACATED_SHARE_PER_SCORE` (15% scores
# 1.5) for the likely heir, the eligible teammate with the largest share of that work, and scaled down by his
# own share against the heir's for everyone else, so one club's lost work leads only one read.
VACATED_MIN_SHARE: Final = 0.15
VACATED_RECENT_WEEKS: Final = 3
VACATED_SHARE_PER_SCORE: Final = 0.10
# The club's expected score is an angle at the week's top or bottom three clubs alone.
EXPECTED_EDGE: Final = 3
# A return from missed games is ordered at this score among his facts (it decides how a manager reads his last
# games); its line carries no unusualness words, only that it is a return (the final review's M1). Its games back
# are its basis, so it reaches the sheet only at three games back (the thin rule).
RETURN_SCORE_FLOOR: Final = 1.5
# The club's expected score is the club's fact more than his: its z-score among the week's clubs counts at this
# weight against his own usage's.
CLUB_FACT_WEIGHT: Final = 0.75
_ORDER_WORDS: Final = ("", "second-", "third-")
# The group the expected score's place is among.
WEEK_GROUP: Final = "of the week"


@dataclass(frozen=True, slots=True)
class Angle:
    """One fact the read is built on: its key, the sentence the sheet states it in, the figures and names that
    sentence prints, its score (how unusual, in peer standard deviations) and its basis."""

    key: str
    text: str
    figures: tuple[AngleFigure, ...]
    names: tuple[str, ...]
    score: float
    basis: Basis | None
    # Each place among his peers the sentence states: its words ("the 3rd-highest", "the second-highest") and
    # the group it is among ("among wide receivers", "of the week").
    places: tuple[tuple[str, str], ...] = ()


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


def _thin(basis: Basis | None) -> bool:
    """Under the games floor or his own count's floor; the club's fact (no basis) is never thin."""
    if basis is None:
        return False
    return basis.games < THIN_GAMES or basis.count < THIN_FLOORS.get(basis.unit, 0.0)


def fresh(player: AnglePlayer, weeks: Sequence[UsageWeek]) -> bool:
    """Whether his usage reaches the newest game of his log: a trend's "last three games" are the log's
    (review M4). The two feeds publish on different clocks, and a lagging week would set a trend's window apart
    from the Last cell and the spread."""
    return bool(weeks) and bool(player.points) and weeks[-1].week == max(week for week, _ in player.points)


def _club_weeks(player: AnglePlayer) -> tuple[UsageWeek, ...]:
    """His weeks with his club this week: a share is his club's, so a traded player's old club is left out."""
    return tuple(w for w in player.weeks if w.team == player.team)


def own_candidates(player: AnglePlayer) -> list[Candidate]:
    """Every candidate read from his own weeks alone; a trend and a return only while his usage is fresh."""
    weeks = _club_weeks(player)
    current = fresh(player, weeks)
    built: list[Candidate | None] = []
    for kind in SHARE_KINDS:
        built.append(share_level(kind, player.position, player.team, weeks))
        if current:
            built.append(share_trend(kind, player.position, player.team, weeks))
    built.extend(
        (
            target_depth(player.position, weeks),
            red_zone(player.position, player.team, weeks),
            spread([points for _, points in player.points]),
            _returned(player, weeks) if current else None,
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
    if not 1 <= len(back) <= RETURN_GAMES_BACK or len(before) < THIN_GAMES:
        return None
    now = share_of(back, lambda w: (w.snaps, w.team_snaps))
    then = share_of(before, lambda w: (w.snaps, w.team_snaps))
    if now is None or then is None:
        return None
    games = "game" if len(missed) == 1 else "games"
    text = (
        f"Back in the lineup, a return from missed games: since the {games} he missed, he has played "
        f"{percent_text(now[0] / now[1])} of {club_possessive(player.team)} offensive snaps, against "
        f"{percent_text(then[0] / then[1])} before"
    )
    figures = (
        AngleFigure(percent(now[0] / now[1]), Measure.SNAPS),
        AngleFigure(percent(then[0] / then[1]), Measure.SNAPS),
    )
    # Each window is a basis on his own snaps: the thinner one is the angle's.
    basis = Basis(min(len(back), len(before)), min(now[0], then[0]), SNAPS)
    return Candidate("return", "return", None, text, figures, basis, fixed=RETURN_SCORE_FLOOR, graded=False)


def vacated(player: AnglePlayer, teammates: Sequence[AnglePlayer], week: int) -> Candidate | None:
    """The largest share of his club's work a teammate ruled out this week drew that passes to his position
    (`_vacated_kinds`), scored for the likely heir and scaled down for the rest (review M2)."""
    best: Candidate | None = None
    for mate in teammates:
        if mate.out_words is None or mate.player_id == player.player_id:
            continue
        weeks = _club_weeks(mate)
        if not weeks or weeks[-1].week < week - VACATED_RECENT_WEEKS:
            continue
        for unit, pick, noun, measure in _vacated_kinds(player.position, mate.position):
            held = share_of(weeks, pick)
            if held is None or held[0] / held[1] < VACATED_MIN_SHARE:
                continue
            share = held[0] / held[1]
            heirs = [t for t in teammates if t.out_words is None and _vacated_kinds(t.position, mate.position)]
            weight = _heir_weight(player, heirs, pick)
            # The heir's words, never an ordinariness grade (the final review's M1).
            heir = "he is the likely heir" if weight >= 1 else "a smaller share of it is his"
            text = (
                f"Vacated work: {mate.name} is {mate.out_words} this week, and he drew {percent_text(share)} of "
                f"{club_possessive(player.team)} {noun} in his games this season ({heir})"
            )
            found = Candidate(
                "vacated", "vacated", None, text, (AngleFigure(percent(share), measure),),
                Basis(len(held_weeks(weeks, pick)), held[0], unit),
                names=(mate.name,), fixed=weight * share / VACATED_SHARE_PER_SCORE, graded=False,
            )  # fmt: skip
            if best is None or (found.fixed or 0.0) > (best.fixed or 0.0):
                best = found
    return best


def _heir_weight(player: AnglePlayer, heirs: Sequence[AnglePlayer], pick: Pick) -> float:
    """His share of the work against the heir's (the eligible teammate with the largest), 1 for the heir."""
    shares = {h.player_id: (s[0] / s[1] if (s := share_of(_club_weeks(h), pick)) else 0.0) for h in heirs}
    top = max(shares.values(), default=0.0)
    mine = shares.get(player.player_id, 0.0)
    return 0.0 if top <= 0 else mine / top


def _vacated_kinds(position: str, mate_position: str) -> list[tuple[str, Pick, str, str]]:
    """The work a mate at `mate_position` leaves that passes to a player at `position`: targets to his own position
    or between receivers and tight ends, carries between backs."""
    kinds: list[tuple[str, Pick, str, str]] = []
    if position == mate_position or {position, mate_position} <= RECEIVERS:
        kinds.append((TARGETS, lambda w: (w.targets, w.team_targets), "targets", Measure.TARGETS))
    if position in RUNNERS and mate_position in RUNNERS:
        kinds.append((CARRIES, lambda w: (w.carries, w.team_carries), "carries", Measure.CARRIES))
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
        place = f"the {_ORDER_WORDS[high]}highest {WEEK_GROUP}"
    elif from_low < EXPECTED_EDGE:
        place = f"the {_ORDER_WORDS[from_low]}lowest {WEEK_GROUP}"
    else:
        return None
    figure = page_tenth(points)
    text = f"Expected score: {club_possessive(team)} expected score is {page_tenth_text(figure)} points, {place}"
    # The club's fact has no player basis (review L5): `_thin` reads None as never thin.
    return Candidate(
        "expected", "expected", None, text, (AngleFigure(figure, Measure.EXPECTED),), None,
        fixed=CLUB_FACT_WEIGHT * abs(_z(points, list(clubs.values())) or 0.0),
        ends=None,
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
                touchdowns[player.position] = touchdowns.get(player.position, 0.0) + c.touchdowns
    return {position: touchdowns[position] / n for position, n in chances.items() if n > 0}


def _with_gap(c: Candidate, rates: Mapping[str, float], position: str) -> Candidate | None:
    """The red-zone candidate measured by its gap: his touchdowns less his chances at his position's rate."""
    if c.key != "red_zone" or c.measure is None:
        return c
    rate = rates.get(position)
    return None if rate is None else replace(c, measure=c.touchdowns - c.measure * rate)


def _pools(
    players: Sequence[AnglePlayer], own: Mapping[str, Sequence[Candidate]]
) -> dict[tuple[str, str], list[float]]:
    pools: dict[tuple[str, str], list[float]] = {}
    for player in players:
        for c in own[player.player_id]:
            if c.measure is not None and not _thin(c.basis):
                pools.setdefault((c.key, player.position), []).append(c.measure)
    return pools


def unusual_words(score: float, position: str, *, club: bool = False) -> str:
    """A fact's unusualness in plain words: "ordinary for a wide receiver", "far out of the ordinary this week"."""
    level = (
        "ordinary"
        if score < ORDINARY_UNDER
        else "out of the ordinary"
        if score < FAR_FROM
        else "far out of the ordinary"
    )
    return f"{level} this week" if club else f"{level} for a {POSITION_ONE.get(position, 'player')}"


def _ended(text: str, score: float, position: str, *, club: bool = False) -> str:
    return f"{text} ({unusual_words(score, position, club=club)})."


def _scored(c: Candidate, pool: Sequence[float], position: str) -> Angle | None:
    if c.fixed is not None:
        text = _ended(c.text, c.fixed, position, club=c.key == "expected") if c.graded else f"{c.text}."
        return Angle(c.key, text, c.figures, c.names, round(c.fixed, 2), c.basis, _expected_places(c))
    z = None if c.measure is None else _z(c.measure, pool)
    if z is None:
        return None
    text, places = c.text, cast("tuple[tuple[str, str], ...]", ())
    if c.ends is not None and c.measure is not None:
        words, group = place_words(c.measure, pool, c.ends), f"among {POSITION_WORDS[position]}"
        text, places = f"{text}, {words} {group}", ((words, group),)
    if c.key == "spread":
        # A direction only past ordinary (the final review's M1): an ordinary spread is "Week to week".
        label = "Week to week" if abs(z) < ORDINARY_UNDER else ("Boom or bust" if z > 0 else "Steady week to week")
        text = f"{label}: {text}"
    return Angle(c.key, _ended(text, abs(z), position), c.figures, c.names, round(abs(z), 2), c.basis, places)


def _expected_places(c: Candidate) -> tuple[tuple[str, str], ...]:
    """The expected score's place, "the second-highest" "of the week", as its sentence states it."""
    if c.key != "expected":
        return ()
    words = c.text.rsplit(", ", 1)[1].removesuffix(f" {WEEK_GROUP}")
    return ((words, WEEK_GROUP),)


def place_words(value: float, pool: Sequence[float], ends: tuple[str, str]) -> str:
    """His place among `pool` from the nearer end, in words: "the highest", "the 4th-lowest"."""
    above = 1 + sum(v > value for v in pool)
    below = 1 + sum(v < value for v in pool)
    place, end = (above, ends[0]) if above <= below else (below, ends[1])
    return f"the {end}" if place == 1 else f"the {ordinal(place)}-{end}"


def summary(angles: Iterable[Angle]) -> tuple[Angle, ...]:
    """Every fact once, most unusual first (the founder's direction: the writer reads them all)."""
    best: dict[str, Angle] = {}
    for angle in angles:
        if angle.key not in best or angle.score > best[angle.key].score:
            best[angle.key] = angle
    return tuple(sorted(best.values(), key=lambda a: (-a.score, a.key)))


def board_angles(players: Sequence[AnglePlayer], clubs: Mapping[str, float], week: int) -> dict[str, tuple[Angle, ...]]:
    """Every board player's facts by universe id: his candidates, scored against his position's peers, the thin
    ones left off, every other one carried, most unusual first."""
    built = {p.player_id: own_candidates(p) for p in players}
    rates = _red_zone_rates(players, built)
    own = {
        p.player_id: [g for c in built[p.player_id] if (g := _with_gap(c, rates, p.position)) is not None]
        for p in players
    }
    pools = _pools(players, own)
    by_club: dict[str | None, list[AnglePlayer]] = {}  # teammates by this week's club
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
        out[player.player_id] = summary(a for a in scored if a is not None)
    return out
