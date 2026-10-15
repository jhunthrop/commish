"""The charted feeds against real rows (`testdata/nflverse/`, week 1 of 2026: NE at SEA and ATL at PIT
for FTN, play-by-play and PFR; weeks 0 and 1 of 2026 and a few of 2025 for Next Gen Stats).

Each count is checked against an independent reading of the fixtures with Python's csv module."""

import csv
import io
from collections import Counter
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from sqlalchemy import Connection

from research.errors import SchemaDriftError
from research.pipeline.nflverse import usage_feeds
from research.pipeline.nflverse.client import NflverseClient, NflverseError
from research.pipeline.nflverse.ftn import FTN_SOURCE, ChartIndex, FtnMetric
from research.pipeline.nflverse.ngs import NGS_SOURCE
from research.pipeline.nflverse.pfr_advstats import PFR_SOURCE, PfrPlayer
from research.pipeline.observations import PlayerWeekObservation
from research.tests.nflverse_fixtures import FixtureFetcher, fixture_rows

_SEASON = 2026
_CONN = cast(Connection, None)
_WEEK_AS_OF = {1.0: datetime(2026, 9, 16, 0, tzinfo=UTC), 2.0: datetime(2026, 9, 23, 0, tzinfo=UTC)}


def _universe() -> dict[str, str]:
    """Every gsis id the fixtures name, as projected players."""
    ids = {r["passer_id"] for r in fixture_rows("play_by_play_2026.csv.gz")}
    ids |= {r["receiver_player_id"] for r in fixture_rows("play_by_play_2026.csv.gz")}
    for kind in ("passing", "receiving", "rushing"):
        ids |= {r["player_gsis_id"] for r in fixture_rows(f"ngs_{kind}.csv.gz")}
    return {i: "WR" for i in ids if i not in ("", "NA")}


@pytest.fixture
def written(monkeypatch: pytest.MonkeyPatch) -> list[PlayerWeekObservation]:
    rows: list[PlayerWeekObservation] = []

    def record(conn: Connection, batch: Sequence[PlayerWeekObservation]) -> int:
        del conn
        rows.extend(batch)
        return len(batch)

    monkeypatch.setattr(usage_feeds, "all_positions", lambda conn: _universe())
    monkeypatch.setattr(usage_feeds, "record_observations", record)
    return rows


def _by(rows: Sequence[PlayerWeekObservation], player: str, metric: str) -> float | None:
    found = [r.value for r in rows if r.player_id == player and r.metric == metric]
    assert len(found) <= 1
    return found[0] if found else None


def _joined() -> list[tuple[dict[str, str], dict[str, str]]]:
    charted = {(r["nflverse_game_id"], int(r["nflverse_play_id"])): r for r in fixture_rows("ftn_charting_2026.csv")}
    out = []
    for play in fixture_rows("play_by_play_2026.csv.gz"):
        chart = charted.get((play["game_id"], int(play["play_id"])))
        if chart is not None and play["two_point_attempt"] != "1":
            out.append((play, chart))
    return out


def test_ftn_counts_each_target_and_dropback_of_the_charted_plays(written: list[PlayerWeekObservation]) -> None:
    report = usage_feeds.ingest_ftn_charting(_CONN, NflverseClient(FixtureFetcher()), _SEASON)
    pairs = _joined()
    targets = [(p, c) for p, c in pairs if p["pass_attempt"] == "1" and p["sack"] != "1" and p["receiver_player_id"]]
    receiver, _ = Counter(p["receiver_player_id"] for p, _ in targets).most_common(1)[0]
    mine = [(p, c) for p, c in targets if p["receiver_player_id"] == receiver]
    assert _by(written, receiver, FtnMetric.TARGETS) == len(mine)
    assert _by(written, receiver, FtnMetric.DROPS) == sum(c["is_drop"] == "TRUE" for _, c in mine)
    assert _by(written, receiver, FtnMetric.CATCHABLE_TARGETS) == sum(c["is_catchable_ball"] == "TRUE" for _, c in mine)
    contested = [(p, c) for p, c in mine if c["is_contested_ball"] == "TRUE"]
    assert _by(written, receiver, FtnMetric.CONTESTED_TARGETS) == len(contested)
    assert _by(written, receiver, FtnMetric.CONTESTED_CATCHES) == sum(p["complete_pass"] == "1" for p, _ in contested)
    dropbacks = [(p, c) for p, c in pairs if p["qb_dropback"] == "1" and p["passer_id"]]
    passer, count = Counter(p["passer_id"] for p, _ in dropbacks).most_common(1)[0]
    blitzed = sum(int(c["n_blitzers"]) > 0 for p, c in dropbacks if p["passer_id"] == passer)
    assert _by(written, passer, FtnMetric.DROPBACKS) == count
    assert _by(written, passer, FtnMetric.BLITZED_DROPBACKS) == blitzed
    assert {r.source for r in written} == {FTN_SOURCE}
    # Stamped at the end of the game's day plus FTN's 48-hour charting window.
    days = {datetime.fromisoformat(p["game_date"]).replace(tzinfo=UTC) for p, _ in pairs}
    assert {r.as_of for r in written} == {day + timedelta(days=3) for day in days}
    assert report.rows_read == len(fixture_rows("ftn_charting_2026.csv"))
    assert "0 with no charting row" in report.detail[0]


def test_ftn_refuses_a_flag_that_is_not_true_or_false() -> None:
    index = ChartIndex()
    row = dict(fixture_rows("ftn_charting_2026.csv")[0], is_drop="maybe")
    with pytest.raises(SchemaDriftError, match="is_drop"):
        index.add(row)


def test_ftn_refuses_a_play_charted_twice() -> None:
    index = ChartIndex()
    row = fixture_rows("ftn_charting_2026.csv")[0]
    index.add(row)
    with pytest.raises(SchemaDriftError, match="twice"):
        index.add(row)


def test_a_season_ftn_has_not_published_is_not_found(written: list[PlayerWeekObservation]) -> None:
    with pytest.raises(NflverseError) as raised:
        usage_feeds.ingest_ftn_charting(_CONN, NflverseClient(FixtureFetcher()), 2027)
    assert raised.value.kind == "not_found"


def _header_only(name: str) -> bytes:
    return (",".join(fixture_rows(name)[0].keys()) + "\n").encode()


def _csv(rows: Sequence[dict[str, str]]) -> bytes:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(rows[0].keys()), lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode()


def test_a_header_with_no_rows_is_refused(
    written: list[PlayerWeekObservation], monkeypatch: pytest.MonkeyPatch
) -> None:
    fetcher = FixtureFetcher({"ftn_charting_2026.csv": _header_only("ftn_charting_2026.csv")})
    with pytest.raises(NflverseError, match="no rows"):
        usage_feeds.ingest_ftn_charting(_CONN, NflverseClient(fetcher), _SEASON)
    monkeypatch.setattr(usage_feeds, "pfr_players", lambda conn: {})
    fetcher = FixtureFetcher({"advstats_week_pass_2026.csv": _header_only("advstats_week_pass_2026.csv")})
    with pytest.raises(NflverseError, match="no rows"):
        usage_feeds.ingest_pfr_advstats(_CONN, NflverseClient(fetcher), _SEASON)
    assert written == []


def test_next_gen_stats_stores_weeks_and_passes_over_the_season_summary(written: list[PlayerWeekObservation]) -> None:
    report = usage_feeds.ingest_next_gen_stats(_CONN, NflverseClient(FixtureFetcher()), _SEASON, _WEEK_AS_OF)
    receiving = fixture_rows("ngs_receiving.csv.gz")
    week_one = [r for r in receiving if r["season"] == "2026" and r["week"] == "1"]
    row = week_one[0]
    player = row["player_gsis_id"]
    assert _by(written, player, "rec_avg_separation") == float(row["avg_separation"])
    assert _by(written, player, "rec_targets") == float(row["targets"])
    assert {r.week for r in written} == {1}
    assert {r.source for r in written} == {NGS_SOURCE}
    assert all(r.as_of == _WEEK_AS_OF[1.0] for r in written)
    summaries = sum(1 for r in receiving if r["season"] == "2026" and r["week"] == "0")
    assert f"({summaries} season summaries passed over)" in report.detail[1]
    assert report.published


def test_next_gen_stats_is_unpublished_until_the_season_has_a_row(written: list[PlayerWeekObservation]) -> None:
    report = usage_feeds.ingest_next_gen_stats(_CONN, NflverseClient(FixtureFetcher()), 2027, _WEEK_AS_OF)
    assert not report.published
    assert written == []


def test_next_gen_stats_refuses_a_week_the_schedule_does_not_hold(written: list[PlayerWeekObservation]) -> None:
    with pytest.raises(NflverseError, match="week 1 of 2026"):
        usage_feeds.ingest_next_gen_stats(_CONN, NflverseClient(FixtureFetcher()), _SEASON, {})


def _pfr_ids() -> list[str]:
    kinds = ("pass", "rec", "rush")
    return sorted({r["pfr_player_id"] for kind in kinds for r in fixture_rows(f"advstats_week_{kind}_2026.csv")})


def test_pfr_maps_by_pfr_id_and_counts_the_unmapped(
    written: list[PlayerWeekObservation], monkeypatch: pytest.MonkeyPatch
) -> None:
    receiving = fixture_rows("advstats_week_rec_2026.csv")
    left_out = receiving[0]["pfr_player_id"]
    mapping = {pfr: PfrPlayer(f"gsis-{pfr}", True) for pfr in _pfr_ids() if pfr != left_out}
    monkeypatch.setattr(usage_feeds, "pfr_players", lambda conn: mapping)
    report = usage_feeds.ingest_pfr_advstats(_CONN, NflverseClient(FixtureFetcher()), _SEASON)
    assert report.unknown == (left_out,)
    assert "1 PFR ids with no mapping" in report.detail[1]
    row = receiving[1]
    assert _by(written, f"gsis-{row['pfr_player_id']}", "receiving_drops") == float(row["receiving_drop"])
    passing = fixture_rows("advstats_week_pass_2026.csv")[0]
    passer = f"gsis-{passing['pfr_player_id']}"
    assert _by(written, passer, "times_pressured") == float(passing["times_pressured"])
    assert {r.source for r in written} == {PFR_SOURCE}
    game_day = passing["pfr_game_id"][:8]
    stamp = next(r.as_of for r in written if r.player_id == passer)
    assert stamp == datetime(int(game_day[:4]), int(game_day[4:6]), int(game_day[6:]), tzinfo=UTC) + timedelta(days=2)


def test_a_player_at_a_position_the_engine_does_not_project_is_left_out(
    written: list[PlayerWeekObservation], monkeypatch: pytest.MonkeyPatch
) -> None:
    mapping = {pfr: PfrPlayer(f"gsis-{pfr}", False) for pfr in _pfr_ids()}
    monkeypatch.setattr(usage_feeds, "pfr_players", lambda conn: mapping)
    report = usage_feeds.ingest_pfr_advstats(_CONN, NflverseClient(FixtureFetcher()), _SEASON)
    assert written == []
    assert report.unknown == ()


def test_a_blank_pfr_value_is_no_row(written: list[PlayerWeekObservation], monkeypatch: pytest.MonkeyPatch) -> None:
    receiving = fixture_rows("advstats_week_rec_2026.csv")
    blanked = [dict(receiving[0], receiving_rat=""), *receiving[1:]]
    monkeypatch.setattr(usage_feeds, "pfr_players", lambda conn: {p: PfrPlayer(p, True) for p in _pfr_ids()})
    fetcher = FixtureFetcher({"advstats_week_rec_2026.csv": _csv(blanked)})
    usage_feeds.ingest_pfr_advstats(_CONN, NflverseClient(fetcher), _SEASON)
    player = receiving[0]["pfr_player_id"]
    assert _by(written, player, "receiving_passer_rating") is None
    assert _by(written, player, "receiving_drops") == float(receiving[0]["receiving_drop"])


def test_the_client_refuses_an_asset_past_its_byte_cap() -> None:
    client = NflverseClient(FixtureFetcher(), max_bytes=1000)
    with pytest.raises(NflverseError, match="more than 1000 bytes") as raised:
        client.stream_csv("ftn_charting", "ftn_charting_2026.csv", ("season",), lambda row: None)
    assert raised.value.kind == "malformed"
    with pytest.raises(NflverseError, match="more than 1000 bytes"):
        client.get_csv("ftn_charting", "ftn_charting_2026.csv")
    assert NflverseClient(FixtureFetcher(), max_bytes=10_000_000).get_csv("ftn_charting", "ftn_charting_2026.csv")
