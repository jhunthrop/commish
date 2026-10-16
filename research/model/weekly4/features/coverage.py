"""THE COVERAGE REPORT: per season, the rows, the share of rows under each default, the stamp checks
and the time to build (lane 68, item 5; the round 4 preregistration's sections 2.10 and 5).

The stamp checks:

- **every read kept the rule**: each recorded stamp read again (`weekly3.ledger.violation`), and per
  kind the newest row's offset from its instant (the figures exactly at the kickoff, one
  millisecond after t_g; every other stamped kind at or before t_g),
- **the per-game clause**: every club-game has each of its reads at its own instant (the game terms:
  plays, club rows, charted rows, the figures, the weather, the schedule; the player rows add round
  3's box and filings reads, the depth chart and the season before),
- **the recorded weather's stamp window**: the `game_weather` stamps' offsets from kickoff, beside
  the windows section 5 item 3 states (reported, never part of the rule).
"""

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from datetime import timedelta
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.weekly3.ledger import Game, ReadKind, Stamp, violation
from research.model.weekly4.features.columns import GAME_DEFAULTS, PLAYER_DEFAULTS, default_column
from research.model.weekly4.features.rows import Row
from research.model.weekly4.features.season import SeasonBuild

TEAM_KINDS: Final[tuple[ReadKind, ...]] = ("plays", "box", "charted", "weather", "schedule")
REPLAY_FIGURES: Final[tuple[ReadKind, ...]] = ("figures",)
LIVE_FIGURES: Final[tuple[ReadKind, ...]] = ("live_figures", "forecast")
PLAYER_KINDS: Final[tuple[ReadKind, ...]] = ("filings",)
# Section 5 item 3: the stamp windows of the recorded weather, in hours after kickoff, by season.
ITEM_THREE_WINDOWS: Final = {
    **dict.fromkeys((2016, 2019), (21.67, 34.5)),
    **dict.fromkeys((2017, 2018), (21.67, 31.0)),
    2020: (21.83, 31.00),
    **dict.fromkeys(range(2021, 2025), (22.67, 34.5)),
}
_WEATHER_WINDOW: Final = text(
    "select min(extract(epoch from as_of - kickoff_at)) / 3600 as lo, "
    "max(extract(epoch from as_of - kickoff_at)) / 3600 as hi, count(*) as n "
    "from research.game_weather where season = :season"
)


def default_shares(rows: Sequence[Row], names: Iterable[str]) -> dict[str, float]:
    if not rows:
        return {}
    return {name: sum(int(str(r[default_column(name)])) for r in rows) / len(rows) for name in names}


def _offsets(stamps: Sequence[Stamp]) -> dict[str, dict[str, Any]]:
    by_kind: dict[str, list[timedelta]] = defaultdict(list)
    counts: dict[str, int] = defaultdict(int)
    for stamp in stamps:
        counts[stamp.kind] += 1
        if stamp.newest is not None:
            by_kind[stamp.kind].append(stamp.newest.as_of - stamp.moment)
    return {
        kind: {
            "reads": counts[kind],
            "newest_after_instant_seconds_max": max(by_kind[kind]).total_seconds() if by_kind[kind] else None,
            "newest_after_instant_seconds_min": min(by_kind[kind]).total_seconds() if by_kind[kind] else None,
        }
        for kind in sorted(counts)
    }


def clause(games: Iterable[Game], stamps: Sequence[Stamp], kinds: Sequence[ReadKind], prior: bool) -> dict[str, Any]:
    """Every game has each of `kinds` read at its own instant (and the season before at or before it)."""
    index = {(s.kind, s.season, s.week, s.moment) for s in stamps}
    priors = [s for s in stamps if s.kind == "prior"]
    found = sorted(set(games), key=lambda g: (g.season, g.week, g.moment, g.club))
    short: list[str] = []
    for g in found:
        missing = [k for k in kinds if (k, g.season, g.week, g.moment) not in index]
        if prior and not any(s.season == g.season and s.moment <= g.moment for s in priors):
            missing.append("prior")
        if missing:
            short.append(f"{g.season} week {g.week} {g.club} lacks {', '.join(missing)}")
    return {"games": len(found), "holds": not short and bool(found), "short": short[:5], "short_count": len(short)}


def weather_window(conn: Connection, season: int) -> dict[str, Any]:
    row = conn.execute(_WEATHER_WINDOW, {"season": season}).one()
    window = ITEM_THREE_WINDOWS.get(season)
    lo = None if row.lo is None else round(float(row.lo), 2)
    hi = None if row.hi is None else round(float(row.hi), 2)
    inside = None if window is None or lo is None or hi is None else window[0] <= lo and hi <= window[1]
    return {"rows": int(row.n), "hours_after_kickoff": [lo, hi], "item_three_window": window, "inside": inside}


def season_report(build: SeasonBuild, conn: Connection, digests: Mapping[str, str]) -> dict[str, Any]:
    live = build.spec.live_after is not None
    figures = LIVE_FIGURES if live else REPLAY_FIGURES
    broken = [b for b in (violation(s) for s in build.stamps) if b is not None]
    chart: ReadKind = "depth" if build.spec.depth_rule == "week" else "depth_prior"
    player_kinds: tuple[ReadKind, ...] = (*TEAM_KINDS, *figures, *PLAYER_KINDS, chart)
    return {
        "season": build.spec.season,
        "live_after": None if build.spec.live_after is None else build.spec.live_after.isoformat(),
        "weeks": {"player": list(build.spec.player_weeks), "team": list(build.spec.team_weeks)},
        "depth_chart_rule": build.spec.depth_rule,
        "rows": {"player": len(build.player_rows), "team": len(build.team_rows), "play": len(build.play_rows)},
        "default_shares": {
            "player": default_shares(build.player_rows, (*GAME_DEFAULTS, *PLAYER_DEFAULTS)),
            "team": default_shares(build.team_rows, GAME_DEFAULTS),
        },
        "teammates": dict(build.counts),
        "stamps": {
            "reads": len(build.stamps),
            "broken": len(broken),
            "broken_examples": broken[:3],
            "by_kind": _offsets(build.stamps),
        },
        "clause": {
            "team": clause(build.team_games, build.stamps, (*TEAM_KINDS, *figures), prior=False),
            "player": clause(build.player_games, build.stamps, player_kinds, prior=True),
        },
        "weather_stamp_window": weather_window(conn, build.spec.season),
        "seconds": round(build.seconds, 1),
        "digests": dict(digests),
    }
