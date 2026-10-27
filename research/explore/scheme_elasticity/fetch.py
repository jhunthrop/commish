"""THE PROBE'S DOWNLOADS: nflverse `pbp_participation` and `ftn_charting` for 2022 and 2023 only,
streamed through the house nflverse client into the lane's scratch database (`lane245_*` on 5433).

Only the scheme columns are kept; neither file carries a fantasy outcome. Each file's season is
admitted by `seasons.admit_season` before its URL is built, so no 2024 to 2026 asset is fetched.
"""

from collections.abc import Callable, Sequence
from typing import Final

import pandas as pd

from research.explore.scheme_elasticity.seasons import PROBE_SEASONS, admit_season
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import ByteCaps, Releases
from research.pipeline.nflverse.csv import CsvRow

PARTICIPATION_RELEASE: Final = "pbp_participation"
PARTICIPATION_COLUMNS: Final = (
    "nflverse_game_id", "play_id", "possession_team", "defenders_in_box", "number_of_pass_rushers",
    "offense_players", "was_pressure", "defense_man_zone_type", "defense_coverage_type",
)  # fmt: skip
FTN_COLUMNS: Final = (
    "nflverse_game_id", "nflverse_play_id", "season", "week", "n_defense_box", "n_blitzers",
    "n_pass_rushers", "is_play_action", "is_screen_pass",
)  # fmt: skip
PARTICIPATION_TABLE: Final = "lane245_participation_plays"
FTN_TABLE: Final = "lane245_ftn_plays"
_TRUE: Final = frozenset({"TRUE", "true", "1"})
_FALSE: Final = frozenset({"FALSE", "false", "0"})


def _number(raw: str) -> float | None:
    text = raw.strip()
    if text in {"", "NA"}:
        return None
    return float(text)


def _flag(raw: str) -> bool | None:
    text = raw.strip()
    if text in _TRUE:
        return True
    if text in _FALSE:
        return False
    return None


def _text(raw: str) -> str | None:
    text = raw.strip()
    return None if text in {"", "NA"} else text


def participation_record(row: CsvRow, season: int) -> dict[str, object]:
    return {
        "season": season,
        "game_id": row["nflverse_game_id"],
        "play_id": int(float(row["play_id"])),
        "possession_team": _text(row["possession_team"]),
        "defenders_in_box": _number(row["defenders_in_box"]),
        "pass_rushers": _number(row["number_of_pass_rushers"]),
        "offense_players": _text(row["offense_players"]),
        "was_pressure": _flag(row["was_pressure"]),
        "man_zone": _text(row["defense_man_zone_type"]),
        "coverage_type": _text(row["defense_coverage_type"]),
    }


def ftn_record(row: CsvRow, season: int) -> dict[str, object]:
    found = int(float(row["season"]))
    if found != season:
        raise ValueError(f"the {season} FTN file carried a {found} row; refused")
    return {
        "season": season,
        "week": int(float(row["week"])),
        "game_id": row["nflverse_game_id"],
        "play_id": int(float(row["nflverse_play_id"])),
        "n_defense_box": _number(row["n_defense_box"]),
        "n_blitzers": _number(row["n_blitzers"]),
        "n_pass_rushers": _number(row["n_pass_rushers"]),
        "is_play_action": _flag(row["is_play_action"]),
        "is_screen_pass": _flag(row["is_screen_pass"]),
    }


def _stream(
    client: NflverseClient,
    release: str,
    file: str,
    columns: tuple[str, ...],
    record: Callable[[CsvRow], dict[str, object]],
) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    client.stream_csv(release, file, columns, lambda row: rows.append(record(row)))
    return pd.DataFrame(rows)


def participation_frame(client: NflverseClient, season: int) -> pd.DataFrame:
    admit_season(season, frozenset(PROBE_SEASONS))
    file = f"pbp_participation_{season}.csv"
    return _stream(
        client, PARTICIPATION_RELEASE, file, PARTICIPATION_COLUMNS, lambda r: participation_record(r, season)
    )


def ftn_frame(client: NflverseClient, season: int) -> pd.DataFrame:
    admit_season(season, frozenset(PROBE_SEASONS))
    file = f"ftn_charting_{season}.csv"
    return _stream(client, Releases.FTN_CHARTING, file, FTN_COLUMNS, lambda r: ftn_record(r, season))


def capped_client(fetcher: Fetcher) -> NflverseClient:
    return NflverseClient(fetcher, max_bytes=ByteCaps.PLAY_BY_PLAY)


def download(client: NflverseClient, seasons: Sequence[int] = PROBE_SEASONS) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Both files for every probe season, as two frames."""
    participation = pd.concat([participation_frame(client, s) for s in seasons], ignore_index=True)
    ftn = pd.concat([ftn_frame(client, s) for s in seasons], ignore_index=True)
    return participation, ftn
