# Does QB throw quality move receiver scoring? An exploratory read — 2026-09-05

**EXPLORATORY. Hypothesis-generation only.** This document changes nothing in the model. Any finding here becomes a registered law only by passing through the law-discovery harness (`scripts/discover-laws.ts`), which applies its own multiple-comparisons control. Every number below is labeled with the season(s) and source it came from.

## Data reality — read this before the numbers below

The brief asked for 2018-2025 team-seasons. This production database does not hold that range. `nflverse_player_week` (real published box scores) covers ONLY 2023 and 2024. 2025 exists only via the pbp-derived gap-season fallback (yards/TDs/INTs/receptions only — no attempts, no completions, no targets). 2026 is the live season and is never read here. **Every result below is scoped to 2023-2025, not 2018-2025**, and is correspondingly small-N.

There is also no reliable historical player-to-team mapping in this database. `player_week_teams` and `nfl_draft_picks` are both EMPTY (verified by direct row count). `preseason_rosters` covers only the live 2026 season. `nfl_players.latest_team` — the one populated team field — is the player's CURRENT (2026) team; applying it to 2024 produced team pass-attempt totals from 54 (Miami) to 903 (Cincinnati, five merged 'Bengals' QBs) against a real range of roughly 450-650, and was rejected as unusable.

Team rosters for 2023 and 2024 (ONLY) are instead reconstructed from the `team_pass_attempts` / `team_targets` / `team_carries` fingerprint nflverse's real historical roster produces on every player's own weekly row (see `reconstructSeasonTeams` in the script for the exact method and why a naive transitive join collapses the league into one component). 2025 carries no such fingerprint and is used ONLY as an outcome season (a receiver's own next-season PPG needs no team information at all).

Team-seasons reconstructed and passing the plausibility gate (attempts in [400, 800], primary passer >= 150 attempts): 58 kept, 6 dropped as implausible, across 2 seasons.

Age is never derived: `nfl_players` carries no birth date or age column. Documented as missing, not imputed, per the brief.

## The leave-one-out QB metric, exactly as computed

For a team-season and a specific qualifying (40+ target) receiver on it:

```
leaveOneOutANYA = (TeamPassYards - Receiver.receivingYards
                   + 20*(TeamPassTD - Receiver.receivingTouchdowns)
                   - 45*TeamInterceptions)
                  / (TeamAttempts - Receiver.targets)
```

Team totals are summed across every reconstructed teammate whose position is QB (backup snaps included; a trick-play pass thrown by a non-QB is not captured — a small, named undercount). The receiver's own catches are removed from the passing side and his own targets from the attempts side (a target consumes one attempt) — this is the circularity control: a receiver's own big season cannot inflate the number later used to predict that same receiver's own next season. Interceptions are never receiver-adjusted (not attributable to one target).

## Main regression: next-season PPG ~ own PPG + target share + leave-one-out ANY/A

Fit on every 2023 and 2024 qualifying receiver-season with a computable target share and a real next-season outcome (2024 and 2025 respectively) — n = 172. This is the full available sample, not a held-out split: with only two transition-years in the store, there was not enough data left to hold a further slice out. The regression is OLS via the normal equations; the CI on the ANY/A coefficient is a paired (row) bootstrap, 2000 resamples.

| Model | own PPG coef | target share coef | ANY/A coef | R2 |
|---|---|---|---|---|
| Control only (own PPG + target share) | 0.411 | 15.889 | — | 0.482 |
| Full (+ leave-one-out ANY/A) | 0.404 | 16.338 | 0.139 | 0.483 |

**Headline coefficient: 0.139 PPG per 1.0 of leave-one-out ANY/A** (bootstrap 95% CI [-0.32, 0.57]), n = 172. R2 delta over the control-only model: 0.001.

**Read with real caution.** n = 172 receiver-seasons is far below what this design was written for (multi-year, multi-season transitions across 2018-2024). A CI this wide relative to the point estimate should not be read as "real" without the harness's own multiple-comparisons pass, which this document explicitly defers to.

## Robustness (a): same-QB-next-season vs all transitions

Classifiable only for the 2023->2024 transition (2025 has no reconstructed team, so a receiver's 2025 QB identity is unknown to this script) — n = 69 classifiable, of which 31 kept the same primary passer into the next season.

| Slice | n | ANY/A coefficient |
|---|---|---|
| Same primary passer next season | 31 | -1.238 |
| All classifiable transitions | 69 | -0.083 |

These two coefficients disagree with each other AND with the full-sample headline coefficient above (sign flips included) — at n = 31 and n = 69, a four-predictor OLS is not well-anchored, and this split should be read as evidence the finding is unstable at this sample size, not as a second confirmation of anything.

## Robustness (b): exclude receiver-seasons under 8 games

n = 170 (of 172) after the games filter.

ANY/A coefficient on this slice: 0.145.

## Robustness (c): the QB-change event study (2023->2024 transition only)

Among classifiable receivers, 38 saw their primary passer change into the next season and 31 did not. Of the 38 QB-change cases, 27 were STILL a 40+-target qualifying receiver the following season (needed to compute their new QB's own leave-one-out efficiency) — this is a further-narrowed sub-slice, named as such.

| Split | n | Mean receiver PPG delta (next season vs the QB-change season) |
|---|---|---|
| New QB situation MORE efficient (ANY/A rose) | 16 | -1.57 |
| New QB situation LESS efficient (ANY/A fell or flat) | 11 | -1.59 |

Both arms clear a minimal size, though still small — read as directional, not confirmatory.

## The sophomore-QB read (item 4) — DESCRIPTIVE ONLY, not causal

Team-seasons (2023 or 2024) where the reconstructed primary passer was a rookie that year, with a qualifying WR1 (highest targets among 40+-target receivers) whose following-season outcome is known: n = 7. This is small by construction — say so, not hide it.

| Rookie QB (season) | WR1 | Rookie-year PPG | Sophomore-year PPG | Delta |
|---|---|---|---|---|
| Will Levis (2023) | DeAndre Hopkins | 13.2 | 9.2 | -4.0 |
| Bryce Young (2023) | Adam Thielen | 13.5 | 13.9 | +0.5 |
| C.J. Stroud (2023) | Nico Collins | 17.2 | 17.6 | +0.3 |
| Caleb Williams (2024) | DJ Moore | 13.9 | 9.9 | -4.0 |
| Jayden Daniels (2024) | Terry McLaurin | 15.8 | 11.4 | -4.3 |
| Bo Nix (2024) | Courtland Sutton | 15.0 | 12.8 | -2.2 |
| Drake Maye (2024) | DeMario Douglas | 9.2 | 6.0 | -3.2 |

Mean delta: -2.42 PPG. Spread (sample stdev): 2.04.

## Dart + Nabers (item 5)

NOTE ON METHOD: unlike the main regression (which sums every reconstructed teammate QB), this single-case number uses ONLY Dart's own individual passing line as 'team passing production' — 2025 has no team fingerprint to reconstruct a Giants roster from, so any other quarterback who played for New York in 2025 is simply not summed in. If New York used a real committee that season, this understates true team volume; it does not affect the leave-one-out subtraction of Nabers' own line, which is exact.

Jaxson Dart (`00-0040691`) 2025 games with a recorded stat line: 14. Passing: 2272 yards, 15 TD, 5 INT (sourced from the pbp-derived 2025 fallback — the only source this season has; pass attempts are NOT available for 2025 in this database, so a true ANY/A cannot be computed for any 2025 quarterback, Dart included).

Malik Nabers (`00-0039337`) 2025: 4 games, 271 receiving yards, 2 TD, 35 targets (pbp-derived target count).

Leave-one-out ANY/G (yards + 20*TD - 45*INT, per game, Nabers' own receiving line removed): 145.43.

Reference distribution: the identical ANY/G-style leave-one-out metric computed for every plausible 2023/2024 team-season's primary passer against that team's own top-target qualifying WR1 (n = 58).

Dart's percentile within that reference distribution: 45th.

**What this would imply for 2026, with the uncertainty stated plainly:** IF the main regression's coefficient (0.139 PPG per 1.0 ANY/A, CI [-0.32, 0.57]) is real — which a CI this wide on an n this small does not establish — and IF Dart's leave-one-out efficiency sits where the percentile above places him, the sophomore-QB descriptive above (itself n too small to generalize) would be the closer analogue for what a second-year quarterback's improvement typically does to his WR1's scoring. This is NOT a projection change. It is an exploratory implication, gated on two separately small-N, non-causal reads, and enters the model only if the law-discovery harness independently confirms it.

## Limitations that most threaten these findings, ranked

1. **Season coverage.** Three seasons (2023-2025), not the requested 2018-2025 — the single biggest threat to every number above generalizing at all.
2. **Team reconstruction, not ground truth.** The fingerprint method is verified sound in spot checks (Mahomes/Allen correctly separate; cluster sizes match real skill-position roster counts) but is inference, not a stored fact — a mid-season trade inside a receiver's own cluster, or a fingerprint collision the plausibility gate missed, would silently mis-group a team-season rather than error loudly.
3. **The leave-one-out approximation.** Removing a receiver's targets from team attempts and his catches from team yards/TDs approximates his 'share' rather than measuring it play-by-play; backup-QB and non-QB trick-play production is a further small, uncorrected gap.
4. **N throughout.** The main regression (n as reported above), the event study (single-digit arms), and the sophomore descriptive (single digits) are all far below a size that should move confidence on their own — every one of them is exactly the kind of finding the law-discovery harness's multiple-comparisons control exists to guard against over-reading.
5. **Dart's own number uses a different unit (ANY/G, not ANY/A)** than the regression's headline coefficient, because 2025 has no attempts data — the percentile placement is internally consistent (same metric on both sides) but is not the same metric the regression's coefficient is denominated in.

