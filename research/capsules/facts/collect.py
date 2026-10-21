"""THE FACTS COLLECTOR: every board player's facts in one bounded pass, each store read once.

Ported from `research-ts/src/capsules/collect.ts` (`collectBoardFacts`, `factsInputFor`,
`propsLinesByPlayer`, `vegasWinTotalsByTeam`) and `capsules/peers.ts` (`activePeersFor`). The pass
reads the board, the injury and news captures, this season's lines, the active peers at the board's
positions and the crosswalk, then the color and depth facts for the prior season and this season's
usage and play (`facts.season_usage`), and builds each projected player's sheet. Identity ids are the board's (the provider's); the universe id the
capsule row keys on rides on the pass (`universe_ids`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Connection, text

from research.capsules.config import CAPSULE_CONFIG
from research.capsules.facts import history as cached
from research.capsules.facts.board import BOARD_SOURCE, BoardRow, board_rows, market_order_positions_on_board
from research.capsules.facts.build import FactsInput, PlayerFacts, build_player_facts
from research.capsules.facts.color import StoryWithoutTouches, UsageTouchesAndTrend
from research.capsules.facts.depth_collect import DepthOptions, collect_depth_facts, depth_prior_seasons
from research.capsules.facts.depth_model import EMPTY_DEPTH, Depth
from research.capsules.facts.market_adp import MarketAdp, run_market_adp
from research.capsules.facts.model import BooksNumbers, Identity, NewsItem, PropsLine, SeasonSoFar, SeasonUsage
from research.capsules.facts.reference import InjurySnapshot, capture_day, injury_snapshot, news_for_players
from research.capsules.facts.season_so_far import SeasonSubject, seasons_so_far
from research.capsules.facts.season_usage_reads import season_usage_by_player
from research.db.read_cache import UNCACHED, ReadThrough
from research.model.domain import Position
from research.model.laws.registry import Law, chip_eligible_laws
from research.model.market.props_anchor import load_archived_prop_lines, median_prop_lines_by_player
from research.model.priors import load_model_artifacts
from research.model.reads.preseason import all_positions
from research.model.reads.teams import first_kickoff_for, team_observations_as_of
from research.pipeline.nflverse.team_codes import source_team_code
from research.pipeline.odds.props import PROP_MARKETS
from research.pipeline.vegas import VEGAS_SOURCE, VegasMetric
from research.season import PRODUCT_SEASON


def active_peers_for(conn: Connection, positions: Sequence[Position], season: int) -> dict[str, Position]:
    """`activePeersFor`: the universe at these positions who are on the board or played a week this
    season or the last, in the universe's order."""
    if not positions:
        return {}
    wanted = set(positions)
    active = {
        row.id
        for row in conn.execute(
            text(
                "select player_id as id from research.preseason_projections where season = :s and source = :source "
                "union select player_id as id from research.player_week_observations where season in (:s, :prior)"
            ),
            {"s": season, "source": BOARD_SOURCE, "prior": season - 1},
        )
    }
    return {pid: position for pid, position in all_positions(conn).items() if position in wanted and pid in active}


def props_lines_by_player(conn: Connection, season: int) -> dict[str, tuple[PropsLine, ...]]:
    """`propsLinesByPlayer`: each player's median pre-kickoff line per market, in market order."""
    kickoff = first_kickoff_for(conn, season)
    if kickoff is None:
        return {}
    medians = median_prop_lines_by_player(load_archived_prop_lines(conn, season, kickoff), kickoff)
    order = {market: index for index, market in enumerate(PROP_MARKETS)}
    return {
        pid: tuple(PropsLine(market, value) for market, value in sorted(by_market.items(), key=lambda kv: order[kv[0]]))
        for pid, by_market in medians.items()
    }


def vegas_win_totals_by_team(conn: Connection, season: int, as_of: datetime) -> dict[str, float]:
    """`vegasWinTotalsByTeam`: each team's posted season win total, by the archive's team code."""
    rows = team_observations_as_of(conn, season, 1, as_of, VEGAS_SOURCE)
    return {row.team: row.value for row in rows if row.metric == VegasMetric.WIN_TOTAL}


@dataclass(frozen=True, slots=True)
class ColorFacts:
    stories: Mapping[str, StoryWithoutTouches]
    usage: UsageTouchesAndTrend
    props: Mapping[str, tuple[PropsLine, ...]]
    win_totals: Mapping[str, float]
    universe_ids: Mapping[str, str]
    depth: Mapping[str, Depth]
    # This season's usage and play by universe id (`facts.season_usage`), empty before week 1 lands.
    season_usage: Mapping[str, SeasonUsage]


@dataclass(frozen=True, slots=True)
class SharedReads:
    """What every sheet in a pass reads beside its own row."""

    laws: Sequence[Law]
    injuries: InjurySnapshot
    news: Mapping[str, Sequence[NewsItem]]
    # This season so far by provider id: empty before the first kickoff (`facts.season_so_far`).
    seasons: Mapping[str, SeasonSoFar]
    color: ColorFacts
    # The ADP the sheets carry (`market_adp`): the run's own, or the oracle's in the parity cases.
    market: MarketAdp
    # The run's Eastern day (`reference.capture_day`), told to the writer.
    run_day: str


def season_reads(
    conn: Connection, as_of: datetime, rows: Sequence[BoardRow], injuries: InjurySnapshot
) -> dict[str, SeasonSoFar]:
    """These rows' seasons so far, each read for his page club and position."""
    subjects = [SeasonSubject(row.player_id, row.position) for row in rows]
    statuses = {row.player_id: injuries.status_for(row.player_id) for row in rows}
    return seasons_so_far(conn, PRODUCT_SEASON, as_of, subjects, statuses)


def facts_input_for(row: BoardRow, shared: SharedReads) -> FactsInput:
    """`factsInputFor`: one projected row's sheet input."""
    color = shared.color
    gsis = color.universe_ids.get(row.player_id)
    story = None if gsis is None else color.stories.get(gsis)
    books = BooksNumbers(
        () if gsis is None else color.props.get(gsis, ()),
        None if row.team is None else color.win_totals.get(source_team_code(row.team)),
    )
    return FactsInput(
        Identity(row.player_id, row.name, row.position, row.team),
        PRODUCT_SEASON,
        row.reasons,
        shared.laws,
        shared.market.adp(row.player_id),
        # No positional ADP: the provider's is not the page's source (`market_adp`).
        None,
        row.overall_rank,
        row.projected_points,
        row.floor_points,
        row.median_points,
        row.ceiling_points,
        row.bye_week,
        shared.seasons.get(row.player_id),
        shared.injuries.status_for(row.player_id),
        tuple(shared.news.get(row.name, ())),
        None if story is None else story.with_touches(color.usage.touches_rank.get(gsis or "")),
        books,
        None if gsis is None else color.usage.usage.get(gsis),
        None if gsis is None else color.usage.trend.get(gsis),
        shared.run_day,
        EMPTY_DEPTH if gsis is None else color.depth.get(gsis, EMPTY_DEPTH),
        shared.market.page_ranks(row.player_id),
        None if gsis is None else color.season_usage.get(gsis),
    )


@dataclass(frozen=True, slots=True)
class Population:
    """Who the color and depth reads are about: the active peers ranked against, the board's ids,
    the subjects with their teams, and (for a single-player read) every board player's team."""

    positions: Mapping[str, Position]
    universe_ids: Mapping[str, str]
    team_by_gsis: Mapping[str, str | None]
    room_teams: Mapping[str, str | None] | None = None


def collect_color(
    conn: Connection, population: Population, as_of: datetime, history: ReadThrough = UNCACHED
) -> ColorFacts:
    """The color and depth reads for the prior season, each once for the whole population; the
    finished seasons' reads through `history` (`facts.history`)."""
    prior = PRODUCT_SEASON - 1
    positions = population.positions
    depth_options = DepthOptions(
        PRODUCT_SEASON,
        depth_prior_seasons(PRODUCT_SEASON),
        positions,
        population.team_by_gsis,
        as_of,
        population.room_teams,
    )
    # The finished seasons any history read covers: the depth facts' three, last season's two among them.
    played = cached.players_with_history(conn, depth_options.prior_seasons)
    return ColorFacts(
        cached.stories(history, conn, prior, positions, played, as_of),
        cached.usage_and_trend(history, conn, prior, positions, played, as_of),
        props_lines_by_player(conn, PRODUCT_SEASON),
        vegas_win_totals_by_team(conn, PRODUCT_SEASON, as_of),
        population.universe_ids,
        collect_depth_facts(conn, depth_options, history, played),
        season_usage_by_player(conn, PRODUCT_SEASON, positions, as_of, on_pages=CAPSULE_CONFIG.sources_on_pages),
    )


def universe_ids_for(conn: Connection, provider_ids: Sequence[str]) -> dict[str, str]:
    """`nflPlayerIdsFor`: provider id to universe id, through the crosswalk."""
    rows = conn.execute(
        text(
            "select provider_player_id, player_id from research.player_crosswalk where provider_player_id = any(:ids)"
        ),
        {"ids": list(provider_ids)},
    )
    return {row.provider_player_id: row.player_id for row in rows if row.player_id is not None}


@dataclass(frozen=True, slots=True)
class BoardFactsPass:
    facts: tuple[PlayerFacts, ...]
    universe_ids: Mapping[str, str]
    peer_count_by_position: Mapping[Position, int]
    prior_season: int
    prior_season_player_count: int
    as_of: datetime


def collect_board_facts(conn: Connection, as_of: datetime, history: ReadThrough = UNCACHED) -> BoardFactsPass:
    """`collectBoardFacts`: every projected board player's facts, in the board's served order, with
    the run's ADP unless `market` says otherwise; the finished seasons' reads through `history`."""
    prior = PRODUCT_SEASON - 1
    rows = board_rows(conn, PRODUCT_SEASON, as_of)
    if not rows:
        return BoardFactsPass((), {}, {}, prior, 0, as_of)
    board_positions = list(dict.fromkeys([*(row.position for row in rows), *market_order_positions_on_board(conn)]))
    positions = active_peers_for(conn, board_positions, PRODUCT_SEASON)
    universe_ids = universe_ids_for(conn, [row.player_id for row in rows])
    # A free agent (no club, Lane 123) is held as None: his own record, no club's facts (Lane 127, B103).
    team_by_gsis = {universe_ids[row.player_id]: row.team for row in rows if row.player_id in universe_ids}
    color = collect_color(conn, Population(positions, universe_ids, team_by_gsis), as_of, history)
    injuries = injury_snapshot(conn, as_of)
    shared = SharedReads(
        chip_eligible_laws(load_model_artifacts(conn).laws),
        injuries,
        news_for_players(conn, [row.name for row in rows], as_of),
        season_reads(conn, as_of, rows, injuries),
        color,
        run_market_adp(conn, as_of),
        capture_day(as_of),
    )
    facts = tuple(build_player_facts(facts_input_for(row, shared)) for row in rows)
    peers: dict[Position, int] = {}
    for position in positions.values():
        peers[position] = peers.get(position, 0) + 1
    return BoardFactsPass(facts, universe_ids, peers, prior, len(color.stories), as_of)
