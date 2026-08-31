# Prediction laws close-out: the ADP scorecard, the six laws, and what this round actually shipped

**Measured 2026-08-31.** Plan: `docs/superpowers/plans/2026-08-31-prediction-laws.md`.
Ledger: `.superpowers/sdd/2026-08-31-prediction-laws/progress.md`.
Reproduce the scorecard with `npm run projections:preseason 2023 2024`. Reproduce the law
measurement with `npm run laws:measure -- --check`. Both read the dev DB only, no network.

This is Task 10, the last task of the plan. Its job is to say plainly whether this round beat the
market, not to make it sound like it did. It did not, on either held-out season, though the gap
against ADP in 2023 is now inside a hundredth of a rank correlation point, which a different fifty
players would decide.

## 1. A store-consistency bug found and fixed before any of the rest of this could be trusted

Before running any benchmark, the brief for this task asked a specific question this round's own
history raised: `src/projections/nflverse/coaches.ts` changed what a "coach" observation means, in
commit `d2aa8a7`. Before that commit, `ingestCoaches` attributed tenure and scheme-prior facts to
the **head coach only** (`games.csv`'s own coach column). After it, `ingestCoaches` always attributes
them to the **play-caller** where `data/play-callers/play-callers.csv` covers the team-week, falling
back to the head coach only where it does not. Two different mechanisms, same metric names
(`coach_tenure_seasons`, `coach_prior_pace_seconds_per_play`, `coach_prior_pass_rate_over_expected`),
same store.

**The store's conflict rule makes this dangerous rather than self-correcting.** `team-store.ts`'s
`recordTeamObservations` writes with `.onConflictDoNothing()` against a unique index on
`(season, week, team, source, metric, asOf)`. That key does not include `value`, and `asOf` is
`schedulePublishedAsOf(season)`, a fixed date per season, identical on every re-run. So a fact
already written at that key, under either attribution regime, permanently blocks any later write for
the same key, silently, no matter which value is more correct. Re-running the ingestion script does
not fix a stale row; it just confirms the row is "already there" and moves on. This is neither
append-only (nothing is versioned) nor genuinely as-of-keyed in the way the store's other consumers
assume (a later `asOf` would win; here `asOf` never changes across re-runs of the same season); it
is a first-write-wins cache with no way to invalidate itself.

**What the dev DB actually held:** querying `team_week_observations` by `ingested_at` relative to
`d2aa8a7`'s commit time (2026-08-31 16:08:13 UTC) showed `coach_tenure_seasons` fully stale
(head-coach-attributed) for every row in seasons 2016-2024 (5,572 rows across all three coach
metrics), while 2011-2015 (and most of 2012–2019 for the two pace/PROE metrics, which need PBP
history a prior backfill only added later) were already fresh. The 2020–2024 span the brief named was
indeed entirely stale, and so, it turned out, was a wider span the brief could not have known about:
tenure for 2016–2019 too, left behind by an earlier controller backfill that tried to write play-caller
facts for those seasons and was silently no-opped by the pre-existing head-coach rows.

**Fix applied:** deleted the 5,572 stale rows (`source = nflverse_schedule`, `metric LIKE 'coach_%'`,
`ingested_at < d2aa8a7`'s commit timestamp, seasons 2016–2024), then re-ran `ingestCoaches` directly
for seasons 2011–2024 (a temporary script, not committed, calling the same exported function
`projection-context.ts` calls; this avoided re-downloading nine seasons of play-by-play that were
already correctly ingested and untouched by the bug). Verified after: zero stale coach rows remain
for any season or metric. Row counts grew substantially where they were rewritten (e.g.
`coach_prior_pace_seconds_per_play` for 2024 went from 85 rows to 357), because play-caller
attribution resolves an "elsewhere" scheme history for far more team-seasons than head-coach-only
ever could.

**Downstream impact, measured rather than assumed:** `npm run laws:measure -- --check` against the
committed `measured.json` before this fix reported drift on exactly one of the six laws:
`play_caller_fingerprint`, the only law that reads `COACH_METRICS` at all (`populations.ts`'s
`incomingCoachFactsByTeam`, via `tenureIsZero` and `priorPassRateOverExpected`). All five other laws'
`effect`/`ci`/`sample` were byte-identical before and after. The core weekly/preseason projection
model was never at risk: the only place `COACH_METRICS` reaches the model at all is one boolean read
in `preseason/source.ts` (`newPlayCaller`), which feeds a single board-reason tag
(`new_play_caller`) and nothing in the point/VOR math. The ADP and ECR scorecard below is unaffected
by the bug this section found; the six-law verdict table in section 3 is not, and is reported
post-fix.

`play_caller_fingerprint`'s measurement, before and after the fix:

| | effect | 95% CI | sample | held-out effect | verdict |
|---|---|---|---|---|---|
| before fix (stale) | −0.342 | [−1.125, 0.495] | 124 | +0.678 | debunked |
| after fix (corrected) | −0.175 | [−0.784, 0.497] | 185 | −0.700 | debunked |

The verdict does not change. The sample grew by half once head-coach staleness stopped shadowing
play-caller coverage, the full-window effect moved toward zero, and the held-out effect flipped sign
to now agree with the full-window sign, but the law's claim needs a **positive** effect (a new
play-caller with a positive prior pass-rate-over-expected should raise a pass-catcher's points), and
the measured effect is negative in both the stale and corrected data. `verdictFor` (`harness.ts`)
returns `debunked` on sign mismatch regardless of CI width, so this was never a close call once the
sign disagreed; the fix changed the number, not the finding. The corrected `measured.json` is
committed with this document, and `laws:measure -- --check` now reports no drift.

## 2. The board-vs-ADP-vs-ECR-vs-naive scorecard

Instrument: `scripts/preseason-report.ts` (`npm run projections:preseason`), the board-vs-benchmark
comparison this round shipped no changes to. `scripts/preseason-diagnose.ts` is the companion
diagnostic tool (section 4 below), not a second scorecard. Both read the store only, at the
preseason moment, on the two held-out seasons `preseason-report.ts` defaults to: 2023 and 2024. The
metric compared is rank correlation (spearman), which is what `ScoreCard`'s `rankCorrelation` field
holds and the only field this instrument prints for cross-source comparisons; `ScoreCard` also
carries `meanAbsoluteError`/`rootMeanSquaredError`, but MAE is not meaningful against ADP/ECR because
those benchmarks are ranks, not points, and the shipped script does not compute it for them.

### Before this round

`docs/research/2026-08-28-beating-consensus.md`, the most recent committed benchmark run before this
round's first commit, measured 2026-08-28 with the same instrument:

| season | ADP | board (before) | ECR | board (before) |
|---|---|---|---|---|
| 2023 | 0.4752 | 0.4701 | 0.7387 | 0.6484 |
| 2024 | 0.4272 | 0.4036 | 0.7725 | 0.7593 |

This is the honest "before" this document can cite: it predates this round's ten tasks (play-caller
table, six laws, confirmed-law gating, and the 2011–2019 nflverse backfill a controller ran mid-round
for the law measurement). It is not a controlled ablation of this round alone: other work in this
worktree (the history backfill in particular, which feeds usage priors well beyond the coach table)
could also move these numbers. Isolating this round's individual contribution from that backfill's
was not attempted; both shipped in the same worktree and neither is separable by re-running an
existing script.

### After this round (today, post store-fix)

| season | ADP | our board | gap | ECR | our board | gap | naive (last season's PPG) | our board | gap |
|---|---|---|---|---|---|---|---|---|---|
| 2023 | 0.4752 | 0.4737 | **−0.0015** | 0.7387 | 0.6657 | −0.0730 | 0.5057 | 0.6657 | **+0.1600** |
| 2024 | 0.4272 | 0.4174 | **−0.0098** | 0.7725 | 0.7596 | −0.0129 | 0.5887 | 0.7596 | **+0.1709** |

(n = 173 for 2023 ADP, 176 for 2024 ADP, 414 for 2023 ECR, 479 for 2024 ECR. The naive row is
`scripts/preseason-diagnose.ts` section B's "last season's points" oracle-half diagnostic (the same
last-year-PPG floor `docs/research/2026-08-27-naive-baseline.md` names), not a third arm
`preseason-report.ts` prints on its own; `benchmarks.ts` names naive/ADP/ECR as the spec's rule but
only ADP and ECR are ingested benchmark sources today.)

**Headline: the board does not beat ADP or ECR on either held-out season. It clears the naive floor
by a wide, comfortable margin on both.** The ADP gap in 2023 (−0.0015 on n=173) is close enough that
a different fifty players' outcomes would flip it; 2024's gap (−0.0098) is small but real. Against
ECR the board is closer than it was before this round on both seasons (2023 improved from a
0.0903-point gap to 0.0730; 2024 from 0.0132 to 0.0129) but still trails on both.

Per-band detail (rank correlation, banded by each benchmark's own rank):

**2023 vs ADP**, elite/starter/deep (fringe is n/a, ADP does not price deep enough to fill it):
ADP 0.2291 / 0.2232 / 0.1789; our board 0.3978 / 0.3693 / **−0.4249**. The board wins the top two
bands and loses badly in the deep pool against the market specifically: the same band the market
does not price with confidence either (ADP's own deep-band rho is only 0.1789).

**2024 vs ADP**: ADP 0.2301 / 0.1773 / −0.1146; our board 0.0585 / 0.2650 / **0.3771**. The pattern
flips: 2024 loses the elite band and wins the deep band decisively. Two seasons, two different
failure bands against the market, by this engine's own two-season rule (stated in the prior
`beating-consensus` document), neither is a confirmed pattern on its own.

**2023 vs ECR**: ECR 0.2878 / 0.2648 / 0.5206 / 0.1473 (elite/starter/deep/fringe); our board 0.3453 /
0.2453 / 0.4507 / **−0.3407**. Fringe is the clear loss.

**2024 vs ECR**: ECR 0.2503 / 0.3303 / 0.5096 / 0.3076; our board 0.0606 / 0.2688 / 0.5029 / 0.3657.
Elite is the clear loss (0.0606 against ECR's 0.2503), deep and fringe are essentially matched or
ahead.

## 3. The six-law verdict table

From `src/projections/laws/measured.json` (regenerated in section 1), measured over
`MEASURE_SEASONS` 2013–2024 (matched pairs use predictor seasons 2013–2023; 2019 is a hole:
nflverse's `stats_player_week_2019.csv` release does not exist), with direction replicated against
`HELD_OUT_SEASONS` [2023, 2024]. A law is `confirmed` only if the full-window CI excludes zero **and**
the held-out subset's effect agrees in sign; `weak` if the sign is right but either of those fails;
`debunked` if the full-window sign itself disagrees with the claim.

| law | claim | effect | 95% CI | n | held-out effect | verdict |
|---|---|---|---|---|---|---|
| target_share_persistence | A WR at ≥24% team target share sustains stronger PPG next season than his raw scoring alone predicts. | +0.971 | [0.035, 1.838] | 120 | +1.567 | **confirmed** |
| td_regression | A player whose TD points run ≥1.5x his position's typical share among regulars (≥8 games) loses PPG next season as TD luck reverts. | −0.871 | [−1.259, −0.490] | 636 | −0.754 | **confirmed** |
| wr_target_competition | A WR with a WR/TE teammate at ≥20% target share and ≥ his own share loses PPG next season. | −0.830 | [−1.587, −0.081] | 216 | −1.681 | **confirmed** |
| rb_age_curve | A running back 28 or older at the season opener produces fewer PPG the following season than a similar younger back. | −1.077 | [−2.455, 0.231] | 43 | −1.667 | weak |
| rb_workload_cliff | A running back with ≥300 combined carries + receptions loses PPG the next season. | −1.518 | [−3.745, 0.698] | 39 | −4.688 | weak |
| play_caller_fingerprint | A WR/TE whose team gets a first-year play-caller with a positive prior pass-rate-over-expected gains PPG. | −0.175 | [−0.784, 0.497] | 185 | −0.700 | **debunked** |

Half the folk laws this round set out to check hold up (target share, TD regression, target
competition). The other half do not survive scrutiny at their stated strength: the two running-back
laws have the right sign but a confidence interval that still spans zero at n=39-43 (real
candidates, not yet demonstrated), and the play-caller fingerprint is flatly debunked, sign and all,
even after this task's own store fix gave it the largest sample of the six laws to work with (185
matched pairs, more than any RB law). Only the three `confirmed` laws are gated onto the board as
reason chips (`board-reasons.ts`: `if (law.verdict !== "confirmed") continue;`); `weak` and
`debunked` laws are measured and committed but never shown to a user. `REASONS ATTACHED` in the
section-2 report run counted 359 (2023) and 368 (2024) `law` reason occurrences on the board, all
necessarily from those three confirmed laws.

## 4. Play-caller coverage

`data/play-callers/play-callers.csv`: 944 rows, 893 distinct team-seasons (some team-seasons split
across a midseason change, hence more rows than team-seasons), spanning 1999–2026 across 35 team
abbreviations (covering relocations/renames: OAK/LV, SD/LAC, STL/LA, WAS). 189 rows are formally
titled head coaches who called their own plays; 755 are coordinators. Every row's `source` field
currently reads `wikipedia`; none have yet been upgraded to `both` (verified against the founder's
Pro Football Reference account), which the README documents as deferred, ongoing work, not a launch
blocker.

`data/play-callers/verification-queue.md` lists 103 team-season entries (spanning eight parse-agent
groups plus a controller merge-fixes section) whose sourcing carried some doubt: an infobox silent on
the OC, a reputation-list attribution not confirmed by season-article prose, an estimated midseason
week split. A seeded 40-row independent spot-check at assembly time (ledger, `spot-check-results.md`)
found 24 confirmed, 15 plausible (all reputation-flagged, deliberately not scored confirmed), and 1
wrong (JAX 2018 handoff week, corrected in place before merge). The queue is real outstanding
verification work, not a hidden defect: `coaches.ts` falls back to the head coach wherever the table
has nothing, so an unverified-but-present row is strictly better coverage than the pre-round
head-coach-only mechanism, never worse.

## 5. What was deferred

From `.superpowers/sdd/2026-08-31-prediction-laws/progress.md`, minors carried forward rather than
fixed in-round (file:line pointers where the ledger gives one):

- `play-callers.ts:134`: a CRLF-only line split would corrupt the `note` field silently.
- `play-callers.ts:224`: the gap-detection message prints a sentinel `0` when the first row starts
  past week 1.
- Empty-name and `startWeek > endWeek` validation checks scan every row in the CSV rather than only
  the requested seasons (defensible today; worth confirming at the first real multi-decade call).
- `coaches.ts`'s `attributedByTeamSeason` rescans the full games list per team-season (an offline,
  one-time-per-ingest cost, noted rather than fixed).
- No automated test exercises `ingestCoaches`' `ENOENT` throw when `play-callers.csv` is missing (no
  `ingest.test.ts` file exists to hold it).
- `populations.ts`'s `incomingCoachFactsByTeam` reads `tenureIsZero: false` when a team has a PROE
  row but no tenure row for the same team-week, a pre-existing edge case, flagged but not closed.
- `populations.ts` sits at 482 lines against the file-size convention; the stated split point is a
  new `laws/season-facts.ts`.
- `preseason_rosters` only carries birth dates from 2021 forward, which caps `rb_age_curve`'s
  full-window sample below what a deeper backfill could give it. Directly relevant to why that law
  reads `weak` rather than confirmed or debunked outright; more data could move it either way.
- `PlayerPeek`'s Outlook panel scans the whole board's `boardReasons` per open rather than narrowing
  per player, a UI performance minor, not a correctness one.
- The `/player-laws` footer registration is tied up in the deferred UX-ledger footer reconciliation
  (locked-array tests elsewhere in the app), so it lives in the storefront nav only for now.
- Two data-provenance judgment calls in the play-caller table remain queued for PFR verification
  rather than resolved: the MIA 2021 co-OC pair (collapsed to Godsey, primary per reporting) and the
  103-entry verification queue generally (section 4).

None of these block the scorecard or the law verdicts above; they are the honest list of loose ends
a future round should pick up, not defects in what was measured here.

## 6. If ADP is not beaten: the best current hypothesis

It is not beaten, on either held-out season, though 2023 is inside a hundredth of a rank-correlation
point. `scripts/preseason-diagnose.ts`'s section D (`npm run projections:preseason:diagnose 2023
2024`) gives the most direct evidence for why, comparing the board's and the market's residuals
against the actual outcome by segment (positive residual means that side ranked the segment too low):

- **The board is more confident than the market, in both directions, and that is not free.** Section
  D's disagreement breakdown shows that once the board and the market disagree by more than 60 ranks
  on a player, the board's mean rank error is worse than the market's on the seasons' worst
  disagreements. 2023: market off by 52.4 ranks on average at that threshold, the board by 57.9;
  2024 is closer (62.9 vs 47.2, board actually ahead there) but 2023's pattern is the more troubling
  one, because it repeats the WR-specific miscalibration below.
- **WR is the position where the board is more wrong than the market, on both seasons.** Section D's
  by-position residuals: 2023 WR: market −7.0, board −17.4; 2024 WR: market −4.8, board −15.0. On
  every other position the board's residual is closer to zero than the market's or in the same
  direction and similar size; WR is the one position where the board overshoots the market's own
  overshoot in both years, and it is the largest single position by roster count on the board.
- **The per-game rate model over-projects established, non-rookie players specifically, on both
  seasons.** Section F's ratio-of-projected-to-actual PPG, by years in the league (all positions,
  n=410/408 with 6+ games): the "year 4-6" cohort is the one group whose ratio is well above 1.0 in
  both seasons, 1.194x in 2023 and 1.102x in 2024. Every other cohort disagrees between the two
  seasons on direction: year-1 rookies are under-projected in 2023 (0.925x) but over-projected in
  2024 (1.102x); year-2 the same shape, weaker (0.953x then 1.024x); year-3 is the single worst cell
  in 2023 (1.208x) but close to calibrated in 2024 (1.081x, not the worst that year). Only "year 4-6
  over-projected" survives this engine's own two-season rule; the rest is noise across the two
  seasons and should not be acted on as a finding, even though it looks like one in a single year.
  Consistent with this, RB is a weak starter-band position against ECR in section 2's per-band table
  (2023: ECR 0.358 vs ours 0.118; 2024: ECR 0.503 vs ours 0.470), though section F's finding is not
  RB-specific; it spans every position.
- **The starter band (ranks 51–150) is still the hardest band**, as the prior `beating-consensus`
  document also found: it is not the worst band on either single benchmark in isolation this round,
  but it is where the board's per-position breakdown (section 2's diagnose section C) shows RB and TE
  losing to ECR on both seasons, while WR and QB are roughly matched or ahead.

None of this was tuned against in this round; it is read off the diagnostic instrument this task was
asked to pick, not acted on. The honest summary: the board's edge over the market is real in the
bands where the market prices with least confidence (the deep pool, inconsistently across the two
seasons) and its deficit is concentrated in WR calibration and veteran-RB rate inflation, both
specific enough to be worked next, neither fixed by this round's play-caller and six-law work, which
never touched the weekly rate or availability models at all.
