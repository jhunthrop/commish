"""THE TWO PUBLISHED BOARDS the engine benchmarks against (`src/projections/preseason/publishers.ts`).

Fantasy Football Calculator's ADP (a JSON API, one format per request, dated by its draft
window's end) and FantasyPros' expert consensus (the `ecrData` block embedded in its cheat-sheet
page, dated September 8 of the season). Each board's knowable-at stamp is the EARLIER of the
publisher's own date and the moment it was fetched: a board cannot be known before it was read.
"""

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from research.errors import ResearchError, SchemaDriftError
from research.pipeline.http import Fetcher

FfcAdpFormat = Literal["ppr", "half-ppr", "standard"]
_FFC_TEAM_COUNT = 12
_END_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ECR_DATA = re.compile(r"ecrData\s*=\s*(\{[\s\S]*?\});\s*\n")
_ECR_USER_AGENT = "commish-projection-engine/1.0"


class PublisherError(ResearchError):
    """A publisher returned an error status or published nothing usable."""


@dataclass(frozen=True)
class RankingCandidate:
    name: str
    position: str
    team: str | None
    rank: float


@dataclass(frozen=True)
class PublishedBoard:
    candidates: list[RankingCandidate]
    published_at: datetime
    publisher_stamp: str


def _earlier(left: datetime, right: datetime) -> datetime:
    return left if left <= right else right


def ffc_adp_url(season: int, feed_format: FfcAdpFormat) -> str:
    return (
        f"https://fantasyfootballcalculator.com/api/v1/adp/{feed_format}"
        f"?year={season}&teams={_FFC_TEAM_COUNT}&position=all"
    )


def parse_average_draft_position(body: object, season: int, fetched_at: datetime) -> PublishedBoard:
    record = body if isinstance(body, dict) else {}
    players = record.get("players") or []
    if not isinstance(players, list) or len(players) == 0:
        raise PublisherError(
            f"Fantasy Football Calculator published no {season} board; there is no market price to score against."
        )
    meta = record.get("meta")
    end_date = meta.get("end_date") if isinstance(meta, dict) else None
    if not isinstance(end_date, str) or _END_DATE.match(end_date) is None:
        raise PublisherError(
            f"Fantasy Football Calculator's {season} board carries no draft window; an undated market price is not a benchmark."
        )
    window_end = datetime.fromisoformat(f"{end_date}T00:00:00+00:00") + timedelta(days=1)
    return PublishedBoard(
        candidates=[RankingCandidate(p["name"], p["position"], p.get("team"), p["adp"]) for p in players],
        published_at=_earlier(window_end, fetched_at),
        publisher_stamp=end_date,
    )


def fetch_average_draft_position(
    fetcher: Fetcher, season: int, fetched_at: datetime, feed_format: FfcAdpFormat = "ppr"
) -> PublishedBoard:
    response = fetcher.get(ffc_adp_url(season, feed_format))
    if not response.ok:
        raise PublisherError(f"Fantasy Football Calculator returned HTTP {response.status} for {season}.")
    return parse_average_draft_position(json.loads(response.text()), season, fetched_at)


def ecr_url(season: int) -> str:
    return f"https://www.fantasypros.com/nfl/rankings/ppr-cheatsheets.php?year={season}"


def parse_expert_consensus(html: str, season: int, fetched_at: datetime) -> PublishedBoard:
    match = _ECR_DATA.search(html)
    if match is None:
        raise SchemaDriftError(f"FantasyPros' {season} page carries no ecrData block; the page shape has changed.")
    board = json.loads(match.group(1))
    if board.get("year") != str(season):
        raise PublisherError(
            f"FantasyPros returned a board for {board.get('year') or 'no season'} when asked for {season}."
        )
    players = [
        p for p in board.get("players") or [] if "player_name" in p and "player_position_id" in p and "rank_ecr" in p
    ]
    if not players:
        raise PublisherError(f"FantasyPros' {season} board carries no ranked players.")
    return PublishedBoard(
        candidates=[
            RankingCandidate(
                p["player_name"],
                p["player_position_id"],
                None if "player_team_id" not in p or p["player_team_id"] == "FA" else p["player_team_id"],
                p["rank_ecr"],
            )
            for p in players
        ],
        published_at=_earlier(datetime(season, 9, 8, tzinfo=UTC), fetched_at),
        publisher_stamp=board.get("last_updated")
        if "last_updated" in board and board["last_updated"] is not None
        else "none",
    )


def fetch_expert_consensus(fetcher: Fetcher, season: int, fetched_at: datetime) -> PublishedBoard:
    response = fetcher.get(ecr_url(season), {"user-agent": _ECR_USER_AGENT})
    if not response.ok:
        raise PublisherError(f"FantasyPros returned HTTP {response.status} for {season}.")
    return parse_expert_consensus(response.text(), season, fetched_at)
