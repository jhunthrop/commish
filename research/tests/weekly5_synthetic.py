# ruff: noqa: PLR2004 - a synthetic season's rates, drawn from a fixed generator
"""Synthetic seasons for round 5's tests (Lane 168): eight clubs, ten weeks a season, every row kind of
round 4's feature store (players, teams, plays, written as its files with a build report) and the frames
round 3's reads give the run (the rate m, the lines, the forms, the fumbles lost, the population rows).
Nothing here is a real season's figure: every value is drawn from a fixed generator, and the seasons are
2016 to 2021 so no test names a season the rounds hold out.
"""

import json
import math
from collections.abc import Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Final

import numpy as np
import pandas as pd

from research.model.weekly.round.scoring import FORMATS
from research.model.weekly2.statistics import JudgedRow
from research.model.weekly4.features.columns import (
    GAME_DEFAULTS,
    PLAY_SCHEMA,
    PLAYER_DEFAULTS,
    PLAYER_SCHEMA,
    TEAM_SCHEMA,
    default_column,
)
from research.model.weekly4.features.store import PLAY_KEY, PLAYER_KEY, TEAM_KEY, write_rows
from research.model.weekly4.system import Store
from research.model.weekly4.tuning import Cell
from research.model.weekly5.gates import DEVELOPMENT_CHECK, RoundFive
from research.model.weekly5.system import Grids, Sources

CLUBS: Final = ("ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE")
ROSTER: Final = (("QB", 1), ("RB", 2), ("WR", 3), ("TE", 1))
SEASONS: Final = tuple(range(2016, 2022))
WEEKS: Final = tuple(range(1, 11))
ROOFS: Final = ("outdoors", "dome", "closed", "open")
TINY: Final = Grids((Cell(7, 0.0, 20, 5),), (Cell(7, 0.0, 20, 5, 0.5),))
# A check on synthetic seasons: the player fit on 2019 and 2020, the team and play models on 2016 to 2020,
# judged on 2021 weeks 6 to 10, small resamples.
T: Final[RoundFive] = replace(
    DEVELOPMENT_CHECK,
    player_fit_seasons=(2019, 2020),
    team_fit_seasons=tuple(range(2016, 2021)),
    judgment_season=2021,
    weeks=tuple(range(6, 11)),
    fit_weeks=tuple(range(4, 11)),
    resamples=200,
    calibration_min_size=10,
    chance_min_pairs=5,
    chance_min_bins=1,
)
T_JUDGED: Final[RoundFive] = replace(
    T, player_fit_seasons=(2019, 2020, 2021), team_fit_seasons=tuple(range(2016, 2022)), judgment_season=2021
)


def player_id(club: str, position: str, slot: int) -> str:
    return f"00-{club}{position}{slot}"


def roster(club: str) -> list[tuple[str, str]]:
    return [(player_id(club, p, i), p) for p, n in ROSTER for i in range(1, n + 1)]


def positions() -> dict[str, str]:
    return {pid: p for club in CLUBS for pid, p in roster(club)}


def _pairs(week: int) -> list[tuple[str, str]]:
    shift = week % (len(CLUBS) - 1)
    order = [CLUBS[0], *[CLUBS[1 + (i + shift) % (len(CLUBS) - 1)] for i in range(len(CLUBS) - 1)]]
    return [(order[i], order[len(order) - 1 - i]) for i in range(len(order) // 2)]


@dataclass(slots=True)
class Built:
    store: Store
    sources: Sources
    population: dict[int, list[JudgedRow]]  # judged season -> its rows
    directory: Path | None = None


def _blank(schema: Sequence[tuple[str, str]]) -> dict[str, Any]:
    return {name: (0 if kind == "int" else "" if kind == "str" else 0.0) for name, kind in schema}


def _play(base: dict[str, Any], **values: Any) -> dict[str, Any]:
    row = {**_blank(PLAY_SCHEMA), **base, **values}
    return row


def _game_plays(  # noqa: PLR0913, PLR0917 - one synthetic game's every coordinate
    rng: np.random.Generator, season: int, week: int, game_id: str, club: str, opponent: str, roof: str, wind: float
) -> list[dict[str, Any]]:
    base = {"season": season, "week": week, "game_id": game_id, "as_of": f"{season}-10-01T00:00:00+00:00",
            "posteam": club, "defteam": opponent, "roof": roof, "indoor": float(roof in ("dome", "closed")),
            "temperature_f": 60.0, "wind_mph": wind, "precipitation": 0.0, "pass_location": "left",
            "run_location": "middle", "run_gap": "guard"}  # fmt: skip
    qb = player_id(club, "QB", 1)
    receivers = [player_id(club, "WR", 1), player_id(club, "WR", 2), player_id(club, "WR", 3),
                 player_id(club, "TE", 1), player_id(club, "RB", 1), player_id(club, "RB", 2)]  # fmt: skip
    weights = np.array([0.26, 0.2, 0.12, 0.18, 0.14, 0.1])
    rows: list[dict[str, Any]] = []
    play = 0
    for _ in range(int(rng.integers(28, 40))):
        play += 1
        yard = float(rng.integers(1, 99))
        common = {**base, "play_id": play, "down": float(rng.integers(1, 4)), "ydstogo": 10.0, "yardline_100": yard}
        roll = rng.random()
        if roll < 0.07:
            rows.append(_play(common, kind="dropback", player_id=qb, sack=1.0, yards_gained=-6.0, complete_pass=0.0))
            continue
        if roll < 0.12:
            gain = float(rng.integers(1, 15))
            rows.append(_play(common, kind="dropback", player_id=qb, sack=0.0, yards_gained=gain,
                              complete_pass=0.0, touchdown=float(gain >= yard)))  # fmt: skip
            continue
        target = receivers[int(rng.choice(len(receivers), p=weights))]
        caught = rng.random() < 0.65
        gain = float(rng.integers(0, 30)) if caught else 0.0
        touchdown = float(caught and gain >= yard)
        pick = float(not caught and rng.random() < 0.05)
        outcome = {"complete_pass": float(caught), "yards_gained": gain, "touchdown": touchdown, "interception": pick,
                   "sack": 0.0, "air_yards": float(rng.integers(-3, 25))}  # fmt: skip
        rows.append(_play(common, kind="dropback", player_id=qb, **outcome))
        rows.append(_play(common, kind="target", player_id=target, **outcome))
    for _ in range(int(rng.integers(18, 28))):
        play += 1
        yard = float(rng.integers(1, 99))
        runner = player_id(club, "RB", 1) if rng.random() < 0.65 else player_id(club, "RB", 2)
        if rng.random() < 0.05:
            runner = qb
        elif rng.random() < 0.05:
            runner = player_id(club, "WR", 1) if rng.random() < 0.6 else player_id(club, "TE", 1)
        gain = float(rng.integers(-2, 12))
        rows.append(_play({**base, "play_id": play, "down": 1.0, "ydstogo": 10.0, "yardline_100": yard},
                          kind="carry", player_id=runner, yards_gained=gain, touchdown=float(gain >= yard),
                          complete_pass=0.0, interception=0.0, sack=0.0))  # fmt: skip
    return rows


def _team_row(season: int, week: int, game_id: str, club: str, opponent: str, game: dict[str, Any]) -> dict[str, Any]:  # noqa: PLR0913, PLR0917
    row = {**_blank(TEAM_SCHEMA), "season": season, "week": week, "game_id": game_id, "club": club,
           "opponent": opponent, "instant": f"{season}-10-01T00:00:00+00:00", **game}  # fmt: skip
    return row


def _team_outcomes(plays: list[dict[str, Any]]) -> dict[str, float]:
    drops = [p for p in plays if p["kind"] == "dropback"]
    scrambles = [p for p in drops if p["sack"] == 0 and p["complete_pass"] == 0 and p["yards_gained"] > 0]
    carries = [p for p in plays if p["kind"] == "carry"]
    targets = [p for p in plays if p["kind"] == "target"]
    return {
        "plays": float(len(drops) + len(carries)),
        "dropbacks": float(len(drops)),
        "sacks": float(sum(p["sack"] for p in drops)),
        "scrambles": float(len(scrambles)),
        "designed_rushes": float(len(carries)),
        "team_targets": float(len(targets)),
        "rushing_touchdowns": float(sum(p["touchdown"] for p in (*carries, *scrambles))),
        "receiving_touchdowns": float(sum(p["touchdown"] for p in targets)),
    }


def _points(rows: list[dict[str, Any]], pid: str, fumbles: float) -> dict[str, float]:
    mine = [p for p in rows if p["player_id"] == pid]
    pass_rows = [p for p in mine if p["kind"] == "dropback" and p["sack"] == 0 and p["complete_pass"] == 1]
    scramble = [
        p
        for p in mine
        if p["kind"] == "dropback" and p["sack"] == 0 and p["complete_pass"] == 0 and p["yards_gained"] > 0
    ]
    picks = sum(p["interception"] for p in mine if p["kind"] == "dropback")
    rush = [p for p in mine if p["kind"] == "carry"] + scramble
    catches = [p for p in mine if p["kind"] == "target" and p["complete_pass"] == 1]
    base = (
        0.04 * sum(p["yards_gained"] for p in pass_rows) + 4 * sum(p["touchdown"] for p in pass_rows) - 2 * picks
        + 0.1 * sum(p["yards_gained"] for p in rush) + 6 * sum(p["touchdown"] for p in rush)
        + 0.1 * sum(p["yards_gained"] for p in catches) + 6 * sum(p["touchdown"] for p in catches) - 2 * fumbles
    )  # fmt: skip
    return {"ppr": base + len(catches), "half": base + 0.5 * len(catches), "std": base}


def _player_row(  # noqa: PLR0913, PLR0917 - one synthetic row's every coordinate
    team: dict[str, Any], pid: str, position: str, played: int, shares: dict[str, float], rng: np.random.Generator
) -> dict[str, Any]:
    row = {**_blank(PLAYER_SCHEMA), **{k: team[k] for k, _ in TEAM_SCHEMA if k in dict(PLAYER_SCHEMA)}}
    for name in (*GAME_DEFAULTS, *PLAYER_DEFAULTS):
        row[default_column(name)] = 0
    withheld = int(rng.random() < 0.04)
    row.update(
        player_id=pid, position=position, status="Out" if withheld else "", withheld=withheld,
        games_played=played, played_in_last_three=int(played > 0), depth_rank=float(1 + pid.endswith("2")),
        snap_season=0.7, snap_last_three=0.7, snap_trend=0.0, depth_chart_week=team["week"],
    )  # fmt: skip
    if played == 0:
        row[default_column("no_game_this_season")] = 1
    for kind, value in shares.items():
        for stat in ("season", "last_three", "decay_0_5", "decay_0_7", "decay_0_85", "decay_1", "prior"):
            row[f"share_{stat}_{kind}"] = value if played or stat == "prior" else math.nan
    return row


def build(directory: Path | None = None, seed: int = 11) -> Built:
    """Every season's store rows and sources; with `directory`, the store's files and build report too."""
    rng = np.random.default_rng(seed)
    where = positions()
    players: list[dict[str, Any]] = []
    teams: list[dict[str, Any]] = []
    plays: list[dict[str, Any]] = []
    lines: list[dict[str, Any]] = []
    fumbles: list[dict[str, Any]] = []
    for season in SEASONS:
        history: dict[str, list[dict[str, float]]] = {}
        counts: dict[str, dict[str, float]] = {}
        for week in WEEKS:
            for k, (home, away) in enumerate(_pairs(week)):
                game_id = f"{season}_{week:02d}_{away}_{home}"
                roof = ROOFS[(k + week) % len(ROOFS)]
                wind = float(rng.integers(0, 20))
                for club, opponent, at_home in ((home, away, 1.0), (away, home, 0.0)):
                    implied = float(rng.normal(22.0, 3.0))
                    game = {"home": at_home, "rest_days": 7.0, "division_game": 0.0, "implied_points": implied,
                            "opponent_implied_points": 44.0 - implied, "spread": 2 * implied - 44.0, "roof": roof,
                            "indoor": float(roof in ("dome", "closed")), "temperature_f": 60.0, "wind_mph": wind,
                            "precipitation": 0.0, "own_pace": 28.0, "opponent_pace": 28.0}  # fmt: skip
                    game_plays = _game_plays(rng, season, week, game_id, club, opponent, roof, wind)
                    plays += game_plays
                    team = _team_row(season, week, game_id, club, opponent, game)
                    teams.append({**team, **_team_outcomes(game_plays)})
                    for pid, position in roster(club):
                        played = len(history.get(pid, []))
                        own = counts.get(pid, {})
                        club_total = counts.get(club, {})
                        shares = {kind: (own.get(kind, 0.0) / club_total[kind] if club_total.get(kind) else 0.0)
                                  for kind in ("targets", "carries", "dropbacks", "red_zone", "inside_ten", "air_yards")}  # fmt: skip
                        players.append(_player_row(team, pid, position, played, shares, rng))
                        fumble = float(rng.random() < 0.03)
                        scored = _points(game_plays, pid, fumble)
                        lines.append({"season": season, "week": week, "player_id": pid, "club": club, **scored})
                        fumbles.append({"season": season, "week": week, "player_id": pid, "fumbles_lost": fumble})
                        history.setdefault(pid, []).append(scored)
                        for p in game_plays:
                            if p["player_id"] != pid:
                                continue
                            for kind, hit in (("targets", p["kind"] == "target"), ("carries", p["kind"] == "carry"),
                                              ("dropbacks", p["kind"] == "dropback"),
                                              ("red_zone", p["kind"] != "dropback" and p["yardline_100"] <= 20),
                                              ("inside_ten", p["kind"] != "dropback" and p["yardline_100"] <= 10)):  # fmt: skip
                                if hit:
                                    for who in (pid, club):
                                        counts.setdefault(who, {}).setdefault(kind, 0.0)
                                        counts[who][kind] += 1.0
    store = _frames(players, teams, plays)
    sources = _sources(pd.DataFrame(lines), pd.DataFrame(fumbles), where)
    built = Built(store, sources, {s: population(sources, s, where, rng) for s in (2021,)})
    if directory is not None:
        built.directory = directory
        write_store(directory, players, teams, plays)
    return built


def _frames(players: list[dict[str, Any]], teams: list[dict[str, Any]], plays: list[dict[str, Any]]) -> Store:
    def frame(rows: list[dict[str, Any]], schema: Sequence[tuple[str, str]]) -> pd.DataFrame:
        found = pd.DataFrame(rows, columns=[n for n, _ in schema])
        for name, kind in schema:
            if kind == "str":
                found[name] = found[name].replace("", None)
        return found

    return Store(frame(players, PLAYER_SCHEMA), frame(teams, TEAM_SCHEMA), frame(plays, PLAY_SCHEMA), {})


def write_store(
    directory: Path, players: list[dict[str, Any]], teams: list[dict[str, Any]], plays: list[dict[str, Any]]
) -> None:
    """Round 4's files per season and kind, with a build report naming each digest."""
    seasons = []
    for season in SEASONS:
        digests = {}
        for kind, rows, schema, key in (("players", players, PLAYER_SCHEMA, PLAYER_KEY), ("teams", teams, TEAM_SCHEMA, TEAM_KEY),
                                        ("plays", plays, PLAY_SCHEMA, PLAY_KEY)):  # fmt: skip
            mine = [{k: (None if v == "" else v) for k, v in r.items()} for r in rows if r["season"] == season]
            name = f"history-{season}-{kind}.parquet"
            digests[name] = write_rows(mine, schema, key, directory / name)
        seasons.append({"season": season, "digests": digests, "depth_chart_rule": "week", "stamps": {"broken": 0},
                        "clause": {"team": {"holds": True}, "player": {"holds": True}}})  # fmt: skip
    (directory / "report-history.json").write_text(
        json.dumps({"seasons": seasons, "outcome_seasons_read": list(SEASONS)})
    )


def _sources(lines: pd.DataFrame, fumbles: pd.DataFrame, where: dict[str, str]) -> Sources:
    rates = []
    forms = []
    for (season, pid), mine in lines.groupby(["season", "player_id"]):
        level = float(mine["ppr"].mean())
        prior = lines[(lines["season"] == season - 1) & (lines["player_id"] == pid)]
        for week in WEEKS:
            before = mine[mine["week"] < week]
            source = before if not before.empty else prior
            rates.append({"season": season, "week": week, "player_id": pid, "candidate": 1,
                          **{f"rate_m_{n}": level * (1.0 if n == "ppr" else 0.85 if n == "half" else 0.7) for n in FORMATS}})  # fmt: skip
            if not source.empty:
                forms.append({"season": season, "week": week, "player_id": pid,
                              **{f"form_{n}": float(source[n].mean()) for n in FORMATS}})  # fmt: skip
    del where
    return Sources(pd.DataFrame(rates), lines, pd.DataFrame(forms), fumbles)


def population(sources: Sources, season: int, where: dict[str, str], rng: np.random.Generator) -> list[JudgedRow]:
    """Every lined player of the season's weeks: round 3's number a noisy form, ADP his preseason order."""
    lines = sources.lines[sources.lines["season"] == season]
    forms = sources.forms.set_index(["season", "week", "player_id"])
    adp = {pid: float(i + 1) for i, pid in enumerate(sorted(where))}
    rows = []
    for r in lines.itertuples():
        key = (season, int(r.week), str(r.player_id))
        form = {n: float(forms.loc[key, f"form_{n}"]) for n in FORMATS} if key in forms.index else None
        number = None if form is None else {n: v * float(rng.uniform(0.8, 1.2)) for n, v in form.items()}
        actual = {n: float(getattr(r, n)) for n in FORMATS}
        rows.append(JudgedRow(int(r.week), str(r.player_id), where[str(r.player_id)], number, None, None,
                              adp[str(r.player_id)], form, actual, False))  # fmt: skip
    return rows
