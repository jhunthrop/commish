// THE PLAYER CAPSULE SWEEP (spec §9 AMENDED 2026-09-04, Task 3) — recomputes every board-relevant
// player's facts and regenerates a capsule wherever the facts hash has moved, the row is missing,
// or the existing row is still template-sourced (a 429'd or facts-outrun capsule keeps retrying
// on every sweep until the gateway lets it through, rather than freezing on its own template hash
// forever). Scheduled nightly (`schedules.ts`); also runnable on demand through the job system's
// own manual-enqueue/rerun tooling.
//
// IT IS ALSO THE PEEK-FACTS WRITER (peek-facts design §3.2, 2026-09-07). The pass this job already
// runs for the whole board is exactly the pass a precomputed peek row needs, so the rows are written
// from it here rather than by a second heavy job of its own.
//
// TERMINAL VS RETRYABLE: `generate.ts` never throws (the template is the permanent floor), so
// nothing inside a single player's own attempt can fail this job — a gateway outage degrades every
// eligible player to template this run and the summary says so plainly. What CAN throw is the
// database work around it (`collectBoardFacts`, `writeRefresh`, `getStoredCapsulesFor`,
// `upsertCapsule`), and that is ordinary retryable weather like every other job's own DB step.
import type { Db } from "@/db/client";
import type { JsonObject } from "@/domain/audit";
import type { Clock } from "@/domain/timing";
import { CAPSULE_CONFIG } from "@/capsules/config";
import { collectBoardFacts } from "@/capsules/collect";
import { describeCapsuleFallback, generateCapsule } from "@/capsules/generate";
import { writeRefresh } from "@/capsules/peek-facts";
import { getStoredCapsulesFor, upsertCapsule, type StoredPlayerCapsule } from "@/capsules/store";
import type { PlayerFacts } from "@/capsules/facts";
import { defineJob, type AnyJobDefinition, type StepOutcome } from "../contract";
import { enqueuePeekDocumentRebuildsQuietly } from "./peek-document-job";

export const CAPSULE_SWEEP_JOB_NAME = "capsule-sweep";

export interface CapsuleSweepPayload {
  /** Overrides `CAPSULE_CONFIG.sweepGenerationBudget` for this run only — an operator's manual
   *  rerun with a wider budget, mainly. Optional; the schedule's own fire never sets it. */
  readonly budget?: number;
}

export function parseCapsuleSweepPayload(raw: JsonObject): CapsuleSweepPayload {
  const budget = raw.budget;
  if (budget === undefined) return {};
  if (typeof budget !== "number" || !Number.isInteger(budget) || budget < 1) {
    throw new Error(`capsule-sweep payload: budget must be a positive integer, got ${JSON.stringify(budget)}.`);
  }
  return { budget };
}

function needsGeneration(facts: PlayerFacts, stored: StoredPlayerCapsule | undefined): boolean {
  return stored === undefined || stored.factsHash !== facts.factsHash || stored.source === "template";
}

export interface CapsuleSweepDeps {
  readonly apiKey: string;
  readonly fetch?: typeof globalThis.fetch;
}

export async function runCapsuleSweepStep(db: Db, clock: Clock, deps: CapsuleSweepDeps, payload: CapsuleSweepPayload): Promise<StepOutcome> {
  const asOf = new Date(clock.now());
  const pass = await collectBoardFacts(db, asOf);
  const facts = pass.facts;
  // THE PRECOMPUTED PEEK ROWS (peek-facts design §3.2) ride on the pass that just ran, before any
  // gateway call: a throttled or slow capsule generation must not be what decides whether a peek
  // opens fast, and the facts are already in hand either way.
  const peekFacts = await writeRefresh(db, pass);
  const stored = await getStoredCapsulesFor(db, facts.map((f) => f.identity.id));
  const eligible = facts.filter((f) => needsGeneration(f, stored.get(f.identity.id)));
  const budget = payload.budget ?? CAPSULE_CONFIG.sweepGenerationBudget;
  const toProcess = eligible.slice(0, budget);

  let llmCount = 0;
  let templateCount = 0;
  let totalCostUsd = 0;
  const detail: string[] = [];

  let first = true;
  for (const one of toProcess) {
    // Paced, not burst: see CAPSULE_CONFIG.sweepPacingMs. The pause sits BEFORE each player
    // after the first so a one-player run pays nothing.
    if (!first) await new Promise((resolve) => setTimeout(resolve, CAPSULE_CONFIG.sweepPacingMs));
    first = false;
    const result = await generateCapsule(one, { apiKey: deps.apiKey, fetch: deps.fetch });
    await upsertCapsule(db, one.identity.id, one.factsHash, result);
    const cost = (result.compact.usage?.costUsd ?? 0) + (result.full.usage?.costUsd ?? 0);
    totalCostUsd += cost;
    if (result.source === "llm") {
      llmCount += 1;
      detail.push(`${one.identity.name}: llm, $${cost.toFixed(6)}`);
    } else {
      templateCount += 1;
      // Labeled by REASON (sweep resilience, color v2, Task 4) — "throttled" (the gateway never
      // gave either size a usable response, even after write.ts's own 429 backoff) reads as a
      // wholly different operational condition from "failed validation" (the gateway talked, the
      // model kept writing something the validator rejected), and an operator scanning a run's own
      // detail lines needs to tell the two apart at a glance.
      detail.push(`${one.identity.name}: ${describeCapsuleFallback(result.compact, result.full)}`);
    }
  }

  // THE EVENT (peek document design §3.4, row two): a written capsule is a changed document input,
  // for every scoring hash in use. Only the players this run actually wrote a capsule for are named.
  // The reason stamp is this pass's own instant, so a retried tick that reaches here twice with the
  // same clock coalesces into one build rather than two.
  if (toProcess.length > 0) {
    await enqueuePeekDocumentRebuildsQuietly(db, clock, {
      playerIds: toProcess.map((one) => one.identity.id),
      reason: `capsule:${asOf.toISOString()}`,
    });
  }

  const remaining = eligible.length - toProcess.length;
  const summary =
    `capsule-sweep: ${facts.length} board players, ${eligible.length} needed a fresh generation, ` +
    `${toProcess.length} processed (${llmCount} llm, ${templateCount} template, $${totalCostUsd.toFixed(6)} spent)` +
    (remaining > 0 ? `, ${remaining} left for the next sweep` : "") +
    `. Peek facts: ${peekFacts.players} rows built, ${peekFacts.changed} changed, ${peekFacts.withTouchesRank} with a touches rank`;

  return { summary, detail };
}

export const capsuleSweepJob: AnyJobDefinition = defineJob<CapsuleSweepPayload>({
  name: CAPSULE_SWEEP_JOB_NAME,
  maxAttempts: 2,
  // Generous: up to `sweepGenerationBudget` players, each up to two gateway calls at up to two
  // attempts (one regeneration) per size, each bounded by the gateway's own `timeoutMs` and one
  // retry. Comfortably below a typical serverless ceiling even at the rare worst case.
  timeoutMs: 480_000,
  backoff: { baseMs: 60_000, maxMs: 10 * 60_000 },
  parsePayload: parseCapsuleSweepPayload,
  steps: [
    {
      name: "sweep",
      run: (ctx, payload) => runCapsuleSweepStep(ctx.db, ctx.clock, { apiKey: process.env[CAPSULE_CONFIG.gateway.envVars.apiKey] ?? "" }, payload),
    },
  ],
});
