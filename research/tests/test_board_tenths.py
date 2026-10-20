"""The site's one rounding rule on the run's boards (Lane 66n, after Lane 66k H1): the nightly's writer
rounds each board figure once to a tenth, half away from zero on the shortest decimal, exactly as the
API's `tenth.Round` does, and the web prints it as given. The cases are the table the Go and web
tests read. A small hand-built board, no store."""

import json
import math
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from research.nightly.build.pages import board_json, drop_between, gap_of, identities, tier_drops
from research.nightly.build.tenth import tenth, tenth_or_none
from research.nightly.config import RUN_FORMATS
from research.nightly.reads.board import BoardEntry, FormatBoard, StoredBoard, StoredRow, board_entries

PPR = RUN_FORMATS[0]
AS_OF = datetime(2026, 9, 9, 2, tzinfo=UTC)
# Nacua's raw run figures as the board file writes them.
WRITTEN = {"projected": 344.1, "floor": 241.7, "expectedGames": 14.9, "adp": 2.8}
# His ADP as shown less his rank of 1.
NACUA_GAP = 1.8
_TABLE = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "format" / "tenth-table.json"
_PICKS_LATER = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "format" / "picks-later-table.json"


def test_every_case_of_the_shared_table_rounds_as_the_api_does() -> None:
    for case in json.loads(_TABLE.read_text()):
        assert tenth(case["in"]) == case["out"], case


def test_no_signed_zero_and_no_rounding_of_what_is_not_a_number() -> None:
    assert math.copysign(1.0, tenth(-0.04)) == 1.0
    assert math.isnan(tenth(math.nan))
    assert tenth_or_none(None) is None


def test_the_gap_is_the_apis_picks_later_with_our_rank_as_the_pick_negated() -> None:
    """The table the API's Picks later test reads (re-review N6): the halves the review found the
    web's whole-pick rounding missed, and the ADP rounded to the tenth its column shows before the
    rank comes off. The Gap is ADP less our rank, Picks later the pick less the ADP, so one is the
    other negated."""
    for case in json.loads(_PICKS_LATER.read_text()):
        later = case["later"]
        assert gap_of(case["adp"], case["pick"]) == (-later if later else 0.0), case
    assert gap_of(None, 1) is None


def _row(pid: str, projected: float, floor: float) -> StoredRow:
    return StoredRow(
        universe_id=f"u-{pid}", player_id=pid, name=pid.upper(), position="WR", team="LAR",
        headshot_url="https://a.espncdn.com/i/headshots/nfl/players/full/1.png", market_adp=None,
        projected=projected, floor=floor, median=projected, ceiling=projected * 1.3, expected_games=14.869727240191919,
    )  # fmt: skip


def test_a_board_file_carries_each_figure_as_a_tenth() -> None:
    rows = [_row("p1", 344.08, 241.70211604019966), _row("p2", 180.0, 120.0)]
    board = FormatBoard(PPR, StoredBoard(PPR.board_source, AS_OF, "research@test", None), board_entries(rows, PPR))
    people = identities([board])
    written = board_json(board, {p.id: p for p in people}, {"p1": 2.84})["rows"][0]
    assert {key: written[key] for key in WRITTEN} == WRITTEN
    assert written["gap"] == NACUA_GAP
    for key in ("projected", "vor", "expectedGames", "floor", "median", "ceiling", "adp", "gap"):
        value = written[key]
        assert value == tenth(value), key


_TIER_DROPS = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "format" / "tier-drop-table.json"


def test_a_tier_drop_is_the_difference_of_the_two_projections_as_shown() -> None:
    """The table the stand-in's test reads too (Lane 66q): each end rounded to the tenth the board
    shows, the difference cleaned back to its tenth."""
    for case in json.loads(_TIER_DROPS.read_text()):
        assert drop_between(case["last"], case["first"]) == case["drop"], case


def _entry(pid: str, position_rank: int, tier: int, projected: float) -> BoardEntry:
    return BoardEntry(_row(pid, projected, projected / 2), projected - 100, position_rank, tier, None, position_rank)


def test_every_player_carries_his_tiers_drop_to_the_next_and_the_last_tier_none() -> None:
    entries = [
        _entry("d", 4, 3, 290.04),
        _entry("a", 1, 1, 344.08),
        _entry("c", 3, 2, 313.26),
        _entry("b", 2, 1, 330.0),
    ]
    assert tier_drops(entries) == {"a": 16.7, "b": 16.7, "c": 23.3, "d": None}


def test_a_board_file_carries_each_rows_tier_drop() -> None:
    rows = [_row("p1", 344.08, 241.7), _row("p2", 180.0, 120.0)]
    board = FormatBoard(PPR, StoredBoard(PPR.board_source, AS_OF, "research@test", None), board_entries(rows, PPR))
    people = identities([board])
    written = board_json(board, {p.id: p for p in people}, {})["rows"]
    drops = tier_drops(board.entries)
    assert [row["tierDrop"] for row in written] == [drops[e.row.player_id] for e in board.entries]
    assert written[-1]["tierDrop"] is None


def test_an_in_season_row_says_the_week_his_rest_of_season_starts_from() -> None:
    """Lane 86: an in-season row carries his club's first week still to play (null with none left), and
    a preseason row carries no such field."""
    rows = [replace(_row("p1", 120.0, 0.0), from_week=7), _row("p2", 90.0, 0.0)]
    entries = tuple(replace(e, in_season=True) for e in board_entries(rows, PPR))
    board = FormatBoard(PPR, StoredBoard(PPR.board_source, AS_OF, "research@test", None), entries)
    people = {p.id: p for p in identities([board])}
    written = {r["id"]: r for r in board_json(board, people, {})["rows"]}
    assert (written["p1"]["restFromWeek"], written["p2"]["restFromWeek"]) == (7, None)
    preseason = FormatBoard(PPR, board.stored, board_entries(rows, PPR))
    assert "restFromWeek" not in board_json(preseason, people, {})["rows"][0]


def test_an_in_season_row_carries_the_preseason_pace_with_his_preseason_figures() -> None:
    """Lane 100 (B17, B51): beside his preseason figure, the pace a game the order starts him from, to a
    tenth; null for a player the preseason board did not rank, and no field preseason."""
    rows = [
        replace(_row("p1", 120.0, 0.0), preseason_per_game=17.46),
        replace(_row("p2", 90.0, 0.0), preseason_per_game=9.0),
    ]
    before = {e.row.universe_id: e for e in board_entries(rows, PPR)}
    entries = tuple(
        replace(e, in_season=True, preseason=before[e.row.universe_id] if e.row.player_id == "p1" else None)
        for e in board_entries(rows, PPR)
    )
    board = FormatBoard(PPR, StoredBoard(PPR.board_source, AS_OF, "research@test", None), entries)
    people = {p.id: p for p in identities([board])}
    written = {r["id"]: r for r in board_json(board, people, {})["rows"]}
    assert (written["p1"]["preseasonPerGame"], written["p2"]["preseasonPerGame"]) == (17.5, None)
    preseason = FormatBoard(PPR, board.stored, board_entries(rows, PPR))
    assert "preseasonPerGame" not in board_json(preseason, people, {})["rows"][0]
