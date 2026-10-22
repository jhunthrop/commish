"""THE RECORD: the prospective register's served board against the season so far, against ADP and the
week's published projection.

Read from the register as the in-season job writes it (`model.register`): each week's latest freeze
of the served board, and its latest grading. A week's line grades our order and ADP's on the same
players (the frozen players with an ADP and a stat line that week), all of them and position by
position, each with the register's own statistics (`model.register.grade.score_columns`): Spearman's
rank correlation with what the players scored, and the mean distance in places between the order
and the finish. Lane 66j adds the starters each order called right (the week's top players at each
position for a 12-team league, against the order's own top players there) and the week's published
projection, graded on the same players where the freeze kept it (from week 7). The season to date is
the register's running score (`runningScoreboard`): the mean of the graded weeks' numbers, over every
player any graded week counted, and the starters summed.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Final

from sqlalchemy import Connection, text

from research.inseason.season_week import GRADE_AFTER, last_kickoffs_by_week
from research.model.backtest import Observation, mean_or_none, spearman, sum_left
from research.model.reads.teams import kickoff_instants_by_week
from research.model.register.freeze import SERVED_SOURCE, SHIPPED_SOURCE
from research.model.register.grade import average_outcome_ranks, ordinal_ranks
from research.season import REGULAR_SEASON_WEEKS

# The one sentence a missed week prints. The 2026 misses (weeks 3 to 5) were the old weekly register
# job failing on every pass, not a nightly run (phase D review L1); from cutover a missed freeze fails
# the in-season job (`inseason`) and alerts.
MISSED_NOTE: Final = "Our order was not set before kickoff that week."
RECORD_POSITIONS: Final = ("QB", "RB", "WR", "TE", "K", "DST")
ALL: Final = "All"
# The coordinator's ruling of 2026-10-17 (Lane 66j): "Order matched" names the rank correlation, its
# scale said once.
STATISTIC: Final = {"agreement": "order matched", "placesOff": "places off", "starters": "starters right"}
# A 12-team league's starters at each position, the week's top players the starters figure counts:
# 12 QB, 24 RB, 36 WR, 12 TE, 12 K and 12 defenses, where the register grades the position.
LEAGUE_TEAMS: Final = 12
STARTERS_A_TEAM: Final = {"QB": 1, "RB": 2, "WR": 3, "TE": 1, "K": 1, "DST": 1}
_STARTER_WORDS: Final = {"QB": "QBs", "RB": "RBs", "WR": "WRs", "TE": "TEs", "K": "kickers", "DST": "defenses"}
# The places the record page prints each figure to.
AGREEMENT_PLACES: Final = 2
PLACES_OFF_PLACES: Final = 1
# The agreement's scale, its ends in the form the page prints the rate (ruling R2, Lane 78): 1.00 and 0.00.
# Lane 93 (B04): the measure named and its whole range said, below 0.00 included, in a player's words;
# Lane 140 (C30): what below 0.00 means, said plainly.
SCALE: Final = (
    f"Order matched is how closely an order ranked the players to the week's finish: "
    f"{1:.{AGREEMENT_PLACES}f} is the same order, {0:.{AGREEMENT_PLACES}f} no closer than chance, "
    f"below {0:.{AGREEMENT_PLACES}f} the order runs backwards."
)


def printed(value: float | None, places: int) -> float | None:
    """A figure rounded once, here, to the places the page prints, half away from zero on its decimal
    value (Lane 66k's ruling): the page and the honest sentence print it as given."""
    if value is None:
        return None
    step = Decimal(1).scaleb(-places)
    return float(Decimal(repr(value)).quantize(step, rounding=ROUND_HALF_UP))


# The order each tracked board is (the record names it on every frozen week, review 66j M7): the served
# board is our preseason order, the shipped board the rest-of-season order every screen shows (Lane 93).
ORDER_OF_SOURCE: Final = {SERVED_SOURCE: "preseason", SHIPPED_SOURCE: "rest_of_season"}
# The boards a week's record may grade, the shipped one first: a freeze that kept it grades the order
# the site showed; a freeze before it (weeks 1, 2 and 6 of 2026) grades the preseason board it kept.
GRADED_SOURCES: Final = (SHIPPED_SOURCE, SERVED_SOURCE)
# The record's method in a player's words (Lane 93, B03): we set the order, never "froze" it.
_METHOD: Final = (
    "Each week we set our order before the first kickoff and graded it on its players' points, "
    "{benchmarks} on the same players."
)


@dataclass(frozen=True, slots=True)
class Score:
    graded: int
    agreement: float | None
    places_off: float | None
    # The week's top players at the positions graded that this order also put there, of how many.
    starters: int
    starters_of: int


@dataclass(frozen=True, slots=True)
class Line:
    position: str
    ours: Score
    adp: Score
    # The week's published projection on the same players where the freeze kept it, None before it did.
    published: Score | None
    # The season to date only: ours over the weeks that graded the published projection, so the two
    # are set side by side like with like (review 66j N1). None on a week's line and before any such week.
    ours_on_published: Score | None = None


@dataclass(frozen=True, slots=True)
class Week:
    """One week of the season as the record shows it (`recordWeekSchema`): graded, frozen, missed (its
    first kickoff passed with no freeze) or upcoming (`at` is then its first kickoff, if known)."""

    week: int
    status: str
    at: datetime | None
    board_as_of: datetime | None
    graded_at: datetime | None
    population: int
    lines: tuple[Line, ...]
    # The order the week's freeze graded ("preseason" or "rest_of_season"), None for a week with no freeze.
    order: str | None = None
    # A frozen week waiting on its stats: the earliest instant the in-season pass grades it (its last
    # kickoff plus `GRADE_AFTER`), None when no kickoff is on file and for every other status.
    grades_from: datetime | None = None
    # A graded week's players as the page counts a league's own starters from (Lane 93), else empty.
    placed: tuple["Placed", ...] = ()


# (player, the order's stance or None where it has none, his points, his position)
Entry = tuple[str, float | None, float, str]


def filled_ranks(entries: Sequence[Entry]) -> dict[str, float]:
    """The fill rule (round 2's `NO_OPINION`, review 66j H3): the rows an order has a stance on in its
    ordinal order, highest first, and every row it has none on below them all, sharing their average
    rank, so every source is graded on the same rows."""
    listed = [(pid, stance) for pid, stance, _, _ in entries if stance is not None]
    ranks: dict[str, float] = {pid: float(rank) for pid, rank in ordinal_ranks(listed).items()}
    missing = [pid for pid, stance, _, _ in entries if stance is None]
    shared = (len(listed) + 1 + len(entries)) / 2
    for pid in missing:
        ranks[pid] = shared
    return ranks


def _starters(entries: Sequence[Entry], ranks: Mapping[str, float]) -> tuple[int, int]:
    """Per position, the order's top N against the finish's top N (N a 12-team league's starters there).
    Only the players the order listed can be called: an order that lists fewer than N has called only
    those (review 66j N5), never the unlisted rows the fill rule ties below them."""
    right = of = 0
    for position, per_team in STARTERS_A_TEAM.items():
        at = [entry for entry in entries if entry[3] == position]
        n = min(per_team * LEAGUE_TEAMS, len(at))
        if n == 0:
            continue
        listed = [entry for entry in at if entry[1] is not None]
        called = {pid for pid, _, _, _ in sorted(listed, key=lambda e: (ranks[e[0]], e[0]))[:n]}
        finished = {pid for pid, _, _, _ in sorted(at, key=lambda e: (-e[2], e[0]))[:n]}
        right += len(called & finished)
        of += n
    return right, of


def score_entries(entries: Sequence[Entry]) -> Score:
    """One order's score over its entries: its ranks under the fill rule against the finish."""
    if not entries:
        return Score(0, None, None, 0, 0)
    ranks = filled_ranks(entries)
    outcome = average_outcome_ranks([(pid, points) for pid, _, points, _ in entries])
    error = sum_left([abs(ranks[pid] - outcome[pid]) for pid, _, _, _ in entries]) / len(entries)
    agreement = spearman([Observation(-ranks[pid], points) for pid, _, points, _ in entries])
    right, of = _starters(entries, ranks)
    return Score(len(entries), agreement, error, right, of)


def entries_of(rows: Sequence[Mapping[str, Any]], stance: str) -> list[Entry]:
    """Each row as an entry; ADP's stance is minus its ADP, and a row a source has no number for has
    none."""
    out: list[Entry] = []
    for row in rows:
        value = row.get(stance)
        held = None if value is None else (-value if stance == "adp" else float(value))
        out.append((row["player_id"], held, row["actual_points"], row["position"]))
    return out


def week_lines(rows: Sequence[Mapping[str, Any]]) -> tuple[Line, ...]:
    """All players, then each position present, on the players both orders rank; the published
    projection on the same rows under the fill rule, when the freeze kept it for any of them."""
    both = [row for row in rows if row["adp"] is not None]
    lines = []
    for position in (ALL, *RECORD_POSITIONS):
        subset = both if position == ALL else [row for row in both if row["position"] == position]
        if not subset:
            continue
        kept = any(row.get("published_points") is not None for row in subset)
        published = score_entries(entries_of(subset, "published_points")) if kept else None
        lines.append(
            Line(
                position,
                score_entries(entries_of(subset, "board_points")),
                score_entries(entries_of(subset, "adp")),
                published,
            )
        )
    return tuple(lines)


@dataclass(frozen=True, slots=True)
class Placed:
    """One graded player of a week as the record page reads him to count the starters a league's own
    lineup calls right (Lane 93, ruling 4): his position, each order's place among the week's graded
    players (the fill rule's ordinal ranks, None where the order has no stance on him) and his place
    in the finish, ties by id, the same orders `_starters` counts by."""

    position: str
    ours: int | None
    adp: int | None
    published: int | None
    finish: int


def placed_players(rows: Sequence[Mapping[str, Any]]) -> tuple[Placed, ...]:
    """The week's graded players on the All line's population (every frozen player with an ADP and a
    stat line), in the finish's order."""
    both = [row for row in rows if row["adp"] is not None]
    finished = sorted(both, key=lambda row: (-row["actual_points"], row["player_id"]))

    def places(stance: str) -> dict[str, int]:
        listed = [(pid, held) for pid, held, _, _ in entries_of(both, stance) if held is not None]
        return ordinal_ranks(listed)

    ours, adp, published = places("board_points"), places("adp"), places("published_points")
    return tuple(
        Placed(
            row["position"],
            ours.get(row["player_id"]),
            adp.get(row["player_id"]),
            published.get(row["player_id"]),
            place,
        )
        for place, row in enumerate(finished, start=1)
    )


def starters_basis(to_date_lines: Sequence[Line]) -> str | None:
    """What the starters figure counts, from the positions the record graded (review 66j M8, Lane 66t),
    naming the lineup it counts (Lane 93: a page opened from a league counts the league's own): "Starters
    right counts a standard 12-team lineup, the week's top 12 QBs, 24 RBs, 36 WRs and 12 TEs, and how
    many of them the order also put there." None before any week is graded."""
    return starters_words({line.position for line in to_date_lines if line.ours.starters_of > 0})


def starters_words(graded: set[str]) -> str | None:
    """The starters basis for the positions graded (any line whose ours counted starters)."""
    counts = [f"{n * LEAGUE_TEAMS} {_STARTER_WORDS[p]}" for p, n in STARTERS_A_TEAM.items() if p in graded]
    if not counts:
        return None
    listed = counts[0] if len(counts) == 1 else f"{', '.join(counts[:-1])} and {counts[-1]}"
    return (
        f"Starters right counts a standard {LEAGUE_TEAMS}-team lineup, the week's top {listed}, "
        "and how many of them the order also put there."
    )


def method(to_date_lines: Sequence[Line]) -> str:
    """How the record is kept, naming only the orders the page draws (Lane 82, the honest empty state):
    ADP always, Published once a graded week carries it, the same rule the page draws its column by
    (any season-to-date line with a published score)."""
    drawn = any(line.published is not None for line in to_date_lines)
    return _METHOD.format(benchmarks="ADP and Published" if drawn else "ADP")


def pooled(scores: Sequence[Score], players: int) -> Score:
    return Score(
        players,
        mean_or_none([s.agreement for s in scores if s.agreement is not None]),
        mean_or_none([s.places_off for s in scores if s.places_off is not None]),
        sum(s.starters for s in scores),
        sum(s.starters_of for s in scores),
    )


def to_date(weeks: Sequence[Week], rows_by_week: Mapping[int, Sequence[Mapping[str, Any]]]) -> tuple[Line, ...]:
    """The running score: per position, the mean of each graded week's numbers, the starters summed. The
    published projection pools only the weeks that graded it, None before any did, and ours is pooled
    again over those same weeks beside it (review 66j N1)."""
    graded = [week for week in weeks if week.status == "graded"]
    lines = []
    for position in (ALL, *RECORD_POSITIONS):
        found = [line for week in graded for line in week.lines if line.position == position]
        if not found:
            continue
        players = {
            row["player_id"]
            for week in graded
            for row in rows_by_week[week.week]
            if row["adp"] is not None and (position == ALL or row["position"] == position)
        }
        shared = [line for line in found if line.published is not None]
        published = [line.published for line in shared if line.published is not None]
        shared_players = max((score.graded for score in published), default=0)
        lines.append(
            Line(
                position,
                pooled([line.ours for line in found], len(players)),
                pooled([line.adp for line in found], len(players)),
                pooled(published, shared_players) if published else None,
                pooled([line.ours for line in shared], shared_players) if shared else None,
            )
        )
    return tuple(lines)


# The legacy record's starters clause, "{name} had more of the week's starters right in the standard
# lineup, 104 of 168 against our 100": the slots name, theirs, of, ours.
STARTERS_CLAUSE: Final = (
    "{name} had more of the week's starters right in the standard lineup, {theirs} of {of} against our {ours}"
)


def trail_clauses(ours: Score, theirs: Score, name: str, starters: str = STARTERS_CLAUSE) -> list[str]:
    """Each figure on which a benchmark called the weeks better than our order, as a clause, every
    figure compared and said as the page prints it; `starters` words the starters figure."""
    out = []
    mine, its = printed(ours.agreement, AGREEMENT_PLACES), printed(theirs.agreement, AGREEMENT_PLACES)
    if mine is not None and its is not None and its > mine:
        out.append(f"{name}'s order matched the finish better, {its:.2f} against our {mine:.2f}")
    mine, its = printed(ours.places_off, PLACES_OFF_PLACES), printed(theirs.places_off, PLACES_OFF_PLACES)
    if mine is not None and its is not None and its < mine:
        out.append(f"{name} put a typical player closer to his finish, {its:.1f} places off against our {mine:.1f}")
    if theirs.starters > ours.starters and theirs.starters_of == ours.starters_of:
        out.append(starters.format(name=name, theirs=theirs.starters, of=theirs.starters_of, ours=ours.starters))
    return out


def honest_line(to_date_lines: Sequence[Line]) -> str | None:
    """The sentence the record page prints when a benchmark called the graded weeks better than our order
    on any figure, all positions together; None when ours leads or ties on every one."""
    line = next((line for line in to_date_lines if line.position == ALL), None)
    if line is None:
        return None
    clauses = trail_clauses(line.ours, line.adp, "ADP")
    if line.published is not None and line.ours_on_published is not None:
        clauses += trail_clauses(line.ours_on_published, line.published, "The published projection")
    if not clauses:
        return None
    return " ".join(f"{clause[0].upper()}{clause[1:]}." for clause in clauses)


_FREEZES: Final = """
select week, max(frozen_at) as frozen_at from research.register_freeze_rows
where season = :s and board_source = :source group by week order by week
"""
_GRADED: Final = """
select g.player_id, g.actual_points, g.graded_at, f.board_points, f.adp, f.published_points, f.espn_points, f.espn_read_at, f.board_as_of,
       case when p.position in ('DEF', 'DST') then 'DST' else p.position end as position
from research.register_grade_rows g
join research.register_freeze_rows f on f.season = g.season and f.week = g.week and f.frozen_at = g.frozen_at
  and f.board_source = g.board_source and f.player_id = g.player_id
join research.players p on p.id = g.player_id
where g.season = :s and g.week = :w and g.frozen_at = :f and g.board_source = :source
  and g.graded_at = (select max(graded_at) from research.register_grade_rows
                     where season = :s and week = :w and frozen_at = :f and board_source = :source)
"""


def order_source(conn: Connection, season: int, week: int, frozen_at: datetime) -> str:
    """The board a freeze's record grades: the order the site shipped where the freeze kept it, else
    the preseason board every freeze keeps (`GRADED_SOURCES`)."""
    shipped = conn.execute(
        text(
            "select exists (select 1 from research.register_freeze_rows "
            "where season = :s and week = :w and frozen_at = :f and board_source = :source)"
        ),
        {"s": season, "w": week, "f": frozen_at, "source": SHIPPED_SOURCE},
    ).scalar_one()
    return SHIPPED_SOURCE if shipped else SERVED_SOURCE


def graded_rows(
    conn: Connection, season: int, week: int, frozen_at: datetime, source: str
) -> tuple[list[Mapping[str, Any]], datetime | None]:
    """A freeze's rows of one board with their latest grading's points (none before it is graded),
    and the board's own stamp."""
    params = {"s": season, "w": week, "f": frozen_at, "source": source}
    rows: list[Mapping[str, Any]] = [row._asdict() for row in conn.execute(text(_GRADED), params)]
    board_as_of = conn.execute(
        text(
            "select max(board_as_of) from research.register_freeze_rows "
            "where season = :s and week = :w and frozen_at = :f and board_source = :source"
        ),
        params,
    ).scalar_one()
    return rows, board_as_of


def _frozen_week(
    conn: Connection, season: int, week: int, frozen_at: datetime, grades_from: datetime | None
) -> tuple[Week, list[Mapping[str, Any]]]:
    source = order_source(conn, season, week, frozen_at)
    rows, board_as_of = graded_rows(conn, season, week, frozen_at, source)
    graded_at = max((row["graded_at"] for row in rows), default=None)
    status = "frozen" if graded_at is None else "graded"
    waits = grades_from if status == "frozen" else None
    placed = placed_players(rows) if status == "graded" else ()
    built = Week(
        week,
        status,
        frozen_at,
        board_as_of,
        graded_at,
        len(rows),
        week_lines(rows),
        ORDER_OF_SOURCE[source],
        waits,
        placed,
    )
    return built, rows


def read_record(
    conn: Connection, season: int, as_of: datetime
) -> tuple[list[Week], dict[int, list[Mapping[str, Any]]]]:
    """Every week of the regular season in order: each frozen week with its latest grading's lines,
    each week whose first kickoff passed with no freeze as missed, the rest upcoming."""
    freezes = {
        int(row.week): row.frozen_at for row in conn.execute(text(_FREEZES), {"s": season, "source": SERVED_SOURCE})
    }
    kickoffs = kickoff_instants_by_week(conn, season)
    ends = last_kickoffs_by_week(conn, season)
    last = max([REGULAR_SEASON_WEEKS, *freezes])
    weeks: list[Week] = []
    rows_by_week: dict[int, list[Mapping[str, Any]]] = {}
    for week in range(1, last + 1):
        kickoff = kickoffs.get(week)
        if week in freezes:
            grades_from = None if week not in ends else ends[week] + GRADE_AFTER
            built, rows = _frozen_week(conn, season, week, freezes[week], grades_from)
            weeks.append(built)
            rows_by_week[week] = rows
        elif kickoff is not None and kickoff <= as_of:
            weeks.append(Week(week, "missed", None, None, None, 0, ()))
        else:
            weeks.append(Week(week, "upcoming", kickoff, None, None, 0, ()))
    return weeks, rows_by_week


def published_from(conn: Connection, season: int) -> int | None:
    """The first week whose freeze of a graded board keeps the published projection for any player
    (review 66j L11), None while none does."""
    week = conn.execute(
        text(
            "select min(week) from research.register_freeze_rows "
            "where season = :s and board_source = any(:sources) and published_points is not null"
        ),
        {"s": season, "sources": list(GRADED_SOURCES)},
    ).scalar_one()
    return None if week is None else int(week)


def frozen_weeks(conn: Connection, season: int) -> dict[int, str]:
    """Each week the served board was frozen for, with the implementation of its latest freeze."""
    rows = conn.execute(
        text(
            "select distinct on (week) week, implementation from research.register_freeze_rows "
            "where season = :s and board_source = :source order by week, frozen_at desc"
        ),
        {"s": season, "source": SERVED_SOURCE},
    )
    return {int(row.week): str(row.implementation) for row in rows}
