"""THE CLUB-GAME ROWS: round 4's team row of each club-game (its instant, game figure, weather and the
team model's inputs) with this sub-round's features at that instant (`features.MomentView`), and its
outcomes beside it for the fit and the grading.

A row is club C's offense against club D's defense. Its outcome columns (`d_` for D's week): the points C
scored (D's points allowed), D's sacks, takeaways, touchdowns, return touchdowns, safeties, blocks and yards allowed, C's
field-goal attempts in each distance band and blocked, its touchdown tries (extra points and two-point
tries), and the realised points of D's defense and of C's projected kicker under the judged scoring.

B132 L1: each row counts whether a week before W that the week tables hold for D or for C was not yet
admitted at t_g (its Wednesday pass came after the instant), `lost_prior_week`.
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

import numpy as np
import pandas as pd

from research.model.weekly_kdef import scoring
from research.model.weekly_kdef.exposure import exposure_view
from research.model.weekly_kdef.features import LeaguePriors, MomentView
from research.model.weekly_kdef.reads import MomentInputs, SeasonInputs, SeasonOutcomes
from research.model.weekly_kdef.scoring import FG_BANDS
from research.model.weekly_kdef.tallies import Implied, tally_of
from research.pipeline.nflverse.team_eras import season_code

DENVER: Final = "DEN"
POINTS_CAP: Final = 60
# D's week, as the row's outcome columns: prefixed, since the store's team row carries C's own `sacks`.
DEFENSE_OUTCOME_PREFIX: Final = "d_"  # 60 plus is one cell of the points distribution (design 5.2)
_NAMES: Final = {
    "0_19": "0_19",
    "20_29": "20_29",
    "30_39": "30_39",
    "40_49": "40_49",
    "50_59": "50_59",
    "60_plus": "60",
}


def implied_lookup(teams: pd.DataFrame) -> Implied:
    """(season, week, club) -> the club's implied points from the store's rows; a club spelled in a later
    season's code (a season-before row) is respelled to its own season's."""
    found = {
        (int(s), int(w), str(c)): float(v)
        for s, w, c, v in zip(teams["season"], teams["week"], teams["club"], teams["implied_points"], strict=True)
        if np.isfinite(v)
    }

    def implied(season: int, week: int, club: str) -> float | None:
        return found.get((season, week, season_code(season, club)))

    return implied


def _keyed(rows: Sequence[Any]) -> list[tuple[int, int, Mapping[str, Any]]]:
    return [(r.season, r.week, r.values) for r in rows]


def _view(inputs: SeasonInputs, moment: MomentInputs, priors: LeaguePriors, implied: Implied) -> MomentView:
    tally = tally_of(
        [*_keyed(inputs.prior_defense), *_keyed(moment.defense)],
        [*_keyed(inputs.prior_kicking), *_keyed(moment.kicking)],
        [*_keyed(inputs.prior_kicks), *_keyed(moment.kicks)],
        implied,
    )
    return MomentView(tally, inputs.season, priors)


def _venue(row: Mapping[str, Any]) -> dict[str, float]:
    home = float(row["home"]) if row["home"] is not None and np.isfinite(row["home"]) else 0.5
    denver = (row["club"] == DENVER and home > 0.5) or (row["opponent"] == DENVER and home < 0.5)  # noqa: PLR2004
    surface = row.get("surface")
    grass = np.nan if surface is None or pd.isna(surface) else float("grass" in str(surface).lower())
    return {"denver": float(denver), "grass": grass}


def _held(outcomes: SeasonOutcomes) -> tuple[dict[str, set[int]], dict[str, set[int]]]:
    defense: dict[str, set[int]] = defaultdict(set)
    kicking: dict[str, set[int]] = defaultdict(set)
    for r in outcomes.defense:
        defense[str(r["team"])].add(int(r["week"]))
    for r in outcomes.kicking:
        kicking[str(r["team"])].add(int(r["week"]))
    return defense, kicking


def lost_a_prior_week(week: int, held: set[int], admitted: set[int]) -> bool:
    return any(w < week and w not in admitted for w in held)


def _points_by_unit(rows: Sequence[Any], key: str, score: Any) -> dict[str, tuple[int, float]]:
    """Per unit, (games, total judged points) over the rows."""
    found: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        found[str(r.values[key])].append(float(score(r.values)))
    return {unit: (len(points), float(sum(points))) for unit, points in found.items()}


def _defense_score(values: Mapping[str, Any]) -> float:
    found = _defense_outcome(values)
    return float(scoring.defense_points({k: np.array([found[k]]) for k in scoring.DEFENSE_COMPONENTS})[0])


def _kicker_score(values: Mapping[str, Any]) -> float:
    found = _kicking_outcome(values)
    return float(scoring.kicker_points({k: np.array([found[k]]) for k in scoring.KICKER_COMPONENTS})[0])


@dataclass(frozen=True, slots=True)
class Form:
    """Recent form (item 9): points a game this season before W under the judged scoring, else last
    season's; None with neither."""

    defense: Mapping[str, tuple[int, float]]
    kicker: Mapping[str, tuple[int, float]]
    prior_defense: Mapping[str, tuple[int, float]]
    prior_kicker: Mapping[str, tuple[int, float]]

    @staticmethod
    def _of(this: Mapping[str, tuple[int, float]], last: Mapping[str, tuple[int, float]], unit: str | None) -> float:
        for found in (this, last):
            games, total = found.get(str(unit), (0, 0.0))
            if unit is not None and games > 0:
                return total / games
        return float("nan")

    def of_defense(self, club: str) -> float:
        return self._of(self.defense, self.prior_defense, club)

    def of_kicker(self, kicker: str | None) -> float:
        return self._of(self.kicker, self.prior_kicker, kicker)


def _form(inputs: SeasonInputs, moment: MomentInputs) -> Form:
    return Form(
        _points_by_unit(moment.defense, "team", _defense_score),
        _points_by_unit(moment.kicking, "player_id", _kicker_score),
        _points_by_unit(inputs.prior_defense, "team", _defense_score),
        _points_by_unit(inputs.prior_kicking, "player_id", _kicker_score),
    )


def feature_rows(
    teams: pd.DataFrame, inputs: SeasonInputs, outcomes: SeasonOutcomes, priors: LeaguePriors, implied: Implied
) -> pd.DataFrame:
    """The season's club-game rows with their features at their instants."""
    held_defense, held_kicking = _held(outcomes)
    found: list[dict[str, Any]] = []
    for (key_week, moment), group in teams.groupby(["week", "instant"], sort=True):
        week = int(str(key_week))
        inputs_at = inputs.moments[(week, datetime.fromisoformat(str(moment)))]
        view = _view(inputs, inputs_at, priors, implied)
        admitted_defense = {(str(r.values["team"]), r.week) for r in inputs_at.defense}
        admitted_kicking = {(str(r.values["team"]), r.week) for r in inputs_at.kicking}
        form = _form(inputs, inputs_at)
        exposure = exposure_view(view.tally, inputs_at.plays.tally)
        for record in group.to_dict("records"):
            row = {str(k): v for k, v in record.items()}
            club, opponent = str(row["club"]), str(row["opponent"])
            lost = lost_a_prior_week(
                week, held_defense[opponent], {w for c, w in admitted_defense if c == opponent}
            ) or lost_a_prior_week(week, held_kicking[club], {w for c, w in admitted_kicking if c == club})
            features = view.row(club, opponent, inputs_at.withheld, inputs_at.filed)
            features |= inputs_at.plays.of(club, opponent) | exposure.of(club, opponent)
            found.append(
                {
                    **row,
                    **features,
                    **_venue(row),
                    "lost_prior_week": float(lost),
                    "form_defense": form.of_defense(opponent),
                    "form_kicker": form.of_kicker(features["kicker_id"]),
                }
            )
    return pd.DataFrame(found)


def _defense_outcome(r: Mapping[str, Any]) -> dict[str, float]:
    def n(name: str) -> float:
        return 0.0 if r.get(name) is None else float(r[name])

    return {
        "points_allowed": min(n("points_allowed"), float(POINTS_CAP))
        if r.get("points_allowed") is not None
        else np.nan,
        "points_allowed_raw": n("points_allowed") if r.get("points_allowed") is not None else np.nan,
        "yards_allowed": n("passing_yards_allowed") + n("rushing_yards_allowed"),
        "sacks": n("def_sacks"),
        "interceptions": n("def_interceptions"),
        "fumble_recoveries": n("fumble_recovery_opp"),
        "defensive_touchdowns": n("def_tds"),
        "return_touchdowns": n("special_teams_tds"),
        "safeties": n("def_safeties"),
        "blocks": n("def_punt_blocks") + n("def_pat_blocks") + n("def_fg_blocks"),
    }


def _kicking_outcome(r: Mapping[str, Any]) -> dict[str, float]:
    found = {f"fg_made_{b}": float(r[f"fg_made_{_NAMES[b]}"]) for b in FG_BANDS}
    found |= {f"fg_missed_{b}": float(r[f"fg_missed_{_NAMES[b]}"]) for b in FG_BANDS}
    found |= {
        "fg_blocked": float(r["fg_blocked"]),
        "xp_made": float(r["pat_made"]),
        "xp_missed": float(r["pat_missed"]) + float(r["pat_blocked"]),
        "fg_att": float(r["fg_att"]),
        "pat_att": float(r["pat_att"]),
    }
    return found


def outcome_columns(rows: pd.DataFrame, outcomes: SeasonOutcomes) -> pd.DataFrame:
    """Each row's outcomes: D's defense week, C's club kicking (summed over its kickers), C's projected
    kicker's own line (his realised points, NaN without a line), and C's two-point tries."""
    defense = {(int(r["week"]), str(r["team"])): _defense_outcome(r) for r in outcomes.defense}
    club: dict[tuple[int, str], dict[str, float]] = defaultdict(lambda: defaultdict(float))
    kicker: dict[tuple[int, str], dict[str, float]] = {}
    for r in outcomes.kicking:
        line = _kicking_outcome(r)
        for name, value in line.items():
            club[(int(r["week"]), str(r["team"]))][name] += value
        kicker[(int(r["week"]), str(r["player_id"]))] = line
    two: dict[tuple[int, str], float] = defaultdict(float)
    for r in outcomes.kicks:
        if r.get("two_point_conv_result") is not None and r.get("posteam") is not None:
            two[(int(r["week"]), str(r["posteam"]))] += 1.0
    out: list[dict[str, float]] = []
    for week, offense, defending, kid in zip(
        rows["week"], rows["club"], rows["opponent"], rows["kicker_id"], strict=True
    ):
        d = defense.get((int(week), str(defending)), {})
        c = club.get((int(week), str(offense)), {})
        own = kicker.get((int(week), str(kid))) if kid is not None and not pd.isna(kid) else None
        found: dict[str, float] = {
            f"{DEFENSE_OUTCOME_PREFIX}{name}": d.get(name, np.nan)
            for name in ("points_allowed", "points_allowed_raw", "yards_allowed", *scoring.DEFENSE_COUNTS)
        }
        found |= {f"club_fg_{b}": c.get(f"fg_made_{b}", 0.0) + c.get(f"fg_missed_{b}", 0.0) for b in FG_BANDS}
        found |= {
            "club_fg_att": c.get("fg_att", 0.0),
            "club_td_tries": c.get("pat_att", 0.0) + two.get((int(week), str(offense)), 0.0),
            "has_defense_line": float(bool(d)),
            "has_kicker_line": float(own is not None),
        }
        found["defense_points"] = (
            float(scoring.defense_points({k: np.array([d[k]]) for k in scoring.DEFENSE_COMPONENTS})[0]) if d else np.nan
        )
        drawn = {k: np.array([own[k]]) for k in scoring.KICKER_COMPONENTS} if own else None
        found["kicker_points"] = float(scoring.kicker_points(drawn)[0]) if drawn else np.nan
        found["kicker_points_flat"] = (
            float(scoring.kicker_points(drawn, fg_points=scoring.FLAT_FG_POINTS)[0]) if drawn else np.nan
        )
        out.append(found)
    return pd.concat([rows.reset_index(drop=True), pd.DataFrame(out)], axis=1)
