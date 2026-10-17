"""THE BOARDS, THE PLAYER PAGES AND THE SEARCH INDEX, in the web's run format (`web/src/lib/run/schema.ts`).

A board row is one format's numbers for one player. A player page inlines every format the run
carries that ranks him, and the capsule: the writer's long read (`body_full`), with its pull
figures, the page's own numbers that the read prints word for word (`capsules.pull_figures`), drawn
from the PPR board row the writer read. A page whose capsule the writer did not write (a facts block,
the oracle's template, none) carries no capsule: its numbers are already on the page, and the
capsule gate counts it against the 2% line.
"""

import math
import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from research.capsules.pull_figures import PageValues, page_numbers, pull_figures_of
from research.capsules.store import WRITTEN_SOURCE, StoredCapsule
from research.capsules.week.caption import written_caption
from research.capsules.week.store import StoredWeekRead
from research.model.instants import js_iso
from research.nightly.build.player_season import SeasonContext, season_block
from research.nightly.config import PAGE_FORMAT, TEAMS, RunFormat
from research.nightly.reads.board import BoardEntry, FormatBoard
from research.nightly.reads.schedule import Game

# The run names a team defense as the site does.
WEB_POSITION: Final = {"QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "K": "K", "DEF": "DST"}
# Each pull figure's caption, the page number it counts in a few words, in the PPR board's unit.
PULL_CAPTIONS: Final = {
    "projected points": "projected PPR points",
    "ceiling": "PPR points in his ceiling season",
    "floor": "PPR points in his floor season",
    "median": "PPR points in his middle season",
    "points over replacement": "PPR points over replacement",
    "drop to the next tier": "PPR points to the next tier",
    "ADP": "his ADP in PPR drafts",
}
Json = dict[str, Any]


def slug_of(name: str) -> str:
    """The web's slug rule (`run-from-mock-data.ts`): accents dropped, lower case, words joined by hyphens."""
    plain = unicodedata.normalize("NFD", name)
    plain = "".join(ch for ch in plain if not unicodedata.combining(ch)).lower()
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", plain))


@dataclass(frozen=True, slots=True)
class Identity:
    id: str
    slug: str
    name: str
    position: str
    team: str
    headshot: str | None


def identities(boards: Sequence[FormatBoard]) -> list[Identity]:
    """Every player any board ranks, in the first board's order then the rest's; a shared name's
    slug takes his position and club."""
    seen: dict[str, BoardEntry] = {}
    for board in boards:
        for entry in board.entries:
            seen.setdefault(entry.row.player_id, entry)
    counts: dict[str, int] = {}
    for entry in seen.values():
        counts[slug_of(entry.row.name)] = counts.get(slug_of(entry.row.name), 0) + 1
    out = []
    for player_id, entry in seen.items():
        row = entry.row
        base = slug_of(row.name)
        slug = base if counts[base] == 1 else f"{base}-{row.position.lower()}-{row.team.lower()}"
        out.append(Identity(player_id, slug, row.name, WEB_POSITION[row.position], row.team, row.headshot_url))
    return out


def numbers_of(entry: BoardEntry, adp: float | None) -> Json:
    """A board row without the identity: the page's numbers for one format (`playerFormatSchema`)."""
    row = entry.row
    numbers: Json = {
        "positionRank": entry.position_rank,
        "ourRank": entry.our_rank,
        "vorRound": math.ceil(entry.our_rank / TEAMS),
        "adp": adp,
        "projected": row.projected,
        "vor": entry.value_over_replacement,
        "expectedGames": row.expected_games,
        "floor": row.floor,
        "median": row.median,
        "ceiling": row.ceiling,
        "tier": entry.tier,
    }
    if entry.in_season:
        # In season, beside the rest-of-season figures: where the preseason board had him, or null
        # for a player it did not rank.
        before = entry.preseason
        numbers |= {
            "preseasonRank": None if before is None else before.our_rank,
            "preseasonPoints": None if before is None else before.row.projected,
        }
    return numbers


def board_json(board: FormatBoard, slugs: Mapping[str, Identity], adp: Mapping[str, float]) -> Json:
    rows = []
    for entry in board.entries:
        who = slugs[entry.row.player_id]
        rows.append(
            {
                "id": who.id,
                "slug": who.slug,
                "name": who.name,
                "position": who.position,
                "team": who.team,
                "headshot": who.headshot,
                **numbers_of(entry, adp.get(who.id)),
            }
        )
    return {"format": board.format.id, "rows": rows}


def page_values(entry: BoardEntry, adp: float | None) -> PageValues | None:
    """The numbers his capsule was written about: the preseason board's, in season too; None for a
    player the preseason board did not rank (no capsule was written about him)."""
    entry = entry.preseason or entry
    row = entry.row
    if row.floor is None or row.median is None or row.ceiling is None:
        return None
    return PageValues(
        row.projected, row.ceiling, row.floor, row.median, entry.value_over_replacement, entry.drop_to_next_tier, adp
    )


def capsule_json(stored: StoredCapsule | None, page: PageValues | None) -> Json | None:
    """The written long read and its pull figures; None for a page the writer did not write."""
    if stored is None or stored.source != WRITTEN_SOURCE:
        return None
    figures = [] if page is None else pull_figures_of(stored.body_full, page_numbers(page))
    return {
        "body": stored.body_full.strip(),
        "pulls": [{"figure": f.text, "caption": PULL_CAPTIONS[f.label]} for f in figures],
        "writtenAt": js_iso(stored.generated_at),
    }


STATUS_CHANGED_CAPTION: Final = "A new read is being written since his status changed"


@dataclass(frozen=True, slots=True)
class ServedWeek:
    """What the page's week read is served against (Lane 72, the review's H1 and H3): the reads of the board
    week by universe id, each player's current status (the injury capture the run reads, by the board's id,
    the contract's word or None), and the run's instant."""

    reads: Mapping[str, StoredWeekRead]
    statuses: Mapping[str, str | None]
    as_of: datetime


def week_read_json(stored: StoredWeekRead | None, status: str | None, kicked_off: bool) -> Json | None:
    """The board week's read (Lane 72) with the page's caption, its stamps, the status it was written against
    and its call. None for a page the writer did not write for the board week, or whose board-week game has
    kicked off. A read written against another status than his current one is withheld: its caption says a
    new read is being written, and the page shows the season read beneath it (the review's H3)."""
    if stored is None or stored.source != WRITTEN_SOURCE or kicked_off:
        return None
    standing = stored.status == status
    return {
        "week": stored.week,
        "body": stored.body.strip() if standing else None,
        "caption": written_caption(stored.written_at, stored.week) if standing else STATUS_CHANGED_CAPTION,
        "status": stored.status,
        "call": stored.call if standing else None,
        "writtenAt": js_iso(stored.written_at),
        "factsAt": None if stored.facts_at is None else js_iso(stored.facts_at),
    }


def _kicked_off(games: Sequence[Game], week: int, at: datetime) -> bool:
    return any(game.week == week and game.kickoff <= at for game in games)


@dataclass(frozen=True, slots=True)
class PageInputs:
    # Format id to player id to his row, in the run's format order.
    entries: Mapping[str, Mapping[str, BoardEntry]]
    adp_by_format: Mapping[str, Mapping[str, float]]
    capsules: Mapping[str, StoredCapsule]  # by universe id
    formats: Mapping[str, RunFormat]
    season: SeasonContext
    week: ServedWeek


def page_inputs(
    boards: Sequence[FormatBoard],
    adp_by_format: Mapping[str, Mapping[str, float]],
    capsules: Mapping[str, StoredCapsule],
    season: SeasonContext,
    week: ServedWeek,
) -> PageInputs:
    entries = {board.format.id: {entry.row.player_id: entry for entry in board.entries} for board in boards}
    formats = {board.format.id: board.format for board in boards}
    return PageInputs(entries, adp_by_format, capsules, formats, season, week)


def player_json(who: Identity, inputs: PageInputs) -> Json:
    formats: Json = {}
    page_entry: BoardEntry | None = None
    universe_id: str | None = None
    season: Json | None = None
    for format_id, by_player in inputs.entries.items():
        entry = by_player.get(who.id)
        if entry is None:
            continue
        if season is None:
            # Every season block is scored in the page format, whichever board ranks him (the web
            # holds every block to one format, review N15).
            row = entry.row
            season = season_block(who.id, row.team, inputs.formats[PAGE_FORMAT.id], row.position, inputs.season)
        formats[format_id] = numbers_of(entry, inputs.adp_by_format[format_id].get(who.id))
        universe_id = entry.row.universe_id
        if format_id == PAGE_FORMAT.id:
            page_entry = entry
    page = None if page_entry is None else page_values(page_entry, inputs.adp_by_format[PAGE_FORMAT.id].get(who.id))
    stored = None if universe_id is None else inputs.capsules.get(universe_id)
    return {
        "id": who.id,
        "slug": who.slug,
        "name": who.name,
        "position": who.position,
        "team": who.team,
        "headshot": who.headshot,
        "formats": formats,
        "capsule": capsule_json(stored, page),
        "weekRead": _week_read(who, universe_id, inputs),
        "season": season,
    }


def _week_read(who: Identity, universe_id: str | None, inputs: PageInputs) -> Json | None:
    stored = None if universe_id is None else inputs.week.reads.get(universe_id)
    if stored is None:
        return None
    kicked_off = _kicked_off(inputs.season.games.get(who.team, ()), stored.week, inputs.week.as_of)
    return week_read_json(stored, inputs.week.statuses.get(who.id), kicked_off)


def index_json(people: Sequence[Identity], players: Mapping[str, Json]) -> list[Json]:
    """The search index; each entry's season is his page's own games and points a game, read from it."""
    return [
        {"id": p.id, "slug": p.slug, "name": p.name, "team": p.team, "position": p.position, "headshot": p.headshot,
         "season": season_summary(players[p.id]["season"])}
        for p in people
    ]  # fmt: skip


def season_summary(season: Json) -> Json:
    return {"games": season["games"], "pointsPerGame": season["pointsPerGame"]}
