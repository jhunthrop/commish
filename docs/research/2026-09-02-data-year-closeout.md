# Round D close-out: the data year begins

**Date:** 2026-09-02 (freeze evidence timestamps run into 2026-09-03 UTC)
**Branch:** worktree-data-year
**Spec/plan:** docs/superpowers/specs + plans, 2026-09-02-data-year
**Strategic frame:** founder directive 2026-09-02: no launch before the 2026 season;
the season becomes the data year; long-term accuracy outranks shipping.

## What this round built

1. **The prospective register** (5638ebf, e8adbc8): append-only weekly freezes of the
   board's claims, taken strictly before each week's first kickoff, graded only after.
   THE WALL: a structural + ESLint gate proving nothing in market/laws/model/preseason/
   nflverse/odds imports the register. The wall hardening review planted 15 evasion
   cases; all are caught.
2. **The season cadence** (e4bb994, dceaf9f, e24bf7d, b4ea62f): one command runs the
   season week (snapshot, ingest, freeze); the cron installer is corruption-proof
   (cannot eat a crontab) and idempotent.
3. **The props archive completion** (08c3bc5 parser fix): a book contradicting itself
   (duplicate same-side outcome) is skipped and counted, not fatal. The 2025 backfill
   completed at 293 events. Archive now holds 2023 (17,244 obs), 2024 (18,719), 2025.
4. **Superseded-row cleanup, verified by census** (4986e6b): 2026 live rows hold only
   v1 raw (546 projections / 3,067 reasons) and v7 (546 / 2,535), one live generation
   each; v4/v5/v6/v8/v9 hold zero 2026 rows. Archives untouched: all nine sources
   present, 675/706/666/664 (v1/v8/v9-family) and 661/694/654/653 (v2-v7) across
   2021-2024. Store totals: 25,197 projections, 177,138 reasons.
5. **Four test-database lanes** (e675dc6): parallel vitest lanes keyed by
   VITEST_POOL_ID end the one-runner era. Benchmark on the whole repo (631 files):
   serial 410s vs parallel 118s (3.5x), failure sets byte-identical (253 failures,
   zero only-in-serial, zero only-in-parallel).
6. **The serve-v9 switch with a dual-track register** (1d87cee): BOARD_SOURCE bumped
   to commish_board_v9_ppr_12 per the founder's ruling ("love is still number 1 -
   that shouldn't be possible"). The register freezes BOTH v9 (served) and v7 (the
   bar-holding champion, shadow) all season, so 2026 grades them head to head
   prospectively.

## The freeze evidence

- v9 persisted 2026-09-03T00:51:53.750Z, 546 rows, no --unfreeze needed. Love at
  value rank 4 (254.7 pts, ADP 27.4). Top 5 by value: Nacua 333.1, Chase 317.5,
  Smith-Njigba 299.1, Love 254.7, Gibbs 248.3. The v1 raw re-persist reproduced all
  546 rows value-for-value: the evidence the v1-unfreeze adjudication rests on.
- Dual week-1 freeze taken 2026-09-03T01:02:07.546Z, 167.3h before kickoff: 1,092
  rows, 546 per board; coverage on both boards: board 546, adp 208, ecr 391,
  props 136. v9 leads Nacua-Chase-Allen-Smith-Njigba-St. Brown; v7 leads
  Nacua-Love (330.8)-Chase-Allen-Smith-Njigba. T1's earlier v7-only freeze
  (2026-09-02T19:24:07Z) stands untouched: the register is append-only.

## The market-curve adjudication: freeze holds

Regenerating the curve would make the tree stop reproducing its own served rows, and
re-persisting after would make "v9" name two configurations across time: the exact
silent-stale failure the source-bump rule exists to prevent. A corrected curve needs
a v10 and a fit round. Measured drift (then restored, uncommitted): 64 of 520
entries, max 4.01 pts (2.95%). The drift check's exit 1 stays expected; the other
four fit checks exit 0.

## The tmpfs finding (the round's best bug)

The inherited 1.4GB→4GB tmpfs bump was the wrong fix. Sampled every 2s under the
full parallel run, the test data dir peaks at 448 MB. What actually runs out is the
Docker VM's 2.9 GB of RAM backing the tmpfs (91 MB free at the trough, ~1 GB
swapped), which surfaces as ENOSPC on a filesystem 89% empty. Moving the test
database onto the container's disk with durability off took the 40 no-space
occurrences (24 real ERRORs on TRUNCATE) to zero and un-broke 15 deferred test
files - a fifth of the standing deferred ledger was this one bug.

## Gates at close

tsc: 43 baseline errors, 0 in touched files. eslint: clean. register+board+ops
suites: 31 files / 576 tests green. Whole-repo parallel run after the final stage:
0 new failures against the stage-1 baseline.

## Standing concerns carried forward

1. Docker VM memory is still 2.9 GB and one service away from tight; raising it is
   a Docker Desktop setting outside the repo, deliberately untouched.
2. Recreating the postgres-test container wipes other worktrees' test DBs;
   recovery: npm run db:migrate:test.
3. register/freeze.ts lacks the assertSingleGeneration loud read despite writing
   immutable history (outside the T3 file list; queue for the next ops touch).
4. The shadow (v7) track has no staleness alarm beyond the freeze's own report.
5. The 64-file deferred test ledger remains; market/curve.test.ts is in it.
6. The lane split depends on VITEST_POOL_ID per-worker semantics; a change there
   would resurface the TRUNCATE race as flakiness rather than a hard error.

## What the 2027 fit round inherits

Props-as-anchor on the 2023-2025 archive judged by quarantined 2026;
uncertainty-weighted rookie blend; per-law held-out gates; D/ST and K
market-anchored rankings; the participation-floor extension; the pbp-context
widening; a v10 market curve if the drift warrants one.
