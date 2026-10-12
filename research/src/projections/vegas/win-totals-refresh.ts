// THE WIN-TOTALS REFRESH (dossier-voice round §3.6; the research nightly run's ingest, and the
// league app's `win-totals` job until cutover) — the team win total the Books module states came
// from a committed, hand-curated file, and a hand-curated file is a human step every August
// forever. [[pfr-account-for-model-inputs]] rules that out: what can be automated is automated, and
// what cannot is skipped rather than done by hand on a schedule.
//
// This job reads the publisher's own file (`PUBLISHED_WIN_TOTALS_URL`, the exact source
// `data/win-totals/README.md` records the committed CSV was fetched from once) for the product
// season and writes it through the SAME verified writer the committed file goes through.
//
// THE COMMITTED FILE IS STILL THE SEED. It is validated row by row against the store's own schedule
// (`scripts/validate-win-totals.ts`) and remains what `ingestVegasWinTotals` reads. This job only
// ever lands a season the publisher has posted, and every row it writes carries the same
// `VEGAS_SOURCE` stamp and the same week-one convention, so the two paths are indistinguishable
// downstream, which is the point.
//
// NOT POSTED IS A REAL ANSWER. A season the publisher has not posted, or has posted only part of,
// writes NOTHING and says so in its summary. The module then keeps saying "Team win total: not
// posted yet", which is true. Half a league of stored win totals would be a board where some teams
// carry a market and some do not for no reason a reader could ever see.
//
// AFTER KICKOFF IT SELF-DISABLES, the same posture `props-preseason-snapshot-job.ts` keeps: a
// PRESEASON win total stops being news the moment the season starts, and a weekly cron that keeps
// re-fetching one is a request nobody reads. No schedule surgery each September, no network call.
//
// TERMINAL VS RETRYABLE: a publisher file whose shape has changed (a renamed column) is terminal —
// every attempt reads the same file and no retry fixes a rename, it needs a human. Everything else
// (a 5xx, a network error, the database write) is ordinary retryable weather.
import type { Db } from "@research/db/client";
import type { Clock } from "@research/domain/timing";
import { PRODUCT_SEASON } from "@research/projections/preseason/current";
import { firstKickoffFor } from "@research/projections/team-store";
import { fetchPublishedWinTotals, writeVerifiedWinTotals } from "@research/projections/vegas/ingest";

export interface WinTotalsPayload {
  /** Which season to fetch. Defaults to `PRODUCT_SEASON`; an operator's manual run can name
   *  another (a season the committed file predates, most likely). */
  readonly season?: number;
}

export interface WinTotalsDeps {
  readonly fetch?: typeof globalThis.fetch;
}

/** The publisher's file changed shape: a human's problem, not a retry's (see the module docblock). */
export class PublisherShapeError extends Error {
  override readonly name = "PublisherShapeError";
}

/** A shape failure is a human's problem, not a retry's — see the module docblock. */
function isShapeFailure(error: Error): boolean {
  return /has no ".*" column|returned a file with no rows/.test(error.message);
}

export async function refreshWinTotals(db: Db, clock: Clock, payload: WinTotalsPayload, deps: WinTotalsDeps = {}): Promise<{ readonly summary: string; readonly detail: readonly string[] }> {
  const season = payload.season ?? PRODUCT_SEASON;
  const kickoff = await firstKickoffFor(db, season);
  if (kickoff !== null && new Date(clock.now()) >= kickoff) {
    return { summary: `win-totals: ${season} has kicked off, so its preseason lines are settled. Nothing fetched.`, detail: [] };
  }

  let published;
  try {
    published = await fetchPublishedWinTotals(season, deps);
  } catch (error: unknown) {
    if (error instanceof Error && isShapeFailure(error)) {
      throw new PublisherShapeError(`win-totals: the publisher's file no longer has the shape this reader needs. ${error.message}`);
    }
    throw error;
  }

  if (!published.posted) {
    return {
      summary: `win-totals: the publisher has posted ${published.teamsPosted} team(s) for ${season}, not a full league. Nothing written, and the page keeps saying "not posted yet".`,
      detail: [],
    };
  }

  const report = await writeVerifiedWinTotals(db, published.rows);
  return {
    summary: `win-totals: ${report.rowsRead} rows read for ${season}, ${report.observationsWritten} new observation(s) written.`,
    detail: [`source ${published.rows[0]?.source ?? "unstated"}, stamped ${published.rows[0]?.sourceDate ?? "unstated"}`],
  };
}
