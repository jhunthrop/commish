"""THE STATS PROVIDER'S CLIENT (`src/stats/tank01/client.ts`): Tank01 on RapidAPI.

The key travels in a header and never in a URL, so it never reaches a log line or a fixture. One
429 is retried once after a pause (a burst limit, not a quota); a second is `rate_limited`. A body
that is not a JSON object, an envelope carrying an `error`, or an envelope with no `body` are each
typed failures rather than an empty result, because an empty result reads as a quiet week.
"""

import json
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Final, Literal
from urllib.parse import urlencode, urljoin

from research.errors import ConfigurationError, ResearchError
from research.pipeline.http import Fetcher, HttpResponse

TANK01_HOST: Final = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com"
TANK01_BASE_URL: Final = f"https://{TANK01_HOST}"
BURST_RETRY_DELAY_SECONDS: Final = 1.1
API_KEY_ENV: Final = "TANK01_API_KEY"
SEASON_ENV: Final = "TANK01_SEASON"
DEFAULT_SEASON: Final = 2026


class Paths:
    PLAYER_LIST: Final = "/getNFLPlayerList"
    TEAMS: Final = "/getNFLTeams"
    GAMES_FOR_WEEK: Final = "/getNFLGamesForWeek"
    BOX_SCORE: Final = "/getNFLBoxScore"
    ADP: Final = "/getNFLADP"
    TEAM_ROSTER: Final = "/getNFLTeamRoster"
    DEPTH_CHARTS: Final = "/getNFLDepthCharts"
    CHANGELOG: Final = "/getNFLChangelog"
    NEWS: Final = "/getNFLNews"
    BETTING_ODDS: Final = "/getNFLBettingOdds"
    DFS: Final = "/getNFLDFS"
    PROJECTIONS: Final = "/getNFLProjections"
    INJURIES_BY_DATE: Final = "/getNFLInjuriesByDate"
    INACTIVES: Final = "/getNFLInactiveList"
    CURRENT_INFO: Final = "/getNFLCurrentInfo"


FailureKind = Literal["unauthorized", "forbidden", "rate_limited", "upstream", "malformed"]


class Tank01Error(ResearchError):
    def __init__(self, kind: FailureKind, path: str, message: str) -> None:
        super().__init__(message)
        self.kind: FailureKind = kind
        self.path = path


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


@dataclass(frozen=True)
class Tank01Client:
    fetcher: Fetcher
    api_key: str
    base_url: str = TANK01_BASE_URL
    host: str = TANK01_HOST
    sleep: Callable[[float], None] = field(default=_sleep)

    def __post_init__(self) -> None:
        if self.api_key == "":
            raise ConfigurationError(f"{API_KEY_ENV} is empty; there is no Tank01 client to build.")

    def url(self, path: str, query: Mapping[str, str] | None = None) -> str:
        base = urljoin(self.base_url, path)
        return f"{base}?{urlencode(dict(query))}" if query else base

    def get(self, path: str, query: Mapping[str, str] | None = None) -> object:
        url = self.url(path, query)
        headers = {"x-rapidapi-key": self.api_key, "x-rapidapi-host": self.host}
        response = self.fetcher.get(url, headers)
        if response.status == 429:
            self.sleep(BURST_RETRY_DELAY_SECONDS)
            response = self.fetcher.get(url, headers)
        _assert_status(response, path)
        return _envelope_body(response, path)


def _assert_status(response: HttpResponse, path: str) -> None:
    if response.status == 401:
        raise Tank01Error("unauthorized", path, f"Tank01 rejected the API key. Check {API_KEY_ENV}.")
    if response.status == 403:
        raise Tank01Error("forbidden", path, "This RapidAPI key is not subscribed to the Tank01 NFL API.")
    if response.status == 429:
        raise Tank01Error("rate_limited", path, "Tank01 request quota exhausted. Back off and retry later.")
    if not response.ok:
        raise Tank01Error("upstream", path, f"Tank01 returned HTTP {response.status} for {path}.")


def _envelope_body(response: HttpResponse, path: str) -> object:
    try:
        parsed: object = json.loads(response.text())
    except ValueError:
        parsed = None
    if isinstance(parsed, list):
        # An array is an object in JavaScript: it passes the TypeScript's type check and fails on `body`.
        raise Tank01Error("malformed", path, f"Tank01 returned no body for {path}.")
    if not isinstance(parsed, dict):
        raise Tank01Error("malformed", path, f"Tank01 returned a non-JSON body for {path}.")
    error = parsed.get("error")
    if isinstance(error, str) and error != "":
        raise Tank01Error("upstream", path, f"Tank01 refused {path}: {error}")
    if "body" not in parsed:
        raise Tank01Error("malformed", path, f"Tank01 returned no body for {path}.")
    body: object = parsed["body"]
    return body
