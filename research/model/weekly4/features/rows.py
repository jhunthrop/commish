"""ONE ROW: a club-game's game terms, and a player's terms on top of them, each default marked.

The values come from the modules beside this one, read at the game's instant; here they are only
laid out in the schema of `columns.py`, every default of section 2.10 an indicator column.
"""

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from research.model.weekly2.designation import CLEAR, QUESTIONABLE, WITHHELD, WeekStatus
from research.model.weekly3.allowance import Allowance
from research.model.weekly3.features import NO_FILING, NO_PRIOR_SEASON, TEAMMATE_NOT_IN_LAST_THREE
from research.model.weekly3.work import KINDS_BY_POSITION
from research.model.weekly4.features.charted import charted_features
from research.model.weekly4.features.columns import (
    GAME_DEFAULTS,
    NO_DEPTH_ROW,
    NO_GAME_THIS_SEASON,
    OPPONENT_NO_PACE,
    PASS_RATE_ALLOWED_WITHOUT_A_GAME,
    PLAYER_DEFAULTS,
    ROUND_THREE_ALLOWANCES,
    decay_label,
    default_column,
)
from research.model.weekly4.features.game import Figures, Venue, Weather
from research.model.weekly4.features.matchup import NO_PACE, ROLE_ALLOWANCES, DefencePressure, Tempo
from research.model.weekly4.features.plays import DEPTH_BUCKETS, SHARE_KINDS, PlayerTally
from research.model.weekly4.features.shares import (
    DECAYS,
    GameShare,
    decayed_share,
    last_three_share,
    season_share,
    snap_mean,
)
from research.model.weekly4.features.teammates import Returning, Vacated
from research.pipeline.observations import PlayerWeekObservation

NEUTRAL_ALLOWANCE: Final = 1.0  # 2.10: "Allowance 1, the shrinkage's prior"

Row = dict[str, object]


@dataclass(frozen=True, slots=True)
class ClubGame:
    """One club's game at its instant, with every game-level term read."""

    season: int
    week: int
    game_id: str
    club: str
    opponent: str
    moment: datetime
    figures: Figures
    weather: Weather
    venue: Venue
    own: Tempo
    opponent_tempo: Tempo
    pressure: DefencePressure
    pass_rate_allowed: Allowance  # the opponent defence's, a shrunk difference (amendment 2 item 2)

    @property
    def defaults(self) -> frozenset[str]:
        found = set(self.figures.defaults | self.weather.defaults | self.venue.defaults)
        found |= self.own.defaults | self.pressure.defaults
        if NO_PACE in self.opponent_tempo.defaults:
            found.add(OPPONENT_NO_PACE)
        if self.pass_rate_allowed.default is not None:
            found.add(PASS_RATE_ALLOWED_WITHOUT_A_GAME)
        return frozenset(found)


def indicators(defaults: Iterable[str], names: Sequence[str]) -> Row:
    found = set(defaults)
    unknown = found - set(names)
    if unknown:
        raise ValueError(f"defaults with no indicator column: {sorted(unknown)}")
    return {default_column(name): int(name in found) for name in names}


def game_row(g: ClubGame) -> Row:
    """The key and game columns of a club-game, and its game-level indicators."""
    f, w, v = g.figures, g.weather, g.venue
    return {
        "season": g.season,
        "week": g.week,
        "game_id": g.game_id,
        "club": g.club,
        "opponent": g.opponent,
        "instant": g.moment.isoformat(),
        "home": v.home,
        "rest_days": v.rest_days,
        "division_game": v.division_game,
        "implied_points": f.implied_points,
        "opponent_implied_points": f.opponent_implied_points,
        "spread": f.spread,
        "figure_source": f.source,
        "roof": w.roof,
        "indoor": w.indoor,
        "temperature_f": w.temperature_f,
        "wind_mph": w.wind_mph,
        "precipitation": w.precipitation,
        "precipitation_probability": w.precipitation_probability,
        "surface": v.surface,
        "own_pace": g.own.pace,
        "own_pass_rate_over_expected": g.own.pass_rate_over_expected,
        "opponent_pace": g.opponent_tempo.pace,
        "opponent_pass_rate_over_expected": g.opponent_tempo.pass_rate_over_expected,
        "opponent_pass_rate_allowed": g.pass_rate_allowed.value,
        "opponent_sack_rate": g.pressure.sack_rate,
        "opponent_hit_rate": g.pressure.hit_rate,
        "opponent_pfr_pressure_rate": g.pressure.pfr_rate,
        **indicators(g.defaults, GAME_DEFAULTS),
    }


@dataclass(frozen=True, slots=True)
class PlayerInputs:
    """Everything one player's row reads at his game's instant."""

    player_id: str
    position: str
    status: WeekStatus | None  # None: no week-W filing
    games: tuple[GameShare, ...]
    prior: tuple[GameShare, ...]
    game_defaults: frozenset[str]  # round 3's line-week defaults (no snap row)
    tallies: Mapping[int, PlayerTally]  # his plays' tallies by week, this season before W
    charted: Sequence[PlayerWeekObservation]
    depth_rank: int | None
    depth_week: int
    depth_mapped: bool  # amendment 2 item 5: a dated chart's rank read on the slot scale
    recent_weeks: tuple[int, ...]
    vacated: Vacated
    returning: Returning
    round_three: Mapping[str, Allowance]  # round 3's kind -> the opponent's allowance
    role: Mapping[str, Allowance]


def _shares(p: PlayerInputs) -> Row:
    found: Row = {}
    for kind in SHARE_KINDS:
        found[f"share_season_{kind}"] = season_share(p.games, kind)
        found[f"share_last_three_{kind}"] = last_three_share(p.games, kind)
        for decay in DECAYS:
            found[f"share_{decay_label(decay)}_{kind}"] = decayed_share(p.games, kind, decay)
        found[f"share_prior_{kind}"] = season_share(p.prior, kind)
    return found


def _targets(p: PlayerInputs) -> Row:
    tallies = list(p.tallies.values())
    targets = sum(t.counts.targets for t in tallies)
    depth = [sum(t.depth[i] for t in tallies) for i in range(len(DEPTH_BUCKETS))]
    with_air = sum(t.air_yard_targets for t in tallies)

    def part(value: float) -> float:
        return value / targets if targets > 0 else math.nan

    return {
        **{f"target_depth_{b}": part(depth[i]) for i, b in enumerate(DEPTH_BUCKETS)},
        "target_outside": part(sum(t.outside for t in tallies)),
        "target_middle": part(sum(t.middle for t in tallies)),
        "air_yards_per_target": sum(t.counts.air_yards for t in tallies) / with_air if with_air > 0 else math.nan,
    }


def _allowances(p: PlayerInputs) -> tuple[Row, set[str]]:
    found: Row = {}
    defaults: set[str] = set()
    kinds = set(KINDS_BY_POSITION.get(p.position, ()))
    for kind in ROUND_THREE_ALLOWANCES:
        given = p.round_three.get(kind) if kind in kinds else None
        found[f"allowance_{kind}"] = NEUTRAL_ALLOWANCE if given is None else given.value
        if given is not None and given.default is not None:
            defaults.add(given.default)
    for name in ROLE_ALLOWANCES:
        given = p.role.get(name)
        found[f"allowance_{name}"] = NEUTRAL_ALLOWANCE if given is None else given.value
        if given is not None and given.default is not None:
            defaults.add(given.default)
    return found, defaults


def _player_defaults(p: PlayerInputs) -> set[str]:
    found = set(p.game_defaults)
    if not p.games:
        found.add(NO_GAME_THIS_SEASON)
    if not p.prior:
        found.add(NO_PRIOR_SEASON)
    if p.depth_rank is None:
        found.add(NO_DEPTH_ROW)
    if p.status is None:
        found.add(NO_FILING)
    for kind in ("targets", "carries"):
        if sum(g.own.of(kind) for g in p.games) <= 0:
            found.add(f"no_{kind}_yet")
    if p.vacated.left_out:
        found.add(TEAMMATE_NOT_IN_LAST_THREE)
    return found


def player_row(g: ClubGame, p: PlayerInputs) -> Row:
    """The club-game's columns and the player's, each of the 2.10 defaults he took marked."""
    charted, charted_missing = charted_features(p.charted, p.tallies)
    allowances, allowance_defaults = _allowances(p)
    snap_season, snap_last = snap_mean(p.games), snap_mean(p.games[-3:])
    recent = set(p.recent_weeks)
    defaults = _player_defaults(p) | set(charted_missing) | allowance_defaults
    return {
        **{k: v for k, v in game_row(g).items() if not k.startswith("default_")},
        "player_id": p.player_id,
        "position": p.position,
        "status": p.status or CLEAR,  # 2.10: no filing is clear for his own number, marked
        "questionable": int(p.status == QUESTIONABLE),
        "withheld": int(p.status == WITHHELD),
        "games_played": len(p.games),
        "played_in_last_three": int(any(x.week in recent and x.club == g.club for x in p.games)),
        **_shares(p),
        "snap_season": snap_season,
        "snap_last_three": snap_last,
        "snap_trend": snap_last - snap_season,
        "depth_rank": math.nan if p.depth_rank is None else float(p.depth_rank),
        "depth_chart_week": p.depth_week,
        "depth_rank_mapped": int(p.depth_mapped),
        **{f"vacated_{kind}": p.vacated.shares.of(kind) for kind in SHARE_KINDS},
        "vacating_teammates": p.vacated.counted,
        **{f"returning_{kind}": p.returning.shares.of(kind) for kind in SHARE_KINDS},
        "returning_teammates": p.returning.counted,
        # 2.2's counts, not defaults this row took (review L4): teammates away with no evidence of a
        # return, and away with no game before the absence.
        "teammates_absent_without_evidence": p.returning.without_evidence,
        "teammates_absent_without_a_pre_absence_share": p.returning.without_pre_absence,
        **_targets(p),
        **charted,
        **allowances,
        **indicators(g.defaults, GAME_DEFAULTS),
        **indicators(defaults, PLAYER_DEFAULTS),
    }
