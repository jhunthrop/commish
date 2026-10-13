"""Load the real board and capsules, derive the honest comparisons the screens show."""
import csv
import math
from pathlib import Path

MOCKS = Path(__file__).resolve().parent.parent
TEAMS_PER_ROUND = 12
TINTED_ROUNDS = 4
NO_ADP_SENTINEL = 250.0


def _f(value):
    return float(value) if value not in ("", None) else None


def load_board():
    rows = list(csv.DictReader(open(MOCKS / "data" / "board-ppr.csv")))
    players = [
        {
            "id": r["player_id"],
            "name": r["name"],
            "pos": r["position"],
            "team": r["nfl_team"],
            "pos_rank": int(r["position_rank"]),
            "adp": _f(r["adp"]),
            "img": r["headshot_url"],
            "proj": float(r["projected_points"]),
            "vor": float(r["value_over_replacement"]),
            "games": float(r["expected_games"]),
            "floor": float(r["floor_points"]),
            "median": float(r["median_points"]),
            "ceiling": float(r["ceiling_points"]),
            "tier": int(r["tier"]) + 1,
        }
        for r in rows
    ]
    by_vor = sorted(players, key=lambda p: -p["vor"])
    for i, p in enumerate(by_vor, start=1):
        p["our_rank"] = i
        p["vor_round"] = math.ceil(i / TEAMS_PER_ROUND)
    return by_vor


def load_capsules():
    return {r["player_id"]: r for r in csv.DictReader(open(MOCKS / "data" / "capsules.csv"))}


def tier_cliffs(players, pos):
    """Drop in projected PPR points from the last player of each tier to the first of the next."""
    group = sorted((p for p in players if p["pos"] == pos), key=lambda p: p["pos_rank"])
    cliffs = {}
    for a, b in zip(group, group[1:]):
        if b["tier"] != a["tier"]:
            cliffs[a["tier"]] = {"drop": a["proj"] - b["proj"], "next": b["tier"]}
    counts = {}
    for p in group:
        counts[p["tier"]] = counts.get(p["tier"], 0) + 1
    return cliffs, counts


def heat_class(p):
    if p["vor"] < 0:
        return "heat-neg"
    return f"heat-{p['vor_round']}" if p["vor_round"] <= TINTED_ROUNDS else "heat-0"


def drafters_gap(p):
    """Positive means drafters take him later than our board does."""
    if p["adp"] is None:
        return None
    return round(p["adp"] - p["our_rank"])


def snake_seat(pick_no, teams=TEAMS_PER_ROUND):
    rnd = (pick_no - 1) // teams + 1
    idx = (pick_no - 1) % teams
    return rnd, (idx + 1 if rnd % 2 else teams - idx)


def adp_or_sentinel(p):
    """Players with no ADP sit behind everyone who has one, for bots and for the survival queue alike."""
    return p["adp"] if p["adp"] is not None else NO_ADP_SENTINEL


def simulate_draft(players, my_seat, picks_made):
    """Bots take the lowest ADP left. You take the highest over-replacement left.
    Mock-draft bots on the product draft from ADP, so this is the room as it would play."""
    pool = list(players)
    picks = []
    for n in range(1, picks_made + 1):
        _, seat = snake_seat(n)
        if seat == my_seat:
            choice = max(pool, key=lambda p: p["vor"])
        else:
            choice = min(pool, key=adp_or_sentinel)
        pool.remove(choice)
        picks.append({"no": n, "seat": seat, "player": choice})
    return picks, pool
