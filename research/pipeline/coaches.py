"""THE PLAY-CALLER TABLE (`src/projections/nflverse/play-callers.ts`, `src/coaches/store.ts`,
`scripts/lib/play-callers-csv.ts`).

A hand-curated CSV (`data/play-callers/play-callers.csv`, sourced from Wikipedia and Pro Football
Reference) is the one-time SEED of the `coaches` table: parsed strictly, validated for full week
coverage of every team-season 1999-2026 and a head coach for 2026, and refused whole on any
problem. Every runtime reader reads the TABLE, never the file. The lookup answers who called plays
for a team in a given week.
"""

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import Connection, select
from sqlalchemy.dialects.postgresql import insert

from research.db.schema import COACHES
from research.db.upsert import excluded_set
from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_is_finite, js_is_integer, js_number, js_trim
from research.pipeline.nflverse.team_eras import FACT_SEASONS, final_week_of, nfl_teams_by_season

PLAY_CALLERS_CSV_PATH = "data/play-callers/play-callers.csv"
HEAD_COACH_SEASONS: tuple[int, ...] = (2026,)
_COLUMNS = ("season", "team", "name", "role", "start_week", "end_week", "source", "note")
_HEAD_COACH_COLUMNS = ("head_coach", "head_coach_first_season")
_ROLES = frozenset({"HC", "OC"})
_SOURCES = frozenset({"wikipedia", "pfr", "both"})
_TENURE_KEY = ("id", "season", "team", "role", "start_week")


@dataclass(frozen=True)
class PlayCallerRow:
    season: int
    team: str
    name: str
    role: str
    start_week: int
    end_week: int
    source: str
    note: str
    head_coach: str
    head_coach_first_season: int | None


def _fail(line: int, what: str) -> SchemaDriftError:
    return SchemaDriftError(f"play-callers.csv line {line}: {what}")


def _integer(raw: str, line: int, what: str) -> int:
    value = js_number(raw)
    if js_trim(raw) == "" or not js_is_finite(value) or not js_is_integer(value):
        raise _fail(line, f"{what} (got {json.dumps(raw)}).")
    return int(value)


def parse_play_callers(csv: str) -> list[PlayCallerRow]:
    """`parsePlayCallers`: a plain comma split (the file never quotes), every field checked."""
    lines = csv.replace("\r\n", "\n").split("\n")
    rows: list[PlayCallerRow] = []
    for index in range(1, len(lines)):
        raw = lines[index]
        if js_trim(raw) == "":
            continue
        number = index + 1
        fields = raw.split(",")
        if len(fields) not in (len(_COLUMNS), len(_COLUMNS) + len(_HEAD_COACH_COLUMNS)):
            raise _fail(
                number,
                f"expected {len(_COLUMNS)} or {len(_COLUMNS) + 2} columns ({','.join((*_COLUMNS, *_HEAD_COACH_COLUMNS))}), "
                f"got {len(fields)}.",
            )
        season_raw, team, name, role, start_raw, end_raw, source, note = fields[:8]
        head_coach = js_trim(fields[8]) if len(fields) > 8 else ""
        first_raw = js_trim(fields[9]) if len(fields) > 9 else ""
        if (head_coach == "") != (first_raw == ""):
            raise _fail(
                number, "head_coach and head_coach_first_season must be filled together or left blank together."
            )
        first_season = None
        if first_raw != "":
            value = js_number(first_raw)
            if not js_is_finite(value) or not js_is_integer(value):
                raise _fail(number, f"head_coach_first_season must be an integer season (got {json.dumps(first_raw)}).")
            first_season = int(value)
        season = _integer(season_raw, number, "season must be an integer")
        if role not in _ROLES:
            raise _fail(number, f"role must be HC or OC (got {json.dumps(role)}).")
        if source not in _SOURCES:
            raise _fail(number, f"source must be wikipedia, pfr, or both (got {json.dumps(source)}).")
        start = _integer(start_raw, number, "start_week must be an integer week")
        end = _integer(end_raw, number, "end_week must be an integer week")
        rows.append(PlayCallerRow(season, team, name, role, start, end, source, note, head_coach, first_season))
    return rows


def _rows_for(rows: Sequence[PlayCallerRow], season: int, team: str) -> list[PlayCallerRow]:
    return sorted((r for r in rows if r.season == season and r.team == team), key=lambda r: r.start_week)


def validate_play_callers(
    rows: Sequence[PlayCallerRow],
    seasons: Sequence[int] = FACT_SEASONS,
    teams_by_season: Callable[[int], Sequence[str]] = nfl_teams_by_season,
    head_coach_seasons: Sequence[int] = HEAD_COACH_SEASONS,
) -> list[str]:
    """`validatePlayCallers`: every problem, named; an empty list means the file may be written."""
    problems: list[str] = []
    for row in rows:
        if js_trim(row.name) == "":
            problems.append(f"{row.team} {row.season}: empty name for weeks {row.start_week}-{row.end_week}.")
        if row.start_week > row.end_week:
            problems.append(f"{row.team} {row.season}: start_week {row.start_week} is after end_week {row.end_week}.")
    for season in seasons:
        final_week = final_week_of(season)
        for team in teams_by_season(season):
            team_rows = [r for r in _rows_for(rows, season, team) if r.start_week <= r.end_week]
            if not team_rows:
                problems.append(f"{team} {season}: no play-caller rows.")
                continue
            covered = 0
            for r in team_rows:
                if r.start_week > covered + 1:
                    problems.append(f"{team} {season}: gap in week coverage between {covered} and {r.start_week}.")
                elif r.start_week <= covered:
                    problems.append(f"{team} {season}: overlapping week ranges around week {r.start_week}.")
                covered = max(covered, r.end_week)
            if covered < final_week:
                problems.append(f"{team} {season}: gap in week coverage between {covered} and {final_week}.")
    for season in head_coach_seasons:
        for team in teams_by_season(season):
            named = [r for r in _rows_for(rows, season, team) if r.head_coach != ""]
            if not named:
                problems.append(f"{team} {season}: empty head_coach.")
                continue
            distinct = list(
                dict.fromkeys(
                    f"{r.head_coach}|{'' if r.head_coach_first_season is None else r.head_coach_first_season}"
                    for r in named
                )
            )
            if len(distinct) > 1:
                problems.append(f"{team} {season}: rows disagree about the head coach ({' and '.join(distinct)}).")
    return problems


def upsert_coach_rows(conn: Connection, rows: Sequence[PlayCallerRow]) -> int:
    """`upsertCoachRows`: one statement, upserted on the tenure key."""
    if not rows:
        return 0
    statement = insert(COACHES).values(
        [
            {
                "season": r.season,
                "team": r.team,
                "role": r.role,
                "name": r.name,
                "start_week": r.start_week,
                "end_week": r.end_week,
                "source": r.source,
                "note": r.note,
                "head_coach": None if r.head_coach == "" else r.head_coach,
                "head_coach_first_season": None if r.head_coach == "" else r.head_coach_first_season,
            }
            for r in rows
        ]
    )
    upsert = statement.on_conflict_do_update(
        index_elements=[COACHES.c.season, COACHES.c.team, COACHES.c.role, COACHES.c.start_week],
        set_=excluded_set(statement, COACHES, _TENURE_KEY),
    ).returning(COACHES.c.id)
    return len(conn.execute(upsert).all())


def ingest_play_callers_csv(conn: Connection, csv_path: Path) -> int:
    """`ingestPlayCallersCsv`: refuse the whole file on any problem, otherwise upsert every row."""
    rows = parse_play_callers(csv_path.read_text(encoding="utf-8"))
    problems = validate_play_callers(rows)
    if problems:
        raise SchemaDriftError(f"{csv_path} failed validation, nothing written:\n" + "\n".join(problems))
    return upsert_coach_rows(conn, rows)


def read_coach_rows(conn: Connection) -> list[PlayCallerRow]:
    """`readCoachRows`: the table, in season, team, start week, role order."""
    query = select(COACHES).order_by(COACHES.c.season, COACHES.c.team, COACHES.c.start_week, COACHES.c.role)
    rows: list[PlayCallerRow] = []
    for r in conn.execute(query).mappings():
        if r["role"] not in _ROLES or r["source"] not in _SOURCES:
            raise SchemaDriftError(f"coaches row {r['id']} holds a role or source no reader understands.")
        rows.append(
            PlayCallerRow(
                r["season"], r["team"], r["name"], r["role"], r["start_week"], r["end_week"], r["source"], r["note"],
                r["head_coach"] or "", r["head_coach_first_season"],
            )
        )  # fmt: skip
    return rows


PlayCallerLookup = Callable[[str, int, int], str | None]


def play_caller_lookup(rows: Sequence[PlayCallerRow]) -> PlayCallerLookup:
    """`playCallerLookup`: the first row (in table order) covering the week, or None."""
    by_team_season: dict[str, list[PlayCallerRow]] = {}
    for row in rows:
        by_team_season.setdefault(f"{row.team}|{row.season}", []).append(row)

    def lookup(team: str, season: int, week: int) -> str | None:
        for r in by_team_season.get(f"{team}|{season}", []):
            if r.start_week <= week <= r.end_week:
                return r.name
        return None

    return lookup
