# Live board close-out: the 2026 season, live for the first time

**Measured 2026-09-01.** Plan: `docs/superpowers/plans/2026-09-01-live-board.md`. Spec:
`docs/superpowers/specs/2026-09-01-live-board-design.md`, backbone
`docs/research/2026-08-28-live-season.md`. Ledger: `.superpowers/sdd/2026-09-01-live-board/progress.md`.

Every figure below is copied verbatim from the task reports and re-measurement outputs this round
produced, or computed fresh with a read-only query against the store (recorded below, script
`.superpowers/sdd/2026-09-01-live-board/chip-stats.sh`). Nothing here was recalled from memory or
re-derived by re-running a persist or the scorecard.

This is Task 5, the last task of the plan. Its job is to record what the round did, not to re-judge
it: the 2025 sanity check that let a gap season anchor the board, the drift protocol proving the
historical measurements never moved, the guards that keep a live board honest about what it can and
cannot see, the board itself, and the honest limits of what any of this can claim before 2026 is
played.

## 1. The 2025 sanity report

nflverse never published `stats_player_week_2025.csv` (re-verified 2026-09-01 via a direct HTTP HEAD
against the nflverse GitHub releases: 404, while `play_by_play_2025.csv` and `snap_counts_2025.csv`
are both published). 2025 stat lines exist only as a derivation from play-by-play, the same path
already used for 2019. Task 1 derived them and printed a sanity report with no published twin to
compare against directly:

```
weekly derived rows: wk1=312 wk2=307 wk3=312 wk4=304 wk5=279 wk6=278 wk7=293 wk8=264 wk9=269
                      wk10=278 wk11=293 wk12=274 wk13=307 wk14=290 wk15=303 wk16=324 wk17=321 wk18=320
position mix, 2025 derived: WR=2142 (40.2%), RB=1417 (26.6%), TE=1127 (21.2%), QB=642 (12.0%)
games per player, 2025 derived: n=579, min=1, max=18, mean=9.20, median=9
  buckets: 1-4=169, 5-8=97, 9-12=101, 13-17=211, 18+=1
games per player, 2024 published: n=584, min=1, max=17, mean=10.00, median=11
  buckets: 1-4=137, 5-8=102, 9-12=96, 13-17=249, 18+=0
```

The derivation itself was validated against a published, non-gap season before being trusted for
2025: run against 2018, **season-points rank correlation 0.9999 across 311 players with >= 8 games**
(bar is 0.99), **mean absolute error 0.28 pts per player**, derived games minus published games
min -8 / max 0 / mean -0.38, 248 of 311 an exact match.

The one number the sanity report itself flagged as worth a second look: 2025's median games (9) sits
below 2024's published median (11), all-cohort. Task 4 ran that question down against the population
that actually reaches a draft board rather than the whole derived pool: restricted to the 2026 top-100
ADP cohort, **median games are identical, 16 vs 16**, and the mean per-game PPR rate is flat
(14.717 derived-2025 vs 14.780 published-2024, a 0.4% delta, well inside normal year-to-year
variance). The four top-100 players missing from 2025 derived entirely are all 2026-draft-class
rookies with no professional 2025 stat line to derive from, an expected absence. The all-cohort gap is
a fringe-band phenomenon (2025 derived carries 32 more players in the 1-4-games bucket than 2024
published), not a defect that reaches anyone the board actually prices. Not a stop condition.

## 2. The drift protocol: five checks, before and after Task 3

Task 3 changed how the live guard reads game-derived observations and how depth/roster stamps are
computed for a season still in progress. None of the five re-measurement checks are supposed to move,
since none of them read 2026: they train and re-verify only on completed seasons.

| check | before (Task 3, original round) | after (Task 3, fix round) |
| --- | --- | --- |
| `npm run laws:measure -- --check` | exit 0, no drift | exit 0, no drift |
| `npm run laws:discover -- --check` | exit 0, no drift | exit 0, no drift |
| `npm run projections:blend:fit -- --check` | **exit 1** | exit 0, no drift |
| `npm run projections:rookie-curve:fit -- --check` | exit 0, no drift | exit 0, no drift |
| `npm run projections:market:fit -- --check` | exit 0, no drift | exit 0, no drift |

The `blend:fit` failure was investigated rather than waved through. `git stash` confirmed the failure
was already present on Task 2's clean HEAD, so it was not caused by Task 3's own guard/stamp changes.
The actual cause: an unrelated house-voice, no-em-dash sweep had touched the fit script's own
generated-docblock template nine minutes after the last regeneration, changing one sentence's
punctuation (an em-dash to a semicolon). `--check` compares the full generated file, comments
included, so a template-only change is enough to fail it with no numeric constant moving at all,
confirmed by diffing the two versions of `blend-fitted.ts` directly: every fitted number identical,
only the one sentence's punctuation differs. Regenerated and committed; the re-run above is clean.

This is a distinct event from the later, real `blend-fit` regeneration Task 4's position-gate fix
caused (section 4 below): that one moved actual train-time constants, this one moved nothing but a
comment.

## 3. The live-moment audit inventory

Task 2 built `BoardMoment` (a `replay` or `live` discriminated union) and wrote five guards, RED
before implementation, before any of the plumbing that reads it:

| guard | what it proves |
| --- | --- |
| (a) replay arm, pinned | `loadPreseason` through the new `BoardMoment` shape produces the identical moment and board a bare replay call already produced; the historical path is byte-identical |
| (b) the live arm's read guard | a live board cannot see any observation of the season it is building for, whatever its source or as-of stamp, at the time this guard was written |
| (c) the scorecard's refusal | `assertGradableMoment` throws when asked to grade a `momentKind: "live"` board; a live board is structurally ungradeable |
| (d) `liveMomentFor`'s cap | caps at real `now` strictly before kickoff; throws once `now` reaches or passes kickoff, since a started season has a replay moment instead |
| (e) `liveMomentFor`'s schedule requirement | refuses a season with no ingested schedule at all, rather than silently returning a wrong instant |

Guard (b) as written in Task 2 was deliberately maximal: it refused every `player_week_observations`
row for the live season, including the pre-game sources (depth chart, injury wire) a real manager
could legitimately see before kickoff. That asymmetry was named on the record rather than hidden
(Task 2's fix round, I6) and closed jointly with Task 3's stamp rework: the guard is now class-scoped,
refusing only game-derived rows at any as-of, while pre-game sources pass the same ordinary as-of gate
every other reader in the engine uses. Both arms were re-verified with no leak on either side (Task 3's
review verdict: APPROVE WITH CONDITIONS, "no leak" confirmed on both the moment-cap and the ingest-cutoff
arm).

`BoardMoment` itself is unforgeable at runtime, not just by type: a module-private `WeakSet` brand
means a hand-built `{ kind: "replay", at: new Date() }` literal is rejected by `loadPreseason` even
though it type-checks, verified by a runtime test constructing exactly that literal.

## 4. The 2026 board

Persisted live at `2026-09-01T17:52:51.667Z`, source `commish_board_v6_ppr_12`: **759 players, 3,554
reason rows.** (The v6 re-persist is the final fix round's, section 4.1 below. The rows quoted here
are v6's; the top 50 is point-for-point identical to v5's, for the reason that section explains.)

**Correction (2026-09-02, roster-refresh hotfix).** The 759 figure quoted above, and every other
"759 players" in this document, is a pre-cutdown count and no longer describes the live board. The
roster ingest could not refresh itself (a live season's stamp does not move between two runs on the
same day, so `onConflictDoNothing` discarded every fresh status), so the board was built on a
mid-camp roster file carrying 3,154 rows and 2,802 actives. The post-cutdown file carries 2,796 rows
and 1,695 actives, one per club at the 53-man limit, and the live board built from it holds **546
players**. Nothing about the round this document records is retracted: the count moved because the
league cut its rosters, not because the board changed its mind. See
`docs/research/2026-09-01-vegas-laws-closeout.md` for the current top 50 and the corrected counts.

### The top 50 (value-rank primary, the plan's acceptance deliverable)

```
rank ptsRank   name                     pos  team       points  adp       laws
  1. pts#2     Jeremiyah Love           RB   ARI     330.8 pts  adp 27.4
  2. pts#1     Puka Nacua               WR   LA      331.0 pts  adp 2.9
  3. pts#3     Ja'Marr Chase            WR   CIN     308.7 pts  adp 3.9
  4. pts#5     Jaxon Smith-Njigba       WR   SEA     289.7 pts  adp 5.5
  5. pts#19    Bijan Robinson           RB   ATL     247.1 pts  adp 2.3
  6. pts#20    Jahmyr Gibbs             RB   DET     247.1 pts  adp 1.5
  7. pts#22    Jonathan Taylor          RB   IND     243.5 pts  adp 7.4     td_regression
  8. pts#6     Amon-Ra St. Brown        WR   DET     273.2 pts  adp 6.4
  9. pts#7     CeeDee Lamb              WR   DAL     271.1 pts  adp 10.3
 10. pts#28    James Cook               RB   BUF     233.2 pts  adp 12.1
 11. pts#29    De'Von Achane            RB   MIA     233.2 pts  adp 10.2
 12. pts#30    Derrick Henry            RB   BAL     231.4 pts  adp 16.5    rb_age_curve, td_regression
 13. pts#12    Justin Jefferson         WR   MIN     262.3 pts  adp 11.7
 14. pts#13    Drake London             WR   ATL     260.5 pts  adp 12.3
 15. pts#39    Christian McCaffrey      RB   SF      224.9 pts  adp 6.5     rb_age_curve
 16. pts#14    George Pickens           WR   DAL     255.0 pts  adp 19.9
 17. pts#44    Trey McBride             TE   ARI     213.6 pts  adp 29.0
 18. pts#45    Brock Bowers             TE   LV      213.6 pts  adp 34.8
 19. pts#15    A.J. Brown               WR   NE      251.0 pts  adp 17.1    threshold:WR:age:q70
 20. pts#16    Chris Olave              WR   NO      250.8 pts  adp 19.0
 21. pts#43    Ashton Jeanty            RB   LV      214.4 pts  adp 21.4
 22. pts#47    Kenneth Walker III       RB   KC      212.6 pts  adp 21.3
 23. pts#4     Josh Allen               QB   BUF     298.6 pts  adp 33.7
 24. pts#53    Saquon Barkley           RB   PHI     205.0 pts  adp 18.8    rb_age_curve
 25. pts#26    Zay Flowers              WR   BAL     234.5 pts  adp 25.7
 26. pts#31    DeVonta Smith            WR   PHI     231.2 pts  adp 29.5
 27. pts#33    Nico Collins             WR   HOU     229.6 pts  adp 21.1
 28. pts#38    Tetairoa McMillan        WR   CAR     227.8 pts  adp 31.3
 29. pts#40    Rashee Rice              WR   KC      219.8 pts  adp 16.1    threshold:WR:touchdownPointsShare:q80
 30. pts#41    Emeka Egbuka             WR   TB      218.7 pts  adp 35.3
 31. pts#42    Ladd McConkey            WR   LAC     217.1 pts  adp 37.9
 32. pts#62    Travis Etienne           RB   NO      182.9 pts  adp 37.8
 33. pts#63    Kyren Williams           RB   LA      182.9 pts  adp 31.8
 34. pts#64    Breece Hall              RB   NYJ     182.9 pts  adp 33.2
 35. pts#65    Javonte Williams         RB   DAL     182.2 pts  adp 36.8    td_regression
 36. pts#46    Garrett Wilson           WR   NYJ     212.8 pts  adp 26.7    threshold:WR:touchdownPointsShare:q80
 37. pts#48    Jaylen Waddle            WR   DEN     211.1 pts  adp 44.7
 38. pts#49    Jameson Williams         WR   DET     211.1 pts  adp 45.2
 39. pts#8     Lamar Jackson            QB   BAL     270.0 pts  adp 57.0
 40. pts#68    Omarion Hampton          RB   LAC     178.5 pts  adp 22.5
 41. pts#50    DJ Moore                 WR   BUF     208.2 pts  adp 47.7    td_regression, threshold:WR:age:q70, threshold:WR:touchdownPointsShare:q80
 42. pts#51    Carnell Tate             WR   TEN     206.5 pts  adp 79.8
 43. pts#52    Tee Higgins              WR   CIN     205.3 pts  adp 36.2    td_regression, threshold:WR:touchdownPointsShare:q80
 44. pts#9     Dak Prescott             QB   DAL     263.5 pts  adp 65.1
 45. pts#10    Joe Burrow               QB   CIN     263.5 pts  adp 56.3
 46. pts#11    Drake Maye               QB   NE      263.5 pts  adp 52.0
 47. pts#89    Colston Loveland         TE   CHI     162.5 pts  adp 55.5
 48. pts#90    Tyler Warren             TE   IND     162.5 pts  adp 65.4
 49. pts#55    Davante Adams            WR   LA      198.3 pts  adp 41.9    td_regression, threshold:WR:age:q70, threshold:WR:touchdownPointsShare:q80
 50. pts#86    Josh Jacobs              RB   GB      165.3 pts  adp 32.0    td_regression
```

Jeremiyah Love sits at value#1 despite pts#2: the rookie replacement channel (draft-capital pricing,
not a market anchor) ranks him ahead of his own raw-points rank, the documented characteristic of that
channel (see section 5's rookie-cap deferral below).

### 4.1 The live model arm was starved of 2025, and now is not

The whole-branch review found one HIGH defect that no per-task review could have seen, because each
task's own half of it was right on its own terms. Task 1 derived 2025 from play-by-play and,
correctly, withheld the participation metrics (targets, carries, pass attempts and their team totals)
that the missing weekly stats file would have carried, rather than writing them as false zeros. Task 4
then admitted derived 2025 into the live board's LAW facts and stopped there. The MODEL arm of the
same board still read `season - 1` through the published-only stat-line reader and through a usage
reader that put those zeros back at read time, so the 2026 board's `predictRates` joined against an
empty 2025 and **every one of 759 players silently took the position-prior efficiency**: Puka Nacua
and a practice-squad receiver carried identical per-opportunity rates. Nothing threw, because "no
evidence means the prior" is the designed fallback. The failure looked exactly like a healthy board.

The fix, ruled as a fix rather than a documented limitation because the spec's own Part 1 admission
covers the live path as a whole: `loadPreseason` now asks ONE predicate for every read that consumes
the prior season, so the model's outcome history and its opportunity counts see the derived 2025 that
the law facts already saw. The play-by-play's own touch counts stand in for the withheld opportunity
counts, which is honest for targets at every position and for carries at every position except
quarterback (measured against 2024, the one season carrying both feeds: pbp targets within 0.7% of the
published count, pbp carries within 0.5% at RB/TE/WR, but only 37.7% at QB, because a quarterback's
scrambles are most of his rush attempts and the derived stat line counts them). A quarterback's
rushing rates, and every position's passing rates, therefore stay on the position prior, which is what
no evidence is supposed to mean.

**What moved, honestly.** The raw model arm moved a great deal: 437 of 759 players, up to 25.2 points,
in the direction the diagnosis predicted (De'Von Achane +25.2, Bijan Robinson +22.7, Jaxon
Smith-Njigba +21.1, Puka Nacua +19.0 on the raw board; Jerry Jeudy -18.6). The RB raw top end went
286.3 to 309.0. **The shipped board's top 50 did not move at all, and that is the point**: all 212
ADP-listed players are priced by the market anchor, which was rebuilding a healthy-looking spread on
top of a starved model the whole time. The masking was total, which is why only a read of the code
found it. Where the model does have authority, the board moved: 245 of the 547 unlisted players
changed price (max 4.84 points, Dont'e Thornton Jr. 74.1 to 69.3), and 307 players changed value rank.
The first value rank that differs at all between the two boards is **167**: everything a manager sees
in the first fourteen rounds is identical, and everything below it is now priced off a measured 2025
instead of a position mean.

**What this fix does NOT restore.** 2025 has no team totals from any feed, so target, carry and
pass-attempt SHARES still fall back to the role's slope against the measured 2025 snap share, and team
volumes to the league mean. The 2026 raw arm's pass-catcher top end therefore remains compressed
against a fully published archive season (2026 WR raw max 233.0 against 2023's 358.8). That is a real
limitation of a season nflverse never published a weekly stats file for, not a defect: the honest
alternative is a number no feed supports.

**The replay invariant, proven rather than argued.** The admission is live-arm-only by construction,
so every replay season must be untouched. `BOARD_SOURCE` was bumped to `commish_board_v6_ppr_12` for
exactly this reason (`preseason_projections`' `(season, source, as_of)` key means a re-persist under
the old name would silently do nothing on the archives and leave the claim uncheckable), all five
seasons were re-persisted, and a read-only full-row comparison of v5 against v6 across 2,662 archive
rows found **zero differences on any stored column, and zero board-reason differences**. The
market-edge scorecard, which grades replay seasons only, was re-run on the v6 state and its 404-line
output is **byte-identical** to the v5 run (`scorecard-final-v6.txt` against `scorecard-final-v5.txt`,
empty diff). Both law drift checks exit 0.

### Chip statistics

The board's law chips were priced through a position gate landed this round (`LAW_ELIGIBILITY`,
tribal; `candidate.position === position`, discovered) after a review found no such gate had ever
existed: a tribal law measured only over RBs could fire, and price, a WR clearing the same numeric
threshold. Computed fresh, read-only, against the live store (`chip-stats.sh`, `psql` against
`preseason_board_reasons` and `preseason_projections`, `season = 2026`, `source =
'commish_board_v6_ppr_12'`):

```
total 2026 v6 candidates: 759
players carrying >=1 law chip: 141
total law reason rows: 181
firings per law id:
  td_regression:                          68
  threshold:WR:age:q70:                   64
  threshold:WR:touchdownPointsShare:q80:  37
  rb_age_curve:                           12
```

These four figures (68/64/37/12, sum 181) match `task-4-report.md`'s own count from the real,
un-persisted rebuild that first exercised the fixed gate, confirmed independently here against the
persisted store rather than recomputed, and re-confirmed unchanged against the v6 board after the
final fix round (a law fact is computed from the prior season's scoring, which the fix did not touch).
A direct SQL check under v5 across all five persisted seasons
found zero cross-position chips, where v4's 2024 board had carried them at scale (`rb_age_curve` on 27
QBs, 27 TEs, and 39 WRs; `wr_target_competition` on 96 TEs), and the addendum documents one remaining
display-only caveat: `board-top.ts` prints roster position, which disagrees with the pricing position
on 7 of 759 2026 rows, so a printed chip can look cross-position on those specific rows even though
the underlying gate held.

**Superseded note (2026-09-01, vegas-laws round):** the `commish_board_v6_ppr_12` board and top 50
recorded above are superseded by `commish_board_v7_ppr_12`, persisted the same day once two win-total
laws entered the discovery family. See `docs/research/2026-09-01-vegas-laws-closeout.md` for the
current top 50 and board story; this document's content otherwise remains the record of what the
live-board round itself shipped.

## 5. The honest scorecard note

**2026 is unmeasurable until it is played.** `assertGradableMoment` structurally refuses to build a
`ScoreCard` for any `momentKind: "live"` board, wired into every script that grades a board against
reality. No rho, no gap, no verdict is printed anywhere beside the 2026 board, by construction, not by
convention.

The held-out figures that exist describe 2023 and 2024, both fully played seasons, and specifically
the **re-measured (post-gate-fix) figures**, not the originally published ones: the position-gate
defect (section 4) moved real, already-shipped board points on every archive season, so the scorecard
was re-run after the fix, on the fully re-persisted v5 boards with regenerated blend-fit constants.
Quoting the re-measured figures, from `docs/research/2026-08-31-market-edge-closeout.md`'s addendum
and `.superpowers/sdd/2026-09-01-live-board/scorecard-final-v5.txt`. The final fix round (section 4.1)
re-ran the same scorecard on the v6 state and the output was byte-identical, so every figure below
stands under v6 unchanged, with an empty diff as the evidence rather than a re-typed table:

**2024 (decisive, out-of-fit), all four positions pooled:**

| | published (pre-fix) | re-measured (gate fix, final) |
| --- | --- | --- |
| blend rho | 0.5301 | 0.5293 |
| blend vs ADP gap | +0.1029 [+0.0081, +0.2099] BEYOND NOISE | +0.1021 [+0.0070, +0.2102] BEYOND NOISE |
| starter band gap | +0.2390 [+0.0403, +0.4443] WON BEYOND NOISE | +0.2355 [+0.0421, +0.4377] WON BEYOND NOISE |
| blend vs raw gap | (not separately tabulated) | +0.1161 [+0.0312, +0.1998] BEYOND NOISE, n=176 |
| blend vs ECR gap | (not separately tabulated) | +0.0312 [-0.0463, +0.1169] within noise, n=176 |

**2023 (in-fit caveat), pooled:** blend vs ADP gap +0.0566 [-0.0526, +0.1680] within noise (published
+0.0570 [-0.0515, +0.1685] within noise), same verdict, never the deciding season either way.

**The bar still holds, decisively, unchanged.** Every verdict independently re-confirmed (beyond
noise, within noise, won beyond noise, on the pooled headline gap and the starter band, both seasons)
is identical under the gate fix. The largest point-estimate move on any independently confirmed figure
is 0.0035 rho, an order of magnitude below anything that could flip a 95% interval's relationship to
zero. `scorecard-final-v5.txt`'s full output (all positions, all bands, both seasons) contains no
"lost beyond noise" line anywhere.

## 6. Deferrals

Recorded here, with pointers, rather than fixed in this round:

1. **2025 injury reports are not ingested.** `injuries_2025.csv` dropped the `date_modified` column
   the mapper (`news/retrieve.ts`'s `reportFiledAt`) requires to stamp a row, and added a new
   `season_type` column in its place, a genuine upstream schema break rather than the vocabulary drift
   originally anticipated. `news` stays off in `PRESEASON_MODEL_FEATURES` regardless, so this affects
   only the (currently unpopulated) injury designation a live 2026 player screen would otherwise show,
   not the board's own pricing. (Task 1 report, section "2025 context ingestion.")

2. **The 2026-09-09 kickoff-eve depth re-ingest is an operational commitment, not yet executed.** A
   dated-schema season's stored depth chart is whatever snapshot was latest at the moment someone ran
   the ingest, unlike a legacy season's chart, which is definitionally the last one before kickoff.
   Task 3's own re-ingest ran 2026-09-01, nine days before the 2026-09-10 kickoff, so the permanently
   stored chart is an early-September snapshot, honest in stamp but not yet final in recency. Ruling I4
   (Task 3 section, `progress.md`) commits to running `npm run projections:preseason:ingest 2026 2026`
   (or a depth-only equivalent) on 2026-09-09, one day before kickoff, to bring 2026's stored chart into
   the same "last chart before kickoff" convention every archive season already has. That date has not
   arrived; the run cannot happen yet.

3. **Tail-cap and unlisted-player follow-ups.** `tailCappedUnlistedPoints` (`market/blend.ts`)
   degenerates when 100% of a position class is unlisted rather than the few deep-bench stragglers it
   was designed for: `Math.min(raw, tail)` collapses every player at that position to the identical tail
   value once every one of them exceeds it. This round hit and fixed the immediate cause (the ADP
   ingest's own publication-stamp defect, section elsewhere in this closeout), and added a live-only
   degeneracy guard so a board built into that state refuses to ship rather than silently flattening a
   position, but `tailCappedUnlistedPoints`'s own design assumption (most of a class is normally listed)
   is unchanged and worth flagging to whoever next owns `market/blend.ts` (Task 4 report, concern 1).
   Separately, the 2026 depth re-ingest's `unknownToUniverse: 351` is a materially higher drop rate than
   the legacy schema's historical seasons typically show; plausibly the dated ESPN-sourced schema's
   `pos_rank` running a full nine-man WR list rather than the legacy file's cap of three, but this was
   not verified against a sample the way `depth.ts`'s own docblock verifies its other claims, and
   remains open (Task 3 report, concern 3).

4. **The rookie-cap question is queued for the next fit round.** The rookie replacement channel shipped
   uncapped on the 2026 board (+155.8 pts at rank #2, the same channel that puts Jeremiyah Love at
   value#1 in section 4 above), a ruling that keeps the channel AS MEASURED rather than capping it post
   hoc, since capping now would ship a variant that never cleared the held-out bar the published
   configuration did clear. Documented loudly rather than silently shipped; the cap question itself
   queues for the next fit round (ruling I4, Task 4 section, `progress.md`).

5. **The `onConflictDoNothing` silent-shadowing hazard in `team-store.ts` is next-round debt.** Two
   different values for the same fact at the same instant would have `onConflictDoNothing` keep
   whichever Postgres inserted first and silently discard the other; `team-store.ts` currently guards
   only the within-batch case (`assertFiniteValues` throws on a genuine intra-batch contradiction), not
   the general hazard across separate insert calls. Carried forward unresolved from the predecessor
   round's own close-out (`docs/research/2026-08-31-market-edge-closeout.md`, section 8, which itself
   traces the origin to `2026-08-31-prediction-laws-closeout.md`, section 5) and unrelated
   to any task this round touched, so it was not re-touched here either.

6. **The tsc baseline: 43 pre-existing errors, verify at merge.** Every task this round ran
   `npx tsc --noEmit` before and after its own changes and found the same 43 errors, none in any file
   the round touched, spread across roughly 13 deferred-ledger UI test files (component prop-shape
   mismatches unrelated to the projections engine). A re-reviewer separately observed the baseline
   reading 60 in those same files "from unrelated concurrent work" partway through the round
   (`progress.md`, the standalone note after Task 3's completion); the note there commits to verifying
   at merge time that the baseline
   this branch carries matches main's own state, not assuming 43 or 60 without checking against
   whatever main actually has when this branch lands.

Final `npx tsc --noEmit` run for this task, below, reproduces the 43-error baseline with zero errors
in any file this task touched (this task touched no source file, only this document).
