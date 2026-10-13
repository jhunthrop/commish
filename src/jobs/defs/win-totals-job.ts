// THE WIN-TOTALS REFRESH AS A LEAGUE-APP JOB. The work is the research core's
// (`@research-ts/projections/vegas/win-totals-refresh`); this binding owns the payload and classifies a
// publisher file that changed shape as terminal, since no retry fixes it.
import type { Db } from "@research-ts/db/client";
import type { JsonObject } from "@research-ts/domain/json";
import type { Clock } from "@research-ts/domain/timing";
import { PublisherShapeError, refreshWinTotals, type WinTotalsDeps, type WinTotalsPayload } from "@research-ts/projections/vegas/win-totals-refresh";
import { defineJob, TerminalJobError, type AnyJobDefinition, type StepOutcome } from "../contract";

export const WIN_TOTALS_JOB_NAME = "win-totals";

export function parseWinTotalsPayload(raw: JsonObject): WinTotalsPayload {
  const season = raw.season;
  if (season === undefined) return {};
  if (typeof season !== "number" || !Number.isInteger(season) || season < 2000) {
    throw new Error(`win-totals payload: season must be a four-digit integer, got ${JSON.stringify(season)}.`);
  }
  return { season };
}

export async function runWinTotalsStep(db: Db, clock: Clock, payload: WinTotalsPayload, deps: WinTotalsDeps = {}): Promise<StepOutcome> {
  try {
    return await refreshWinTotals(db, clock, payload, deps);
  } catch (error) {
    if (error instanceof PublisherShapeError) throw new TerminalJobError(error.message);
    throw error;
  }
}

export const winTotalsJob: AnyJobDefinition = defineJob<WinTotalsPayload>({
  name: WIN_TOTALS_JOB_NAME,
  maxAttempts: 3,
  // One fetch of a small CSV plus a write and its read-back verification.
  timeoutMs: 60_000,
  backoff: { baseMs: 60_000, maxMs: 10 * 60_000 },
  parsePayload: parseWinTotalsPayload,
  steps: [{ name: "fetch", run: (ctx, payload) => runWinTotalsStep(ctx.db, ctx.clock, payload) }],
});
