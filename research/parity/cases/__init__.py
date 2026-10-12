"""Every parity case, by name, and every fixture set's recording recipe."""

from research.parity.case import Case, Recording
from research.parity.cases import nflverse_context, nflverse_pbp, nflverse_season, tank01

ALL_CASES: tuple[Case, ...] = (*nflverse_season.CASES, *nflverse_context.CASES, *nflverse_pbp.CASES, *tank01.CASES)

CASES_BY_NAME: dict[str, Case] = {case.name: case for case in ALL_CASES}


def all_recordings() -> dict[str, Recording]:
    recordings: dict[str, Recording] = {}
    for case in ALL_CASES:
        for recording in case.recordings:
            recordings[recording.fixture_set] = recording
    for recording in nflverse_season.ALSO_RECORDED:
        recordings[recording.fixture_set] = recording
    return recordings
