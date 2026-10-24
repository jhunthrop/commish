"""THE RUN'S DATABASE-BOUND STEPS, ON THE SCRATCH COPY (the runner's `Environment`).

- the preconditions: R4 6.3's counts on the run's seasons (`preconditions.counted`);
- round 3's reproduction: its development check fitted and scored by its committed code, its 26 lines
  equal to their record, or the run is refused (6.3), as round 4's runner ran it, before the claim;
- the judged season: for the check, round 3's development check's own judged read (2023, already read by
  round 3's model before the claim, as round 4's check); for the judgment, round 3 fitted on 2021 to 2023
  and its 2024 read, after the claim;
- the fit seasons' reads with that run's round 3 fit (`reads.fit_reads`), and the fumbles lost;
- the six tables' digests (`round.table_digests`) and round 4's development-check record.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Connection

from research.model.arithmetic import model_version
from research.model.domain import Position
from research.model.priors import ModelArtifacts, load_model_artifacts
from research.model.reads.preseason import all_positions
from research.model.weekly3 import gates as round_three_gates
from research.model.weekly4.round_three import RoundThree, reproduction, run_round_three
from research.model.weekly5.gates import RoundFive
from research.model.weekly5.preconditions import counted, recorded
from research.model.weekly5.reads import FitReads, JudgedReads, fit_reads, judged_reads
from research.model.weekly5.round import RefusedError, table_digests


@dataclass(frozen=True, slots=True)
class Handle:
    """A round 3 run and what its reads need."""

    three: RoundThree
    artifacts: ModelArtifacts
    positions: Mapping[str, Position]
    version: str


class DatabaseEnvironment:
    """The real steps."""

    def preconditions(self, conn: Connection, t: RoundFive) -> tuple[list[str], dict[str, Any]]:
        return counted(conn, t)

    def round_three(self, conn: Connection, t: RoundFive) -> object:
        del t
        artifacts = load_model_artifacts(conn)
        positions = all_positions(conn)
        version = model_version()
        dev = run_round_three(conn, round_three_gates.DEVELOPMENT_CHECK, artifacts, positions, version)
        unreproduced = reproduction(dev.lines)
        if unreproduced:
            raise RefusedError(
                "round 3's code does not reproduce its 26 recorded lines: " + "; ".join(unreproduced[:3])
            )
        return Handle(dev, artifacts, positions, version)

    def judged(self, conn: Connection, t: RoundFive, reproduced: object) -> tuple[JudgedReads, object]:
        if not isinstance(reproduced, Handle):
            raise TypeError("the judged read needs round 3's reproduction")
        if t.round_three.judgment_season == reproduced.three.judged.season:
            return judged_reads(reproduced.three, t), reproduced
        three = run_round_three(conn, t.round_three, reproduced.artifacts, reproduced.positions, reproduced.version)
        handle = Handle(three, reproduced.artifacts, reproduced.positions, reproduced.version)
        return judged_reads(three, t), handle

    def fit_reads(self, conn: Connection, t: RoundFive, fit: object) -> FitReads:
        if not isinstance(fit, Handle):
            raise TypeError("the fit seasons are read with a round 3 fit")
        return fit_reads(conn, t, fit.three.fit, fit.artifacts, fit.positions)

    def digests(self, conn: Connection) -> dict[str, str]:
        return table_digests(conn)

    def round_four_record(self) -> Mapping[str, Any]:
        return recorded()
