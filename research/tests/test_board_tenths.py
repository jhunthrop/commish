"""The site's one rounding rule on the run's boards (Lane 66n, after Lane 66k H1): the nightly's writer
rounds each board figure once to a tenth, half away from zero on the shortest decimal, exactly as the
API's `tenth.Round` does, and the web prints it as given. The cases are the table the Go and web
tests read. A small hand-built board, no store."""

import json
import math
from datetime import UTC, datetime
from pathlib import Path

from research.nightly.build.pages import board_json, gap_of, identities
from research.nightly.build.tenth import tenth, tenth_or_none
from research.nightly.config import RUN_FORMATS
from research.nightly.reads.board import FormatBoard, StoredBoard, StoredRow, board_entries

PPR = RUN_FORMATS[0]
AS_OF = datetime(2026, 9, 9, 2, tzinfo=UTC)
# Nacua's raw run figures as the board file writes them.
WRITTEN = {"projected": 344.1, "floor": 241.7, "expectedGames": 14.9, "adp": 2.8}
# His ADP as shown less his rank of 1.
NACUA_GAP = 1.8
_TABLE = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "format" / "tenth-table.json"


def test_every_case_of_the_shared_table_rounds_as_the_api_does() -> None:
    for case in json.loads(_TABLE.read_text()):
        assert tenth(case["in"]) == case["out"], case


def test_no_signed_zero_and_no_rounding_of_what_is_not_a_number() -> None:
    assert math.copysign(1.0, tenth(-0.04)) == 1.0
    assert math.isnan(tenth(math.nan))
    assert tenth_or_none(None) is None


def test_the_gap_is_the_adp_as_shown_less_our_rank_rounded_once() -> None:
    """The halves the review found the web's whole-pick rounding missed, and the ADP rounded to the
    tenth the ADP column shows before the rank comes off (as the API's Picks later does)."""
    cases = [(5.5, 10, -4.5), (16.5, 17, -0.5), (6.5, 3, 3.5), (2.84, 1, 1.8), (9.45, 9, 0.5), (7.0, 7, 0.0)]
    for adp, rank, gap in cases:
        assert gap_of(adp, rank) == gap, (adp, rank)
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
