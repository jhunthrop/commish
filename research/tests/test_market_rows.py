"""Kickers and defenses on every board in draft order (Lane 66m, the 2026-09-05 ruling): the order, the
rows the run writes for them, the index, the depth gate's counts, the published table and the statuses.
A small hand-built fixture, no store."""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from research.model.domain import Position
from research.nightly.build.pages import board_json, identities, index_json, market_identities
from research.nightly.build.season import format_json
from research.nightly.config import RUN_FORMATS, TEAMS
from research.nightly.designations import ranked
from research.nightly.gates import basis_gate, depth_gate
from research.nightly.publish import encode
from research.nightly.published_board import published_board
from research.nightly.reads.board import FormatBoard, StoredBoard, StoredRow, board_entries
from research.nightly.reads.market import MarketPlayer, market_order
from research.nightly.run_store import JSON_TYPE, LocalRunStore

PPR = RUN_FORMATS[0]
_MARKET_ORDER = Path(__file__).resolve().parents[2] / "api" / "testdata" / "market-order.json"
AS_OF = datetime(2026, 9, 9, 2, tzinfo=UTC)


def _kicker(pid: str, team: str = "KC") -> MarketPlayer:
    return MarketPlayer(
        pid, f"Kicker {pid}", "K", team, f"https://a.espncdn.com/i/headshots/nfl/players/full/{pid}.png"
    )


def _defense(team: str) -> MarketPlayer:
    return MarketPlayer(f"DST-{team}", f"{team} Defense", "DEF", team, None)


def _row(pid: str, projected: float, position: Position = "WR") -> StoredRow:
    return StoredRow(
        universe_id=f"u-{pid}", player_id=pid, name=pid.upper(), position=position, team="KC",
        headshot_url="https://a.espncdn.com/i/headshots/nfl/players/full/1.png", market_adp=None,
        projected=projected, floor=projected * 0.6, median=projected, ceiling=projected * 1.4, expected_games=15.0,
    )  # fmt: skip


def _board(rows: list[StoredRow]) -> FormatBoard:
    return FormatBoard(PPR, StoredBoard(PPR.board_source, AS_OF, "research@test", None), board_entries(rows, PPR))


def test_the_order_is_the_formats_adp_then_the_provider_id_and_the_undrafted_are_off() -> None:
    players = [_kicker("300"), _defense("BUF"), _kicker("100"), _kicker("200"), _defense("KC"), _kicker("050")]
    adp = {"300": 150.5, "DST-KC": 140.0, "200": 160.0, "050": 160.0}
    order = market_order(players, adp)
    # The September ruling: only the players the drafters take; a tie goes by id.
    assert [e.player.player_id for e in order] == ["DST-KC", "300", "050", "200"]
    assert [e.order for e in order] == [1, 2, 3, 4]
    # Each position ranks in the same order, its own count from 1.
    assert {e.player.player_id: e.position_rank for e in order} == {"DST-KC": 1, "300": 1, "050": 2, "200": 3}


def test_the_shared_fixture_order_is_the_rooms() -> None:
    """`api/testdata/market-order.json`: the board's order per format, which the room's read must match."""
    shared = json.loads(_MARKET_ORDER.read_text())
    players = [MarketPlayer(p["id"], p["id"], p["position"], p["team"], None) for p in shared["players"]]
    for fmt, expected in shared["order"].items():
        order = market_order(players, shared["captures"][fmt]["before_kickoff"])
        assert [e.player.player_id for e in order] == expected, fmt
        firsts = {pos: next(e.player.player_id for e in order if e.player.position == pos) for pos in ("K", "DEF")}
        assert firsts == shared["first"][fmt], fmt


def test_a_board_file_carries_its_market_rows_after_the_ranked_ones() -> None:
    board = _board([_row("p1", 250.0), _row("p2", 200.0, "RB")])
    players = [_kicker("100"), _defense("BUF")]
    adp = {"p1": 3.5, "DST-BUF": 170.0}
    order = market_order(players, adp)
    people = identities([board])
    market = market_identities(people, order)
    slugs = {p.id: p for p in (*people, *market)}
    written = board_json(board, slugs, adp, order)
    rows = written["rows"]
    # The kicker the format's drafts do not take is not on the board.
    assert [r["id"] for r in rows] == ["p1", "p2", "DST-BUF"]
    assert {r["orderBasis"] for r in rows[:2]} == {"projection"}
    defense = rows[2]
    assert defense == {
        "id": "DST-BUF",
        "slug": "buf-defense",
        "name": "BUF Defense",
        "position": "DST",
        "team": "BUF",
        "headshot": None,
        "orderBasis": "market",
        "positionRank": 1,
        "ourRank": 3,
        "vorRound": None,
        "adp": 170.0,
        "gap": None,
        "projected": None,
        "vor": None,
        "expectedGames": None,
        "floor": None,
        "median": None,
        "ceiling": None,
        "tier": None,
    }


def test_a_shared_name_takes_its_position_and_club_across_the_market_rows() -> None:
    board = _board([_row("p1", 250.0)])
    people = identities([board])
    twins = [MarketPlayer("100", "P1", "K", "BUF", None)]
    market = market_identities(people, market_order(twins, {"100": 150.0}))
    assert [m.slug for m in market] == ["p1-k-buf"]


def test_the_index_lists_kickers_and_defenses_with_no_page() -> None:
    board = _board([_row("p1", 250.0)])
    people = identities([board])
    market = market_identities(people, market_order([_kicker("100")], {"100": 150.0}))
    season = {"games": 3, "pointsPerGame": 12.5}
    index = index_json(people, {"p1": {"season": season}}, market)
    assert index[0]["orderBasis"] == "projection"
    assert index[0]["season"] == season
    assert index[1] == {
        "id": "100",
        "slug": "kicker-100",
        "name": "Kicker 100",
        "team": "KC",
        "position": "K",
        "headshot": "https://a.espncdn.com/i/headshots/nfl/players/full/100.png",
        "orderBasis": "market",
    }


def _full_board(kickers: int, defenses: int) -> dict[str, Any]:
    shape = {"QB": 24, "RB": 60, "WR": 70, "TE": 24}
    rows = [{"position": p, "orderBasis": "projection"} for p, n in shape.items() for _ in range(n)]
    rows += [{"position": "K", "orderBasis": "market"}] * kickers + [
        {"position": "DST", "orderBasis": "market"}
    ] * defenses
    return {"rows": rows}


def test_the_depth_gate_admits_kickers_and_defenses_with_their_own_counts() -> None:
    passed = depth_gate([PPR], {PPR.id: _full_board(TEAMS, TEAMS)})
    assert passed.passed, passed.reasons
    assert "K 12, DST 12" in passed.summary
    short = depth_gate([PPR], {PPR.id: _full_board(TEAMS - 1, 0)})
    assert not short.passed
    assert "board_depth_short:ppr-12:K:11/12" in short.reasons
    assert "board_depth_short:ppr-12:DEF:0/12" in short.reasons


def test_the_published_table_takes_the_market_rows_with_no_points_and_the_boards_basis() -> None:
    manifest = {
        "season": 2026,
        "formats": [{"id": "ppr-12"}],
        "sources": [{"artifact": "boards", "feed": PPR.board_source, "window": {"to": "2026-09-09T02:00:00.000Z"}}],
    }
    board = _board([_row("p1", 250.0)])
    order = market_order([_kicker("100")], {"100": 150.0})
    people = identities([board])
    slugs = {p.id: p for p in (*people, *market_identities(people, order))}
    published = published_board("2026-09-09T05", manifest, {"ppr-12": board_json(board, slugs, {}, order)})
    kicker = next(r for r in published.rows if r.player_id == "100")
    assert (kicker.rank, kicker.position_rank, kicker.points, kicker.points_over_replacement) == (2, 1, None, None)
    assert {r.order_basis for r in published.rows} == {"preseason"}


def test_an_in_season_board_publishes_no_kicker_or_defense_rows() -> None:
    """The in-season tools rank by the rest-of-season figure, which kickers and defenses do not carry, so
    the table the API reads holds none of their rows once a format ranks the rest of the season."""
    manifest = {
        "season": 2026,
        "formats": [{"id": "ppr-12", "rosFromWeek": 7, "refreshedAt": "2026-10-21T12:00:00.000Z"}],
        "sources": [],
    }
    board = _board([_row("p1", 250.0)])
    order = market_order([_kicker("100"), _defense("BUF")], {"100": 150.0, "DST-BUF": 140.0})
    people = identities([board])
    slugs = {p.id: p for p in (*people, *market_identities(people, order))}
    published = published_board("2026-10-21T12", manifest, {"ppr-12": board_json(board, slugs, {}, order)})
    assert [r.player_id for r in published.rows] == ["p1"]
    assert {r.order_basis for r in published.rows} == {"rest_of_season"}


def test_a_kicker_on_a_board_is_one_the_statuses_mark(tmp_path: Path) -> None:
    store = LocalRunStore(tmp_path)
    board = _board([_row("p1", 250.0)])
    order = market_order([_kicker("100")], {"100": 150.0})
    people = identities([board])
    slugs = {p.id: p for p in (*people, *market_identities(people, order))}
    store.put("runs/r1/manifest.json", encode({"season": 2026, "formats": [{"id": "ppr-12"}]}), JSON_TYPE)
    store.put("runs/r1/boards/ppr-12.json", encode(board_json(board, slugs, {}, order)), JSON_TYPE)
    found = ranked(store, "r1")
    assert found is not None
    assert found.ids == {"p1", "100"}


def test_every_format_names_the_adp_its_kickers_and_defenses_take_their_order_from() -> None:
    # Each board's own drafts: the order its ADP column prints.
    assert format_json(PPR, 2026)["marketOrder"] == "ffc_adp_ppr_12"
    assert format_json(RUN_FORMATS[1], 2026)["marketOrder"] == "ffc_adp_half_12"


def test_the_basis_gate_fails_a_market_order_with_no_adp_source() -> None:
    manifest = {
        "formats": [format_json(PPR, 2026)],
        "sources": [{"artifact": a} for a in ("boards", "adp", "schedule", "clubs")],
    }
    record = {"method": "m", "statistic": {"agreement": "a"}, "weeks": []}
    schedule = {"slates": [], "opponentBasis": "o", "unit": "u"}
    window = {"from": "2026-09-09T07:00:00.000Z", "to": "2026-09-09T07:00:00.000Z"}
    half = {"sources": [{"id": "ffc_adp_half_12", "drafts": "Half PPR drafts", "window": window}]}
    assert "basis_missing:market_order:ppr-12:ffc_adp_ppr_12" in basis_gate(manifest, half, record, schedule).reasons
    ppr = {"sources": [{"id": "ffc_adp_ppr_12", "drafts": "PPR drafts", "window": window}]}
    assert basis_gate(manifest, ppr, record, schedule).passed
