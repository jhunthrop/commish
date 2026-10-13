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
from typing import Any, Final

from research.capsules.pull_figures import PageValues, page_numbers, pull_figures_of
from research.capsules.store import StoredCapsule
from research.nightly.config import PAGE_FORMAT, TEAMS
from research.nightly.reads.board import BoardEntry, FormatBoard

WRITTEN_SOURCE: Final = "llm"
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
    return {
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


def page_values(entry: BoardEntry, adp: float | None) -> PageValues:
    row = entry.row
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
    }


@dataclass(frozen=True, slots=True)
class PageInputs:
    # Format id to player id to his row, in the run's format order.
    entries: Mapping[str, Mapping[str, BoardEntry]]
    adp_by_format: Mapping[str, Mapping[str, float]]
    capsules: Mapping[str, StoredCapsule]  # by universe id


def page_inputs(
    boards: Sequence[FormatBoard],
    adp_by_format: Mapping[str, Mapping[str, float]],
    capsules: Mapping[str, StoredCapsule],
) -> PageInputs:
    entries = {board.format.id: {entry.row.player_id: entry for entry in board.entries} for board in boards}
    return PageInputs(entries, adp_by_format, capsules)


def player_json(who: Identity, inputs: PageInputs) -> Json:
    formats: Json = {}
    page_entry: BoardEntry | None = None
    universe_id: str | None = None
    for format_id, by_player in inputs.entries.items():
        entry = by_player.get(who.id)
        if entry is None:
            continue
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
    }


def index_json(people: Sequence[Identity]) -> list[Json]:
    return [
        {"id": p.id, "slug": p.slug, "name": p.name, "team": p.team, "position": p.position, "headshot": p.headshot}
        for p in people
    ]
