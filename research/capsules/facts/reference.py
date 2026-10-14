"""THE PROVIDER'S LATEST INJURY AND NEWS CAPTURES, as a capsule reads them.

Ported from `research-ts/src/reference/{injuries,news}.ts`. The injury read is tri-state: no capture
ever ("unknown", never a healthy claim), a capture that does not name him ("clean", dated), or one
that does ("designated"). News is the newest capture's headlines whose prefix before the colon is
his name, at most three, in the capture's order.

Two departures from the oracle (phase D fix round 3):
- An injury status is dated by the Eastern day it began (the first capture of the unbroken run of
  captures showing it), never a capture's own instant or day (fix rounds 3 and 4). The facts hash is
  over the sheet, so a night that sees the same status hashes the same sheet and rewrites nothing:
  with the capture's instant every capture moved 436 of 536 sheets, and with its day every night moved
  all 536.
- Both reads take the newest capture at or before the sheet's instant, so a sheet read as of a past
  instant is that instant's sheet (the recorded parity case reads one).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, text

from research.capsules.facts.model import InjuryClean, InjuryDesignated, InjuryStatus, InjuryUnknown, NewsItem
from research.model.instants import ms_instant

INJURY_SOURCE: Final = "tank01_injuries_by_date"
NEWS_SOURCE: Final = "tank01_news"
_STORIES_PER_PLAYER: Final = 3
# The league's own clock: a capture at 02:00 UTC on October 14 is October 13's report.
EASTERN: Final = ZoneInfo("America/New_York")


def capture_day(captured_at: datetime) -> str:
    """The calendar day, in Eastern time, a capture belongs to: what the sheet prints and hashes."""
    return captured_at.astimezone(EASTERN).date().isoformat()


@dataclass(frozen=True, slots=True)
class InjurySnapshot:
    """Each player's status on the newest capture, with the Eastern day that status began."""

    captured_at: datetime | None
    # Feed player id to (designation, the day the run of that designation began); clean is None.
    runs: Mapping[str, tuple[str | None, str]]
    first_day: str

    def status_for(self, player_id: str) -> InjuryStatus:
        """`injuryStatusFor`, dated by the day his current status began."""
        if self.captured_at is None:
            return InjuryUnknown("unknown")
        designation, since = self.runs.get(player_id, (None, self.first_day))
        return (
            InjuryClean("clean", since) if designation is None else InjuryDesignated("designated", designation, since)
        )


def _designations(entries: object) -> dict[str, str]:
    """Each `[playerID, designation]` pair the capture lists (`_INJURY_ENTRIES`), the last one a
    player has winning; an entry without a text id and a non-empty text designation is skipped."""
    designations: dict[str, str] = {}
    for entry in entries if isinstance(entries, list) else []:
        player_id, designation = entry if isinstance(entry, list) and len(entry) == 2 else (None, None)  # noqa: PLR2004 - a pair
        if isinstance(player_id, str) and isinstance(designation, str) and designation != "":
            designations[player_id] = designation
    return designations


# The injury captures' `injList`, each entry as its `[playerID, designation]` pair in the list's order,
# projected on the server: the payload is about fifty kilobytes a capture and the snapshot reads every
# capture of the season, so shipping whole payloads moved some 22 MB a facts pass for these two fields.
# An entry that is not an object, or a payload with no `injList` array, projects as nothing to read,
# as the payload read in Python found nothing in it.
_INJURY_ENTRIES: Final = text(
    "select captured_at, case when jsonb_typeof(payload) = 'object' and jsonb_typeof(payload->'injList') = 'array' "
    "then (select coalesce(jsonb_agg(jsonb_build_array(e->'playerID', e->'designation') order by n), '[]'::jsonb) "
    "from jsonb_array_elements(payload->'injList') with ordinality as listed(e, n)) else '[]'::jsonb end as entries "
    "from research.capture_snapshots where source = :source and captured_at <= :as_of order by captured_at"
)


def _latest(conn: Connection, source: str, as_of: datetime) -> tuple[object, datetime | None]:
    row = conn.execute(
        text(
            "select payload, captured_at from research.capture_snapshots where source = :source "
            "and captured_at <= :as_of order by captured_at desc limit 1"
        ),
        {"source": source, "as_of": as_of},
    ).first()
    return (None, None) if row is None else (row.payload, ms_instant(row.captured_at))


def injury_snapshot(conn: Connection, as_of: datetime) -> InjurySnapshot:
    """Every by-date injury capture at or before `as_of`, oldest first: each player's status on the
    newest, dated by the first capture of its unbroken run (fix round 4, review N1)."""
    rows = conn.execute(_INJURY_ENTRIES, {"source": INJURY_SOURCE, "as_of": as_of}).all()
    if not rows:
        return InjurySnapshot(None, {}, "")
    runs: dict[str, tuple[str | None, str]] = {}
    for row in rows:
        day = capture_day(ms_instant(row.captured_at))
        designations = _designations(row.entries)
        for player_id, designation in designations.items():
            if runs.get(player_id, (None, ""))[0] != designation:
                runs[player_id] = (designation, day)
        for player_id, (held, _) in list(runs.items()):
            if held is not None and player_id not in designations:
                runs[player_id] = (None, day)
    return InjurySnapshot(ms_instant(rows[-1].captured_at), runs, capture_day(ms_instant(rows[0].captured_at)))


def _story(raw: object) -> NewsItem | None:
    entry = raw if isinstance(raw, dict) else {}
    title = entry.get("title") if isinstance(entry.get("title"), str) else ""
    link = entry.get("link") if isinstance(entry.get("link"), str) else ""
    if title == "" or link == "":
        return None
    date = entry.get("date")
    return NewsItem(str(title), str(link), date if isinstance(date, str) and date != "" else None)


def news_for_players(conn: Connection, names: Sequence[str], as_of: datetime) -> dict[str, list[NewsItem]]:
    """`newsForPlayers`: up to three of the newest capture's headlines per name, as of `as_of`."""
    by_name: dict[str, list[NewsItem]] = {name: [] for name in names}
    if not names:
        return by_name
    payload, _ = _latest(conn, NEWS_SOURCE, as_of)
    for raw in payload if isinstance(payload, list) else []:
        story = _story(raw)
        if story is None or ":" not in story.title:
            continue
        bucket = by_name.get(story.title[: story.title.index(":")])
        if bucket is not None and len(bucket) < _STORIES_PER_PLAYER:
            bucket.append(story)
    return by_name
