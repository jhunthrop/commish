"""Every parity case, by name, and every fixture set's recording recipe."""

from research.parity.case import Case, Recording
from research.parity.cases import nflverse_season

ALL_CASES: tuple[Case, ...] = (*nflverse_season.CASES,)

CASES_BY_NAME: dict[str, Case] = {case.name: case for case in ALL_CASES}


def all_recordings() -> dict[str, Recording]:
    recordings: dict[str, Recording] = {}
    for case in ALL_CASES:
        for recording in case.recordings:
            recordings[recording.fixture_set] = recording
    for recording in nflverse_season.ALSO_RECORDED:
        recordings[recording.fixture_set] = recording
    return recordings
