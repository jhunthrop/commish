"""THE PORT'S INPUTS AS THE ORACLE READS THEM: one week's input, or a fit's, written as JSON for
`ts/weekly.ts` (camelCase keys, instants as ISO strings, maps as entry lists in their order)."""

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from research.model.domain import STAT_LINE_FIELDS, Position, snake_to_camel
from research.model.instants import js_iso
from research.model.reads.observations import PlayerWeekUsage, SeasonStatLine
from research.model.reads.teams import TeamContext
from research.model.weekly.inputs import WeeklyInput

_USAGE_FIELDS = (
    "season",
    "week",
    "player_id",
    "snap_share",
    "target_share",
    "carry_share",
    "pass_attempt_share",
    "targets",
    "carries",
    "pass_attempts",
    "team_targets",
    "team_carries",
    "team_pass_attempts",
)


def usage_json(row: PlayerWeekUsage) -> dict[str, Any]:
    return {**{snake_to_camel(name): getattr(row, name) for name in _USAGE_FIELDS}, "asOf": js_iso(row.as_of)}


def line_json(row: SeasonStatLine) -> dict[str, Any]:
    line = {
        snake_to_camel(name): getattr(row.line, name)
        for name in STAT_LINE_FIELDS
        if getattr(row.line, name) is not None
    }
    return {"season": row.season, "line": line, "asOf": js_iso(row.as_of)}


def context_json(context: TeamContext) -> dict[str, Any]:
    return {
        "playerTeams": [
            {"season": e.season, "week": e.week, "playerId": e.player_id, "team": e.team, "asOf": js_iso(e.as_of)}
            for e in context.player_teams
        ],
        "teamObservations": [
            {
                "season": o.season,
                "week": o.week,
                "team": o.team,
                "source": o.source,
                "metric": o.metric,
                "value": o.value,
                "asOf": js_iso(o.as_of),
            }
            for o in context.team_observations
        ],
    }


def _common(
    usage: Sequence[PlayerWeekUsage],
    history: Sequence[SeasonStatLine],
    positions: Mapping[str, Position],
    context: TeamContext,
) -> dict[str, Any]:
    return {
        "positions": list(positions.items()),
        "usage": [usage_json(row) for row in usage],
        "history": [line_json(row) for row in history],
        **context_json(context),
    }


def write_week(path: Path, data: WeeklyInput) -> Path:
    payload = {
        "season": data.season,
        "week": data.week,
        "asOf": js_iso(data.as_of),
        "firstRosterSeason": list(data.first_roster_season.items()),
        **_common(data.usage, data.history, data.positions, data.team_context),
    }
    path.write_text(json.dumps(payload, separators=(",", ":")))
    return path


def write_fit(  # noqa: PLR0913, PLR0917 - a fit's whole input, named
    path: Path,
    seasons: Sequence[int],
    held_out: Sequence[int],
    usage: Sequence[PlayerWeekUsage],
    history: Sequence[SeasonStatLine],
    positions: Mapping[str, Position],
    context: TeamContext,
) -> Path:
    payload = {"seasons": list(seasons), "heldOut": list(held_out), **_common(usage, history, positions, context)}
    path.write_text(json.dumps(payload, separators=(",", ":")))
    return path
