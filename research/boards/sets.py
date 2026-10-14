"""WHERE A GENERATION'S CANDIDATE SETS COME FROM, for `keep-candidates` (`research.boards.keep`)."""

from collections.abc import Mapping, Sequence
from datetime import datetime

from sqlalchemy import Connection, Engine

from research.boards.keep import CandidateSets
from research.model.arithmetic import Arithmetic
from research.model.market.curve import BOARD_FORMATS, BoardFormat, board_source_for
from research.model.preseason.candidate_store import read_candidates
from research.model.preseason.candidates import BoardCandidate
from research.model.preseason.persist import build_season
from research.model.priors import ModelArtifacts, load_model_artifacts


def _built(
    conn: Connection, season: int, moment: datetime, artifacts: ModelArtifacts, arithmetic: Arithmetic
) -> Mapping[BoardFormat, Sequence[BoardCandidate]]:
    season_boards = build_season(conn, season, moment, artifacts, arithmetic, BOARD_FORMATS)
    if season_boards.inputs.moment != moment:
        raise ValueError(f"the rebuild took {season_boards.inputs.moment}, not the generation's {moment}")
    return {fmt: season_boards.boards[board_source_for(fmt)].candidates for fmt in BOARD_FORMATS}


def rebuilt_in(conn: Connection, season: int, artifacts: ModelArtifacts, arithmetic: Arithmetic) -> CandidateSets:
    """The generation rebuilt in the store that serves it (before the season's first kickoff)."""
    return lambda moment: _built(conn, season, moment, artifacts, arithmetic)


def from_store(engine: Engine, season: int) -> CandidateSets:
    """The sets another store keeps for the same generation."""

    def read(moment: datetime) -> Mapping[BoardFormat, Sequence[BoardCandidate]]:
        with engine.connect() as conn:
            return {fmt: read_candidates(conn, season, board_source_for(fmt), moment) for fmt in BOARD_FORMATS}

    return read


def point_in_time(season: int) -> CandidateSets:
    """The generation rebuilt on a scratch copy of the dev store as it stood at its moment."""
    from research.model.arithmetic import ARM64_BOARDS  # noqa: PLC0415 - the parity harness is dev tooling
    from research.parity import databases  # noqa: PLC0415
    from research.parity.model.store import oracle_fits, scratch_pair_at  # noqa: PLC0415

    def rebuild(moment: datetime) -> Mapping[BoardFormat, Sequence[BoardCandidate]]:
        pair = scratch_pair_at(moment, "keep", oracle_fits())
        engine = pair.research_engine()
        try:
            with engine.connect() as conn:
                return _built(conn, season, moment, load_model_artifacts(conn), ARM64_BOARDS)
        finally:
            engine.dispose()
            databases.drop_scratch_databases()

    return rebuild
