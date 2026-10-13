"""WHERE EACH SEEDED FIT CAME FROM: the record the artifact store keeps once the oracle's tree is gone.

Version 1 of each artifact `research.model.seed` publishes is a constant the TypeScript oracle
committed, carried number for number. Its row says, in `fitted_on`, which oracle module and export
it is, the commit that last changed it, the seasons it was fitted on and held out from, the inputs
the store has since lost, and how it would be fitted again; its `fit_stamp` is that commit's time.

The commit is found with `git log --follow`, skipping pure renames: the move of the oracle into
`research-ts/` (aa7adb09, and 519851ac before it) changed no number, so a stamp from it would date a
fit to the day its file moved. A commit is named with its subject, because the last change to a
constant can be a refactor rather than a fit (`kdef-fitted.ts` at 3d4afb70 is one), and the reader
should see which.
"""

import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from types import MappingProxyType
from typing import Final

_REPO: Final = Path(__file__).resolve().parents[2]
_ORACLE_ROOT: Final = "research-ts/src/projections"
_PURE_RENAME: Final = "R100"
# What the dev store no longer holds (the store keeps only the seasons the product reads), and so
# why none of these fits can be re-run on it as it stands.
LOST_INPUTS: Final = (
    "the store no longer holds preseason_rosters for 2021-2024, player_week_observations for 2018-2022, "
    "player_week_teams for 2018-2023, or team_week_observations (schedule, kickoffs, play-by-play, coaches) before 2024"
)
REFIT_PATH: Final = (
    "rebuild that history with phase A's ingests (`python -m research.pipeline season|context|preseason --first <first> "
    "--last <last>`, phase D), port the fit, and publish its result as the next version"
)


@dataclass(frozen=True, slots=True)
class FitSource:
    """One seeded fit: the oracle module and export it is, its seasons, and the oracle's fit command."""

    module: str
    export: str
    fitted_on: str
    held_out: str
    command: str

    @property
    def file(self) -> str:
        return f"{_ORACLE_ROOT}/{self.module}"


FIT_SOURCES: Final = MappingProxyType(
    {
        "model/weekly-priors": FitSource(
            "model/fitted.ts",
            "FITTED_MODEL, FIT_SEASONS, HELD_OUT_SEASONS",
            "2021 and 2022 (2020 as history)",
            "2023 and 2024",
            "npm run projections:fit",
        ),
        "preseason/priors": FitSource(
            "preseason/fitted.ts",
            "FITTED_AVAILABILITY_PRIORS, FITTED_ROOKIE_PRIORS, FITTED_DEPTH_PRIORS, FITTED_CAREER_PRIORS",
            "2021 and 2022, except the rookie games rate (2023 and 2024)",
            "2023 and 2024 (the rookie games rate: 2025 and 2026)",
            "npm run projections:preseason:fit",
        ),
        "preseason/rookie-curve": FitSource(
            "preseason/rookie-curve-fitted.ts",
            "FITTED_ROOKIE_CURVE",
            "rookie classes 2003-2021",
            "every class after 2021",
            "npm run projections:rookie-curve:fit",
        ),
        "preseason/rookie-history": FitSource(
            "preseason/rookie-historical-games-fitted.ts",
            "FITTED_HISTORICAL_ROOKIE_GAMES_RATE, FITTED_ROOKIE_CURVE_EVIDENCE",
            "rookie classes 2003-2021",
            "every class after 2021",
            "npm run projections:rookie-historical-games:fit",
        ),
        "preseason/kdef-priors": FitSource(
            "preseason/kdef-fitted.ts",
            "FITTED_KICKER_PRIORS, FITTED_DEFENSE_PRIORS",
            "2013-2024",
            "2025 (judged once) and 2026",
            "npm run projections:kdef:fit",
        ),
        "market/blend-constants": FitSource(
            "market/blend-fitted.ts",
            "FITTED_BLEND_CONSTANTS",
            "predictor seasons 2013-2021",
            "every season after 2021",
            "npm run projections:blend:fit",
        ),
        "market/curve-ppr": FitSource(
            "market/curve-fitted.ts",
            "FITTED_MARKET_CURVE",
            "ADP boards 2013-2021",
            "every season after 2021",
            "npm run projections:market:fit",
        ),
        "market/curve-half": FitSource(
            "market/curve-fitted-half.ts",
            "FITTED_MARKET_CURVE_HALF",
            "Half PPR ADP boards 2018-2021",
            "2023 and 2024",
            "npm run projections:market:fit -- --format=half",
        ),
        "market/curve-std": FitSource(
            "market/curve-fitted-std.ts",
            "FITTED_MARKET_CURVE_STD",
            "Standard ADP boards 2013-2021",
            "2023 and 2024",
            "npm run projections:market:fit -- --format=std",
        ),
        "laws/measured": FitSource(
            "laws/measured.json",
            "the tribal laws' measurements",
            "seasons 2003-2023 (each law states its own)",
            "replicated on predictor seasons 2021-2023",
            "npm run laws:measure",
        ),
        "laws/discovered": FitSource(
            "laws/discovered.json",
            "the discovered laws",
            "discovery on predictor seasons 2003-2021",
            "replicated on predictor seasons 2021-2023",
            "npm run laws:discover",
        ),
        "laws/discovery-quantiles": FitSource(
            "laws/discovery/quantiles.ts",
            "DISCOVERY_QUANTILES",
            "predictor seasons 2003-2021",
            "every season after 2021",
            "npm run laws:discover:quantiles",
        ),
    }
)


@dataclass(frozen=True, slots=True)
class FitCommit:
    sha: str
    committed_at: datetime
    subject: str


def fit_commit(file: str) -> FitCommit:
    """The last commit that changed `file`'s content, following it through renames."""
    completed = subprocess.run(
        ["git", "log", "--follow", "-M", "--format=@%h%x09%cI%x09%s", "--name-status", "--", file],
        cwd=_REPO,
        check=True,
        capture_output=True,
        text=True,
    )
    header: list[str] | None = None
    for line in completed.stdout.splitlines():
        if line.startswith("@"):
            header = line[1:].split("\t", 2)
        elif line.strip() and header is not None and line.split("\t")[0] != _PURE_RENAME:
            return FitCommit(header[0], datetime.fromisoformat(header[1]), header[2])
    raise LookupError(f"{file} has no commit that changed its content")


def fitted_on(name: str, commit: FitCommit) -> str:
    """The artifact row's `fitted_on`: what the fit is, when it last changed, and how it is re-run."""
    source = FIT_SOURCES[name]
    return (
        f"the TypeScript oracle's {source.export} (projections/{source.module}), last changed at {commit.sha} "
        f"({commit.committed_at.date().isoformat()}: {commit.subject}); fitted on {source.fitted_on}, held out "
        f"{source.held_out}. Not re-runnable on the store as it stands: {LOST_INPUTS}. To re-fit: {REFIT_PATH}; "
        f"the oracle's own command was `{source.command}`."
    )
