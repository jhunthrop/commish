"""THE SERVED FIT (preregistration section 4, the coordinator's ruling on H8), pinned by its digest.

After a pass, and before the first counted freeze, the judged procedure is refitted once: the
player-level models on 2021 to 2024, the play and team models on 2016 to 2024, forward-chained by
season as in 2.6 (the 2024 rows' component outputs from the play and team models fitted on 2016 to
2023), with the same fixed procedure and the same hyperparameters, decay and grid cells the judged fit
chose, and no selection of any kind. It reads 2024 outcomes and no 2025 or 2026 outcome. The models the
live weeks read are the ones fitted through 2024 (the "next season's" in the forward-chained table).

It is published as a `model_artifacts` version: the fitted objects serialised (scikit-learn's own
pickles, base64, with the library's version), beside the content digest of that serialisation, so a
loader refuses a payload whose bytes do not match the digest it pins. The judged artifacts are kept
beside it, unchanged, as the record of what passed.
"""

import base64
import hashlib
import pickle
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Final

import sklearn
from sqlalchemy import Connection

from research.errors import ResearchError
from research.model.artifacts import publish_artifact, read_artifact
from research.model.weekly4.board import RoundShared, SeasonModels
from research.model.weekly4.gates import ROUND_FOUR
from research.model.weekly4.simulate import Dispersion
from research.model.weekly4.system import Extras, Fitted, FixedCells, Store, fit_system
from research.model.weekly4.tuning import Cell

SERVED_ARTIFACT: Final = "weekly4/served"
# Section 4: "the player-level models on 2021 to 2024, the play and team models on 2016 to 2024". The
# models the live weeks read are 2.6's next season's, fitted on every season through 2024.
SERVED: Final = replace(
    ROUND_FOUR,
    player_fit_seasons=(2021, 2022, 2023, 2024),
    team_fit_seasons=tuple(range(2016, 2025)),
    judgment_season=2025,
    adp_seasons=(),
)
SERVES: Final = SERVED.judgment_season


class ServedDigestError(ResearchError):
    """A served payload whose serialisation does not match the digest it pins."""


def judged_cells(record: Mapping[str, Any], judged_season: int = ROUND_FOUR.judgment_season) -> FixedCells:
    """The cells the judged fit chose for its judged season's rows, from its record."""
    fitted = record["fitted"]
    key = str(judged_season)
    shares = "-".join(str(s) for s in ROUND_FOUR.player_fit_seasons)
    return FixedCells(
        {name: Cell(**cells[key]) for name, cells in fitted["play_model_cells"].items()},
        {name: Cell(**cells[key]) for name, cells in fitted["team_model_cells"].items()},
        Cell(**fitted["share_cells"][shares]),
    )


def served_fit(store: Store, extras: Extras, cells: FixedCells) -> Fitted:
    """The judged procedure refitted on 2021 to 2024 and 2016 to 2024 at the judged cells."""
    return fit_system(store, extras, SERVED, fixed=cells)


@dataclass(frozen=True, slots=True)
class Served:
    """What a live week reads: the models of the season after 2024, the fit constants, the dispersions."""

    models: SeasonModels
    shared: RoundShared
    dispersion: Dispersion


def served_of(fitted: Fitted) -> Served:
    return Served(fitted.models[SERVES], fitted.shared, fitted.dispersion)


def serialise(served: Served) -> tuple[str, str]:
    """The served objects as base64 text, and the SHA-256 of their bytes."""
    raw = pickle.dumps(served, protocol=pickle.HIGHEST_PROTOCOL)
    return base64.b64encode(raw).decode("ascii"), hashlib.sha256(raw).hexdigest()


def payload_of(served: Served, cells: FixedCells, judged_digest: str) -> dict[str, Any]:
    encoded, digest = serialise(served)
    return {
        "model": ROUND_FOUR.model_name,
        "serves": SERVES,
        "player_fit_seasons": list(SERVED.player_fit_seasons),
        "team_fit_seasons": list(SERVED.team_fit_seasons),
        "cells": {
            "play": {k: repr(c) for k, c in cells.play.items()},
            "team": {k: repr(c) for k, c in cells.team.items()},
            "shares": repr(cells.shares),
        },
        "judged_record_digest": judged_digest,
        "sklearn": sklearn.__version__,
        "digest": digest,
        "objects": encoded,
    }


def deserialise(payload: Mapping[str, Any]) -> Served:
    """The served objects, refused unless their bytes match the digest the payload pins and the library
    is the version they were fitted with."""
    raw = base64.b64decode(payload["objects"])
    if hashlib.sha256(raw).hexdigest() != payload["digest"]:
        raise ServedDigestError("the served payload's objects do not match its digest")
    if payload["sklearn"] != sklearn.__version__:
        raise ServedDigestError(
            f"the served models were fitted with scikit-learn {payload['sklearn']}, not {sklearn.__version__}"
        )
    found = pickle.loads(raw)
    if not isinstance(found, Served):
        raise ServedDigestError("the served payload holds no served models")
    return found


def publish_served(conn: Connection, payload: Mapping[str, Any], version: int, fit_stamp: datetime) -> str:
    """Publish the served version (immutable: a different payload under the same version is refused)."""
    publish_artifact(conn, SERVED_ARTIFACT, version, dict(payload), fit_stamp, "2016-2024")
    return str(payload["digest"])


def load_served(conn: Connection, version: int) -> tuple[Served, str]:
    """The pinned served version's models and its digest (the `model_version` every row carries)."""
    payload = read_artifact(conn, SERVED_ARTIFACT, version).payload
    return deserialise(payload), str(payload["digest"])
