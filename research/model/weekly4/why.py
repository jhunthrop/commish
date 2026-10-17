"""THE WHY LINES (preregistration section 2.7, "On the screen"): the three groups with the largest
absolute contribution and any other of at least 0.5 PPR points (half a reception), each a fact in the
expert's form and the site's words. Every template keeps the copy rules: no em-dashes, no semicolons,
no tips, no competitor names, no betting or trading words ("expected to win by 3", never the figure's own
idiom). The facts come from the row the number read, at its instant; the screen shows the read time.
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

TOP: Final = 3
HALF_A_POINT: Final = 0.5  # 2.7: "any other of at least 0.5 PPR points (half a reception)"
POSITION_WORDS: Final = {"QB": "quarterbacks", "RB": "running backs", "WR": "receivers", "TE": "tight ends"}
KIND_WORDS: Final = {
    "targets": "targets",
    "carries": "carries",
    "dropbacks": "dropbacks",
    "air_yards": "air yards",
    "red_zone": "red-zone chances",
    "inside_ten": "chances inside the ten",
}


@dataclass(frozen=True, slots=True)
class Facts:
    """The facts a player's why lines state, read from his row at the game's instant."""

    position: str
    opponent: str
    opponent_rank: int | None  # 1 gives up the most points over expected to the position
    home: float
    rest_days: float
    implied_points: float
    spread: float  # his club's expected margin, positive when it is expected to win
    roof: str | None
    wind_mph: float
    temperature_f: float
    precipitation: float
    precipitation_probability: float | None
    vacated_count: int
    vacated_volume: float  # the extra opportunities a game from teammates out
    returning_count: int
    returning_volume: float  # the opportunities a game a returning teammate takes back
    kind: str  # his main kind
    share_last_three: float
    share_season: float
    efficiency_per_100: float  # his shrunk points over expected per 100 opportunities
    efficiency_sample: int
    efficiency_kind: str


def chosen_groups(values: Mapping[str, float]) -> list[str]:
    """The three largest by absolute value, then any other of at least half a point."""
    ordered = sorted(values, key=lambda g: (-abs(values[g]), g))
    return ordered[:TOP] + [g for g in ordered[TOP:] if abs(values[g]) >= HALF_A_POINT]


def _number(value: float) -> str:
    rounded = round(value * 2) / 2
    return f"{rounded:g}"


def _ordinal(rank: int) -> str:
    suffix = "th" if 10 <= rank % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(rank % 10, "th")  # noqa: PLR2004 - English ordinals
    return f"{rank}{suffix}"


def _role(f: Facts) -> str:
    words = KIND_WORDS.get(f.kind, f.kind)
    return f"Has {f.share_last_three:.0%} of his team's {words} over his last three games, {f.share_season:.0%} this season"


def _teammates(f: Facts) -> str:
    words = KIND_WORDS.get(f.kind, f.kind)
    if f.vacated_count > 0 and f.vacated_volume >= f.returning_volume:
        who = "a teammate" if f.vacated_count == 1 else f"{f.vacated_count} teammates"
        return f"Gets {f.vacated_volume:.1f} more {words} with {who} out"
    if f.returning_count > 0:
        who = "a teammate" if f.returning_count == 1 else f"{f.returning_count} teammates"
        return f"Gives back about {f.returning_volume:.1f} {words} with {who} returning"
    return f"His team has its usual players at his position this week, so his {words} hold"


def _matchup(f: Facts) -> str:
    group = POSITION_WORDS.get(f.position, "his position")
    if f.opponent_rank is None:
        return f"Against {f.opponent}, who have not played enough yet to read against {group}"
    return f"Against {f.opponent}, who give up the {_ordinal(f.opponent_rank)} most points over expected to {group}"


def _game(f: Facts) -> str:
    if not math.isfinite(f.implied_points):
        return "No expected score for this game yet"
    score = f"His team is expected to score {round(f.implied_points):.0f}"
    if not math.isfinite(f.spread):
        return score
    if abs(f.spread) < HALF_A_POINT / 2:
        return f"{score} in an even game"
    verb = "win" if f.spread > 0 else "lose"
    return f"{score} and to {verb} by {_number(abs(f.spread))}"


def _weather(f: Facts) -> str:
    if f.roof in ("dome", "closed"):
        return "Indoors, roof expected closed" if f.roof == "closed" else "Indoors, under a dome"
    if not (math.isfinite(f.wind_mph) and math.isfinite(f.temperature_f)):
        return "No forecast for kickoff yet"
    parts = [f"Wind {f.wind_mph:.0f} mph at kickoff", f"{f.temperature_f:.0f} degrees"]
    if f.precipitation_probability is not None:
        parts.append(f"a {f.precipitation_probability:.0%} chance of rain or snow")
    elif f.precipitation >= 1.0:
        parts.append("rain or snow")
    return ", ".join(parts) + (", roof expected open" if f.roof == "open" else ", outdoors")


def _home(f: Facts) -> str:
    place = "At home" if f.home >= 1.0 else "On the road"
    if not math.isfinite(f.rest_days):
        return place
    return f"{place}, on {f.rest_days:.0f} days of rest"


def _efficiency(f: Facts) -> str:
    words = KIND_WORDS.get(f.efficiency_kind, f.efficiency_kind)
    side = "over" if f.efficiency_per_100 >= 0 else "under"
    return (
        f"Scoring {abs(f.efficiency_per_100):.0f} points {side} expected per 100 {words} this season, "
        f"pulled toward the average over {f.efficiency_sample} {words}"
    )


_TEMPLATES: Final = {
    "role": _role,
    "teammates": _teammates,
    "matchup": _matchup,
    "game": _game,
    "weather": _weather,
    "home_rest": _home,
    "efficiency": _efficiency,
}


def sentence(group: str, facts: Facts) -> str:
    return _TEMPLATES[group](facts)
