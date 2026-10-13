"""Snapshot the in-season data the league and season mocks draw, from what shipped: the stand-in run's
player file and schedule (web/.runs) and a league page's sync answer read from a local api in replay
mode, joined to the run's league board file. Run once after `npm run standin` and a local attach:

    python3 build/export_inseason.py <run dir> <sync.json> <league-board ppr.json>

It writes data/season-chris-olave.json and data/league-sleeper.json, which gen.py reads."""
import json
import sys
from pathlib import Path

MOCKS = Path(__file__).resolve().parent.parent
SEASON_PLAYER = "Chris Olave"
POOL_ROWS = 14
MOVES = 8


def season(run):
    index = json.loads((run / "index.json").read_text())
    entry = next(e for e in index if e["name"] == SEASON_PLAYER)
    block = json.loads((run / "players" / f"{entry['id']}.json").read_text())["season"]
    schedule = json.loads((run / "schedule.json").read_text())
    slate = next(s for s in schedule["slates"] if s["abbr"] == entry["team"])
    kickoffs = {g["week"]: g["kickoff"] for g in slate["games"]}
    return {"player": entry, "season": block, "kickoffs": kickoffs}


def league(sync, board):
    rows = {r["id"]: r for r in board["rows"]}

    def placed(p):
        row = rows.get(p["board_id"] or "")
        if row is None:
            return {"name": p["name"], "pos": p["position"], "team": p["team"], "placed": False}
        return {
            "name": row["name"],
            "pos": row["position"],
            "pos_rank": row["positionRank"],
            "team": row["team"],
            "img": row["headshot"],
            "bye": sync["byes"].get(row["team"]),
            "proj": row["projected"],
            "vor": row["vor"],
            "vor_round": row["vorRound"],
            "games": row["season"]["games"],
            "ppg": row["season"]["pointsPerGame"],
            "placed": True,
        }

    held = set(sync["rostered"])
    pool = [placed({"board_id": r["id"], "name": r["name"], "position": r["position"], "team": r["team"]})
            for r in board["rows"] if r["id"] not in held][:POOL_ROWS]
    names = {t["roster_id"]: t["name"] for t in sync["teams"]}
    side = lambda s: {"team": names[s["roster_id"]], "starters": [placed(x["player"]) for x in s["starters"]]}
    return {
        "name": sync["name"],
        "week": sync["week"],
        "me": sync["me"],
        "teams": sync["teams"],
        "season_basis": board["season"],
        "board_basis": board["format"]["basis"],
        "matchup": {"mine": side(sync["matchup"]["mine"]), "opponent": side(sync["matchup"]["opponent"])},
        "roster": [{"slot": s["slot"], "player": placed(s["player"])} for s in sync["roster"]],
        "pool": pool,
        "pool_size": len(board["rows"]) - len(held & set(rows)),
        "moves": [
            {
                "at": m["at"],
                "kind": m["kind"],
                "teams": [names[r] for r in m["roster_ids"]],
                "adds": [[names[a["roster_id"]], a["player"]["name"]] for a in m["adds"]],
                "drops": [d["player"]["name"] for d in m["drops"]],
            }
            for m in sync["moves"][:MOVES]
        ],
    }


def main():
    run, sync_path, board_path = (Path(a) for a in sys.argv[1:4])
    sync = json.loads(sync_path.read_text())["data"]
    board = json.loads(board_path.read_text())
    (MOCKS / "data" / "season-chris-olave.json").write_text(json.dumps(season(run), indent=1))
    (MOCKS / "data" / "league-sleeper.json").write_text(json.dumps(league(sync, board), indent=1))


if __name__ == "__main__":
    main()
