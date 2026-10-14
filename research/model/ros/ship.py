"""THE SHIPPED MODEL'S ARTIFACT: round 3's model, fit on its own seasons, published once.

Founder ruling 2026-10-14: "ship". What ships is round 3 (`commish_ros_v3`, fit on 2021-2023, judged
once on 2024 weeks 8 and 12) exactly as judged: the fit runs on the named store with round 3's
configuration and is published only when every fitted number equals the judged record's
(`docs/research/2026-10-14-rest-of-season-round3-results.json`, `priors`). A store whose inputs give
any other number is refused, so the artifact the nightly reads is always the judged model, never a
refit. The nightly itself never fits (`live.load_ros_priors`).
"""

import json
from collections.abc import Mapping
from datetime import datetime
from pathlib import Path
from typing import Any, Final

from sqlalchemy import text

from research.errors import ConfigurationError
from research.model.arithmetic import ARM64_BOARDS, model_version
from research.model.artifacts import publish_artifact, stable_json
from research.model.priors import load_model_artifacts
from research.model.ros import gates
from research.model.ros.judge import fit_round
from research.model.ros.live import ARTIFACT_VERSION
from research.model.ros.payload import ARTIFACT_NAME, priors_payload
from research.model.ros.scratch import target_engine

SHIPPED_ROUND: Final = 3
SHIPPED: Final = gates.ROUND_THREE


def first_difference(fitted: Mapping[str, Any], judged: Mapping[str, Any]) -> str | None:
    """The first key whose fitted value differs from the judged one, or None when every one is equal."""
    for key in sorted({*fitted, *judged}):
        if stable_json(fitted.get(key)) != stable_json(judged.get(key)):
            return key
    return None


def fitted_on(record: Path) -> str:
    return (
        f"{SHIPPED.model_name} at {model_version()}: round 3 of the rest-of-season board "
        f"(docs/research/2026-10-14-rest-of-season-round3-preregistration.md), fit on "
        f"{'-'.join(str(s) for s in (SHIPPED.fit_seasons[0], SHIPPED.fit_seasons[-1]))}, judged once on "
        f"{SHIPPED.judgment_season} weeks 8 and 12 (the record: {record.name}); shipped by the "
        "founder's ruling of 2026-10-14; equal, number for number, to the judged record's priors"
    )


def fit_and_publish(url: str, record: Path, now: datetime) -> list[str]:
    """Fit round 3 on `url`, check it against the judged record, and publish it there."""
    judged = json.loads(record.read_text())["priors"]
    engine = target_engine(url)
    try:
        with engine.connect() as conn:
            conn.execute(text("set transaction read only"))
            fitted = fit_round(conn, SHIPPED, load_model_artifacts(conn), ARM64_BOARDS)
        payload = priors_payload(fitted.priors)
        differs = first_difference(payload, judged)
        if differs is not None:
            raise ConfigurationError(
                f"the fit on this store differs from the judged record at {differs!r}; nothing published"
            )
        with engine.begin() as conn:
            outcome = publish_artifact(conn, ARTIFACT_NAME, ARTIFACT_VERSION, payload, now, fitted_on(record))
    finally:
        engine.dispose()
    return [
        f"fit: {fitted.rows} population rows, outcomes read for {sorted(set(fitted.served))}",
        f"{ARTIFACT_NAME} v{ARTIFACT_VERSION}: equal to {record.name}, {outcome}",
    ]
