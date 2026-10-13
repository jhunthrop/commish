"""GENERATED INPUTS FOR THE PURE DECIDE FUNCTIONS, and the port's answers in the oracle's JSON shape.

Seeded, so both sides see the same inputs every run: z-scores across the whole line and at the
edges, survival boards with tied prices, ordered floor/median/ceiling triples, weekly score lists
around the four-week minimum, and start/sit rosters on every roster shape with tied medians.
"""

import random
from dataclasses import fields
from typing import Any, Final

from research.model.arithmetic import ARM64_BOARDS
from research.model.decide.lineup import LineupCandidate, LineupDecision, MatchupContext, start_sit
from research.model.decide.normal import chance_of_clearing, normal_cdf
from research.model.decide.outlook import (
    ProjectionDistribution,
    outlook_around,
    realized_dispersion,
    standard_deviation_of,
)
from research.model.decide.survival import BoardEntry, SurvivalCurve
from research.model.domain import RosterSlotConfig, snake_to_camel

_SEED: Final = 20261012
_POSITIONS: Final = ("QB", "RB", "WR", "TE", "K", "DEF")
_SHAPES: Final = (
    (
        ("QB", 1, ("QB",)),
        ("RB", 2, ("RB",)),
        ("WR", 2, ("WR",)),
        ("TE", 1, ("TE",)),
        ("FLEX", 1, ("RB", "WR", "TE")),
        ("K", 1, ("K",)),
        ("DEF", 1, ("DEF",)),
        ("BENCH", 6, _POSITIONS),
    ),
    (
        ("QB", 1, ("QB",)),
        ("RB", 2, ("RB",)),
        ("WR", 2, ("WR",)),
        ("TE", 1, ("TE",)),
        ("FLEX", 1, ("RB", "WR", "TE")),
        ("SUPERFLEX", 1, ("QB", "RB", "WR", "TE")),
        ("K", 1, ("K",)),
        ("DEF", 1, ("DEF",)),
        ("BENCH", 6, _POSITIONS),
    ),
    (
        ("QB", 1, ("QB",)),
        ("RB", 2, ("RB",)),
        ("WR", 2, ("WR",)),
        ("TE", 1, ("TE",)),
        ("FLEX", 2, ("RB", "WR", "TE")),
        ("K", 1, ("K",)),
        ("DEF", 1, ("DEF",)),
        ("BENCH", 6, _POSITIONS),
    ),
    (
        ("QB", 1, ("QB",)),
        ("RB", 2, ("RB",)),
        ("WR", 3, ("WR",)),
        ("TE", 1, ("TE",)),
        ("FLEX", 1, ("RB", "WR", "TE")),
        ("DEF", 1, ("DEF",)),
        ("BENCH", 8, _POSITIONS),
    ),
)


def _slots_json(shape: tuple[tuple[str, int, tuple[str, ...]], ...]) -> list[dict[str, Any]]:
    return [{"slot": slot, "count": count, "eligiblePositions": list(positions)} for slot, count, positions in shape]


def _triple(rng: random.Random) -> list[float]:
    median = round(rng.uniform(0, 30), rng.choice((1, 2, 3)))
    floor = min(median, round(median - rng.uniform(0, 12), 2))
    return [floor, median, max(median, round(median + rng.uniform(0, 15), 2))]


def normal_inputs() -> dict[str, Any]:
    rng = random.Random(_SEED)
    z = [rng.uniform(-9, 9) for _ in range(20_000)] + [rng.gauss(0, 1) for _ in range(20_000)]
    z += [0.0, -0.0, 1e-300, -1e-12, 5.0, -5.0, 1.2815515655446004, 38.0, -38.0]
    clearing = [[rng.uniform(-60, 60), rng.uniform(0.01, 40), rng.uniform(-20, 20)] for _ in range(5_000)]
    survival = []
    for _ in range(300):
        size = rng.randint(1, 450)
        board = [
            {
                "playerId": f"p{n:04d}",
                "position": rng.choice(_POSITIONS),
                "averageDraftPosition": round(rng.uniform(0.1, 300), rng.choice((0, 1, 2))),
            }
            for n in range(size)
        ]
        from_pick = rng.randint(1, 200)
        survival.append({"board": board, "fromPick": from_pick, "toPick": from_pick + rng.randint(1, 31)})
    spreads = [_triple(rng) for _ in range(5_000)]
    around = [[rng.uniform(-10, 40), rng.uniform(0, 12)] for _ in range(5_000)]
    weeks = [[round(rng.uniform(-2, 45), 2) for _ in range(rng.randint(0, 17))] for _ in range(3_000)]
    return {"z": z, "clearing": clearing, "survival": survival, "spreads": spreads, "around": around, "weeks": weeks}


def port_normal(inputs: dict[str, Any]) -> list[dict[str, list[Any]]]:
    curve = SurvivalCurve(ARM64_BOARDS)
    survival = [
        list(
            curve.probabilities(
                [BoardEntry(e["playerId"], e["position"], e["averageDraftPosition"]) for e in query["board"]],
                query["fromPick"],
                query["toPick"],
            ).items()
        )
        for query in inputs["survival"]
    ]
    return [
        {"normalCdf": [normal_cdf(z, ARM64_BOARDS) for z in inputs["z"]]},
        {"chanceOfClearing": [chance_of_clearing(m, sd, t, ARM64_BOARDS) for m, sd, t in inputs["clearing"]]},
        {"survival": [[list(pair) for pair in query] for query in survival]},
        {"standardDeviationOf": [standard_deviation_of(ProjectionDistribution(*t)) for t in inputs["spreads"]]},
        {"outlookAround": [_camel(outlook_around(m, sd)) for m, sd in inputs["around"]]},
        {"realizedDispersion": [realized_dispersion(weeks) for weeks in inputs["weeks"]]},
    ]


def lineup_queries() -> list[dict[str, Any]]:
    rng = random.Random(_SEED + 1)
    queries = []
    for n in range(1_500):
        shape = _SHAPES[n % len(_SHAPES)]
        medians = [round(rng.uniform(0, 30), 1) for _ in range(6)]
        candidates = []
        for index in range(rng.randint(4, 20)):
            floor, median, ceiling = _triple(rng)
            if rng.random() < 0.2:  # noqa: PLR2004 - a fifth of the men tie another's median
                median = rng.choice(medians)
                floor, ceiling = min(floor, median), max(ceiling, median)
            candidates.append(
                {
                    "playerId": f"c{index:02d}",
                    "position": rng.choice(_POSITIONS),
                    "outlook": {"floor": floor, "median": median, "ceiling": ceiling},
                }
            )
        matchup = {"projectedMargin": rng.uniform(-40, 40), "opponentStandardDeviation": rng.uniform(4, 30)}
        queries.append({"candidates": candidates, "rosterSlots": _slots_json(shape), "matchup": matchup})
    return queries


def _camel(value: object) -> dict[str, Any]:
    return {snake_to_camel(f.name): getattr(value, f.name) for f in fields(value)}  # type: ignore[arg-type]


def _decision_json(decision: LineupDecision) -> dict[str, Any]:
    starters = []
    for start in decision.starters:
        row = _camel(start)
        row["reasons"] = [
            {snake_to_camel(k): v for k, v in _camel(reason).items() if v is not None} for reason in start.reasons
        ]
        starters.append(row)
    return {"starters": starters, "bench": list(decision.bench), "winProbability": decision.win_probability}


def port_lineup(query: dict[str, Any]) -> dict[str, Any]:
    candidates = [
        LineupCandidate(c["playerId"], c["position"], ProjectionDistribution(**c["outlook"]))
        for c in query["candidates"]
    ]
    slots = [RosterSlotConfig(s["slot"], s["count"], tuple(s["eligiblePositions"])) for s in query["rosterSlots"]]
    matchup = MatchupContext(query["matchup"]["projectedMargin"], query["matchup"]["opponentStandardDeviation"])
    return _decision_json(start_sit(candidates, slots, matchup, ARM64_BOARDS))
