"""Re-scores every played week of a run's season blocks with the research code's own
`compute_fantasy_points` and fails on any difference from the run's points.

The stand-in scores with a TypeScript port (fantasy-points.ts); this holds it to the original.
Run from the repo root after `npm run standin`:
    uv run --project research python web/scripts/check-points-parity.py [web/.runs/runs/<runId>]
With no argument it reads the run web/.runs/runs/latest.json points at.
"""

import json
import sys
from pathlib import Path

from research.model.domain import SCORING_PRESETS, STAT_FIELDS, ScoringRules, StatLine, compute_fantasy_points

RUNS = Path("web/.runs/runs")
# The product's defense is domain.py's DEF.
POSITION_NAMES = {"DST": "DEF"}


def run_dir() -> Path:
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    return RUNS / json.loads((RUNS / "latest.json").read_text())["runId"]


def preset(format_id: str) -> ScoringRules:
    """A format id's preset: ppr-12 scores with ppr, half-ppr-12 with half_ppr."""
    name = format_id.rsplit("-", 1)[0].replace("-", "_")
    return SCORING_PRESETS[name]


def main() -> int:
    played = 0
    mismatches = 0
    for file in sorted((run_dir() / "players").glob("*.json")):
        player = json.loads(file.read_text())
        season = player["season"]
        rules = preset(season["format"])
        position = POSITION_NAMES.get(player["position"], player["position"])
        for row in season["log"]:
            if row["status"] != "played":
                continue
            line = StatLine(
                player_id=player["id"],
                week=row["week"],
                **{field: row[field] or 0.0 for field in STAT_FIELDS},
            )
            points = compute_fantasy_points(line, position, rules)
            played += 1
            if points != row["points"]:
                mismatches += 1
                print(f"{player['name']} week {row['week']}: research {points}, run {row['points']}")
    print(f"{played} played weeks, {mismatches} mismatches")
    return 1 if mismatches or played == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
