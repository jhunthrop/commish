"""THE WEEK'S FACTS FROM THE STORE, for every board player at one instant (`collect_week_sheets`).

Each read takes only what was stamped at or before the instant:
- the week: his club's first game still to kick off (a club on its bye that week has its bye and its next
  game), from the stored schedule the player page reads (`nightly.reads.schedule`), and only a club whose
  week is the board week (`board_week`): a club whose board-week game has kicked off has its next week
  ahead, written when that week rolls over (Lane 256), so no sheet, projection or figure is read for it;
- the published projection: the newest two snapshots of his week captured by then
  (`tank01_projection_rows`, PPR points), the provider never named, each as the card serves it (the cents,
  then the tenth);
- the game's expected points: the newest figures read before his kickoff (`tank01_lines`, else the game
  table's `nflverse_game_figures`), the club's own and the game total less it for the opponent, in the
  half points the card prints, never the spread; the venue's roof (`nflverse_game_reads` and `stadiums`) and the kickoff forecast (`nws_forecast`);
- his status: the newest injury capture (`capsules.facts.reference.injury_snapshot`, Lane 63's feed), in
  the contract's words;
- his season so far and the opponent's PPR points allowed a game to his position, ranked (1 allowed the
  fewest), from the season the player page prints (`nightly.build.player_season`), as the API's week facts
  rank them (`api/internal/inseason/facts.go` rankAllowed);
- his place on the published board (`published_boards`, PPR), and the depth chart from the night's facts
  pass (`Subject.facts.depth`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Final, cast

from sqlalchemy import Connection, text

from research.capsules.page_figures import expected_score, page_tenth, projection_tenth
from research.capsules.sweep import Subject
from research.capsules.week.rollover import Rollover, projection_held, published_from_week, rollover
from research.capsules.week.sheet import (
    Allowed,
    BoardPlace,
    DepthPlace,
    ExpectedScore,
    GameLine,
    LastRead,
    PublishedProjection,
    Status,
    Weather,
    WeekGame,
    WeekSheet,
)
from research.capsules.week.store import StoredWeekRead
from research.db.schema.provider import GAME_TO_PLAY
from research.model.domain import Position
from research.nightly.build.page_club import call_for
from research.nightly.build.player_season import SeasonContext, season_block, season_context
from research.nightly.config import PAGE_FORMAT
from research.nightly.designations import StatusRead, listed_status, read_statuses
from research.nightly.reads.schedule import Game, finals_at, game_states, weeks_left
from research.pipeline.nflverse.team_codes import product_team_code
from research.pipeline.nws.grid import PRECIPITATION_KINDS
from research.season import REGULAR_SEASON_WEEKS

RANKED_POSITIONS: Final = ("QB", "RB", "WR", "TE")
# The hourly capture's game figures, and the game table's weekly read the card falls back to.
LINES_SOURCE: Final = "tank01_lines"
GAME_TABLE_SOURCE: Final = "nflverse_game_figures"
# How old the capture's read may be at the game's instant before the card takes the game table's (the API's
# `FiguresStaleAfter`, five missed hourly captures).
FIGURES_STALE_AFTER: Final = timedelta(hours=6)
# A read is the game's figures only with all three, as the API reads it (`figuresOf`).
_FIGURE_METRICS: Final = ("implied_team_total", "game_total", "point_spread")
FORECAST_SOURCE: Final = "nws_forecast"
_TOUCHDOWNS: Final = ("passing_touchdowns", "rushing_touchdowns", "receiving_touchdowns")
Json = dict[str, Any]


@dataclass(frozen=True, slots=True)
class ClubWeek:
    """A club's week ahead: the week, whether it is the club's bye, and its next game."""

    week: int
    bye: bool
    game: Game | None


def club_week(slate: Sequence[Game], current: int, as_of: datetime) -> ClubWeek | None:
    """The club's week ahead from `current`: its bye week, or its first game not yet kicked off."""
    by_week = {g.week: g for g in slate}
    for week in range(current, REGULAR_SEASON_WEEKS + 1):
        game = by_week.get(week)
        if game is None:
            after = next((g for g in sorted(slate, key=lambda g: g.week) if g.week > week), None)
            return ClubWeek(week, True, after)
        if game.kickoff > as_of:
            return ClubWeek(week, False, game)
    return None


def published_projections(
    conn: Connection, season: int, weeks: Sequence[int], as_of: datetime
) -> dict[tuple[str, int], PublishedProjection]:
    """Each player's published projection for `weeks` by (board id, week), as the card serves it at `as_of`."""
    rows = conn.execute(
        text(
            "with snapshots as (select week, snapshot_id, max(captured_at) as captured_at, "
            "row_number() over (partition by week order by max(captured_at) desc, snapshot_id desc) as n "
            "from research.tank01_projection_rows where season = :s and week = any(:weeks) and captured_at <= :at "
            "group by week, snapshot_id) "
            "select r.provider_player_id as id, r.week, r.ppr_points, s.captured_at, s.n "
            "from research.tank01_projection_rows r join snapshots s on s.snapshot_id = r.snapshot_id "
            "and s.week = r.week where s.n <= 2"
        ),
        {"s": season, "weeks": list(weeks), "at": as_of},
    ).all()
    newest = {(r.id, r.week): r for r in rows if r.n == 1}
    before = {(r.id, r.week): r for r in rows if r.n == 2}  # noqa: PLR2004 - the snapshot before the newest
    out = {}
    for key, row in newest.items():
        prior = before.get(key)
        out[key] = published_projection(
            float(row.ppr_points),
            row.captured_at,
            None if prior is None else float(prior.ppr_points),
            None if prior is None else prior.captured_at,
        )
    return out


def published_projection(
    points: float, captured_at: datetime, previous: float | None, previous_at: datetime | None
) -> PublishedProjection:
    """The week's published projection as the card serves it (`page_figures.projection_tenth`), and the
    snapshot's before it the same way."""
    return PublishedProjection(
        projection_tenth(points), captured_at, None if previous is None else projection_tenth(previous), previous_at
    )


def _team_week_reads(
    conn: Connection, season: int, weeks: Sequence[int], sources: Sequence[str], as_of: datetime
) -> dict[tuple[int, str], tuple[datetime, dict[str, float]]]:
    """Each club-week's newest read (every metric of it) across `sources`, stamped by then and before its kickoff."""
    rows = conn.execute(
        text(
            "with kickoffs as (select week, team, max(as_of) as kickoff from research.team_week_observations "
            "where season = :s and source = 'nflverse_kickoff' and metric = 'kickoff_instant' group by week, team), "
            "newest as (select o.week, o.team, max(o.as_of) as as_of from research.team_week_observations o "
            "left join kickoffs k on k.week = o.week and k.team = o.team where o.season = :s and o.week = any(:weeks) "
            "and o.source = any(:sources) and o.as_of <= :at and (k.kickoff is null or o.as_of < k.kickoff) "
            "group by o.week, o.team) "
            "select o.week, o.team, o.metric, o.value, o.as_of from research.team_week_observations o "
            "join newest n on n.week = o.week and n.team = o.team and n.as_of = o.as_of "
            "where o.season = :s and o.source = any(:sources)"
        ),
        {"s": season, "weeks": list(weeks), "sources": list(sources), "at": as_of},
    )
    out: dict[tuple[int, str], tuple[datetime, dict[str, float]]] = {}
    for row in rows:
        key = (int(row.week), product_team_code(row.team))
        out.setdefault(key, (row.as_of, {}))[1][row.metric] = float(row.value)
    return out


TeamWeekRead = tuple[datetime, dict[str, float]]


def figures_at(
    capture: TeamWeekRead | None, game_table: TeamWeekRead | None, now: datetime, kickoff: datetime
) -> TeamWeekRead | None:
    """The game figures the card shows at `now` (the API's `figuresAt`): the capture's read while it is at most
    `FIGURES_STALE_AFTER` older than the instant (the kickoff once it has passed), else the game table's; a
    read without all three figures is none."""
    capture, game_table = _whole(capture), _whole(game_table)
    instant = min(now, kickoff)
    if capture is None or instant - capture[0] > FIGURES_STALE_AFTER:
        return game_table
    return capture


def _whole(read: TeamWeekRead | None) -> TeamWeekRead | None:
    return read if read is not None and all(metric in read[1] for metric in _FIGURE_METRICS) else None


def expected_from_read(read: tuple[datetime, dict[str, float]] | None) -> ExpectedScore | None:
    """The game's expected score as the card prints it: half points, the opponent's the total less the club's."""
    if read is None:
        return None
    at, values = read
    club, total = values.get("implied_team_total"), values.get("game_total")
    return None if club is None or total is None else ExpectedScore(*expected_score(club, total), at)


def _roofs(
    conn: Connection, season: int, weeks: Sequence[int], as_of: datetime
) -> dict[tuple[int, str], tuple[str, datetime]]:
    """Each club-week's venue roof, from the newest read of its game by then, with that read's stamp."""
    rows = conn.execute(
        text(
            "with newest as (select distinct on (game_id) week, home_team, away_team, stadium_id, stadium, read_at "
            "from research.nflverse_game_reads where season = :s and week = any(:weeks) and read_at <= :at "
            "order by game_id, read_at desc) "
            "select g.week, g.home_team, g.away_team, s.roof_type, g.read_at from newest g "
            "join research.stadiums s on s.stadium_id = g.stadium_id where g.stadium = any(s.aliases)"
        ),
        {"s": season, "weeks": list(weeks), "at": as_of},
    )
    out = {}
    for row in rows:
        for team in (row.home_team, row.away_team):
            out[(int(row.week), product_team_code(team))] = (str(row.roof_type), row.read_at)
    return out


def _schedule_reads(
    conn: Connection, season: int, weeks: Sequence[int], as_of: datetime
) -> dict[tuple[int, str], datetime]:
    """Each club-week's schedule row's read, by then (the kickoff the sheet prints is that row's)."""
    rows = conn.execute(
        text(
            "select week, home_team, away_team, ingested_at from research.provider_games "
            f"where season = :s and week = any(:weeks) and ingested_at <= :at and {GAME_TO_PLAY}"
        ),
        {"s": season, "weeks": list(weeks), "at": as_of},
    )
    return {(int(r.week), team): r.ingested_at for r in rows for team in (r.home_team, r.away_team)}


def board_week(published_from: int | None, pending: Sequence[int]) -> int | None:
    """The site's board week: the first week the published rest-of-season board covers (the API's
    `BoardWeek`), once a game of it is still to come; the first week with a game still to kick off when the
    board's first week has every game kicked off (the Tuesday run after a Monday final reads the board the
    Monday run published, whose first week is played, Lane 256) or when no board is published."""
    if not pending:
        return published_from
    return pending[0] if published_from is None else max(published_from, pending[0])


def _weather(venue: tuple[str, datetime] | None, forecast: tuple[datetime, dict[str, float]] | None) -> Weather | None:
    if venue is None and forecast is None:
        return None
    roof, roof_read_at = (None, None) if venue is None else venue
    at, values = forecast if forecast is not None and roof not in ("dome", "retractable") else (None, {})
    code = values.get("precipitation_kind")
    kind = PRECIPITATION_KINDS[int(code)] if code is not None and 0 <= int(code) < len(PRECIPITATION_KINDS) else None
    return Weather(
        roof,
        values.get("temperature_f"),
        values.get("wind_mph"),
        values.get("precipitation_probability"),
        kind,
        at,
        roof_read_at,
    )


def _boards(conn: Connection, season: int, as_of: datetime) -> dict[str, BoardPlace]:
    rows = conn.execute(
        text(
            "select player_id, rank, position_rank, points, order_basis, from_week, published_at "
            "from research.published_boards where season = :s and format = 'ppr' and published_at <= :at"
        ),
        {"s": season, "at": as_of},
    )
    return {
        r.player_id: BoardPlace(r.rank, r.position_rank, r.points, r.order_basis, r.from_week, r.published_at)
        for r in rows
    }


def _lines_stamp(conn: Connection, season: int, as_of: datetime) -> datetime | None:
    return cast(
        "datetime | None",
        conn.execute(
            text(
                "select max(as_of) from research.player_week_observations where season = :s "
                "and source = 'nflverse_player_week' and as_of <= :at"
            ),
            {"s": season, "at": as_of},
        ).scalar_one(),
    )


def _ranked_players(conn: Connection) -> dict[str, tuple[Position, str | None]]:
    rows = conn.execute(
        text("select id, position, team from research.provider_players where position = any(:p)"),
        {"p": list(RANKED_POSITIONS)},
    )
    return {r.id: (cast("Position", r.position), r.team) for r in rows}


def _blocks(context: SeasonContext, players: Mapping[str, tuple[Position, str | None]]) -> dict[str, Json]:
    """Each player's season block in PPR; a player whose slate does not read (a trade mid-bye) is left out."""
    out = {}
    for pid, (position, _club) in players.items():
        try:
            out[pid] = season_block(pid, PAGE_FORMAT, position, context)
        except ValueError:
            continue
    return out


def allowed_by_opponent(
    context: SeasonContext,
    blocks: Mapping[str, Json],
    players: Mapping[str, tuple[Position, str | None]],
    read_at: datetime,
) -> dict[tuple[str, str], Allowed]:
    """Each club's PPR points allowed a game to each position this season over its games in the records,
    ranked 1 for the fewest (the API's `rankAllowed`): a position with no counted line is not ranked."""
    sums: dict[tuple[str, str], float] = {}
    for pid, block in blocks.items():
        position, team = players[pid]
        clubs = context.store.teams.get(pid, {})
        for row in block["log"]:
            club = clubs.get(row["week"], team)
            if row["status"] == "played" and (club, row["week"]) in context.store.in_records:
                key = (row["opponent"], position)
                sums[key] = sums.get(key, 0.0) + row["points"]
    games: dict[str, int] = {}
    for club, _week in context.store.in_records:
        games[club] = games.get(club, 0) + 1
    out: dict[tuple[str, str], Allowed] = {}
    for position in RANKED_POSITIONS:
        if not any(p == position for (_, p) in sums):
            continue
        rows = sorted(
            ((club, sums.get((club, position), 0.0) / n) for club, n in sorted(games.items()) if n > 0),
            key=lambda row: row[1],
        )
        for rank, (club, per_game) in enumerate(rows, start=1):
            out[(club, position)] = Allowed(rank, len(rows), per_game, position, context.through, read_at)
    return out


@dataclass(frozen=True, slots=True)
class WeekFacts:
    """The night's reads behind every sheet, read once."""

    as_of: datetime
    season: int
    context: SeasonContext
    blocks: Mapping[str, Json]
    allowed: Mapping[tuple[str, str], Allowed]
    weeks: Mapping[str, ClubWeek]
    projections: Mapping[tuple[str, int], PublishedProjection]
    figures: Mapping[tuple[int, str], tuple[datetime, dict[str, float]]]
    game_table: Mapping[tuple[int, str], tuple[datetime, dict[str, float]]]
    forecasts: Mapping[tuple[int, str], tuple[datetime, dict[str, float]]]
    roofs: Mapping[tuple[int, str], tuple[str, datetime]]
    boards: Mapping[str, BoardPlace]
    statuses: Mapping[str, Status]
    schedule_reads: Mapping[tuple[int, str], datetime]
    lines_at: datetime | None
    board_week: int
    # Whether the board week's reads are written on a pass at `as_of` (Lane 256, `rollover`).
    rollover: Rollover


def _status(read: StatusRead | None, player_id: str, at: datetime | None, checked: datetime | None) -> Status:
    """His status on the read for the sheet: the word, and a return this week's day and list (Lane 153)."""
    listed = listed_status(read, player_id)
    if listed is None:
        return Status(None, at, checked)
    return Status(listed.status, at, checked, listed.returning, listed.returning_from)


def read_week_facts(conn: Connection, season: int, subjects: Sequence[Subject], as_of: datetime) -> WeekFacts | None:
    """The night's week facts for `subjects`; None once no game is left to kick off."""
    players = _ranked_players(conn)
    for subject in subjects:
        identity = subject.facts.identity
        players.setdefault(identity.id, (identity.position, identity.team))
    context = season_context(conn, season, list(players), as_of)
    states = game_states(context.games, finals_at(conn, season, as_of), as_of)
    pending = weeks_left(states)
    published_from = published_from_week(conn, season, as_of)
    the_board_week = board_week(published_from, pending)
    if not pending or the_board_week is None:
        return None
    held = projection_held(conn, season, the_board_week, as_of)
    current = pending[0]
    weeks = {
        club: cw
        for club, slate in context.games.items()
        if (cw := club_week(slate, current, as_of)) is not None and cw.week == the_board_week
    }
    wanted = sorted({cw.week for cw in weeks.values()} | {cw.game.week for cw in weeks.values() if cw.game is not None})
    stamp = _lines_stamp(conn, season, as_of)
    blocks = _blocks(context, players)
    read = read_statuses(conn, as_of, now=as_of)
    at, checked = (None, None) if read is None else (read.read_at, read.checked_at)
    statuses = {s.facts.identity.id: _status(read, s.facts.identity.id, at, checked) for s in subjects}
    return WeekFacts(
        as_of,
        season,
        context,
        blocks,
        {} if stamp is None else allowed_by_opponent(context, blocks, players, stamp),
        weeks,
        published_projections(conn, season, wanted, as_of),
        _team_week_reads(conn, season, wanted, (LINES_SOURCE,), as_of),
        _team_week_reads(conn, season, wanted, (GAME_TABLE_SOURCE,), as_of),
        _team_week_reads(conn, season, wanted, (FORECAST_SOURCE,), as_of),
        _roofs(conn, season, wanted, as_of),
        _boards(conn, season, as_of),
        statuses,
        _schedule_reads(conn, season, wanted, as_of),
        stamp,
        the_board_week,
        rollover(the_board_week, context.games, states, published_from, held, as_of),
    )


def last_games(block: Json) -> tuple[GameLine, ...]:
    """His three newest played games, each week's points to the tenth the card prints."""
    played = [row for row in block["log"] if row["status"] == "played"]
    newest = sorted(played, key=lambda row: row["week"], reverse=True)[:3]
    return tuple(
        GameLine(row["week"], row["opponent"], bool(row["home"]), page_tenth(float(row["points"]))) for row in newest
    )


def _touchdowns(block: Json) -> float | None:
    totals = block["totals"]
    values = [totals.get(field) for field in _TOUCHDOWNS]
    return None if any(v is None for v in values) or block["games"] == 0 else float(sum(values))


def _depth(subject: Subject) -> DepthPlace | None:
    """The depth chart from the night's facts pass, stamped by its release day (midnight UTC)."""
    chart = subject.facts.depth.depth_chart
    if chart is None:
        return None
    released = datetime.combine(date.fromisoformat(chart.as_of[:10]), time(), UTC)
    return DepthPlace(chart.slot, tuple((n.name, n.slot) for n in chart.around_him), released)


def last_read_of(stored: StoredWeekRead | None) -> LastRead | None:
    """The read before this one, its projection as the card's tenth (a row kept before the tenth was stored
    reads as the figure the card's "Proj at the read" prints)."""
    if stored is None:
        return None
    points = None if stored.projection_points is None else projection_tenth(stored.projection_points)
    return LastRead(stored.written_at, points, stored.status)


def week_sheet(
    facts: WeekFacts, subject: Subject, stored: Mapping[tuple[str, int], StoredWeekRead]
) -> WeekSheet | None:
    """One subject's sheet, or None when his club has no week ahead, he has no club (a free agent, Lane
    123), or his season does not read."""
    identity = subject.facts.identity
    block = facts.blocks.get(identity.id)
    if block is None:
        return None
    # The page's club (Lane 120): a block is written only for a player the context names a club for.
    club = call_for(facts.context.clubs, identity.id).club
    if club is None:
        return None
    cw = facts.weeks.get(club)
    if cw is None:
        return None
    game = (
        None
        if cw.game is None
        else WeekGame(
            cw.game.week,
            cw.game.opponent,
            cw.game.home,
            cw.game.kickoff,
            facts.schedule_reads.get((cw.game.week, club)),
        )
    )
    key = (cw.week, club)
    log = block["log"]
    return WeekSheet(
        player_id=subject.universe_id,
        name=identity.name,
        position=identity.position,
        team=club,
        season=facts.season,
        week=cw.week,
        written_at=facts.as_of,
        game=game,
        bye=cw.bye,
        projection=facts.projections.get((identity.id, cw.week)),
        expected=None if cw.bye or game is None else expected_from_read(_figures(facts, key, game.kickoff)),
        weather=None if cw.bye else _weather(facts.roofs.get(key), facts.forecasts.get(key)),
        allowed=None if game is None or cw.bye else facts.allowed.get((game.opponent, identity.position)),
        status=facts.statuses.get(identity.id, Status(None, None)),
        depth=_depth(subject),
        last_games=last_games(block),
        points_per_game=block["pointsPerGame"],
        games_played=int(block["games"]),
        touchdowns=_touchdowns(block),
        through=facts.context.through,
        played=tuple(row["week"] for row in log if row["status"] == "played"),
        missed=tuple(row["week"] for row in log if row["status"] == "inactive"),
        board=facts.boards.get(identity.id),
        last_read=last_read_of(stored.get((subject.universe_id, cw.week))),
        lines_at=facts.lines_at,
    )


def _figures(facts: WeekFacts, key: tuple[int, str], kickoff: datetime) -> TeamWeekRead | None:
    return figures_at(facts.figures.get(key), facts.game_table.get(key), facts.as_of, kickoff)


def collect_week_sheets(
    facts: WeekFacts, subjects: Sequence[Subject], stored: Mapping[tuple[str, int], StoredWeekRead]
) -> list[WeekSheet]:
    """Every subject's sheet that reads, in the subjects' (board) order."""
    sheets = (week_sheet(facts, subject, stored) for subject in subjects)
    return [sheet for sheet in sheets if sheet is not None]
