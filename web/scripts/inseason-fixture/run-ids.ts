// The ids of the runs the fixture shot scripts are built from, each written by its own writer under
// web/.runs/runs/ (never committed), named once here so the writers and `npm run shots` agree.

/** The nightly's contract fixture run (research/nightly/contract/fixture), made after week 6. */
export const CONTRACT_RUN_ID = '2026-10-21T12-ros';
/** The contract run moved back to the fixture week's Saturday (saturday-run.ts). */
export const SATURDAY_RUN_ID = '2026-10-17T17-ros';
/** The stand-in run made Thursday morning of week 6 (one-board-run.ts). */
export const ONE_BOARD_RUN_ID = '2026-10-15T13-oneboard';
/** The contract run with Jahmyr Gibbs as a club mover or a free agent (mover-run.ts). */
export type ClubRun = 'mover' | 'free-agent';
export const clubRunId = (run: ClubRun): string => `2026-10-21T12-${run}`;
/** The record shots runs (record-fixture/run.ts): live's shape a week on, the record as the nightly
 * writes it on Monday night of week 6, and the two records' runs by mode (Lane 114). */
export const RECORD_SHAPE_RUN_ID = '2026-10-21T12-live-shape';
export const RECORD_LIVE_RUN_ID = '2026-10-21T12-live-week6';
export const recordTwoRunId = (mode: 'upcoming' | 'graded' | 'published'): string =>
	`2026-10-21T12-two-${mode}`;
