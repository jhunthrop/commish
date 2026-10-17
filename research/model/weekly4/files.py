"""THE STORE'S FILES, READ BY THE FIT: Lane 68's Parquet rows, each file's SHA-256 recorded beside the
digest its build reported, so the run's record says exactly which rows it read.

The round reads the files once, offline, on a scratch copy (the store's own reason for files); no
served number reads a file (the served path builds its live rows in process, `features.season`).
Only the seasons a run may read are opened: the team and play files of 2016 through the judged season,
the player files of the player fit seasons and the judged season.
"""

import hashlib
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pandas as pd

from research.errors import ConfigurationError
from research.model.weekly4.system import Store


def _read(path: Path, digests: dict[str, str]) -> pd.DataFrame:
    if not path.exists():
        raise ConfigurationError(f"the feature store has no {path.name} in {path.parent}")
    digests[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return pd.read_parquet(path)


def build_report(directory: Path) -> dict[str, Any]:
    path = directory / "report-history.json"
    if not path.exists():
        raise ConfigurationError(f"the feature store's build report {path} is missing")
    found: dict[str, Any] = json.loads(path.read_text())
    return found


def reported_digests(report: dict[str, Any]) -> dict[str, str]:
    return {name: digest for season in report["seasons"] for name, digest in season["digests"].items()}


def load_store(directory: Path, team_seasons: Sequence[int], player_seasons: Sequence[int]) -> Store:
    """The files of the named seasons, each refused unless its digest equals the build's report."""
    digests: dict[str, str] = {}
    teams = pd.concat(
        [_read(directory / f"history-{s}-teams.parquet", digests) for s in team_seasons], ignore_index=True
    )
    plays = pd.concat(
        [_read(directory / f"history-{s}-plays.parquet", digests) for s in team_seasons], ignore_index=True
    )
    players = pd.concat(
        [_read(directory / f"history-{s}-players.parquet", digests) for s in player_seasons], ignore_index=True
    )
    reported = reported_digests(build_report(directory))
    moved = sorted(name for name, digest in digests.items() if reported.get(name) != digest)
    if moved:
        raise ConfigurationError(f"the feature files differ from their build's report: {moved}")
    return Store(players, teams, plays, digests)
