# The Rest-of-Season Board, Round 3: Preregistration

**Written:** 2026-10-14, after round 2's one judgment and before any fit of round 3.
**Rulings:** the coordinator's round-3 rulings of 2026-10-14. Founder ruling 2026-10-14: "we can't
leave stale rankings during the season so it needs to be accurate and fresh - ship it."
**Earlier rounds:** round 1 (`commish_ros_v1`) and round 2 (`commish_ros_v2`) failed and never ship.
Round 2 judged 2025 at weeks 8 and 12: ordering passed 22 of 24 cells at +0.04 and every PPR and half
PPR cell; the starters' rank error passed 21 of 24; the per-week interval failed 11 of 24, and failed
16 of 24 on 2024 in its development check, so the interval does not hold from season to season.
**Results:** `2026-10-14-rest-of-season-round3-results.md` and `.json` beside it.

## What changes in round 3

1. **No interval.** In season the board carries rank and projected rest-of-season points; floor and
   ceiling are null and the basis says no range is given in season. No interval is fitted, shown or
   gated (G3 is not a gate). A later round may validate one.
2. **2025 is closed** (three judgments, 178 cells). **2026 stays pristine.** Round 3 is judged once on
   **2024, weeks 8 and 12.**
3. **Fit on 2021, 2022 and 2023** (the opportunity line too), never 2024, 2025 or 2026.

Unchanged from round 2: switch week S = 6 (the preseason board through week 6, this model from week
7); points a game from the raw board's line (`commish_board_v1_ppr_12` season line over its expected
games); availability from the served board's expected games; the absence streak from stat lines, no
designation (2025's filings are unstamped and no stamped reserve list exists); red-zone share out;
the universe, club rule, opportunity line, shrinkage form, grids and searches; search weeks 7..15;
the population (K = QB 36, RB 72, WR 108, TE 36) and the statistics. The model is
`commish_ros_v3`: `commish_ros_v2` without its interval.

## The seasons, and a correction

**2021 and 2022 can be built.** Rounds 1 and 2 said the store held no week-one roster for them; that
was wrong. The dev copy holds them (`preseason_rosters`: 2,721 rows for 2021, 2,873 for 2022); round
1 read a filtered query and a stale artifact note. The house's roster ingest
(`python -m research.model.ros ingest-week-one-rosters --database <scratch> --season 2021 --season
2022`, `ingest_week1_rosters`) wrote 0 rows into the scratch copy because nothing was absent. Today's
builder makes both boards at their replay moments (2021: 539 players, moment
2021-09-10T23:59:59.999Z; 2022: 561, 2022-09-09T23:59:59.999Z). Two limits, named: their boards read
three prior seasons of published lines, and 2019 has none (only play-by-play-derived lines, which a
replay board does not admit), so the 2021 and 2022 boards are built on thinner history than a live
board; and the preseason priors (`preseason/priors`) were fitted on 2021 and 2022, so those two
boards are in sample for the preseason model, and stronger than an out-of-sample board. Both
effects favour the stale board in the fit, which can only push k up.

**2024's exposure, named.** No round has *judged* 2024, but its ordering numbers at exactly weeks 8
and 12 have been computed and read twice: round 1's development check (fit 2023, weeks 4, 8 and 12)
and round 2's (fit 2023, weeks 8 and 12: G1 passed all 24 cells at +0.04; G2 failed week-8
receivers in all three formats). 2024 was also a fit season of rounds 1 and 2. Round 3's design (no
interval, the round-2 model) was chosen knowing those numbers. A pass here is therefore weaker
evidence than a first look would be, and the results document will say so beside the verdict. The
fit no longer includes 2024, so round 3's numbers are not those checks' numbers.

## Gates

All must pass; a gate that cannot answer fails.

- **G1, ordering:** for W in {8, 12}, p in {QB, RB, WR, TE}, f in {PPR, half PPR, standard} (24
  cells): model rho minus stale-board rho **>= +0.04**, over a population of at least 20.
- **G2, the starters:** the same 24 cells: the model's mean rank error among the top-N finishers
  (QB 12, RB 24, WR 36, TE 12) **<=** the stale board's.
- **G4, isolation:** the fit's reader serves only 2021-2023 and refuses 2024-2026; the judgment's
  reader serves only 2024 and refuses 2025 and 2026; the judgment leaves the five tables' digests
  unchanged. No 2025 or 2026 outcome is read.
- G3 and G5 are not gates.

49 gate lines. The stale baseline is round 2's: the served PPR board, and in half PPR and standard
the served PPR board carried by the raw model's ratio (a decision from board content: past seasons'
half and standard boards are flat market tails). Thresholds in `model/ros/gates.py`, `ROUND_THREE`.

## Development check

Fit on 2021 and 2022, judged on 2023 weeks 8 and 12, the same code. 2023 is held out from the fit for
that check only; the judgment's fit then includes it. After the check only defects may change.

## Decision rule

- **All gates pass:** step 4 as the brief says. From week 7 of the product season (the run date
  against the first kickoff and the switch week, never a flag) the nightly serves `commish_ros_v3` in
  every format the run carries, with `floor` and `ceiling` null and the basis "rest of the 2026 season
  from week N, refreshed <run date>, no range in season"; the fitted numbers go to `model_artifacts`,
  pinned; the raw line is read once (from `preseason_candidates` if it holds it, else written once a
  run as an artifact); preseason runs are unchanged.
- **Any gate fails:** nothing ships; the results report every number; the model is not retuned and
  rerun against 2024.
