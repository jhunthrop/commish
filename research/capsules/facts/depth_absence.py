"""WHY A PRIOR SEASON ENDED, THE GAMES HE MISSED, AND HIS INJURY DESIGNATIONS THIS SUMMER.

Ported from `research-ts/src/projections/availability/season-end.ts` and `capsules/facts/
{availability,injury-history}.ts`. A season ended on the injury report's word when the week after
his last game reads Out or Injured Reserve, else on the roster's when it reads reserve from then
on; never on a guess. A missed game is a week the designation archives call unavailable.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Final

from research.capsules.facts.depth_model import GamesMissed, InjuryDesignation, SeasonEnding
from research.model.instants import js_iso
from research.model.preseason.availability_history import (
    WeeklyInjuryReport,
    WeeklyRosterStatus,
    classify_season_weeks,
)

_SEASON_ENDING_REPORTS: Final = frozenset({"Out", "Injured Reserve"})
_RESERVE_CLASS_STATUSES: Final = frozenset({"RES"})


@dataclass(frozen=True, slots=True)
class SeasonInputs:
    """One prior season's rows for one player, and the weeks he played."""

    season: int
    team_games: int
    covered: bool
    roster_rows: Sequence[WeeklyRosterStatus]
    injury_rows: Sequence[WeeklyInjuryReport]
    played_weeks: Sequence[int]


def _season_ending(inputs: SeasonInputs) -> SeasonEnding | None:
    """`deriveSeasonEnding`: the report's reading first, then the roster's."""
    last_played = max(inputs.played_weeks) if inputs.played_weeks else 0
    first_missed = last_played + 1
    report = next((row for row in inputs.injury_rows if row.week == first_missed), None)
    if report is not None and report.report_status in _SEASON_ENDING_REPORTS:
        injury = None if report.primary_injury == "" else report.primary_injury
        return SeasonEnding(inputs.season, last_played, first_missed, "report", report.report_status, None, injury)
    status = next((row for row in inputs.roster_rows if row.week == first_missed), None)
    if status is None or status.status not in _RESERVE_CLASS_STATUSES:
        return None
    later = [row for row in inputs.roster_rows if row.week >= first_missed]
    if not all(row.status in _RESERVE_CLASS_STATUSES for row in later):
        return None
    return SeasonEnding(inputs.season, last_played, first_missed, "status", None, status.status, None)


def season_endings_for(seasons: Sequence[SeasonInputs]) -> tuple[SeasonEnding, ...]:
    """`seasonEndingsFor`: one entry per season that ended early, in the seasons' order."""
    return tuple(ending for ending in (_season_ending(s) for s in seasons) if ending is not None)


def games_missed_for(seasons: Sequence[SeasonInputs]) -> tuple[GamesMissed, ...]:
    """`gamesMissedFor`: a season either store knows him in; the weeks only where both archives cover it."""
    missed: list[GamesMissed] = []
    for s in seasons:
        if not s.roster_rows and not s.played_weeks:
            continue
        played = sorted(set(s.played_weeks))
        classes = classify_season_weeks(s.roster_rows, s.injury_rows, s.played_weeks) if s.covered else None
        missed.append(
            GamesMissed(
                s.season,
                s.team_games,
                len(played),
                played[0] if played else None,
                None if classes is None else tuple(classes["unavailable"]),
                None if classes is None else tuple(classes["suspended"]),
                None if classes is None else len(classes["did_not_play"]),
            )
        )
    return tuple(missed)


@dataclass(frozen=True, slots=True)
class CapturedDesignation:
    designation: str
    description: str | None


@dataclass(frozen=True, slots=True)
class InjuryCapture:
    captured_at: datetime
    designations: Mapping[str, CapturedDesignation]


def injury_history_for(player_id: str, captures: Sequence[InjuryCapture]) -> tuple[InjuryDesignation, ...]:
    """`injuryHistoryFor`: each run of one designation across consecutive captures, as one entry."""
    runs: list[InjuryDesignation] = []
    open_run: InjuryDesignation | None = None
    for capture in captures:
        seen = capture.designations.get(player_id)
        if seen is None:
            open_run = None
            continue
        day = js_iso(capture.captured_at)[:10]
        if open_run is not None and open_run.designation == seen.designation:
            description = open_run.description if open_run.description is not None else seen.description
            open_run = replace(
                open_run, description=description, last_seen_at=day, capture_count=open_run.capture_count + 1
            )
            runs[-1] = open_run
            continue
        open_run = InjuryDesignation(seen.designation, seen.description, day, day, 1)
        runs.append(open_run)
    return tuple(runs)
