"""A LIVE WEEK: the served number for the games still to kick off, and its weekly freeze (sections 3.3
and 4), built but wired to no screen.

Every input is read in process from the store's tables by the same code the history build ran
(`features.season.build_season` with `live_after`), never from a file: the week's player and team rows
at each game's instant; the plays of the season before and of this season's weeks before W, priced by
the served play model; the rate m, ADP, the rounds' recent form and the projected set from round 3's
own week board; this season's lines before W for last-three form and the expert's spreadsheet.

The live week differs from replay where 2.5 says so: the precipitation is the forecast's probability q,
the point q x f(1) + (1 - q) x f(0) and each draw of the simulation taking the flag 1 with probability
q; a retractable roof stays undecided (its state missing, counted) while the one-split rule of 2.5
cannot be fitted (the store holds no weather for a closed-roof game); the run seed is the live run's
`job_runs` id. Each frozen row carries its range, the why (the seven groups' attributions and the lines
they speak) and the benchmarks' values; a row is counted toward "leads" only when frozen by the pinned
served version after a pass (3.3), so every freeze before one is a shadow.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

import numpy as np
import pandas as pd
from sqlalchemy import Connection, text

from research.model.arithmetic import ARM64_BOARDS
from research.model.domain import Position
from research.model.priors import ModelArtifacts
from research.model.reads.observations import ObservationQuery, WeekRange, stat_lines_as_of
from research.model.reads.teams import player_teams_as_of, team_observations_as_of
from research.model.register.freeze import IMPLEMENTATION
from research.model.ros.reads import build_stale_board, week_inputs
from research.model.weekly.round.scoring import points_by_format
from research.model.weekly2.board import WeekBoard, week_board
from research.model.weekly2.judge import rate_priors
from research.model.weekly3.gates import ROUND_THREE
from research.model.weekly4.attribution import coalition_points, shapley
from research.model.weekly4.benchmarks import baseline, last_three, points_allowed
from research.model.weekly4.board import SeasonData, Variant, build_board
from research.model.weekly4.features import reads
from research.model.weekly4.features.depth import DepthRule
from research.model.weekly4.features.game import Weather, replay_weather
from research.model.weekly4.features.outcomes import play_rows
from research.model.weekly4.features.season import SeasonSpec, build_season, season_schedule
from research.model.weekly4.gates import ROUND_FOUR
from research.model.weekly4.groups import GROUPS
from research.model.weekly4.history import with_outcomes
from research.model.weekly4.play_model import FORMAT_NAMES, RECEPTION_VALUE, TOUCHDOWN, YARDS_PER_POINT, price
from research.model.weekly4.round_three import candidates
from research.model.weekly4.served import Served
from research.model.weekly4.share_model import week_counts
from research.model.weekly4.simulate import BAND, Simulated, game_seed, simulate_game
from research.model.weekly4.value_allowance import game_values, value_allowances
from research.model.weekly4.why import Facts, chosen_groups, sentence
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource

LAST_WEEK: Final = (
    22  # every week of the season before, the postseason's included in the read and dropped by the plays' rule
)
MAIN_KIND: Final = {"QB": "dropbacks", "RB": "carries", "WR": "targets", "TE": "targets"}
_HISTORY: Final = {"targets": "target", "carries": "carry", "dropbacks": "dropback"}
_VOLUME: Final = {"targets": "team_targets", "carries": "designed_rushes", "dropbacks": "team_dropbacks"}


@dataclass(frozen=True, slots=True)
class RateBoard:
    board: WeekBoard
    rates: pd.DataFrame  # player_id, rate_m_<format>, candidate


def rate_board(
    conn: Connection, season: int, week: int, artifacts: ModelArtifacts, positions: Mapping[str, Position]
) -> RateBoard:
    """Round 3's week board at the week's first instant: the rate m (its record's refit), ADP, recent
    form and the season to date, and the projected set from them."""
    rate = rate_priors(conn, ROUND_THREE, artifacts)
    stale = build_stale_board(conn, season, artifacts, ARM64_BOARDS, ROUND_THREE.rate_round.prior_source)
    board = week_board(
        conn, week_inputs(conn, season, week, stale, positions), stale, positions, rate.priors, ROUND_THREE.adp_source
    )
    chosen = candidates(board, ROUND_FOUR.population)
    rates = pd.DataFrame(
        [
            {
                "player_id": p.player_id,
                **{f"rate_m_{n}": float(p.rate[n]) for n in FORMAT_NAMES},
                "candidate": int(p.player_id in chosen),
            }
            for p in board.players
        ]
    )
    return RateBoard(board, rates)


def season_lines(
    conn: Connection, season: int, week: int, moment: datetime, positions: Mapping[str, Position]
) -> pd.DataFrame:
    """This season's lines of weeks before W as stored at the week's instant, with each line's club."""
    if week <= 1:
        return pd.DataFrame(columns=["week", "player_id", "club", *FORMAT_NAMES])
    span = WeekRange(1, week - 1)
    clubs = {(e.week, e.player_id): e.team for e in player_teams_as_of(conn, season, span, moment)}
    rows = []
    for found in stat_lines_as_of(conn, ObservationQuery(season, span, moment)):
        position = positions.get(found.line.player_id)
        if position is None:
            continue
        key = (found.line.week, found.line.player_id)
        rows.append(
            {"week": key[0], "player_id": key[1], "club": clubs.get(key), **points_by_format(found.line, position)}
        )
    return pd.DataFrame(rows, columns=["week", "player_id", "club", *FORMAT_NAMES])


def own_implied(conn: Connection, season: int, week: int, moment: datetime) -> dict[str, float]:
    """Each club's mean implied points over its games of weeks before W (the spreadsheet's T-own), as
    stored at the instant; the league's mean under "" for a club with none."""
    if week <= 1:
        return {}
    rows = [
        r
        for r in team_observations_as_of(conn, season, WeekRange(1, week - 1), moment, ScheduleSource.KICKOFF)
        if r.metric == ScheduleMetric.IMPLIED_TEAM_TOTAL
    ]
    found: dict[str, list[float]] = {}
    for r in rows:
        found.setdefault(r.team, []).append(r.value)
    means = {club: float(np.mean(v)) for club, v in found.items()}
    if rows:
        means[""] = float(np.mean([r.value for r in rows]))
    return means


def _weather(conn: Connection, season: int, weeks: Sequence[int]) -> dict[str, Weather]:
    found: dict[str, Weather] = {}
    for week in weeks:
        for row in reads.weather(conn, season, week):
            found[row.game_id] = replay_weather(row, None)
    return found


def history_plays(conn: Connection, served: Served, season: int, week: int, until: datetime) -> pd.DataFrame:
    """The plays of the season before and of this season's weeks before W, stamped by the instant,
    priced by the served play model."""
    frames = []
    for s, last in ((season - 1, LAST_WEEK), (season, week - 1)):
        if last < 1:
            continue
        plays = reads.plays(conn, s, last, until)
        rows = play_rows(plays, _weather(conn, s, range(1, last + 1)))
        frames.append(pd.DataFrame(rows))
    found = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if found.empty:
        return found
    return with_outcomes(price(found, served.models.play)).reset_index(drop=True)


def live_data(  # noqa: PLR0913, PLR0917 - the live week's every read, named
    conn: Connection,
    served: Served,
    season: int,
    week: int,
    after: datetime,
    positions: Mapping[str, Position],
    rated: RateBoard,
    depth_rule: DepthRule,
) -> SeasonData:
    """The live week's inputs as one season's data: the rows of the games kicking off after `after`."""
    build, _ = build_season(
        conn, SeasonSpec(season, (week,), (week,), depth_rule, after), {k: str(v) for k, v in positions.items()}, None
    )
    rows = pd.DataFrame(list(build.player_rows)).merge(rated.rates, on="player_id", how="left")
    candidate = rows["candidate"].fillna(0).astype(int)
    rows = rows.assign(
        candidate=candidate,
        lined=0,
        projected=((rows["withheld"] == 0) & (candidate == 1)).astype(int),
    ).reset_index(drop=True)
    teams = pd.DataFrame(list(build.team_rows)).reset_index(drop=True)
    priced = history_plays(conn, served, season, week, after)
    this = priced[priced["season"] == season] if not priced.empty else priced
    counts = week_counts(this) if not this.empty else pd.DataFrame(columns=["season", "week", "club", "player_id"])
    schedule, _ = season_schedule(conn, season)
    pairing = pd.DataFrame(
        [(season, w, c, o) for (w, c), o in schedule.pairing.items()], columns=["season", "week", "club", "opponent"]
    )
    values = game_values(this, {k: str(v) for k, v in positions.items()}) if not this.empty else pd.DataFrame()
    allowances = (
        value_allowances(values, pairing, season, (week,))
        if not values.empty
        else pd.DataFrame(columns=["season", "week", "defence", "position", "kind", "format", "value", "games"])
    )
    return SeasonData(season, rows, teams, priced, counts, allowances)


def _with_flag(flag: float) -> Variant:
    """2.5's mixture: the precipitation flag set to `flag` where the forecast gives a probability."""

    def transform(frame: pd.DataFrame) -> pd.DataFrame:
        q = frame["precipitation_probability"].to_numpy(dtype=float)
        return frame.assign(precipitation=np.where(np.isnan(q), frame["precipitation"].to_numpy(dtype=float), flag))

    return Variant(transform=transform)


@dataclass(frozen=True, slots=True)
class LiveWeek:
    season: int
    week: int
    board: pd.DataFrame  # the mixed points, every row
    bands: Mapping[str, Mapping[str, tuple[float, float, float]]]
    why: Mapping[str, list[dict[str, Any]]]
    benchmarks: Mapping[str, dict[str, Any]]
    kickoffs: Mapping[str, datetime]


def _mixed_simulation(game0: pd.DataFrame, game1: pd.DataFrame, served: Served, run_seed: int, q: float) -> Simulated:
    first = simulate_game(game0, served.dispersion, served.models.constants, run_seed, ROUND_FOUR.draws)
    if q <= 0:
        return first
    second = simulate_game(game1, served.dispersion, served.models.constants, run_seed, ROUND_FOUR.draws)
    row = game0.iloc[0]
    rng = np.random.default_rng(
        game_seed(run_seed, int(row["season"]), int(row["week"]), "precipitation:" + str(row["game_id"]))
    )
    wet = rng.random(ROUND_FOUR.draws) < q
    points = {n: np.where(wet[None, :], second.points[n], first.points[n]) for n in FORMAT_NAMES}
    return Simulated(first.players, first.positions, first.clubs, points, first.noise, points)


def _facts(row: pd.Series, rank: int | None) -> Facts:
    kind = MAIN_KIND.get(str(row["position"]), "targets")
    history = _HISTORY[kind]
    volume = float(row[_VOLUME[kind]])
    n = float(row[f"{history}_n"])
    per_100 = _efficiency_per_opportunity(row, history) * 100.0
    return Facts(
        position=str(row["position"]),
        opponent=str(row["opponent"]),
        opponent_rank=rank,
        home=float(row["home"]),
        rest_days=float(row["rest_days"]),
        implied_points=float(row["implied_points"]),
        spread=float(row["spread"]),
        roof=None if pd.isna(row["roof"]) else str(row["roof"]),
        wind_mph=float(row["wind_mph"]),
        temperature_f=float(row["temperature_f"]),
        precipitation=float(np.nan_to_num(row["precipitation"])),
        precipitation_probability=None
        if pd.isna(row["precipitation_probability"])
        else float(row["precipitation_probability"]),
        vacated_count=int(row["vacating_teammates"]),
        vacated_volume=float(row[f"vacated_{kind}"]) * volume,
        returning_count=int(row["returning_teammates"]),
        returning_volume=float(row[f"returning_{kind}"]) * volume,
        kind=kind,
        share_last_three=float(row[f"share_last_three_{kind}"]),
        share_season=float(row[f"share_season_{kind}"]),
        efficiency_per_100=per_100,
        efficiency_sample=round(n),
        efficiency_kind=kind,
    )


def _efficiency_per_opportunity(row: pd.Series, history: str) -> float:
    """His shrunk points over expected per opportunity of his main kind (PPR, touchdowns included)."""
    if history == "target":
        catch = (float(row["target_catch_factor"]) - 1.0) * float(row["target_wx_catch"]) * RECEPTION_VALUE["ppr"]
        td = (float(row["target_td_factor"]) - 1.0) * float(row["target_wx_td"]) * TOUCHDOWN
        return catch + float(row["target_yoe"]) / YARDS_PER_POINT + td
    if history == "carry":
        td = (float(row["carry_td_factor"]) - 1.0) * float(row["carry_wx_td"]) * TOUCHDOWN
        return float(row["carry_yoe"]) / YARDS_PER_POINT + td
    return float(row["dropback_yoe"]) / 25.0


def _ranks(data: SeasonData) -> dict[tuple[str, str], int]:
    """Each defence's rank among the week's by its value allowance to the position's main kind (1: most)."""
    found: dict[tuple[str, str], int] = {}
    table = data.allowances[data.allowances["format"] == "ppr"]
    for position, kind in MAIN_KIND.items():
        mine = table[(table["position"] == position) & (table["kind"] == _HISTORY[kind])].sort_values(
            "value", ascending=False
        )
        for rank, defence in enumerate(mine["defence"], start=1):
            found[(str(defence), position)] = rank
    return found


def live_week(  # noqa: PLR0913, PLR0917 - the live week in its order
    conn: Connection,
    served: Served,
    data: SeasonData,
    rated: RateBoard,
    lines: pd.DataFrame,
    positions: Mapping[str, Position],
    run_seed: int,
) -> LiveWeek:
    """The week's mixed points, ranges, why lines and benchmarks."""
    m = served.models
    dry, wet = (
        build_board(data, m, served.shared, _with_flag(0.0)),
        build_board(data, m, served.shared, _with_flag(1.0)),
    )
    q = np.nan_to_num(data.rows["precipitation_probability"].to_numpy(dtype=float))
    board = dry.copy()
    for name in FORMAT_NAMES:
        board[f"point_{name}"] = q * wet[f"point_{name}"].to_numpy() + (1 - q) * dry[f"point_{name}"].to_numpy()
    bands: dict[str, dict[str, tuple[float, float, float]]] = {}
    for game_id, game in board.groupby("game_id", sort=True):
        game_q = float(np.nanmax(q[game.index])) if len(game) else 0.0
        simulated = _mixed_simulation(dry.loc[game.index], wet.loc[game.index], served, run_seed, game_q)
        pct = {n: np.percentile(simulated.points[n], BAND, axis=1) for n in FORMAT_NAMES}
        for i, pid in enumerate(simulated.players):
            bands[pid] = {n: (float(pct[n][0][i]), float(pct[n][1][i]), float(pct[n][2][i])) for n in FORMAT_NAMES}
        del game_id
    values_dry = coalition_points(data, m, served.shared, _with_flag(0.0).transform)
    values_wet = coalition_points(data, m, served.shared, _with_flag(1.0).transform)
    ppr = {s: q * values_wet[s]["ppr"] + (1 - q) * values_dry[s]["ppr"] for s in values_dry}
    attributions = shapley(ppr)
    ranks = _ranks(data)
    schedule, _ = season_schedule(conn, data.season)
    pairing = pd.DataFrame([(w, c, o) for (w, c), o in schedule.pairing.items()], columns=["week", "club", "opponent"])
    week = int(data.rows["week"].iloc[0])
    own = own_implied(
        conn, data.season, week, min(kickoff for kickoff in data.rows["instant"].map(datetime.fromisoformat))
    )
    form = rated.board.form
    adp = rated.board.adp
    allowed = points_allowed(lines, pairing, {k: str(v) for k, v in positions.items()}, week)
    three = last_three(lines, week)
    why: dict[str, list[dict[str, Any]]] = {}
    benchmarks: dict[str, dict[str, Any]] = {}
    ordered = board.reset_index(drop=True)
    for index in range(len(ordered)):
        row = ordered.iloc[index]
        if int(row["projected"]) != 1 or not np.isfinite(row["point_ppr"]):
            continue
        pid = str(row["player_id"])
        contributions = {g: float(attributions[g][index]) for g in GROUPS}
        facts = _facts(row, ranks.get((str(row["opponent"]), str(row["position"]))))
        why[pid] = [
            {"group": g, "points": contributions[g], "text": sentence(g, facts), "read_at": str(row["instant"])}
            for g in chosen_groups(contributions)
        ]
        own_form = form.get(pid)
        benchmarks[pid] = {
            "adp": adp.get(pid),
            "form": None if own_form is None else dict(own_form),
            "last_three": three.get(pid),
            "baseline": baseline(
                own_form,
                allowed.get((str(row["opponent"]), str(row["position"])), 1.0),
                float(row["implied_points"]),
                own.get(str(row["club"]), own.get("", float(row["implied_points"]))),
            ),
            "neutral_ppr": float(values_dry[frozenset()]["ppr"][index]),
        }
    kickoffs = {str(g): datetime.fromisoformat(str(t)) for g, t in zip(board["game_id"], board["instant"], strict=True)}
    return LiveWeek(data.season, int(data.rows["week"].iloc[0]), board, bands, why, benchmarks, kickoffs)


_INSERT: Final = text(
    "insert into research.register_weekly_rows (season, week, game_id, frozen_at, model_version, player_id, implementation, "
    "kickoff_at, club, counted, questionable, "
    + ", ".join(f"{p}_{n}" for n in FORMAT_NAMES for p in ("point", "floor", "median", "ceiling"))
    + ", why, benchmarks) values (:season, :week, :game_id, :frozen_at, :model_version, :player_id, :implementation, "
    ":kickoff_at, :club, :counted, :questionable, "
    + ", ".join(f":{p}_{n}" for n in FORMAT_NAMES for p in ("point", "floor", "median", "ceiling"))
    + ", cast(:why as jsonb), cast(:benchmarks as jsonb))"
)


def freeze_rows(live: LiveWeek, frozen_at: datetime, model_version: str, counted: bool) -> list[dict[str, Any]]:
    """The register rows of every projected player with a number in a game still to kick off."""
    rows: list[dict[str, Any]] = []
    for _, row in live.board.iterrows():
        pid = str(row["player_id"])
        kickoff = live.kickoffs[str(row["game_id"])]
        if pid not in live.why or pid not in live.bands or kickoff <= frozen_at:
            continue
        found: dict[str, Any] = {
            "season": live.season,
            "week": live.week,
            "game_id": str(row["game_id"]),
            "frozen_at": frozen_at,
            "model_version": model_version,
            "player_id": pid,
            "implementation": IMPLEMENTATION,
            "kickoff_at": kickoff,
            "club": str(row["club"]),
            "counted": counted,
            "questionable": bool(row["questionable"]),
            "why": json.dumps(live.why[pid]),
            "benchmarks": json.dumps(live.benchmarks[pid], default=float),
        }
        for name in FORMAT_NAMES:
            floor, median, ceiling = live.bands[pid][name]
            found |= {
                f"point_{name}": float(row[f"point_{name}"]),
                f"floor_{name}": floor,
                f"median_{name}": median,
                f"ceiling_{name}": ceiling,
            }
        rows.append(found)
    return rows


def record(conn: Connection, rows: Sequence[Mapping[str, Any]]) -> int:
    """A plain insert, no conflict clause: a second freeze at an instant is refused by the key."""
    for row in rows:
        conn.execute(_INSERT, dict(row))
    return len(rows)
