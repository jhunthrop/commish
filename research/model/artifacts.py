"""THE MODEL'S FITTED ARTIFACTS: versioned rows in `research.model_artifacts`, never files.

Ported from `research-ts/src/projections/model/artifacts.ts` (publish and read, a version is
immutable) and extended to every fit the TypeScript still read from committed constants. The
catalog pins one version of each; the board reads exactly the pinned versions.
"""

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Any, Final, Literal

from sqlalchemy import Connection, text

from research.errors import ResearchError
from research.model.instants import ms_instant


class MissingArtifactError(ResearchError):
    """The store holds no row for a pinned artifact version."""


class ArtifactVersionConflictError(ResearchError):
    """A version is already published with a different payload: versions are immutable."""


# The pinned version of every artifact the model reads.
CATALOG: Final[Mapping[str, int]] = MappingProxyType(
    {
        "model/weekly-priors": 1,
        "preseason/priors": 1,
        "preseason/rookie-curve": 1,
        "preseason/rookie-history": 1,
        "preseason/kdef-priors": 1,
        "preseason/game-variance-skill": 1,
        "preseason/game-variance-kdef": 1,
        "market/blend-constants": 1,
        "market/props-anchor-weight": 1,
        "market/curve-ppr": 1,
        "market/curve-half": 1,
        "market/curve-std": 1,
        "laws/measured": 1,
        "laws/discovered": 1,
        "laws/discovery-quantiles": 1,
    }
)


def stable_json(value: Any) -> str:
    """`stableJson`: keys sorted at every level, the form two payloads are compared in."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def payload_digest(value: Any) -> str:
    return hashlib.sha256(stable_json(value).encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class PublishedArtifact:
    name: str
    version: int
    payload: Any
    fit_stamp: datetime
    fitted_on: str
    published_at: datetime


def read_artifact(conn: Connection, name: str, version: int | None = None) -> PublishedArtifact:
    """`readModelArtifact` at the catalog's pinned version unless one is named."""
    pinned = CATALOG.get(name) if version is None else version
    if pinned is None:
        raise MissingArtifactError(f"{name} is not in the artifact catalog")
    row = conn.execute(
        text(
            "select name, version, payload, fit_stamp, fitted_on, published_at from research.model_artifacts where name = :n and version = :v"
        ),
        {"n": name, "v": pinned},
    ).first()
    if row is None:
        raise MissingArtifactError(
            f"model_artifacts holds no {name} v{pinned}, which this code pins. Run `python -m research.model.seed`."
        )
    return PublishedArtifact(
        row.name, row.version, row.payload, ms_instant(row.fit_stamp), row.fitted_on, ms_instant(row.published_at)
    )


PublishOutcome = Literal["inserted", "unchanged"]


def publish_artifact(  # noqa: PLR0913, PLR0917 - the oracle's own parameters, in its order, for a line-by-line read
    conn: Connection, name: str, version: int, payload: Any, fit_stamp: datetime, fitted_on: str
) -> PublishOutcome:
    """`publishModelArtifact`: inserts a new version, accepts an identical re-publish, refuses a change."""
    existing = conn.execute(
        text("select payload from research.model_artifacts where name = :n and version = :v"), {"n": name, "v": version}
    ).first()
    if existing is not None:
        if stable_json(existing.payload) == stable_json(payload):
            return "unchanged"
        raise ArtifactVersionConflictError(
            f"{name} v{version} is already published with a different payload; publish the next version."
        )
    conn.execute(
        text(
            "insert into research.model_artifacts (name, version, fit_stamp, fitted_on, payload) "
            "values (:n, :v, :stamp, :on, cast(:payload as jsonb))"
        ),
        {"n": name, "v": version, "stamp": fit_stamp, "on": fitted_on, "payload": json.dumps(payload)},
    )
    return "inserted"


def read_pinned(conn: Connection) -> dict[str, Any]:
    """Every catalog artifact's payload, by name."""
    return {name: read_artifact(conn, name).payload for name in CATALOG}
