"""THE FACTS COLLECTOR: every board player's facts in one bounded pass, each store read once.

Ported from `research-ts/src/capsules/collect.ts` (`collectBoardFacts`, `factsInputFor`,
`propsLinesByPlayer`, `vegasWinTotalsByTeam`) and `capsules/peers.ts` (`activePeersFor`). The pass
reads the board, the injury and news captures, this season's lines, the active peers at the board's
positions and the crosswalk, then the color and depth facts for the prior season, and builds each
projected player's sheet. Identity ids are the board's (the provider's); the universe id the
capsule row keys on rides on the pass (`universe_ids`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.capsules.facts.board import BOARD_SOURCE, BoardRow, board_rows, market_order_positions_on_board
from research.capsules.facts.build import FactsInput, PlayerFacts, build_player_facts
from research.capsules.facts.color import (
    StoryWithoutTouches,
    UsageTouchesAndTrend,
    current_season_summaries,
    last_season_stories_for,
    usage_touches_and_trend_for,
)
from research.capsules.facts.depth_collect import DepthOptions, collect_depth_facts, depth_prior_seasons
from research.capsules.facts.depth_model import EMPTY_DEPTH, Depth
from research.capsules.facts.market_adp import MarketAdp, run_market_adp
from research.capsules.facts.model import BooksNumbers, Identity, NewsItem, PropsLine, SeasonSummary
from research.capsules.facts.reference import InjurySnapshot, injury_snapshot, news_for_players
from research.model.domain import Position
from research.model.laws.registry import Law, chip_eligible_laws
from research.model.market.props_anchor import load_archived_prop_lines, median_prop_lines_by_player
from research.model.priors import load_model_artifacts
from research.model.reads.preseason import all_positions
from research.model.reads.teams import first_kickoff_for, team_observations_as_of
from research.pipeline.nflverse.team_codes import source_team_code
from research.pipeline.odds.props import PROP_MARKETS
from research.pipeline.vegas import VEGAS_SOURCE, VegasMetric

PRODUCT_SEASON: Final = 2026


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


@dataclass(frozen=True, slots=True)
class SharedReads:
    """What every sheet in a pass reads beside its own row."""

    laws: Sequence[Law]
    injuries: InjurySnapshot
    news: Mapping[str, Sequence[NewsItem]]
    seasons: Mapping[str, SeasonSummary]
    color: ColorFacts
    # The ADP the sheets carry (`market_adp`): the run's own, or the oracle's in the parity cases.
    market: MarketAdp


def facts_input_for(row: BoardRow, shared: SharedReads) -> FactsInput:
    """`factsInputFor`: one projected row's sheet input."""
    color = shared.color
    gsis = color.universe_ids.get(row.player_id)
    story = None if gsis is None else color.stories.get(gsis)
    books = BooksNumbers(
        () if gsis is None else color.props.get(gsis, ()), color.win_totals.get(source_team_code(row.team))
    )
    return FactsInput(
        Identity(row.player_id, row.name, row.position, row.team),
        PRODUCT_SEASON,
        row.reasons,
        shared.laws,
        shared.market.adp(row.player_id, row.market_adp),
        shared.market.position_adp(row.market_position_adp),
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
        EMPTY_DEPTH if gsis is None else color.depth.get(gsis, EMPTY_DEPTH),
    )


@dataclass(frozen=True, slots=True)
class Population:
    """Who the color and depth reads are about: the active peers ranked against, the board's ids,
    the subjects with their teams, and (for a single-player read) every board player's team."""

    positions: Mapping[str, Position]
    universe_ids: Mapping[str, str]
    team_by_gsis: Mapping[str, str]
    room_teams: Mapping[str, str] | None = None


def collect_color(conn: Connection, population: Population, as_of: datetime) -> ColorFacts:
    """The color and depth reads for the prior season, each once for the whole population."""
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
    return ColorFacts(
        last_season_stories_for(conn, prior, positions, as_of),
        usage_touches_and_trend_for(conn, prior, positions, as_of),
        props_lines_by_player(conn, PRODUCT_SEASON),
        vegas_win_totals_by_team(conn, PRODUCT_SEASON, as_of),
        population.universe_ids,
        collect_depth_facts(conn, depth_options),
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


def collect_board_facts(conn: Connection, as_of: datetime, market: MarketAdp | None = None) -> BoardFactsPass:
    """`collectBoardFacts`: every projected board player's facts, in the board's served order, with
    the run's ADP unless `market` says otherwise."""
    prior = PRODUCT_SEASON - 1
    rows = board_rows(conn, PRODUCT_SEASON, as_of)
    if not rows:
        return BoardFactsPass((), {}, {}, prior, 0, as_of)
    board_positions = list(dict.fromkeys([*(row.position for row in rows), *market_order_positions_on_board(conn)]))
    positions = active_peers_for(conn, board_positions, PRODUCT_SEASON)
    universe_ids = universe_ids_for(conn, [row.player_id for row in rows])
    team_by_gsis = {universe_ids[row.player_id]: row.team for row in rows if row.player_id in universe_ids}
    color = collect_color(conn, Population(positions, universe_ids, team_by_gsis), as_of)
    shared = SharedReads(
        chip_eligible_laws(load_model_artifacts(conn).laws),
        injury_snapshot(conn),
        news_for_players(conn, [row.name for row in rows]),
        current_season_summaries(
            conn, PRODUCT_SEASON, [row.player_id for row in rows], {r.player_id: r.position for r in rows}
        ),
        color,
        run_market_adp(conn, as_of) if market is None else market,
    )
    facts = tuple(build_player_facts(facts_input_for(row, shared)) for row in rows)
    peers: dict[Position, int] = {}
    for position in positions.values():
        peers[position] = peers.get(position, 0) + 1
    return BoardFactsPass(facts, universe_ids, peers, prior, len(color.stories), as_of)
