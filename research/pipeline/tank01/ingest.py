"""THE STATS PROVIDER'S INGESTS: the roster and its weekly lines, the fixtures, and the ADP column.

`ingest_roster_and_lines` is `seedPlayers` (`src/data/seed/seed-players.ts`): the roster upserted
into `players` (ADP left alone: only the ADP feed writes it; a stored club too, the daily list's, Lane
127), then every week's box scores into `provider_stat_lines`, one line per player, upserted. `ingest_schedule` is the stats pipeline's
fixture walk into `provider_games` (`stats-pipeline/schedule.ts`). `ingest_adp` is its ADP enrichment
(`stats-pipeline/adp.ts`): an UPDATE of `players.adp` and `pos_adp`, never an insert.

NOT PORTED, ON PURPOSE: the live-scoring worker (`stats-pipeline/worker.ts`) that ticks a week
in progress, settles matchups and publishes scores. It is the league platform's machinery (it
reads `matchups`, sets lineups, publishes to leagues), and the league platform is not part of the
prep site.
"""

import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Final

from sqlalchemy import Connection, delete, select, text, update
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import PROVIDER_GAMES, PROVIDER_PLAYERS, PROVIDER_STAT_LINES, PROVIDER_WEEKS
from research.db.upsert import excluded_set
from research.pipeline.budget import RequestBudget, UnmeteredBudget, reserve_or_raise
from research.pipeline.checkpoint import Checkpoint, no_checkpoint
from research.pipeline.crosswalk import respell_provider_names
from research.pipeline.tank01.mapping import GameSummary, Player, StatLine, deduped_by_player_id
from research.pipeline.tank01.provider import LIST_ADP_REQUEST_COST, LIST_PLAYERS_REQUEST_COST, Tank01Provider

LOG: Final = logging.getLogger(__name__)
_SEED_BATCH = 500


def _chunks[T](items: list[T], size: int) -> list[list[T]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


_STAT_LINE_KEY = ("season", "week", "provider_player_id")
_STAT_COLUMNS = tuple(c.name for c in PROVIDER_STAT_LINES.columns if c.name not in _STAT_LINE_KEY)


def _stat_line_row(season: int, line: StatLine) -> dict[str, object]:
    """Every column named, a stat the box score left out written as the zero it means (Tank01
    omits a category the player did not record; the TypeScript leaves the field out and its
    legacy column's default fills the same zero, and the research table has no default)."""
    return {
        "season": season,
        "week": line.week,
        "provider_player_id": line.player_id,
        **{c: line.values.get(c, 0.0) for c in _STAT_COLUMNS},
    }


@dataclass(frozen=True)
class SeedReport:
    """What the seed wrote: every listed player's name, position and headshot, a club only on the rows
    it created (`new_players`), and the week lines. The operator's command prints it as it reads."""

    players: int
    stat_lines: int
    new_players: int = 0

    def __str__(self) -> str:
        return (
            f"{self.players} players' names, positions and headshots ({self.new_players} new, each with the "
            f"list's club; no stored club rewritten, the daily list owns it), {self.stat_lines} stat lines"
        )


# THE CLUB IS THE DAILY LIST'S (Lane 127, B103): the seed's roster read is as old as its run, so its club
# never overwrites a stored one (`player_clubs` keeps the column current). A row the seed creates takes
# the list's club, since the daily list inserts no player.
_ROSTER_KEEPS: Final = ("id", "adp", "team")


def _upsert_roster(conn: Connection, players: list[Player]) -> int:
    """The roster upserted; how many rows it created."""
    created = 0
    for batch in _chunks(players, _SEED_BATCH):
        rows = [
            {"id": p.id, "name": p.name, "position": p.position, "team": p.nfl_team, "headshot_url": p.headshot_url}
            for p in batch
        ]
        statement = insert(PROVIDER_PLAYERS).values(rows)
        update_set = excluded_set(statement, PROVIDER_PLAYERS, _ROSTER_KEEPS)
        upsert = statement.on_conflict_do_update(index_elements=[PROVIDER_PLAYERS.c.id], set_=update_set)
        # Postgres leaves xmax at 0 on a row the statement inserted and sets it on one it updated.
        inserted = conn.execute(upsert.returning(text("xmax = 0"))).scalars().all()
        created += sum(1 for was_inserted in inserted if was_inserted)
    return created


def retire_other_seasons(conn: Connection, season: int) -> int:
    """THE ROLLOVER RULE (`research.db.schema.provider`): the store holds one season, so before a
    writer stores `season` every row of any other season goes, in the writer's own transaction."""
    retired = 0
    for table in (PROVIDER_STAT_LINES, PROVIDER_GAMES, PROVIDER_WEEKS):
        retired += len(conn.execute(delete(table).where(table.c.season != season).returning(table.c.season)).all())
    return retired


def _upsert_week(conn: Connection, season: int, week_lines: list[StatLine]) -> None:
    for batch in _chunks(week_lines, _SEED_BATCH):
        statement = insert(PROVIDER_STAT_LINES).values([_stat_line_row(season, line) for line in batch])
        keys = [PROVIDER_STAT_LINES.c[c] for c in _STAT_LINE_KEY]
        update_set = excluded_set(statement, PROVIDER_STAT_LINES, _STAT_LINE_KEY)
        conn.execute(statement.on_conflict_do_update(index_elements=keys, set_=update_set))


def ingest_roster_and_lines(
    conn: Connection,
    provider: Tank01Provider,
    budget: RequestBudget | None = None,
    checkpoint: Checkpoint = no_checkpoint,
) -> SeedReport:
    """`seedPlayers`: the roster, then weeks 1 through the provider's last week of box scores.

    NOT ATOMIC, AS THE TYPESCRIPT IS NOT: `checkpoint` is called after the roster and after each
    week, so a run stopped mid-season keeps every week it wrote and a re-run finishes the rest
    (every write is an idempotent upsert)."""
    ledger = budget if budget is not None else UnmeteredBudget()
    reserve_or_raise(ledger, LIST_PLAYERS_REQUEST_COST, "the player list")
    players = provider.list_players()
    retire_other_seasons(conn, provider.season)
    created = _upsert_roster(conn, players)
    # The provider's spelling was just written back; a crossed player keeps his own (Lane 78).
    LOG.info("tank01 roster: %s", respell_provider_names(conn).line())
    checkpoint()
    stat_count = 0
    for week in range(1, provider.last_week_of_season + 1):
        reserve_or_raise(ledger, 1, f"week {week}'s schedule")
        games = provider.list_games(week)
        if not games:
            continue
        reserve_or_raise(ledger, len(games), f"week {week}'s {len(games)} box scores")
        lines = [line for game in games for line in provider.get_game_stat_lines(game)]
        if not lines:
            continue
        week_lines = deduped_by_player_id(lines)
        _upsert_week(conn, provider.season, week_lines)
        checkpoint()
        stat_count += len(week_lines)
    return SeedReport(players=len(players), stat_lines=stat_count, new_players=created)


def _provider_date(raw: str) -> date | None:
    """The provider's `YYYYMMDD`, or None where it sent none."""
    return None if raw == "" else datetime.strptime(raw, "%Y%m%d").replace(tzinfo=UTC).date()


@dataclass(frozen=True)
class ScheduleIngestResult:
    weeks: int
    games: int
    # Stored games marked superseded this run (a moved game's old id, B77b).
    superseded: int = 0


def _clubs(home: str, away: str) -> frozenset[str]:
    return frozenset((home, away))


def supersede_moved_games(conn: Connection, season: int, week: int, fixtures: Sequence[GameSummary]) -> int:
    """THE MOVED GAME (B77b): a stored game of the week whose id the provider's week no longer lists, while
    it lists the same two clubs under another id (the id carries the date, so a date change is a new id),
    is marked superseded by that id, in the ingest's transaction. A stored game with no such pair (the
    provider dropped it outright) is left as it stands. The rows marked."""
    t = PROVIDER_GAMES
    listed = {game.game_id for game in fixtures}
    by_clubs = {_clubs(game.home_nfl_team, game.away_nfl_team): game.game_id for game in fixtures}
    stored = conn.execute(
        select(t.c.game_id, t.c.home_team, t.c.away_team, t.c.superseded_by).where(
            t.c.season == season, t.c.week == week
        )
    ).all()
    marked = 0
    for row in stored:
        new_id = by_clubs.get(_clubs(str(row.home_team), str(row.away_team)))
        if row.game_id in listed or new_id is None or row.superseded_by == new_id:
            continue
        conn.execute(update(t).where(t.c.game_id == row.game_id).values(superseded_by=new_id))
        LOG.info("tank01 schedule: week %d %s superseded by %s", week, row.game_id, new_id)
        marked += 1
    return marked


def ingest_schedule(conn: Connection, provider: Tank01Provider, budget: RequestBudget) -> ScheduleIngestResult:
    """Every fixture of weeks 1 through the last, upserted on its own id (a flexed kickoff lands, and a
    listed id is a game to play again); then each week's moved games marked superseded."""
    weeks = 0
    games = 0
    superseded = 0
    retire_other_seasons(conn, provider.season)
    for week in range(1, provider.last_week_of_season + 1):
        reserve_or_raise(budget, 1, f"week {week}'s schedule")
        fixtures = provider.list_games(week)
        if not fixtures:
            continue
        statement = insert(PROVIDER_GAMES).values(
            [
                {
                    "game_id": game.game_id,
                    "season": provider.season,
                    "week": game.week,
                    "home_team": game.home_nfl_team,
                    "away_team": game.away_nfl_team,
                    "game_date": _provider_date(game.game_date),
                    "kickoff_et": game.kickoff_et or None,
                    "status": game.status,
                    "superseded_by": None,
                }
                for game in fixtures
            ]
        )
        conn.execute(
            statement.on_conflict_do_update(
                index_elements=[PROVIDER_GAMES.c.game_id], set_=excluded_set(statement, PROVIDER_GAMES, ("game_id",))
            )
        )
        superseded += supersede_moved_games(conn, provider.season, week, fixtures)
        weeks += 1
        games += len(fixtures)
    return ScheduleIngestResult(weeks=weeks, games=games, superseded=superseded)


@dataclass(frozen=True)
class AdpIngestResult:
    adp_entries: int
    players_updated: int


def ingest_adp(conn: Connection, provider: Tank01Provider, budget: RequestBudget) -> AdpIngestResult:
    """`ingestAdp`: one absolute-value UPDATE keyed by player id; a ranked player with no row lands on nothing."""
    reserve_or_raise(budget, LIST_PLAYERS_REQUEST_COST, "the player list")
    provider.list_players()
    reserve_or_raise(budget, LIST_ADP_REQUEST_COST, "the ADP feed")
    entries = provider.list_adp()
    if not entries:
        return AdpIngestResult(0, 0)
    feed = json.dumps([{"id": e.player_id, "adp": e.adp, "pos_adp": e.pos_adp} for e in entries])
    updated = conn.execute(
        text(
            f"update {PROVIDER_PLAYERS.fullname} as p set adp = data.adp, pos_adp = data.pos_adp "
            "from jsonb_to_recordset(cast(:feed as jsonb)) as data(id text, adp double precision, pos_adp text) "
            "where p.id = data.id returning p.id"
        ),
        {"feed": feed},
    ).all()
    return AdpIngestResult(adp_entries=len(entries), players_updated=len(updated))


def backfill_headshots(conn: Connection, provider: Tank01Provider) -> int:
    """`backfill-headshots.ts`: each listed player's headshot URL onto his existing row, never an insert."""
    updated = 0
    for player in provider.list_players():
        if player.headshot_url is None:
            continue
        statement = (
            update(PROVIDER_PLAYERS)
            .where(PROVIDER_PLAYERS.c.id == player.id)
            .values(headshot_url=player.headshot_url)
            .returning(PROVIDER_PLAYERS.c.id)
        )
        updated += len(conn.execute(statement).all())
    return updated
