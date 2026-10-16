"""THE ANYTIME-TOUCHDOWN MARKET, CAPTURED PER KICKOFF SLOT (`player_td_prop_observations`).

The weekly round 4's market benchmark for touchdowns (preregistration §2.9): The Odds API's
`player_anytime_td` (the key checked against a live answer on 2026-10-16: every book quotes a Yes
price per player, none a No), captured in each kickoff slot's window (`kickoff_slots`) for that
slot's events. One event's call with one market and one region spends one credit, and the answer's
`x-requests-remaining` is the plan's balance, printed every pass. Never an input, never on the site.

Parsed strictly, as the props snapshot is (`props.py`): an unknown market, an outcome other than
Yes or No, or an unreadable price is a changed API; a player with a No and no Yes is skipped and
counted; a player quoted twice on one side by one book is ambiguous and skipped.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, insert, text

from research.db.schema import PLAYER_TD_PROP_OBSERVATIONS
from research.errors import SchemaDriftError
from research.pipeline.http import Fetcher
from research.pipeline.jscompat import js_date_parse
from research.pipeline.kickoff_slots import Slot, due_slot, kickoff_slots
from research.pipeline.kickoffs import stored_kickoffs
from research.pipeline.odds.props import SPORT_KEY, CreditStatus, get_json, odds_url, parse_odds_event

TD_MARKET: Final = "player_anytime_td"
TD_PARAMS: Final = (("regions", "us"), ("markets", TD_MARKET), ("oddsFormat", "american"))
_SIDES: Final = ("Yes", "No")


@dataclass(frozen=True, slots=True)
class TdObservation:
    event_id: str
    commence_time: datetime
    bookmaker: str
    player_name: str
    yes_price: int
    no_price: int | None
    fetched_at: datetime


@dataclass(frozen=True, slots=True)
class ParsedTd:
    observations: list[TdObservation]
    skipped: int


def _fail(path: str, reason: str) -> SchemaDriftError:
    return SchemaDriftError(f"anytime-touchdown snapshot: {path}: {reason}")


def _list(value: object, path: str) -> list[object]:
    if not isinstance(value, list):
        raise _fail(path, "expected an array")
    return value


def _dict(value: object, path: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise _fail(path, "expected an object")
    return value


def _string(value: object, path: str) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise _fail(path, "expected a non-empty string")
    return value


def _price(value: object, path: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int | float) or float(value) != int(value):
        raise _fail(path, f"expected a whole American price, got {value!r}")
    return int(value)


def _book_prices(outcomes: list[object], path: str) -> tuple[dict[str, dict[str, int]], int]:
    prices: dict[str, dict[str, int]] = {}
    ambiguous: set[str] = set()
    for index, raw in enumerate(outcomes):
        where = f"{path}[{index}]"
        outcome = _dict(raw, where)
        side = _string(outcome.get("name"), f"{where}.name")
        if side not in _SIDES:
            raise _fail(f"{where}.name", f'expected "Yes" or "No", got "{side}"')
        player = _string(outcome.get("description"), f"{where}.description")
        quoted = prices.setdefault(player, {})
        if side in quoted:
            ambiguous.add(player)
        quoted[side] = _price(outcome.get("price"), f"{where}.price")
    for player in ambiguous:
        prices.pop(player)
    return prices, len(ambiguous)


def parse_td_response(payload: object, fetched_at: datetime) -> ParsedTd:
    root = _dict(payload, "response")
    event_id = _string(root.get("id"), "response.id")
    commence = js_date_parse(_string(root.get("commence_time"), "response.commence_time"))
    if commence is None:
        raise _fail("response.commence_time", "unparseable date")
    observations: list[TdObservation] = []
    skipped = 0
    for b_index, raw_book in enumerate(_list(root.get("bookmakers", []), "response.bookmakers")):
        b_path = f"response.bookmakers[{b_index}]"
        book = _dict(raw_book, b_path)
        key = _string(book.get("key"), f"{b_path}.key")
        for m_index, raw_market in enumerate(_list(book.get("markets"), f"{b_path}.markets")):
            m_path = f"{b_path}.markets[{m_index}]"
            market = _dict(raw_market, m_path)
            if market.get("key") != TD_MARKET:
                raise _fail(f"{m_path}.key", f'unknown market "{market.get("key")}", expected {TD_MARKET}')
            prices, ambiguous = _book_prices(_list(market.get("outcomes"), f"{m_path}.outcomes"), f"{m_path}.outcomes")
            skipped += ambiguous
            for player, sides in prices.items():
                if "Yes" not in sides:
                    skipped += 1
                    continue
                observations.append(
                    TdObservation(event_id, commence, key, player, sides["Yes"], sides.get("No"), fetched_at)
                )
    return ParsedTd(observations, skipped)


def record_td_observations(conn: Connection, rows: Sequence[TdObservation]) -> int:
    if rows:
        conn.execute(insert(PLAYER_TD_PROP_OBSERVATIONS), [
            {
                "event_id": r.event_id, "commence_time": r.commence_time, "bookmaker": r.bookmaker,
                "player_name": r.player_name, "yes_price": r.yes_price, "no_price": r.no_price,
                "fetched_at": r.fetched_at,
            }
            for r in rows
        ])  # fmt: skip
    return len(rows)


_CAPTURED_SINCE: Final = text(
    f"select exists (select 1 from {PLAYER_TD_PROP_OBSERVATIONS.fullname} "
    "where fetched_at >= :since and commence_time between :first and :last)"
)


def td_slot_due(conn: Connection, season: int, now: datetime) -> Slot | None:
    """The kickoff slot whose window holds `now`, unless its events' market is already stored in it."""
    slot = due_slot(kickoff_slots(stored_kickoffs(conn, season)), now)
    if slot is None:
        return None
    params = {"since": slot.opens, "first": slot.first_kickoff, "last": slot.last_kickoff}
    return None if conn.execute(_CAPTURED_SINCE, params).scalar_one() else slot


@dataclass(frozen=True, slots=True)
class TdSnapshot:
    slot: Slot | None
    events: int
    written: int
    skipped: int
    credits: CreditStatus | None

    def line(self) -> str:
        if self.slot is None:
            return "anytime-touchdown market: no kickoff slot due"
        credits = "" if self.credits is None else f", {self.credits.remaining} credits left this month"
        return (
            f"anytime-touchdown market, week {self.slot.week} {self.slot.name}: {self.written} rows from "
            f"{self.events} events, {self.skipped} skipped{credits}"
        )


def run_td_snapshot(conn: Connection, fetcher: Fetcher, api_key: str, season: int, now: datetime) -> TdSnapshot:
    """The due slot's events, one credit each; nothing at all when no slot is due."""
    slot = td_slot_due(conn, season, now)
    if slot is None:
        return TdSnapshot(None, 0, 0, 0, None)
    listed, credits = get_json(fetcher, odds_url(f"/sports/{SPORT_KEY}/events", api_key), "/events")
    events = [parse_odds_event(raw, f"td snapshot: /events[{i}]") for i, raw in enumerate(_list(listed, "/events"))]
    chosen = [e for e in events if slot.holds(e.commence_time)]
    written = skipped = 0
    for event in chosen:
        path = f"/sports/{SPORT_KEY}/events/{event.id}/odds"
        payload, credits = get_json(fetcher, odds_url(path, api_key, dict(TD_PARAMS)), f"/events/{event.id}/odds")
        parsed = parse_td_response(payload, now)
        written += record_td_observations(conn, parsed.observations)
        skipped += parsed.skipped
    return TdSnapshot(slot, len(chosen), written, skipped, credits)
