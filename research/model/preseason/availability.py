"""EXPECTED GAMES PLAYED: a beta-binomial over the season, its rate shrunk from role and history.

Ported from `research-ts/src/projections/preseason/{availability,availability-status}.ts`. The
log-gamma is Lanczos as the TypeScript writes it, on V8's own `log`, `exp` and `sin` (`fdlibm`),
so the distribution matches to the last bit.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Final, Literal

from research.model.domain import Position
from research.model.jsmath import exp, js_max, js_min, js_pow, log, sin

RoleBracket = Literal["bench", "rotation", "committee", "featured"]
AgeBracket = Literal["under25", "25to27", "28to30", "over30"]
AvailabilityDesignation = Literal[
    "out", "injured_reserve", "injured_reserve_return", "pup", "nfi", "suspended", "exempt"
]
RosterStatus = str

_FIRST_SEVENTEEN_GAME_SEASON: Final = 2021
_YEAR_MS: Final = 365.2425 * 24 * 60 * 60 * 1000
_OLDEST_AGE: Final = 60
_SEPTEMBER: Final = 9
_QUANTILES: Final = (0.1, 0.5, 0.9)


def team_games_in(season: int) -> int:
    """`teamGamesIn`."""
    return 17 if season >= _FIRST_SEVENTEEN_GAME_SEASON else 16


def age_bracket_for(age: float | None) -> AgeBracket:
    """`ageBracketFor`."""
    if age is None:
        return "25to27"
    if age < 25:  # noqa: PLR2004 - the bracket's own bound
        return "under25"
    if age < 28:  # noqa: PLR2004 - the bracket's own bound
        return "25to27"
    if age <= 30:  # noqa: PLR2004 - the bracket's own bound
        return "28to30"
    return "over30"


def role_bracket_for(projected_snap_share: float) -> RoleBracket:
    """`roleBracketFor`."""
    if projected_snap_share < 0.15:  # noqa: PLR2004 - the bracket's own bound
        return "bench"
    if projected_snap_share < 0.35:  # noqa: PLR2004 - the bracket's own bound
        return "rotation"
    if projected_snap_share < 0.6:  # noqa: PLR2004 - the bracket's own bound
        return "committee"
    return "featured"


def _utc_ms(year: int, month: int, day: int) -> int:
    """`Date.UTC(year, month - 1, day)`."""
    return int((datetime(year, month, day, tzinfo=UTC) - datetime(1970, 1, 1, tzinfo=UTC)).total_seconds()) * 1000


def age_at_season(birth_date: str | None, season: int) -> float | None:
    """`ageAtSeason`: years from birth to 1 September of the season."""
    if birth_date is None:
        return None
    parts = birth_date.strip().split("-")
    if len(parts) != 3 or [len(part) for part in parts] != [4, 2, 2] or not all(part.isdigit() for part in parts):  # noqa: PLR2004 - YYYY-MM-DD
        return None
    try:
        born = _utc_ms(int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError:
        return None
    years = (_utc_ms(season, _SEPTEMBER, 1) - born) / _YEAR_MS
    return years if math.isfinite(years) and 0 < years < _OLDEST_AGE else None


@dataclass(frozen=True, slots=True)
class SeasonAvailability:
    season: int
    games_played: int
    team_games: int
    games_unavailable: int | None
    games_suspended: int | None


@dataclass(frozen=True, slots=True)
class SeasonEvidence:
    played: float
    available: float
    games: float


def _clamp_count(value: float, ceiling: float) -> float:
    return js_min(js_max(0.0, value), ceiling)


def availability_evidence(entry: SeasonAvailability) -> SeasonEvidence | None:
    """`availabilityEvidence`."""
    if entry.games_unavailable is None or entry.games_suspended is None or entry.team_games <= 0:
        return None
    games = entry.team_games - _clamp_count(entry.games_suspended, entry.team_games)
    available = games - _clamp_count(entry.games_unavailable, games)
    return SeasonEvidence(_clamp_count(entry.games_played, available), available, games)


@dataclass(frozen=True, slots=True)
class AvailabilityInput:
    position: Position
    age: float | None
    status: RosterStatus
    designation: AvailabilityDesignation | None
    projected_snap_share: float
    history: tuple[SeasonAvailability, ...]
    baseline_rate: float | None


@dataclass(frozen=True, slots=True)
class AvailabilityPriors:
    baseline: Mapping[Position, Mapping[RoleBracket, float]]
    availability_baseline: Mapping[Position, float]
    age_multiplier: Mapping[Position, Mapping[AgeBracket, float]]
    status_multiplier: Mapping[str, float]
    prior_games: float
    availability_prior_games: float
    recency_decay: float
    history_seasons: int
    concentration: float
    concentration_per_season: float
    designation_multiplier: Mapping[str, float] = field(default_factory=lambda: MappingProxyType({}))


@dataclass(frozen=True, slots=True)
class ProjectionDistribution:
    floor: float
    median: float
    ceiling: float


@dataclass(frozen=True, slots=True)
class GamesPlayedOutlook:
    expected: float
    rate: float
    distribution: ProjectionDistribution
    probabilities: tuple[float, ...]


_LANCZOS: Final = (
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
)
_HALF: Final = 0.5


def log_gamma(x: float) -> float:
    """Lanczos, as `availability.ts` writes it, with V8's `log` and `sin`."""
    if x < _HALF:
        return log(math.pi / sin(math.pi * x)) - log_gamma(1 - x)
    z = x - 1
    series = 0.99999999999980993
    for index, coefficient in enumerate(_LANCZOS):
        series += coefficient / (z + index + 1)
    t = z + len(_LANCZOS) - 0.5
    return 0.5 * log(2 * math.pi) + (z + 0.5) * log(t) - t + log(series)


def _log_beta(a: float, b: float) -> float:
    return log_gamma(a) + log_gamma(b) - log_gamma(a + b)


def games_played_probabilities(team_games: int, rate: float, concentration: float) -> tuple[float, ...]:
    """`gamesPlayedProbabilities`: P(games = k), k = 0..teamGames."""
    if team_games < 1:
        raise ValueError(f"A season has a whole number of games; got {team_games}.")
    if not (0 <= rate <= 1):
        raise ValueError(f"An availability rate is a share of a season; got {rate}.")
    if not (concentration > 0) or concentration == math.inf:
        raise ValueError(f"A beta-binomial needs a positive concentration; got {concentration}.")
    if rate == 0:
        return tuple(1.0 if k == 0 else 0.0 for k in range(team_games + 1))
    if rate == 1:
        return tuple(1.0 if k == team_games else 0.0 for k in range(team_games + 1))
    alpha = rate * concentration
    beta = (1 - rate) * concentration
    denominator = _log_beta(alpha, beta)
    raw = []
    for k in range(team_games + 1):
        choose = log_gamma(team_games + 1) - log_gamma(k + 1) - log_gamma(team_games - k + 1)
        raw.append(exp(choose + _log_beta(k + alpha, team_games - k + beta) - denominator))
    total = 0.0
    for value in raw:
        total += value
    return tuple(value / total for value in raw)


def _quantile_of(probabilities: Sequence[float], quantile: float) -> float:
    cumulative = 0.0
    for games, probability in enumerate(probabilities):
        cumulative += probability
        if cumulative >= quantile:
            return float(games)
    return float(len(probabilities) - 1)


def outlook_from_rate(team_games: int, rate: float, concentration: float) -> GamesPlayedOutlook:
    """`outlookFromRate`."""
    probabilities = games_played_probabilities(team_games, rate, concentration)
    expected = 0.0
    for games, probability in enumerate(probabilities):
        expected += probability * games
    floor, median, ceiling = (_quantile_of(probabilities, quantile) for quantile in _QUANTILES)
    return GamesPlayedOutlook(expected, rate, ProjectionDistribution(floor, median, ceiling), probabilities)


def seventeen_games_for_everyone(season: int) -> GamesPlayedOutlook:
    """`seventeenGamesForEveryone`."""
    team_games = team_games_in(season)
    probabilities = tuple(1.0 if k == team_games else 0.0 for k in range(team_games + 1))
    games = float(team_games)
    return GamesPlayedOutlook(games, 1.0, ProjectionDistribution(games, games, games), probabilities)


def _recent_history(history: Sequence[SeasonAvailability], seasons: int) -> list[SeasonAvailability]:
    return sorted(history, key=lambda entry: -entry.season)[:seasons]


def _clamp_share(value: float) -> float:
    return js_min(1.0, js_max(0.0, value))


def _shrunk_term(
    rookie_input: AvailabilityInput,
    priors: AvailabilityPriors,
    prior: float,
    prior_games: float,
    numerator_of: str,
    denominator_of: str,
) -> float:
    denominator = 0.0
    numerator = 0.0
    for index, entry in enumerate(_recent_history(rookie_input.history, priors.history_seasons)):
        evidence = availability_evidence(entry)
        if evidence is None:
            continue
        weight = js_pow(priors.recency_decay, index)
        denominator += weight * getattr(evidence, denominator_of)
        numerator += weight * getattr(evidence, numerator_of)
    return (prior_games * prior + numerator) / (prior_games + denominator) if denominator > 0 else prior


def _role_prior(player: AvailabilityInput, priors: AvailabilityPriors) -> float:
    return _clamp_share(priors.baseline[player.position][role_bracket_for(player.projected_snap_share)])


def shrunk_availability_rate(player: AvailabilityInput, priors: AvailabilityPriors) -> float:
    """`shrunkAvailabilityRate`: role times availability, or the rookie's baseline moved by both."""
    role_prior = _role_prior(player, priors)
    availability_prior = _clamp_share(priors.availability_baseline[player.position])
    role = _shrunk_term(player, priors, role_prior, priors.prior_games, "played", "available")
    availability = _shrunk_term(
        player, priors, availability_prior, priors.availability_prior_games, "available", "games"
    )
    if player.baseline_rate is None:
        return _clamp_share(role * availability)
    role_ratio = role / role_prior if role_prior > 0 else 1.0
    availability_ratio = availability / availability_prior if availability_prior > 0 else 1.0
    return _clamp_share(_clamp_share(player.baseline_rate) * role_ratio * availability_ratio)


def status_multiplier_for(status: str, designation: str | None, priors: AvailabilityPriors) -> float:
    """`statusMultiplierFor`: the designation's cell when there is one, else the status's."""
    cell = None if designation is None else priors.designation_multiplier.get(designation)
    return priors.status_multiplier[status] if cell is None else cell


def expected_games_played(player: AvailabilityInput, season: int, priors: AvailabilityPriors) -> GamesPlayedOutlook:
    """`expectedGamesPlayed`."""
    shrunk = shrunk_availability_rate(player, priors)
    multiplied = (
        shrunk
        * priors.age_multiplier[player.position][age_bracket_for(player.age)]
        * status_multiplier_for(player.status, player.designation, priors)
    )
    rate = js_min(1.0, js_max(0.0, multiplied))
    seasons = len(_recent_history(player.history, priors.history_seasons))
    return outlook_from_rate(
        team_games_in(season), rate, priors.concentration + priors.concentration_per_season * seasons
    )


# --- the resolved status the availability model reads (`availability-status.ts`) ----------------

_CUTDOWN_STATUS_OF: Final[Mapping[str, RosterStatus]] = MappingProxyType(
    {
        "active": "active",
        "injured_reserve": "reserve",
        "pup": "reserve",
        "nfi": "reserve",
        "suspended": "reserve",
        "exempt": "reserve",
        "practice_squad": "practice_squad",
        "off_active_roster": "off_roster",
        "no_roster": "off_roster",
        "retired": "off_roster",
    }
)
_DESIGNATION_OF_KIND: Final[Mapping[str, AvailabilityDesignation]] = MappingProxyType(
    {"injured_reserve": "injured_reserve", "pup": "pup", "nfi": "nfi", "suspended": "suspended", "exempt": "exempt"}
)


def cutdown_status_of(kind: str) -> RosterStatus:
    """`cutdownStatusOf`."""
    return _CUTDOWN_STATUS_OF[kind]


def availability_status_for(resolved_kind: str | None, file_status: RosterStatus) -> RosterStatus:
    """`availabilityStatusFor`: the resolved kind's cut-down status, or the file's."""
    return file_status if resolved_kind is None else cutdown_status_of(resolved_kind)


def availability_designation_of(resolved_kind: str | None, detail: str | None) -> AvailabilityDesignation | None:
    """`availabilityDesignationOf`."""
    if resolved_kind is None:
        return None
    if resolved_kind == "active":
        return "out" if detail == "out" else None
    if resolved_kind == "injured_reserve" and detail == "designated_to_return":
        return "injured_reserve_return"
    return _DESIGNATION_OF_KIND.get(resolved_kind)
