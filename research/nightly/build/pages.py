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

from research.capsules.page_figures import projection_tenth
from research.capsules.pull_figures import PageValues, page_numbers, pull_figures_of
from research.capsules.store import WRITTEN_SOURCE, StoredCapsule
from research.capsules.week.cadence import projection_moved_past_shown
from research.capsules.week.caption import PROJECTION_MOVED_CAPTION, status_changed_caption, written_caption
from research.capsules.week.rollover import ReadsDue
from research.capsules.week.store import StoredWeekRead
from research.free_agent import run_club
from research.model.instants import js_iso
from research.nightly.build.page_club import call_for, page_last_game_club
from research.nightly.build.player_season import SeasonContext, prior_seasons, season_block
from research.nightly.build.tenth import percent_or_none, tenth, tenth_or_none
from research.nightly.config import MARKET_ORDER, PAGE_FORMAT, PROJECTION_ORDER, TEAMS, RunFormat
from research.nightly.reads.board import BoardEntry, FormatBoard
from research.nightly.reads.market import MarketEntry
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
    # How every board orders him: by our projection (a page of his own), or in the market's draft
    # order (a kicker or a defense: a row on every board and an index entry, no page).
    order_basis: str = PROJECTION_ORDER


def _slug_with_place(base: str, position: str, team: str) -> str:
    return f"{base}-{position.lower()}-{team.lower()}"


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
        team = run_club(row.team)
        slug = base if counts[base] == 1 else _slug_with_place(base, row.position, team)
        out.append(Identity(player_id, slug, row.name, WEB_POSITION[row.position], team, row.headshot_url))
    return out


def market_identities(people: Sequence[Identity], entries: Sequence[MarketEntry]) -> list[Identity]:
    """The kickers and defenses in draft order, each slug clear of the pages' and of each other's: a
    shared name's slug takes his position and club, as a page's does."""
    taken = {p.slug for p in people}
    counts: dict[str, int] = {}
    for entry in entries:
        counts[slug_of(entry.player.name)] = counts.get(slug_of(entry.player.name), 0) + 1
    out = []
    for entry in entries:
        player = entry.player
        base = slug_of(player.name)
        team = run_club(player.team)
        slug = base if counts[base] == 1 and base not in taken else _slug_with_place(base, player.position, team)
        out.append(
            Identity(
                player.player_id,
                slug,
                player.name,
                WEB_POSITION[player.position],
                team,
                player.headshot_url,
                MARKET_ORDER,
            )
        )
    return out


def gap_of(adp: float | None, our_rank: int) -> float | None:
    """Drafters' ADP less our rank, the board's Gap (Lane 66n): plus when drafters take him later than
    we rank him. The API's rule for Picks later (Lane 66o, `mock.PicksLater`) with our rank in the
    pick's place: the ADP rounded to the tenth the column shows, the difference cleaned back to the
    tenth it is. None without an ADP. The web prints it as given."""
    return None if adp is None else tenth(tenth(adp) - our_rank)


def drop_between(last: float, first: float) -> float:
    """A tier's drop (Lane 66q): its last player's projection less the next tier's first, each rounded
    to the tenth the board shows, the difference cleaned back to its tenth. The web prints it as given."""
    return tenth(tenth(last) - tenth(first))


def tier_drops(entries: Sequence[BoardEntry]) -> dict[str, float | None]:
    """Each player's tier's drop to the next tier at his position, by player id: the drop from the
    tier's last player (by position rank) to the next tier's first, across every tier the board draws,
    the replacement line included. None in a position's last tier. The tier band, the tier list and the
    jump list print it (`tierDrop`)."""
    by_position: dict[str, list[BoardEntry]] = {}
    for entry in entries:
        by_position.setdefault(entry.row.position, []).append(entry)
    out: dict[str, float | None] = {}
    for pool in by_position.values():
        ranked = sorted(pool, key=lambda e: e.position_rank)
        first_of: dict[int, BoardEntry] = {}
        last_of: dict[int, BoardEntry] = {}
        for entry in ranked:
            first_of.setdefault(entry.tier, entry)
            last_of[entry.tier] = entry
        for entry in ranked:
            following = first_of.get(entry.tier + 1)
            out[entry.row.player_id] = (
                None if following is None else drop_between(last_of[entry.tier].row.projected, following.row.projected)
            )
    return out


def numbers_of(entry: BoardEntry, adp: float | None, tier_drop: float | None) -> Json:
    """A board row without the identity: the page's numbers for one format (`playerFormatSchema`),
    each figure rounded once to a tenth here, the web printing it as given (Lane 66n), with his
    tier's drop to the next (`tier_drops`)."""
    row = entry.row
    numbers: Json = {
        "positionRank": entry.position_rank,
        "ourRank": entry.our_rank,
        "vorRound": math.ceil(entry.our_rank / TEAMS),
        "adp": tenth_or_none(adp),
        "gap": gap_of(adp, entry.our_rank),
        "tierDrop": tier_drop,
        "projected": tenth(row.projected),
        "vor": tenth(entry.value_over_replacement),
        "expectedGames": tenth(row.expected_games),
        "floor": tenth_or_none(row.floor),
        "median": tenth_or_none(row.median),
        "ceiling": tenth_or_none(row.ceiling),
        "tier": entry.tier,
    }
    if entry.in_season:
        # In season, beside the rest-of-season figures: where the preseason board had him, or null
        # for a player it did not rank.
        before = entry.preseason
        numbers |= {
            "preseasonRank": None if before is None else before.our_rank,
            "preseasonPoints": None if before is None else tenth(before.row.projected),
            # The preseason pace a game the order starts his figure from (Lane 100), with his preseason
            # figures only.
            "preseasonPerGame": None if before is None else tenth_or_none(row.preseason_per_game),
            # The share of his rate a game that pace carries, a whole percent (Lane 139, C08).
            "preseasonShare": None if before is None else percent_or_none(row.preseason_share),
            # The steps from his Avg to our rate (Lane 139 fix round 1): his season blended with his usage, and
            # the model's rate a game he plays, before the games he may miss.
            "blendedPerGame": None if before is None else tenth_or_none(row.blended_per_game),
            "ratePerGame": tenth_or_none(row.rate_per_game),
            # The week his rest of season starts from: his club's first game still to play (Lane 86).
            "restFromWeek": row.from_week,
            # One more club game at his rate (Lane 96): a league whose title week is past the run's last
            # week values it (the API's LiveBoard).
            "gamePoints": tenth_or_none(row.game_points),
        }
    return numbers


def _who(who: Identity) -> Json:
    return {
        "id": who.id,
        "slug": who.slug,
        "name": who.name,
        "position": who.position,
        "team": who.team,
        "headshot": who.headshot,
        "orderBasis": who.order_basis,
    }


# A kicker's or a defense's projected figures: none (the ruling ships no projection and no tier).
_UNPROJECTED: Final = ("projected", "vor", "expectedGames", "floor", "median", "ceiling", "tier", "tierDrop")


def market_row(who: Identity, entry: MarketEntry, our_rank: int, adp: float | None) -> Json:
    """A kicker's or a defense's row: his place in draft order and the format's ADP, no projected figure."""
    return {
        **_who(who),
        "positionRank": entry.position_rank,
        "ourRank": our_rank,
        "vorRound": None,
        "adp": tenth_or_none(adp),
        "gap": None,
        **dict.fromkeys(_UNPROJECTED),
    }


def board_json(
    board: FormatBoard, slugs: Mapping[str, Identity], adp: Mapping[str, float], market: Sequence[MarketEntry] = ()
) -> Json:
    """The ranked rows in the served order, then the kickers and defenses in draft order, numbered on."""
    drops = tier_drops(board.entries)
    rows = [
        {**_who(slugs[e.row.player_id]), **numbers_of(e, adp.get(e.row.player_id), drops[e.row.player_id])}
        for e in board.entries
    ]
    ranked = len(rows)
    for entry in market:
        who = slugs[entry.player.player_id]
        rows.append(market_row(who, entry, ranked + entry.order, adp.get(who.id)))
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


@dataclass(frozen=True, slots=True)
class ServedWeek:
    """What the page's week read is served against (Lane 72, the review's H1 and H3): the reads of the board
    week by universe id, each player's current status (the injury capture the run reads, by the board's id,
    the contract's word or None), and the run's instant."""

    reads: Mapping[str, StoredWeekRead]
    statuses: Mapping[str, str | None]
    as_of: datetime
    # Each player's published projection for the board week as the card prints it, by the board's id (None
    # for a player the snapshot leaves out); None when the run read no snapshot for the week (Lane 66v).
    projections: Mapping[str, float] | None = None
    # The board week and the night its reads are written, while its roll-over has not run (Lane 256).
    due: ReadsDue | None = None


class _Unread:
    """The run read no published projection for the board week, so a read is not judged by it."""


UNREAD: Final = _Unread()


@dataclass(frozen=True, slots=True)
class ReadClock:
    """What a read is served at: the run's instant. The status read a standing read stands on is named by the
    web at its own build, never baked into the run (Lane 222, B186: `capsules/week/caption.py`)."""

    as_of: datetime


def week_read_json(
    stored: StoredWeekRead | None,
    status: str | None,
    kicked_off: bool,
    clock: ReadClock,
    projection: float | _Unread | None = UNREAD,
) -> Json | None:
    """The board week's read (Lane 72) with the page's caption, its stamps, the status it was written against
    and its call. None for a page the writer did not write for the board week, or whose board-week game has
    kicked off. A read written against another status than his current one is withheld: its caption says his
    status changed and when the hourly pass writes the new read, and the page shows the season read beneath
    it (the review's H3, the re-review's F5). So is a read whose published projection the card prints has
    moved from by the Proj change tile's threshold (`projection`, the run's for him; Lane 66v, Lane 162). `projection` and `movedCaption` are the figure the read
    quotes, as the card prints it, and the words the page shows once the card's live read prints another."""
    if stored is None or stored.source != WRITTEN_SOURCE or kicked_off:
        return None
    quoted = None if stored.projection_points is None else projection_tenth(stored.projection_points)
    moved = not isinstance(projection, _Unread) and projection_moved_past_shown(projection, stored.projection_points)
    standing = stored.status == status and not moved
    if stored.status != status:
        caption = status_changed_caption(clock.as_of)
    else:
        caption = PROJECTION_MOVED_CAPTION if moved else written_caption(stored.written_at, stored.week)
    return {
        "week": stored.week,
        "body": stored.body.strip() if standing else None,
        "caption": caption,
        "status": stored.status,
        "call": stored.call if standing else None,
        "writtenAt": js_iso(stored.written_at),
        "factsAt": None if stored.facts_at is None else js_iso(stored.facts_at),
        "projection": quoted,
        "movedCaption": PROJECTION_MOVED_CAPTION,
    }


def reads_due_json(week_read: Json | None, due: ReadsDue | None) -> Json | None:
    """While no read is served and the week's roll-over has not run, the week and the night its reads are
    written (Lane 256), which the page says in place of "not written yet"; None otherwise."""
    return None if week_read is not None or due is None else due.json()


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
    # Format id to player id to his tier's drop (`tier_drops`).
    tier_drops: Mapping[str, Mapping[str, float | None]]


def page_inputs(
    boards: Sequence[FormatBoard],
    adp_by_format: Mapping[str, Mapping[str, float]],
    capsules: Mapping[str, StoredCapsule],
    season: SeasonContext,
    week: ServedWeek,
) -> PageInputs:
    entries = {board.format.id: {entry.row.player_id: entry for entry in board.entries} for board in boards}
    formats = {board.format.id: board.format for board in boards}
    drops = {board.format.id: tier_drops(board.entries) for board in boards}
    return PageInputs(entries, adp_by_format, capsules, formats, season, week, drops)


def player_json(who: Identity, inputs: PageInputs) -> Json:
    formats: Json = {}
    page_entry: BoardEntry | None = None
    universe_id: str | None = None
    season: Json | None = None
    prior: list[Json] = []
    for format_id, by_player in inputs.entries.items():
        entry = by_player.get(who.id)
        if entry is None:
            continue
        if season is None:
            # Every season block is scored in the page format, whichever board ranks him (the web
            # holds every block to one format, review N15).
            row = entry.row
            season = season_block(who.id, inputs.formats[PAGE_FORMAT.id], row.position, inputs.season)
            prior = prior_seasons(who.id, inputs.formats[PAGE_FORMAT.id], row.position, inputs.season)
        formats[format_id] = numbers_of(
            entry, inputs.adp_by_format[format_id].get(who.id), inputs.tier_drops[format_id][who.id]
        )
        universe_id = entry.row.universe_id
        if format_id == PAGE_FORMAT.id:
            page_entry = entry
    page = None if page_entry is None else page_values(page_entry, inputs.adp_by_format[PAGE_FORMAT.id].get(who.id))
    stored = None if universe_id is None else inputs.capsules.get(universe_id)
    week_read = _week_read(who, universe_id, inputs)
    return {
        "id": who.id,
        "slug": who.slug,
        "name": who.name,
        "position": who.position,
        "team": who.team,
        "headshot": who.headshot,
        "formats": formats,
        "capsule": capsule_json(stored, page),
        "weekRead": week_read,
        "weekReadsDue": reads_due_json(week_read, inputs.week.due),
        "season": season,
        "priorSeasons": prior,
        # The club his newest game line was for, when it is not the page's (Lane 120), and whether that
        # week was special teams alone (Lane 144).
        "lastGameClub": page_last_game_club(
            call_for(inputs.season.clubs, who.id), () if season is None else season["log"]
        ),
    }


def _week_read(who: Identity, universe_id: str | None, inputs: PageInputs) -> Json | None:
    stored = None if universe_id is None else inputs.week.reads.get(universe_id)
    if stored is None:
        return None
    kicked_off = _kicked_off(inputs.season.games.get(who.team, ()), stored.week, inputs.week.as_of)
    projections = inputs.week.projections
    projection = UNREAD if projections is None else projections.get(who.id)
    week = inputs.week
    return week_read_json(stored, week.statuses.get(who.id), kicked_off, ReadClock(week.as_of), projection)


def _index_entry(p: Identity) -> Json:
    return {
        "id": p.id,
        "slug": p.slug,
        "name": p.name,
        "team": p.team,
        "position": p.position,
        "headshot": p.headshot,
        "orderBasis": p.order_basis,
    }


def index_json(people: Sequence[Identity], players: Mapping[str, Json], market: Sequence[Identity] = ()) -> list[Json]:
    """The index: every page, its season his page's own games and points a game, read from it; then
    every kicker and defense the boards carry, with no page and no season."""
    pages = [{**_index_entry(p), "season": season_summary(players[p.id]["season"])} for p in people]
    return [*pages, *(_index_entry(p) for p in market)]


def season_summary(season: Json) -> Json:
    return {"games": season["games"], "pointsPerGame": season["pointsPerGame"]}
