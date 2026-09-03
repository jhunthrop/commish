// THE VERCEL TICK, testably: everything `src/app/api/jobs/tick/route.ts` does, with the db,
// definitions and env injected so the route file stays a wire and this logic runs against the
// test lanes. One authenticated request = one bounded `runTick` = schedule catch-up + reclaim +
// a budgeted drain; a long job makes progress via step checkpoints and finishes across ticks.
import type { Db } from "@/db/client";
import { fail, ok } from "@/lib/api/respond";
import { JOBS_CONFIG } from "./config";
import type { AnyJobDefinition } from "./contract";
import { formatErrorForLog } from "./execute";
import { runTick } from "./runner";
import { cronSecretFromEnv, isAuthorizedTick, type EnvRecord } from "./tick-auth";

export interface TickHandlerDeps {
  readonly db: Db;
  readonly definitions: ReadonlyMap<string, AnyJobDefinition>;
  readonly env: EnvRecord;
  readonly workerId: string;
}

/** `JOBS_TICK_BUDGET_MS` override, clamped so a typo cannot ask for a zero-length or
 *  function-killing tick; the route's own `maxDuration` leaves headroom above the ceiling. */
const BUDGET_FLOOR_MS = 5_000;
const BUDGET_CEILING_MS = 280_000;

export function tickBudgetMs(env: EnvRecord): number {
  const raw = env.JOBS_TICK_BUDGET_MS;
  if (raw === undefined || raw === "") return JOBS_CONFIG.vercelTickBudgetMsDefault;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return JOBS_CONFIG.vercelTickBudgetMsDefault;
  return Math.min(BUDGET_CEILING_MS, Math.max(BUDGET_FLOOR_MS, Math.round(parsed)));
}

export async function handleTick(request: Request, deps: TickHandlerDeps): Promise<Response> {
  const secret = readSecret(deps.env);
  if (secret === null) {
    // Startup validation, surfaced per request: an unconfigured deployment refuses everything.
    console.error("[jobs] tick refused: CRON_SECRET is not configured.");
    return fail("Job tick is not configured.", 500);
  }
  if (!isAuthorizedTick(request.headers.get("authorization"), secret)) {
    return fail("Not authorized.", 401);
  }

  try {
    const report = await runTick(
      { db: deps.db, clock: { now: () => new Date().toISOString() }, random: Math.random, workerId: deps.workerId },
      deps.definitions,
      { budgetMs: tickBudgetMs(deps.env), maxJobs: JOBS_CONFIG.vercelTickMaxJobs },
    );
    return ok(report);
  } catch (error: unknown) {
    // Scrubbed text, never the raw object: a stack or a nested cause can carry what a message
    // does not (the same rule the executor's own logging follows).
    console.error(`[jobs] tick failed: ${formatErrorForLog(error)}`);
    return fail("Tick failed. See the server log.", 500);
  }
}

function readSecret(env: EnvRecord): string | null {
  try {
    return cronSecretFromEnv(env);
  } catch {
    return null;
  }
}
