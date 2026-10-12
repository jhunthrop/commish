"""PLAYER PROPS FROM THE ODDS API (`src/projections/odds/{http,props-store,snapshot,historical}.ts`).

An event's odds response is parsed strictly: an unknown market or a malformed outcome throws (a
wrong number is worse than none), a line priced on one side only is skipped and counted, and a
side quoted twice for one player and point is ambiguous and skipped. Every two-sided line is one
`player_prop_observations` row, stamped with the instant it was fetched. The key travels as a
query parameter, which the replay strips before a URL is ever recorded.
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final, Literal
from urllib.parse import urlencode

from sqlalchemy import Connection, insert

from research.db.schema import PLAYER_PROP_OBSERVATIONS
from research.errors import ResearchError, SchemaDriftError
from research.pipeline.http import Fetcher, HttpResponse
from research.pipeline.jscompat import js_date_parse, js_is_finite, js_json_stringify, js_string, js_trim

ODDS_API_BASE: Final = "https://api.the-odds-api.com/v4"
SPORT_KEY: Final = "americanfootball_nfl"
API_KEY_ENV: Final = "ODDS_API_KEY"
PROP_MARKETS: Final = (
    "player_pass_yds",
    "player_reception_yds",
    "player_receptions",
    "player_rush_yds",
    "player_pass_tds",
)
_INSERT_CHUNK_ROWS = 2_000


class OddsApiError(ResearchError):
    """The Odds API returned a non-2xx status."""


@dataclass(frozen=True)
class OddsEvent:
    id: str
    commence_time: datetime
    home_team: str
    away_team: str


@dataclass(frozen=True)
class CreditStatus:
    remaining: str
    used: str


@dataclass(frozen=True)
class PropObservation:
    event_id: str
    commence_time: datetime
    bookmaker: str
    market: str
    player_name: str
    point: float
    over_price: float
    under_price: float
    fetched_at: datetime


@dataclass(frozen=True)
class SkippedOutcome:
    bookmaker: str
    market: str
    player_name: str
    point: float
    reason: Literal["unpaired", "duplicate"]
    present_side: Literal["Over", "Under"]


@dataclass(frozen=True)
class ParsedEventOdds:
    observations: list[PropObservation]
    skipped: list[SkippedOutcome]


def credit_status(response: HttpResponse) -> CreditStatus:
    return CreditStatus(
        response.header("x-requests-remaining") or "unknown", response.header("x-requests-used") or "unknown"
    )


def require_ok(response: HttpResponse, path: str) -> None:
    if not response.ok:
        body = response.text()
        raise OddsApiError(
            f"The Odds API returned HTTP {response.status} for {path}.{f' Body: {body}' if body else ''}"
        )


def odds_url(path: str, api_key: str, params: dict[str, str] | None = None) -> str:
    return f"{ODDS_API_BASE}{path}?{urlencode({'apiKey': api_key, **(params or {})})}"


def _event_date(value: object, what: str) -> datetime:
    parsed = js_date_parse(value) if isinstance(value, str) else None
    if parsed is None:
        raise SchemaDriftError(f'{what} is unparseable ("{value}").')
    return parsed


def parse_odds_event(raw: object, path: str) -> OddsEvent:
    if not isinstance(raw, dict):
        raise SchemaDriftError(f"{path} was not an object.")
    event_id = raw.get("id")
    if not isinstance(event_id, str) or event_id == "":
        raise SchemaDriftError(f"{path}.id is missing.")
    commence = raw.get("commence_time")
    if not isinstance(commence, str):
        raise SchemaDriftError(f"{path}.commence_time is missing.")
    home, away = raw.get("home_team"), raw.get("away_team")
    if not isinstance(home, str) or not isinstance(away, str):
        raise SchemaDriftError(f"{path} is missing home_team or away_team.")
    return OddsEvent(event_id, _event_date(commence, f"{path}.commence_time"), home, away)


def _fail(path: str, reason: str) -> SchemaDriftError:
    return SchemaDriftError(f"odds-props-snapshot: {path}: {reason}")


def _object(value: object, path: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise _fail(path, f"expected an object, got {_shown(value)}")
    return value


def _array(value: object, path: str) -> list[object]:
    if not isinstance(value, list):
        raise _fail(path, f"expected an array, got {_shown(value)}")
    return value


def _string(value: object, path: str) -> str:
    if not isinstance(value, str) or js_trim(value) == "":
        raise _fail(path, f"expected a non-empty string, got {_shown(value)}")
    return value


def _number(value: object, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not js_is_finite(float(value)):
        raise _fail(path, f"expected a finite number, got {_shown(value)}")
    return float(value)


def _shown(value: object) -> str:
    return "undefined" if value is None else js_json_stringify(value)


@dataclass
class _Pair:
    player_name: str
    point: float
    over: float | None = None
    under: float | None = None


def _market_outcomes(
    outcomes: list[object], path: str
) -> tuple[dict[str, _Pair], dict[str, tuple[str, float, Literal["Over", "Under"]]]]:
    pairs: dict[str, _Pair] = {}
    duplicated: dict[str, tuple[str, float, Literal["Over", "Under"]]] = {}
    for index, raw in enumerate(outcomes):
        where = f"{path}[{index}]"
        outcome = _object(raw, where)
        name = _string(outcome.get("name"), f"{where}.name")
        if name not in ("Over", "Under"):
            raise _fail(
                f"{where}.name", f'expected "Over" or "Under", got {json.dumps(name)} -- malformed outcome pair'
            )
        player = _string(outcome.get("description"), f"{where}.description")
        point = _number(outcome.get("point"), f"{where}.point")
        price = _number(outcome.get("price"), f"{where}.price")
        key = f"{player} {js_string(point)}"
        if key in duplicated:
            continue
        pair = pairs.get(key) or _Pair(player, point)
        if name == "Over":
            if pair.over is not None:
                duplicated[key] = (player, point, "Over")
                pairs.pop(key, None)
                continue
            pair.over = price
        else:
            if pair.under is not None:
                duplicated[key] = (player, point, "Under")
                pairs.pop(key, None)
                continue
            pair.under = price
        pairs[key] = pair
    return pairs, duplicated


def parse_event_odds_response(payload: object, fetched_at: datetime) -> ParsedEventOdds:
    """`parseEventOddsResponse`: every two-sided line, the rest named and skipped."""
    root = _object(payload, "response")
    event_id = _string(root.get("id"), "response.id")
    commence_raw = _string(root.get("commence_time"), "response.commence_time")
    commence = js_date_parse(commence_raw)
    if commence is None:
        raise _fail("response.commence_time", f'unparseable date "{commence_raw}"')
    if root.get("bookmakers") is None:
        return ParsedEventOdds([], [])
    observations: list[PropObservation] = []
    skipped: list[SkippedOutcome] = []
    for b_index, raw_bookmaker in enumerate(_array(root["bookmakers"], "response.bookmakers")):
        b_path = f"response.bookmakers[{b_index}]"
        bookmaker = _object(raw_bookmaker, b_path)
        bookmaker_key = _string(bookmaker.get("key"), f"{b_path}.key")
        for m_index, raw_market in enumerate(_array(bookmaker.get("markets"), f"{b_path}.markets")):
            m_path = f"{b_path}.markets[{m_index}]"
            market = _object(raw_market, m_path)
            market_key = _string(market.get("key"), f"{m_path}.key")
            if market_key not in PROP_MARKETS:
                raise _fail(
                    f"{m_path}.key", f'unknown market "{market_key}" -- expected one of {", ".join(PROP_MARKETS)}'
                )
            pairs, duplicated = _market_outcomes(
                _array(market.get("outcomes"), f"{m_path}.outcomes"), f"{m_path}.outcomes"
            )
            for player, point, side in duplicated.values():
                skipped.append(SkippedOutcome(bookmaker_key, market_key, player, point, "duplicate", side))
            for pair in pairs.values():
                if pair.over is None or pair.under is None:
                    side = "Over" if pair.over is not None else "Under"
                    skipped.append(
                        SkippedOutcome(bookmaker_key, market_key, pair.player_name, pair.point, "unpaired", side)
                    )
                    continue
                observations.append(
                    PropObservation(
                        event_id,
                        commence,
                        bookmaker_key,
                        market_key,
                        pair.player_name,
                        pair.point,
                        pair.over,
                        pair.under,
                        fetched_at,
                    )
                )
    return ParsedEventOdds(observations, skipped)


def record_prop_observations(conn: Connection, rows: Sequence[PropObservation]) -> int:
    """`recordPropObservations`: a plain insert; every fetch is its own observation."""
    for start in range(0, len(rows), _INSERT_CHUNK_ROWS):
        conn.execute(
            insert(PLAYER_PROP_OBSERVATIONS),
            [
                {
                    "event_id": r.event_id, "commence_time": r.commence_time, "bookmaker": r.bookmaker,
                    "market": r.market, "player_name": r.player_name, "point": r.point,
                    "over_price": r.over_price, "under_price": r.under_price, "fetched_at": r.fetched_at,
                }
                for r in rows[start : start + _INSERT_CHUNK_ROWS]
            ],
        )  # fmt: skip
    return len(rows)


def get_json(fetcher: Fetcher, url: str, path: str) -> tuple[object, CreditStatus]:
    response = fetcher.get(url)
    require_ok(response, path)
    payload: object = json.loads(response.text())
    return payload, credit_status(response)
