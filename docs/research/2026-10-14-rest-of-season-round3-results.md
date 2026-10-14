# The Rest-of-Season Board, Round 3: Results

**Run:** 2026-10-14 (UTC), once, by
`uv run python -m research.model.ros judge --round 3 --database <scratch copy> --out <file>`.
**Preregistration:** `2026-10-14-rest-of-season-round3-preregistration.md`, committed as `6b3ff075`
before any fit; the development check recorded as `c35ab3fc` (no amendment) before the judgment.
**Tree:** `c35ab3fc` (`model_version` `research@c35ab3fc`), arithmetic `v8-fdlibm-fused/pow-apple-libm`.
**Data:** the scratch copy `lane18_ros` (port 5433), as in rounds 1 and 2; the 2021 and 2022 week-one
rosters were already present (the roster ingest wrote 0 rows). The fit read outcomes of 2021-2023,
the judgment 2024 only; nothing of 2025 or 2026.
**Every number:** `2026-10-14-rest-of-season-round3-results.json`.

## Decision

**A gate failed. Nothing ships.** 48 cells judged (G1 and G2 at weeks 8 and 12, four positions, three
formats) plus G4: **3 of 49 lines failed**, all G2 at week 8 for receivers:

```
FAIL  G2 8|WR|ppr       rank error 20.694 against the stale board's 18.806
FAIL  G2 8|WR|half      rank error 21.000 against the stale board's 19.417
FAIL  G2 8|WR|std       rank error 22.417 against the stale board's 21.625
```

- **G1 (rho over the stale board, >= +0.04): 24 of 24 passed**, by +0.066 to +0.284.
- **G2 (starters' rank error <= the stale board's): 21 of 24 passed.**
- **G4, isolation: passed** (outcomes read for 2021-2023 in the fit and 2024 in the judgment; the five
  tables' digests unchanged).

The board stays the preseason projection with its caption. `commish_ros_v3` is not retuned or rerun
against 2024. Step 4 was not built.

## Every judged cell, PPR

Half PPR and standard are in the JSON (`numbers.cells`). "Form" is season-to-date points a game times
games left; "ECR" the preseason FantasyPros rank. Rank errors are over the top-N actual finishers.

| W | Pos | n | rho model | rho board | rho form | rho ECR | err model | err board | err form | err ECR | MAE |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 8 | QB | 42 | 0.640 | 0.573 | 0.649 | 0.684 | 6.75 | 8.58 | 7.58 | 8.42 | 50.8 |
| 8 | RB | 90 | 0.752 | 0.583 | 0.761 | 0.640 | 11.21 | 14.54 | 10.25 | 12.69 | 27.8 |
| 8 | WR | 126 | 0.575 | 0.504 | 0.579 | 0.534 | 20.69 | 18.81 | 19.18 | 19.39 | 32.5 |
| 8 | TE | 47 | 0.624 | 0.472 | 0.620 | 0.556 | 7.00 | 10.33 | 7.04 | 8.83 | 27.1 |
| 12 | QB | 42 | 0.651 | 0.417 | 0.678 | 0.562 | 9.00 | 11.54 | 7.83 | 9.42 | 31.3 |
| 12 | RB | 89 | 0.741 | 0.522 | 0.731 | 0.566 | 12.88 | 16.56 | 13.75 | 16.54 | 18.7 |
| 12 | WR | 125 | 0.729 | 0.452 | 0.622 | 0.487 | 19.78 | 23.97 | 18.06 | 22.17 | 19.6 |
| 12 | TE | 46 | 0.508 | 0.400 | 0.568 | 0.464 | 7.92 | 9.62 | 7.50 | 9.08 | 20.1 |

## Reading the result

The ordering result held a third time and on a different season: the model beats the stale board by
the doubled margin in every cell. The one consistent miss is the week-8 receiver starters: across the
whole receiver population the model orders better (rho +0.07), but among the 36 who finish as
starters it places them about two spots worse on average than the preseason board did. Round 2's
development check on 2024 (fit 2023) failed exactly these three cells, and round 2's judgment on 2025
failed two of them, so this is a property of the model at week 8, not of one season.

Two further readings, ungated. First, season-to-date form alone orders about as well as the model
in this season (better at week 8 for QB, RB and WR rho, and at week 12 for QB and TE), so the model's
advantage over the stale board comes mostly from the season so far, not from the shrinkage. Second,
the week-8 receiver failure sits in the starters' rank error, where form is also worse than the
board (19.18 against 18.81): the preseason order of the receivers who finish as starters is hard to
beat with seven weeks of data.

**Exposure, as preregistered.** 2024's week-8 and week-12 ordering numbers had been computed twice
before this judgment (rounds 1 and 2's development checks, with 2024 in or near their fits), and this
round's design was chosen knowing them. The verdict is a fail, so the exposure did not buy a pass;
had it passed, it would have been weaker evidence than a first look.

## The fit

2021-2023 (opportunity line too), 10,394 population rows over weeks 6-16 (searches on 7-15). PPR:
k, alpha QB 3.0, 0.6; RB 2.0, 0.5; WR 1.5, 0.5; TE 3.0, 0.3. k_q QB 12, RB 8, WR 8, TE 32. Return
after an absence of 1, 2, 3+ games: next 0.369, 0.248, 0.199; later 0.591, 0.515, 0.364. No interval
fitted. Every number in the JSON's `priors`.

## Development check

Fit 2021-2022, judged 2023 weeks 8 and 12 (`2026-10-14-rest-of-season-round3-dev-check.json`): 5 of
49 failed, all tight ends in half PPR and standard (G1 week 8, G2 weeks 8 and 12). No defect, no
amendment. The judgment's failures (week-8 receivers) were not among them.

## Where this leaves the rest-of-season board

Across three rounds and two seasons, the rest-of-season ordering beats the stale board from week 8 by
a wide margin in nearly every cell; what keeps failing is a narrow G2 cell (week-8 receiver
starters) and, while it was gated, the interval. A next decision is a ruling more than a model:
whether "no worse than the stale board among week-8 receiver starters" is the right bar for "better
than stale", or whether a later switch week (where week 12's G2 passes everywhere) answers it. Any
next round needs a clean season: 2024 now carries a judgment, 2025 three, and 2026 is pristine.

## The ruling this judgment was taken under

Quoted from the coordinator of this session, 2026-10-14, after round 2 failed:

> "round 3 gates ordering only (G1 +0.04, G2, G4), the in-season board ships with no interval (null
> floor/ceiling, basis says so), fit 2021-2023 after ingesting 2021-22 week-one rosters into the
> scratch copy, judged once on 2024 at weeks 8 and 12; 2025 closed, 2026 pristine; S=6."
