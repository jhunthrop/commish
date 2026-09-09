# Play-caller facts, 1999-2026

`play-callers.csv` records WHO CALLED THE OFFENSIVE PLAYS for every NFL team-season from 1999
through 2026, with midseason changes as separate week-range rows. It is the sourced coordinator
table `src/projections/nflverse/coaches.ts` was designed to receive: the coaching-change prior
attaches to the play-caller's own history, not the head coach's, wherever this table has a row.

## Format

`season,team,name,role,start_week,end_week,source,note`

- `team` is the era-correct nflverse abbreviation (`OAK` through 2019, `LV` after; `SD`/`LAC`;
  `STL`/`LA`; `WAS` across all Washington renames).
- `role` is `HC` when the head coach called plays, `OC` otherwise. The NAME is what the model
  attributes history to; the role is provenance.
- Week ranges exactly partition each season (1-17 through 2020, 1-18 from 2021). The validator
  enforces this: `npm run facts:play-callers`.

## Sources and the licensing ruling

Assembled 2026-08-31 from Wikipedia team-season articles via the sanctioned MediaWiki API
(CC BY-SA), with coach-article fallbacks where a season article was silent. Rows carry
`source: wikipedia` until hand-verified against the founder's paid Pro Football Reference
account, which upgrades them to `both`. The PFR ruling (plans/phase-8-legal-launch-readiness.md,
2026-08-31): interface and Stathead exports at human request rates only, NEVER a crawler, and
these names are model inputs only — they never render in the product.

`verification-queue.md` lists every row whose sourcing carried doubt (article silent,
reputation-based HC attribution, estimated midseason week split). Work that queue against PFR
when convenient; correctness of the COMMON case does not wait on it.

## Verification record

- Merge-time validation: full coverage and exact week partition, 944 rows (2026-08-31).
- Independent 40-row seeded spot-check (seed 20260831): results in the SDD workspace's
  spot-check-results.md at assembly time: 24 confirmed, 15 plausible (all reputation-flagged HC attributions, deliberately not scored confirmed), 1 wrong (JAX 2018 handoff week, corrected in place).
- Known judgment calls patched at merge: CHI 2025 to Ben Johnson (HC play-caller from his 2025
  arrival, not 2026); MIA 2021 co-OC pair collapsed to Godsey pending verification; LV 2022
  span corrected to the 18-week era.

## Ingesting

`play-callers.csv` is the reviewed input to `npm run coaches:ingest`, which validates it exactly as
`npm run facts:play-callers` does and upserts every row into the `coaches` table. Nothing in the
server reads this file: the team page and the fact sheet read the table through
`src/coaches/store.ts`. The file read lives in `scripts/lib/play-callers-csv.ts`.

## Refreshing

Each offseason: append the new season's rows (roughly 10-15 changes plus holdovers), re-run
`npm run facts:play-callers`, verify new rows against PFR before upgrading their `source`, and run
`npm run coaches:ingest` against each database that serves them.
