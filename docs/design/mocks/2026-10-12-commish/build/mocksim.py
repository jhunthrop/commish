"""The mock as a function: settings + seed + your picks -> a whole draft.
Bots draft from where drafters take players, with the same spread the survival odds use,
so the room, the odds and the 200-run report all describe one world."""
import random
from collections import Counter
from statistics import median

from data import TEAMS_PER_ROUND, adp_or_sentinel, snake_seat
from survival import DRAFT_NOISE_FLOOR_PICKS, DRAFT_NOISE_SLOPE

ROUNDS = 14
STARTERS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1}
FLEX = ("RB", "WR", "TE")
CAPS = {"QB": 2, "RB": 6, "WR": 7, "TE": 2}
FILL_STARTERS_FROM_ROUND = 9
BOT_LOOKAHEAD = 40


def _counts(roster):
    return Counter(p["pos"] for p in roster)


def _open_starter(roster):
    have = _counts(roster)
    return [pos for pos, need in STARTERS.items() if have[pos] < need]


def your_pick(pool, roster, rnd):
    """Highest over replacement that keeps a legal roster. Late, fill an empty starter slot first."""
    have = _counts(roster)
    legal = [p for p in pool if have[p["pos"]] < CAPS[p["pos"]]]
    if rnd >= FILL_STARTERS_FROM_ROUND:
        missing = _open_starter(roster)
        if missing:
            fill = [p for p in legal if p["pos"] in missing]
            if fill:
                return max(fill, key=lambda p: p["vor"])
    return max(legal, key=lambda p: p["vor"])


def bot_pick(pool, rng):
    """Where drafters take him, blurred by the survival spread for his place in the queue."""
    order = sorted(pool, key=adp_or_sentinel)[:BOT_LOOKAHEAD]
    scored = []
    for place, p in enumerate(order, start=1):
        spread = DRAFT_NOISE_FLOOR_PICKS + DRAFT_NOISE_SLOPE * place
        scored.append((place + rng.gauss(0, spread), p))
    return min(scored, key=lambda t: t[0])[1]


def run_draft(players, my_seat, seed, fixed=None, rounds=ROUNDS):
    """One whole draft. fixed maps a pick number to the player you took there; every other pick of yours
    comes from your_pick, every bot pick from bot_pick seeded, so the same seed replays the same draft."""
    rng = random.Random(seed)
    pool = list(players)
    rosters = {s: [] for s in range(1, TEAMS_PER_ROUND + 1)}
    picks = []
    for n in range(1, rounds * TEAMS_PER_ROUND + 1):
        rnd, seat = snake_seat(n)
        if seat == my_seat:
            choice = (fixed or {}).get(n) or your_pick(pool, rosters[seat], rnd)
        else:
            choice = bot_pick(pool, rng)
        pool.remove(choice)
        rosters[seat].append(choice)
        picks.append({"no": n, "seat": seat, "player": choice})
    return picks, rosters, pool


def lineup(roster):
    """Best starting lineup by projected points: QB, RB, RB, WR, WR, TE, FLEX. No K or D/ST in this data."""
    by_pos = {pos: sorted((p for p in roster if p["pos"] == pos), key=lambda p: -p["proj"]) for pos in CAPS}
    slots = []
    for pos, need in STARTERS.items():
        for i in range(need):
            slots.append((pos, by_pos[pos][i] if i < len(by_pos[pos]) else None))
    used = {id(p) for _, p in slots if p}
    flex = max((p for pos in FLEX for p in by_pos[pos] if id(p) not in used), key=lambda p: p["proj"], default=None)
    slots.append(("FLEX", flex))
    return slots


def lineup_points(roster):
    return sum(p["proj"] for _, p in lineup(roster) if p)


def standings(rosters):
    return sorted(((lineup_points(r), s) for s, r in rosters.items()), reverse=True)


def many_runs(players, my_seat, seeds):
    """Your draft from this slot, run once per seed with your picks on autopick from the board."""
    points, ranks, exposure, firsts = [], [], Counter(), Counter()
    for seed in seeds:
        _, rosters, _ = run_draft(players, my_seat, seed)
        table = standings(rosters)
        points.append(lineup_points(rosters[my_seat]))
        ranks.append(next(i for i, (_, s) in enumerate(table, start=1) if s == my_seat))
        for p in rosters[my_seat]:
            exposure[p["id"]] += 1
        firsts[tuple(p["id"] for p in rosters[my_seat][:3])] += 1
    pts = sorted(points)
    n = len(pts)
    return {
        "n": n,
        "median": median(pts),
        "p10": pts[int(0.1 * n)],
        "p90": pts[min(n - 1, int(0.9 * n))],
        "top3": sum(1 for r in ranks if r <= 3) / n,
        "rank_counts": Counter(ranks),
        "exposure": exposure,
        "firsts": firsts,
        "points": pts,
    }
