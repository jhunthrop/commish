"""THE ROUND'S PRECONDITIONS (preregistration 6.3), each checked before the claim and recorded; a missing
or unequal one refuses the run and is named.

- R4 6.3's preconditions, every one, counted as round 4 counted them (`weekly4.preconditions`), on the
  seasons through the run's judged one (the judgment's counts are 2024's "present by count" check);
- the feature files built with `--depth-chart week`, their digests equal to round 4's development-check
  record (`features.digests`) for every file that record names; the files it does not name (2024's) are
  recorded;
- round 4's components reproduced exactly: the play model's and the team model's cells for every season
  round 4's check recorded, and in the development check the share models' cells and fold losses
  (reading: the judgment's share refits read the rate m of round 3's judgment fit, as round 4's judgment
  would have, so their equality is the check's precondition; the judgment requires the check's record to
  show it held). The team model fitted for the first player fit season's rows has no earlier record and is
  recorded (N7).

Round 3's reproduction of its 26 lines is the runner's (`weekly4.round_three.reproduction`).
"""

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any, Final

from sqlalchemy import Connection

from research.model.weekly2.judge import DOCS
from research.model.weekly4 import gates as round_four
from research.model.weekly4.preconditions import depth_chart_verdict, missing_preconditions, payload, read_counts
from research.model.weekly4.share_model import ShareFit
from research.model.weekly5.gates import RoundFive
from research.model.weekly5.system import Components

ROUND_FOUR_RECORD: Final = DOCS / "2026-10-16-weekly-projection-round4-development-check.json"
STORE_KINDS: Final = ("players", "teams", "plays")
DEPTH_RULE: Final = "week"  # 6.3: "the feature files rebuilt with `--depth-chart week`"


def round_four_constant(t: RoundFive) -> round_four.RoundFour:
    """Round 4's constant on the run's seasons, for round 4's counts."""
    return replace(
        round_four.ROUND_FOUR,
        player_fit_seasons=t.player_fit_seasons,
        team_fit_seasons=t.team_fit_seasons,
        judgment_season=t.judgment_season,
        adp_seasons=t.adp_seasons,
        round_three=t.round_three,
    )


def counted(conn: Connection, t: RoundFive) -> tuple[list[str], dict[str, Any]]:
    """R4 6.3's preconditions on the run's seasons: what is missing, and the record's payload."""
    r4 = round_four_constant(t)
    counts = read_counts(conn, r4)
    verdict = depth_chart_verdict()
    return missing_preconditions(counts, r4, verdict, DEPTH_RULE), payload(counts, r4, verdict, DEPTH_RULE)


def recorded(path: Path = ROUND_FOUR_RECORD) -> dict[str, Any]:
    found: dict[str, Any] = json.loads(path.read_text())
    return found


def file_season(name: str) -> int:
    """The season of a store file (`history-<season>-<kind>.parquet`)."""
    return int(name.split("-")[1])


def file_digests(directory: Path, seasons: Sequence[int]) -> dict[str, str]:
    """Each store file of `seasons` hashed, bytes only (no row is read for the model)."""
    found: dict[str, str] = {}
    for season in seasons:
        for kind in STORE_KINDS:
            path = directory / f"history-{season}-{kind}.parquet"
            if path.exists():
                found[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return found


def digest_mismatches(digests: Mapping[str, str], record: Mapping[str, Any], seasons: Sequence[int]) -> list[str]:
    """Every file round 4's record names for a season the run opens that this store holds with another digest, or
    that the run did not hash (6.3: "A missing or unequal one refuses the run and is named")."""
    named = record["features"]["digests"]
    opened = set(seasons)
    return sorted(
        f"{name}: {digests.get(name, 'not checked')} against {digest}"
        for name, digest in named.items()
        if file_season(name) in opened and digests.get(name) != digest
    )


def _cells(found: Mapping[str, Mapping[int, object]]) -> dict[str, dict[str, dict[str, Any]]]:
    return {k: {str(s): asdict(c) for s, c in v.items()} for k, v in found.items()}  # type: ignore[call-overload]


def component_mismatches(components: Components, record: Mapping[str, Any]) -> list[str]:
    """The play and team cells round 4's check recorded that this fit does not equal."""
    fitted = record["fitted"]
    found: list[str] = []
    for name, mine in (
        ("play_model_cells", _cells(components.play.cells)),
        ("team_model_cells", _cells(components.team.cells)),
    ):
        for model, by_season in fitted[name].items():
            for season, cell in by_season.items():
                if mine.get(model, {}).get(season) != cell:
                    found.append(f"{name} {model} {season}: {mine.get(model, {}).get(season)} against {cell}")
    return found


def share_mismatches(shares: ShareFit, record: Mapping[str, Any]) -> list[str]:
    """The share cells and fold losses round 4's check recorded that this fit does not equal."""
    fitted = record["fitted"]
    cells = {"-".join(map(str, k)): asdict(m.cell) for k, m in shares.models.items()}
    losses = {"-".join(map(str, k)): dict(v) for k, v in shares.losses.items()}
    found = [
        f"share_cells {k}: {cells.get(k)} against {v}" for k, v in fitted["share_cells"].items() if cells.get(k) != v
    ]
    found += [
        f"share_fold_losses {k}: {len(losses.get(k, {}))} cells differ"
        for k, v in fitted["share_fold_losses"].items()
        if losses.get(k) != v
    ]
    return found


def first_team_cells(components: Components, t: RoundFive) -> dict[str, Any]:
    """N7: the team model fitted for the first player fit season's rows, recorded (no earlier record)."""
    first = str(t.player_fit_seasons[0])
    return {k: v[first] for k, v in _cells(components.team.cells).items() if first in v}
