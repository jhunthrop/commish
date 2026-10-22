"""EACH LISTED PLAYER'S RUN UNDER HIS STATUS, READ AS THE API READS IT (Lane 134).

The run read is one text for both lanes: `RUNS_QUERY` is `api/internal/boards/designation_runs.sql`
byte for byte (the API embeds the file; `tests/test_designation_dating.py` pins this copy to it). For
each player the by-date capture at `newest` lists, the first capture of his unbroken run under that
status, over the captures in the window that pass the floor; a run that reaches the window's oldest
capture is left out (we do not know when it began).

THE VERSION (B114). `RUNS_VERSION` names what the read answers for a capture: a digest of its text,
its window, its capture cap and the code table, derived here as the API derives `boards.RunsVersion`,
so a change to any input is a new version without anyone bumping a constant. The shared dating's
digest carries it (`designation_dating.py`).
"""

import hashlib
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Final

from sqlalchemy import Connection, bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.types import Text

from research.db.schema import CAPTURE_SNAPSHOTS
from research.model.designations import CODES

BY_DATE_SOURCE: Final = "tank01_injuries_by_date"
# The read looks back this far and over at most this many captures (hourly, about two months).
RUN_WINDOW: Final = timedelta(days=60)
MAX_RUN_CAPTURES: Final = 2000
_TABLE_MARK: Final = "{{capture_snapshots}}"

RUNS_QUERY: Final = """with listed_caps as materialized (
  select payload, captured_at, (
    select count(distinct btrim(e->>'playerID')) from jsonb_array_elements(payload->'injList') as e
    where btrim(coalesce(e->>'playerID', '')) <> '' and btrim(coalesce(e->>'designation', '')) <> ''
  ) as n_listed
  from {{capture_snapshots}}
  where source = :source and captured_at <= :newest and captured_at > :oldest and jsonb_typeof(payload->'injList') = 'array'
), floored as (
  select payload, captured_at, n_listed, lead(n_listed) over (order by captured_at desc) as n_before
  from listed_caps where n_listed > 0
), caps as (
  select payload, captured_at, row_number() over (order by captured_at desc) as n
  from floored
  where n_before is null or 2 * n_listed >= n_before
  order by captured_at desc limit :most
), listed as (
  select c.n, c.captured_at, btrim(e->>'playerID') as player_id, m.status
  from caps c cross join lateral jsonb_array_elements(c.payload->'injList') as e
  join unnest(cast(:codes as text[]), cast(:statuses as text[])) as m(code, status) on m.code = upper(btrim(e->>'designation'))
  where btrim(coalesce(e->>'playerID', '')) <> ''
), runs as (
  select player_id, status, n, captured_at, n - row_number() over (partition by player_id, status order by n) as gap
  from listed
)
select player_id, status, min(captured_at) as since
from runs where gap = 0 group by player_id, status
having max(n) < (select count(*) from caps)
"""

_RUNS: Final = text(RUNS_QUERY.replace(_TABLE_MARK, CAPTURE_SNAPSHOTS.fullname)).bindparams(
    bindparam("codes", type_=ARRAY(Text)), bindparam("statuses", type_=ARRAY(Text))
)


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def runs_version_of(query: str, window: timedelta, captures: int, codes: Mapping[str, str]) -> str:
    """`boards.runsVersionOf`: "runs-" and the first 16 hex of the sha256 of the inputs' canonical lines,
    the query's sha256, the window in seconds, the capture cap, then each code and its status in code
    order."""
    lines = [
        f"query {_sha256(query)}",
        f"window_seconds {int(window.total_seconds())}",
        f"captures {captures}",
        *(f"code {code}\t{codes[code]}" for code in sorted(codes)),
    ]
    return "runs-" + _sha256("".join(f"{line}\n" for line in lines))[:16]


RUNS_VERSION: Final = runs_version_of(RUNS_QUERY, RUN_WINDOW, MAX_RUN_CAPTURES, CODES)


def designation_runs(conn: Connection, newest: datetime) -> dict[tuple[str, str], datetime]:
    """`boards.PGSource.DesignationRuns`: each (player, status) the capture at `newest` lists, with the
    first capture of his unbroken run under it, in UTC at the store's precision."""
    codes = sorted(CODES)
    rows = conn.execute(
        _RUNS,
        {
            "source": BY_DATE_SOURCE,
            "newest": newest,
            "oldest": newest - RUN_WINDOW,
            "most": MAX_RUN_CAPTURES,
            "codes": codes,
            "statuses": [CODES[code] for code in codes],
        },
    )
    return {(r.player_id, r.status): r.since.astimezone(UTC) for r in rows}
