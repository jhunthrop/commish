"""THE FITTED ARTIFACTS, PARSED INTO THE TYPES THE MODEL READS.

Each payload is the JSON the fit published (camelCase keys, as the TypeScript wrote them); each
parser refuses a payload missing a field the model reads rather than defaulting it.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

from sqlalchemy import Connection

from research.model.artifacts import read_pinned
from research.model.domain import Position
from research.model.laws.discovery import CandidateLaw, QuantileTable, generate_candidates_from
from research.model.laws.registry import Law, discovered_laws_from, registry_from
from research.model.preseason.adjustments import CareerPriors, DepthPriors
from research.model.preseason.availability import AvailabilityPriors
from research.model.preseason.candidates import PreseasonPriors
from research.model.preseason.rookies import RookieCurveKnot, RookieEvidenceKnot, RookiePriors, RookieShares
from research.model.weekly.efficiency import EfficiencyPriors
from research.model.weekly.opportunity import (
    LeagueTeamVolume,
    OpportunityPriors,
    OpportunityShrinkage,
    RolePrior,
    ShareShrinkage,
)
from research.model.weekly.scheme import SchemeLeagueMeans, SchemePriors, SchemeVolumeElasticity


def _frozen(value: Mapping[str, Any]) -> Mapping[str, Any]:
    return MappingProxyType(dict(value))


def _nested_floats(value: Mapping[str, Mapping[str, Any]]) -> Mapping[Any, Mapping[Any, float]]:
    return MappingProxyType(
        {
            key: MappingProxyType({inner: float(number) for inner, number in cells.items()})
            for key, cells in value.items()
        }
    )


def parse_opportunity(raw: Mapping[str, Any]) -> OpportunityPriors:
    shrink = raw["shrinkage"]
    volume = raw["leagueTeamVolume"]
    overrides = raw.get("shareShrinkageByPosition") or {}
    return OpportunityPriors(
        recency_decay=float(raw["recencyDecay"]),
        by_position=MappingProxyType(
            {
                position: RolePrior(
                    float(cell["snapShare"]),
                    float(cell["targetsPerSnap"]),
                    float(cell["carriesPerSnap"]),
                    float(cell["passAttemptsPerSnap"]),
                )
                for position, cell in raw["byPosition"].items()
            }
        ),
        shrinkage=OpportunityShrinkage(float(shrink["season"]), float(shrink["inSeason"]), float(shrink["teamVolume"])),
        league_team_volume=LeagueTeamVolume(
            float(volume["targets"]), float(volume["carries"]), float(volume["passAttempts"])
        ),
        share_shrinkage_by_position=MappingProxyType(
            {position: ShareShrinkage(cell.get("season"), cell.get("inSeason")) for position, cell in overrides.items()}
        ),
    )


def _snake_rates(cells: Mapping[str, Any]) -> Mapping[str, float]:
    from research.model.domain import camel_to_snake  # noqa: PLC0415 - kept beside the one rename

    return MappingProxyType({camel_to_snake(name): float(value) for name, value in cells.items()})


def parse_efficiency(raw: Mapping[str, Any]) -> EfficiencyPriors:
    multiplier = raw.get("experienceMultiplier")
    return EfficiencyPriors(
        by_position=MappingProxyType({position: _snake_rates(cells) for position, cells in raw["byPosition"].items()}),
        regression=_snake_rates(raw["regression"]),
        experience_multiplier=None
        if multiplier is None
        else MappingProxyType({k: float(v) for k, v in multiplier.items()}),
    )


def parse_scheme(raw: Mapping[str, Any]) -> SchemePriors:
    league = raw["league"]

    def elasticity(cell: Mapping[str, Any]) -> SchemeVolumeElasticity:
        return SchemeVolumeElasticity(float(cell["tempo"]), float(cell["passLean"]))

    return SchemePriors(
        SchemeLeagueMeans(
            float(league["paceSecondsPerPlay"]), float(league["passRate"]), float(league["passRateOverExpected"])
        ),
        elasticity(raw["targets"]),
        elasticity(raw["carries"]),
        elasticity(raw["passAttempts"]),
    )


def parse_availability(raw: Mapping[str, Any]) -> AvailabilityPriors:
    return AvailabilityPriors(
        baseline=_nested_floats(raw["baseline"]),
        availability_baseline=MappingProxyType({k: float(v) for k, v in raw["availabilityBaseline"].items()}),
        age_multiplier=_nested_floats(raw["ageMultiplier"]),
        status_multiplier=MappingProxyType({k: float(v) for k, v in raw["statusMultiplier"].items()}),
        prior_games=float(raw["priorGames"]),
        availability_prior_games=float(raw["availabilityPriorGames"]),
        recency_decay=float(raw["recencyDecay"]),
        history_seasons=int(raw["historySeasons"]),
        concentration=float(raw["concentration"]),
        concentration_per_season=float(raw["concentrationPerSeason"]),
        designation_multiplier=MappingProxyType(
            {k: float(v) for k, v in (raw.get("designationMultiplier") or {}).items()}
        ),
    )


def parse_rookies(raw: Mapping[str, Any]) -> RookiePriors:
    volume = raw["leagueTeamVolume"]
    return RookiePriors(
        by_bucket=MappingProxyType(
            {
                position: MappingProxyType(
                    {
                        bucket: RookieShares(
                            float(cell["snapShare"]),
                            float(cell["targetShare"]),
                            float(cell["carryShare"]),
                            float(cell["passAttemptShare"]),
                        )
                        for bucket, cell in buckets.items()
                    }
                )
                for position, buckets in raw["byBucket"].items()
            }
        ),
        league_team_volume=(float(volume["targets"]), float(volume["carries"]), float(volume["passAttempts"])),
        typical_incumbent_claim=MappingProxyType({k: float(v) for k, v in raw["typicalIncumbentClaim"].items()}),
        game_rate=_nested_floats(raw["gameRate"]),
        landing_bound=float(raw["landingBound"]),
    )


def parse_rookie_curve(raw: Mapping[str, Any]) -> Mapping[Position, tuple[RookieCurveKnot, ...]]:
    return MappingProxyType(
        {
            position: tuple(RookieCurveKnot(float(knot["pick"]), float(knot["points"])) for knot in knots)
            for position, knots in raw.items()
        }
    )


@dataclass(frozen=True, slots=True)
class RookieHistory:
    games_rate: Mapping[Position, Mapping[str, float]]
    curve_evidence: Mapping[Position, tuple[RookieEvidenceKnot, ...]]


def parse_rookie_history(raw: Mapping[str, Any]) -> RookieHistory:
    return RookieHistory(
        _nested_floats(raw["gamesRate"]["byBucket"]),
        MappingProxyType(
            {
                position: tuple(RookieEvidenceKnot(float(k["pick"]), int(k["n"])) for k in knots)
                for position, knots in raw["curveEvidence"]["byPosition"].items()
            }
        ),
    )


def parse_game_variance(skill: Mapping[str, Any], kdef: Mapping[str, Any]) -> Mapping[str, Mapping[str, float]]:
    """`composeGameVariance`: the two halves, neither allowed to overwrite the other."""
    out: dict[str, Mapping[str, float]] = {}
    for player_class in ("rookie", "veteran"):
        overlap = set(skill[player_class]) & set(kdef[player_class])
        if overlap:
            raise ValueError(f"game variance: {player_class}.{sorted(overlap)} is measured by both halves")
        out[player_class] = MappingProxyType(
            {
                **{k: float(v) for k, v in skill[player_class].items()},
                **{k: float(v) for k, v in kdef[player_class].items()},
            }
        )
    return MappingProxyType(out)


def parse_quantiles(raw: Mapping[str, Any]) -> QuantileTable:
    return MappingProxyType(
        {
            quantity: MappingProxyType(
                {
                    position: MappingProxyType({float(level): float(v) for level, v in levels.items()})
                    for position, levels in by_position.items()
                }
            )
            for quantity, by_position in raw.items()
        }
    )


@dataclass(frozen=True, slots=True)
class ModelArtifacts:
    """Everything the board reads that a fit produced."""

    preseason: PreseasonPriors
    rookie_history: RookieHistory
    game_variance: Mapping[str, Mapping[str, float]]
    laws: tuple[Law, ...]
    candidates: Mapping[str, CandidateLaw]
    raw: Mapping[str, Any]


def model_artifacts_from(payloads: Mapping[str, Any]) -> ModelArtifacts:
    """Parses the pinned payloads into the model's types."""
    weekly = payloads["model/weekly-priors"]
    preseason = payloads["preseason/priors"]
    candidates = generate_candidates_from(parse_quantiles(payloads["laws/discovery-quantiles"]))
    by_id = MappingProxyType({candidate.id: candidate for candidate in candidates})
    laws = (*registry_from(payloads["laws/measured"]), *discovered_laws_from(payloads["laws/discovered"], set(by_id)))
    priors = PreseasonPriors(
        opportunity=parse_opportunity(weekly["opportunity"]),
        efficiency=parse_efficiency(weekly["efficiency"]),
        scheme=parse_scheme(weekly["context"]["scheme"]),
        absorption_rate=float(weekly["context"]["redistribution"]["absorptionRate"]),
        availability=parse_availability(preseason["availability"]),
        rookies=parse_rookies(preseason["rookies"]),
        rookie_curve=parse_rookie_curve(payloads["preseason/rookie-curve"]),
        depth=DepthPriors(_nested_floats(preseason["depth"]["bySnapShare"]), float(preseason["depth"]["bound"])),
        career=CareerPriors(_nested_floats(preseason["career"]["byExperience"]), float(preseason["career"]["bound"])),
    )
    return ModelArtifacts(
        preseason=priors,
        rookie_history=parse_rookie_history(payloads["preseason/rookie-history"]),
        game_variance=parse_game_variance(
            payloads["preseason/game-variance-skill"], payloads["preseason/game-variance-kdef"]
        ),
        laws=laws,
        candidates=by_id,
        raw=MappingProxyType(dict(payloads)),
    )


def load_model_artifacts(conn: Connection) -> ModelArtifacts:
    """The pinned artifacts, read from the store and parsed."""
    return model_artifacts_from(read_pinned(conn))
