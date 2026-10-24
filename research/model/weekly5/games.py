"""EACH PLAYER'S GAME, REALISED, FROM THE PLAY TABLE (preregistration 2.5, "Where each realised quantity is
read").

One row per (season, week, club, player) with plays: every tree target, every realised rate's numerator
and opportunity of 2.4, and the realised shares and conversion weights of 2.6 and 2.7, read from the
store's play rows (round 4's `features/outcomes.play_rows` under `plays.py`'s opportunity rule: a target
is `is_target`, a carry `is_designed_rush`, a dropback `qb_dropback` credited to the passer or on a
scramble the rusher; two-point tries, kneels, spikes and special teams are no play).

- A reception is a target with `complete_pass`; receiving yards the yards of his completed targets.
- A carry is a designed rush with him as rusher, plus, for a quarterback, his scrambles. The store's play
  rows carry no `qb_scramble` flag; a scramble is round 4's `play_model.scramble` (a dropback with no sack,
  no completion and no interception that gained yards or scored), the rule round 4's play model and
  simulation used (a reading: a scramble for no gain and no score reads as an incompletion).
- A pass attempt is a dropback credited to him that is neither a sack nor a scramble; its passing yards,
  interceptions and passing touchdowns are its completed yards, its interception and its touchdown on a
  completion.
- xFP per target and per carry are the plays' stored PPR prices (the play model fitted before the season),
  FPOE the PPR points over them (`play_model.actual_points`).
- The realised red-zone and inside-ten shares are his opportunities (targets plus designed rushes) from the
  20 and the 10 over his club's in the game; his dropback share his dropbacks over the club's; the
  conversion weights u = the club's realised touchdowns of the kind x his realised share (2.6, 2.7).
"""

from collections.abc import Mapping
from typing import Final

import numpy as np
import pandas as pd

from research.model.weekly4.features.plays import INSIDE_TEN_YARDS, RED_ZONE_YARDS
from research.model.weekly4.play_model import actual_points, scramble
from research.model.weekly4.share_model import realised_shares, week_counts

KEY: Final = ["season", "week", "club", "player_id"]
SUMMED: Final = (
    "targets",
    "receptions",
    "receiving_yards",
    "receiving_touchdowns",
    "designed",
    "designed_yards",
    "designed_touchdowns",
    "dropbacks",
    "sacks",
    "scrambles",
    "scramble_yards",
    "scramble_touchdowns",
    "pass_attempts",
    "passing_yards",
    "interceptions",
    "passing_touchdowns",
    "xfp_target",
    "fp_target",
    "xfp_carry",
    "fp_carry",
    "red_zone",
    "inside_ten",
)


def _flag(plays: pd.DataFrame, name: str) -> np.ndarray:
    return plays[name].fillna(0.0).to_numpy(dtype=float)


def play_columns(priced: pd.DataFrame) -> pd.DataFrame:
    """Each play row's contribution to its player's game (the `SUMMED` columns)."""
    kind = priced["kind"].to_numpy()
    target, carry, dropback = kind == "target", kind == "carry", kind == "dropback"
    complete, touchdown = _flag(priced, "complete_pass"), _flag(priced, "touchdown")
    yards = priced["yards_gained"].fillna(0.0).to_numpy(dtype=float)
    sack, interception = _flag(priced, "sack"), _flag(priced, "interception")
    scrambled = scramble(priced).to_numpy(dtype=float) * dropback
    attempt = dropback * (1.0 - sack) * (1.0 - scrambled)
    yard = priced["yardline_100"].to_numpy(dtype=float, na_value=np.nan)
    opportunity = (target | carry).astype(float)
    fp = actual_points(priced)["fp_ppr"].to_numpy(dtype=float)
    xfp = priced["xfp_ppr"].to_numpy(dtype=float) if "xfp_ppr" in priced else np.zeros(len(priced))
    found = {
        "targets": target * 1.0,
        "receptions": target * complete,
        "receiving_yards": target * complete * yards,
        "receiving_touchdowns": target * touchdown,
        "designed": carry * 1.0,
        "designed_yards": carry * yards,
        "designed_touchdowns": carry * touchdown,
        "dropbacks": dropback * 1.0,
        "sacks": dropback * sack,
        "scrambles": scrambled,
        "scramble_yards": scrambled * yards,
        "scramble_touchdowns": scrambled * touchdown,
        "pass_attempts": attempt,
        "passing_yards": attempt * complete * yards,
        "interceptions": attempt * interception,
        "passing_touchdowns": attempt * complete * touchdown,
        "xfp_target": target * xfp,
        "fp_target": target * fp,
        "xfp_carry": carry * xfp,
        "fp_carry": carry * fp,
        "red_zone": opportunity * np.nan_to_num(yard <= RED_ZONE_YARDS),
        "inside_ten": opportunity * np.nan_to_num(yard <= INSIDE_TEN_YARDS),
    }
    keys = priced[["season", "week", "posteam", "player_id"]].rename(columns={"posteam": "club"})
    return keys.assign(**{k: np.asarray(v, dtype=float) for k, v in found.items()})


def player_games(priced: pd.DataFrame, teams: pd.DataFrame, positions: Mapping[str, str]) -> pd.DataFrame:
    """Each player's realised game: the summed play columns, his position's carries, rushing yards and
    rushing touchdowns (a quarterback's scrambles among them), his realised shares and the conversion
    weights from his club's realised touchdowns (the team rows)."""
    rows = play_columns(priced[priced["player_id"].notna()])
    games = rows.groupby(KEY, as_index=False)[list(SUMMED)].sum()
    games = games.assign(position=games["player_id"].map(positions))
    games = games[games["position"].notna()].reset_index(drop=True)
    qb = (games["position"] == "QB").to_numpy(dtype=float)
    # Round 4's realised shares: his opportunities over his club's, every player's counted (a fullback's too).
    realised = realised_shares(games, week_counts(priced[priced["player_id"].notna()]))

    def share(kind: str) -> np.ndarray:
        found: np.ndarray = realised[f"y_{kind}"].to_numpy(dtype=float)
        return found

    touchdowns = games[["season", "week", "club"]].merge(
        teams[["season", "week", "club", "rushing_touchdowns", "receiving_touchdowns"]],
        on=["season", "week", "club"],
        how="left",
    )
    s = 0.5 * share("red_zone") + 0.5 * share("inside_ten")
    dropback_share = share("dropbacks")
    rush_td = touchdowns["rushing_touchdowns"].fillna(0.0).to_numpy(dtype=float)
    rec_td = touchdowns["receiving_touchdowns"].fillna(0.0).to_numpy(dtype=float)
    return games.assign(
        carries=games["designed"] + qb * games["scrambles"],
        rushing_yards=games["designed_yards"] + qb * games["scramble_yards"],
        rushing_touchdowns=games["designed_touchdowns"] + qb * games["scramble_touchdowns"],
        touchdown_share=s,
        dropback_share=dropback_share,
        u_rush=rush_td * s,
        u_receiving=rec_td * s,
        u_passing=rec_td * dropback_share,
    )


def lined_games(
    games: pd.DataFrame,
    lines: pd.DataFrame,
    positions: Mapping[str, str],
    fumbles: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Every lined player-game (a week-W line) of a player with a position, his realised game beside it
    (zeros with no play), and his line's fumbles lost where read. A line names his club."""
    keys = lines[["season", "week", "player_id", "club"]].drop_duplicates(["season", "week", "player_id"])
    keys = keys.assign(position=keys["player_id"].map(positions))
    keys = keys[keys["position"].notna()]
    found = keys.merge(games.drop(columns=["club", "position"]), on=["season", "week", "player_id"], how="left")
    numeric = [c for c in games.columns if c not in {"season", "week", "club", "player_id", "position"}]
    found[numeric] = found[numeric].fillna(0.0)
    if fumbles is not None:
        found = found.merge(fumbles, on=["season", "week", "player_id"], how="left")
        found["fumbles_lost"] = found["fumbles_lost"].fillna(0.0)
    return found.reset_index(drop=True).assign(games=1.0)
