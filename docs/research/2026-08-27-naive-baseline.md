# The naive baseline, measured

**Measured 2026-08-27.** Reproduce with `npm run projections:report` (Phase 1, Task 5).
Spec: `docs/design/2026-08-27-projection-engine-spec.md`.

This is the floor. Every model the engine ever ships has to clear these numbers, and if it cannot,
we have nothing. It is deliberately the dumbest defensible answer — last season's points per game —
so that beating it means something.

## The number

Naive benchmark, 2024 regular season, PPR, replayed week by week and scored against actual weekly
outcomes.

| | rank correlation | MAE | RMSE | n |
|---|---|---|---|---|
| **Overall** | **0.566** | **5.14** | **7.02** | **4,734** |

4,734 scored player-weeks: every QB, RB, WR and TE who both had a prior-season average to project
from and an actual outcome to be scored against, across all eighteen weeks.

**Rank correlation is the number that matters.** Fantasy is an ordering problem — a projection
wrong about everybody by the same twelve points costs a manager nothing — so 0.566 is the bar, and
MAE and RMSE are diagnostics beside it. The gap between them (5.14 against 7.02) says the error is
not spread evenly: a minority of large misses, injuries and three-touchdown afternoons, carry a
disproportionate share of it. That is the shape a model can actually attack.

## By week

| week | rho | MAE | RMSE | n | | week | rho | MAE | RMSE | n |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0.679 | 4.53 | 6.05 | 289 | | 10 | 0.658 | 4.66 | 6.55 | 236 |
| 2 | 0.644 | 4.57 | 6.13 | 283 | | 11 | 0.542 | 5.72 | 7.70 | 252 |
| 3 | 0.562 | 5.21 | 7.23 | 293 | | 12 | 0.558 | 5.29 | 7.06 | 229 |
| 4 | 0.595 | 4.95 | 6.65 | 275 | | 13 | 0.555 | 5.12 | 6.89 | 276 |
| 5 | 0.516 | 5.53 | 7.45 | 237 | | 14 | 0.590 | 5.34 | 7.71 | 228 |
| 6 | 0.599 | 4.85 | 6.52 | 242 | | 15 | 0.512 | 5.49 | 7.55 | 275 |
| 7 | 0.455 | 5.44 | 6.94 | 267 | | 16 | 0.582 | 4.95 | 6.72 | 272 |
| 8 | 0.614 | 4.71 | 6.37 | 281 | | 17 | 0.534 | 5.52 | 7.53 | 276 |
| 9 | 0.588 | 5.18 | 7.18 | 261 | | 18 | 0.436 | 5.63 | 8.00 | 262 |

The benchmark decays through the season — 0.679 in week 1, 0.436 in week 18 — which is exactly what
a projection frozen in January should do. Last season's average is at its most informative before
this season has said anything, and least informative once seventeen weeks of new evidence exist and
are being ignored. **That decay is the opportunity.** Any model that reads the current season at all
should beat the naive floor by more in November than in September, and if it does not, its
in-season features are doing nothing.

Week 18 is worst by some margin. Playoff-bound teams rest starters, which is a known,
forecastable event and not noise — a strong argument for the availability layer.

## By rank band

Pooled over every replayed week, banded by the benchmark's own projected rank.

| band | rank | rho | MAE | RMSE | n |
|---|---|---|---|---|---|
| elite | 1–50 | 0.045 | 7.50 | 9.30 | 682 |
| starter | 51–150 | 0.279 | 6.30 | 7.67 | 1,176 |
| deep | 151–400 | 0.259 | 4.45 | 6.20 | 2,268 |
| fringe | 401+ | 0.100 | 2.83 | 5.47 | 608 |

**Read these correlations with care, and never against the overall figure.** Within-band rho is far
lower than the pooled 0.566 for a purely statistical reason: restricting to a narrow band removes
most of the variance the correlation is measured over, so the number falls even when the ordering is
no worse. Range restriction, not incompetence. The bands are comparable to *each other* and to the
same bands under a future model; they are not comparable to the overall row.

Two things are real here:

1. **Absolute error rises with rank.** 7.50 points in the elite band against 2.83 in the fringe.
   High scorers have more to be wrong about, so a headline MAE is dominated by the top of the board
   and hides everything below it. This is why the spec forbids reporting one number alone.
2. **The elite band's ordering is essentially noise** (rho 0.045). Among the fifty players last
   season says are best, last season says almost nothing about who outscores whom this week. That
   is the honest version of "everyone ranks the top fifty correctly" — everyone identifies the same
   fifty, and nobody orders them well.

The `deep` band (151–400) holds 2,268 of the 4,734 scored player-weeks — nearly half the sample, and
the band the spec expects the first real win in. There is now a number to beat there.

**One caveat on the banding.** Players are banded by the *benchmark's own* projected rank, because
that is knowable before kickoff and is the ordering a manager actually acts on. It means two
sources' bands hold different players, so band-by-band comparison between sources is indicative
rather than exact. The fix is to band by a common prior — ADP — and that arrives with the ADP
benchmark.

## What the measurement rests on

- **Point-in-time throughout.** Every week is replayed from the moment the *previous* week's numbers
  landed, and `replay` reads history through one gate (`as_of <= …`) that makes it structurally
  unable to see a row stamped later. A stat correction published between two replayed weeks is
  invisible to the earlier one and visible to the later one, and there is a test that says so.
- **Actuals are the final, corrected numbers**, read deliberately without that gate. We score
  against what really happened, not against what was briefly believed on a Sunday night.
- **Composed through real scoring rules.** The benchmark predicts a `StatLine`; PPR composes it.
  The same benchmark works unchanged in a superflex TE-premium league.
- **Source:** nflverse `snap_counts` and `stats_player_week`, 2023 and 2024, ingested into
  `player_week_observations`. 196,309 observations across the two seasons.

## The crosswalk, and the one thing to fix next

nflverse keys players by its own ids; our `players` table is keyed by the stats provider's. The join
is on name, position and team, and it reports every player it could not resolve rather than dropping
any silently — an absent player is otherwise indistinguishable from one who did not play.

| season | participation | weekly stats | unresolved people |
|---|---|---|---|
| 2024 (replayed) | 98.1% | 99.0% | 6 |
| 2023 (history only) | 87.1% | 89.2% | 63 |

**2023 is below the 90% bar the plan set, and the cause is understood.** Our `players` table is a
*current* (2026) roster snapshot, so anyone who has since retired or left the league simply is not
in it — Logan Thomas, Latavius Murray, Matt Breida, DeVante Parker, Jerick McKinnon. That is a
genuine absence, not a bad join, and it gets monotonically worse the further back a backfill reaches:
98% for last season, 89% for the one before.

It costs **coverage, not correctness**. A 2023 player missing from history gets no naive projection
in 2024, which shrinks the sample; it does not bias the ordering of the players that are there. And
nearly every failure is `absent` rather than `ambiguous` — one ambiguous person in all of 2024 —
which is the safe direction to fail in, because an ambiguous match is the one that writes a whole
season of somebody else's snaps onto a player.

**The fix, before any backfill reaches further than 2023:** resolve against a *historical* player
universe rather than today's roster — nflverse's own player release, or Tank01's `fRefID` /
`gsis_id` cross-references once an API key exists. That turns a name join into an id join and
retires this whole class of problem.

Two smaller findings from the same measurement, both now fixed and tested:

- Feeds disagree about given names (`Josh`/`Joshua` Palmer, `Kenny`/`Kenneth` Gainwell,
  `Chig`/`Chigoziem` Okonkwo). A surname-plus-initial fallback, consulted only after both full-name
  lookups find nobody, recovered roughly a point and a half of resolution. It deliberately does not
  attempt true nicknames (`Hollywood` for `Marquise` Brown) — that needs an alias table, and
  guessing there would be guessing.
- That fallback immediately married two different men to one roster entry, and the store's own
  coherence check caught it: one player, two different snap counts, one week. `resolveAll` now
  refuses both when a shared player id is claimed by two different names, and lets the strictest
  matching rule win when only the loose one collides.

---

## Phase 2 addendum: the historical universe, and the backfill it made possible

**Measured 2026-08-27, after Phase 2 Task 1.** Reproduce with `npm run projections:backfill 2020 2024`.
Everything above this line is Phase 1's measurement and is left exactly as it was recorded.

The fix the section above named — "resolve against a *historical* player universe rather than
today's roster" — is done. nflverse publishes a `players` release covering everyone back to 1999
with the NFL's own `gsis_id` and Pro Football Reference's `pfr_id`, and both files we ingest already
carry one of those. Identity is now an **id join**: `stats_player_week` on `gsis_id`,
`snap_counts` on `pfr_id`, cross-referenced through the release. The name join is deleted.

### Resolution, per season, over distinct skill-position people

| season | participation | weekly stats | before (name join) |
|---|---|---|---|
| 2020 | 99.7% | 100.0% | not measured |
| 2021 | 99.9% | 100.0% | not measured |
| 2022 | 99.8% | 100.0% | not measured |
| 2023 | 99.8% | 100.0% | 87.1% / 89.2% |
| 2024 | 99.5% | 100.0% | 98.1% / 99.0% |

**The decay going backwards is gone.** 2020 now resolves better than 2024 did under the name join,
and the ten-point-per-season slide that made a deep backfill worthless has no mechanism left: an id
does not retire. Weekly stats resolve completely in every season, because the file's own
`player_id` IS the universe's key — there is nothing left to miss.

What remains unresolved is a handful of practice-squad call-ups the players release genuinely does
not carry (Cody White, Rodney Williams, John Lovett, John Samuel Shenker). They are reported by name
and count rather than dropped, for the reason Phase 1 gave: an absent player is otherwise
indistinguishable from one who did not play.

### What is in the store

| season | observations |
|---|---|
| 2020 | 128,886 |
| 2021 | 137,064 |
| 2022 | 135,392 |
| 2023 | 135,548 |
| 2024 | 136,428 |
| **total** | **673,318** |

Plus 25,064 people in `nfl_players`, the universe itself. Per season that is roughly 6,840
participation rows and 5,840 stat lines, carrying twenty-two metrics per player-week: the fourteen
`StatLine` fields, plus four opportunity numerators (snaps, targets, carries, pass attempts) and
their four team denominators.

**Team totals ride on each player's own row** rather than in a table of their own, because the store
has no team column. That is deliberate and it is worth more than the column would be: a player
traded in October carries his new offence's volume with him automatically, and a team-keyed table
would get exactly those players wrong — the ones a model most needs to be right about.

### Why five seasons and not six

`stats_player_week_2019.csv` is **not published**. The `player_stats` release carries every season
from 1999 to 2024 under that name except 2002 and 2019. The legacy `player_stats_2019.csv` exists
but has a different schema (53 columns against 114, with `recent_team` for `team` and
`interceptions` for `passing_interceptions`), and translating between the two would put a
hand-written column mapping in the one place the engine cannot afford a silent mistake. Five seasons
is the plan's own floor — enough to fit on three and hold two entirely out — so the honest answer
was to take the five and say why, rather than to build a schema adapter nobody can test.

### What this does NOT fix

`nfl_players` is deliberately not linked to `players`. The engine models NFL players; mapping those
onto the roster the product drafts from is a separate concern, and whichever phase first renders a
projection to a manager owns it. Until then there is no seam to keep honest.
