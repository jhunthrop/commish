"""THE FITTED NUMBERS AS JSON: the results file's `priors` block and, if the round passes, the
`model/ros-priors` artifact's payload. One shape both ways, so what is published is what was judged.
"""

from collections.abc import Mapping
from types import MappingProxyType
from typing import Any, Final

from research.model.ros.model import OpportunityLine, RosPriors, Shrinkage

ARTIFACT_NAME: Final = "model/ros-priors"


def _triple(values: Any) -> tuple[float, float, float]:
    low, mid, high = (float(v) for v in values)
    return low, mid, high


def priors_payload(priors: RosPriors) -> dict[str, Any]:
    return {
        "opportunity": {
            key: [line.intercept, line.targets, line.carries, line.pass_attempts, line.snap_share]
            for key, line in priors.opportunity.items()
        },
        "shrinkage": {key: {"k": s.k, "alpha": s.alpha} for key, s in priors.shrinkage.items()},
        "availabilityK": dict(priors.availability_k),
        "returnNext": list(priors.return_next),
        "returnLater": list(priors.return_later),
        "offboardRate": dict(priors.offboard_rate),
        "offboardAvailability": dict(priors.offboard_availability),
        "interval": {key: list(values) for key, values in priors.interval.items()},
    }


def _floats(raw: Mapping[str, Any]) -> Mapping[str, float]:
    return MappingProxyType({key: float(value) for key, value in raw.items()})


def priors_from(payload: Mapping[str, Any]) -> RosPriors:
    """The payload read back; a missing key raises, so a short artifact fails loudly."""
    return RosPriors(
        opportunity=MappingProxyType(
            {key: OpportunityLine(*(float(v) for v in values)) for key, values in payload["opportunity"].items()}
        ),
        shrinkage=MappingProxyType(
            {key: Shrinkage(float(s["k"]), float(s["alpha"])) for key, s in payload["shrinkage"].items()}
        ),
        availability_k=_floats(payload["availabilityK"]),
        return_next=_triple(payload["returnNext"]),
        return_later=_triple(payload["returnLater"]),
        offboard_rate=_floats(payload["offboardRate"]),
        offboard_availability=_floats(payload["offboardAvailability"]),
        interval=MappingProxyType({key: _triple(values) for key, values in payload["interval"].items()}),
    )
