// THE PEEK DOCUMENT REBUILD (peek document design §3.4, 2026-09-07) — the job every input event
// enqueues, and the only thing that ever writes `player_peek_documents` in production.
//
// EVENTS, NEVER A CRON. A document goes stale for exactly five reasons and the product already owns
// all five: weekly stats finalize, a capsule is written, a peek-facts row is written, a harvest
// capture moves an injury designation or a headline, or a league's scoring rules change. Each one
// enqueues a targeted rebuild the moment it happens, the way `draft-grades` is enqueued post-commit
// from the draft store, so the documents are as fresh as the data behind them and no schedule has to
// guess at how often that is. A roster change enqueues NOTHING: the holder is joined live.
//
// COALESCING IS THE IDEMPOTENCY KEY. `peek-document:<hash>:<reason>`, where the reason names the
// GENERATION of the input that asked for the rebuild (a facts `as_of`, a capsule's facts hash, the
// finalized week, the capture instant, the new scoring hash). Two enqueues of the same generation
// before the tick drains are one job and therefore one build. A later generation mints a new key,
// because it is genuinely new work.
//
// TERMINAL VS RETRYABLE: a payload that does not parse dead-letters through the contract's own
// terminal path, since no retry makes a malformed row parse. Everything the build itself can throw
// is ordinary database weather and retries, exactly like every other data job here.
import type { Db, DbTx } from "@/db/client";
import { writePeekDocuments } from "@/capsules/peek-document-store";
import type { JsonObject } from "@/domain/audit";
import { PPR_SCORING, type ScoringSettings } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import { eq } from "drizzle-orm";
import { leagues, scoringSettings } from "@/db/schema";
import { backfillLeagueScoringHashes, scoringHashesInUse } from "@/league-service/scoring-hash";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import type { ScoringRules } from "@/scoring";
import { enqueueJob } from "../store";
import { defineJob, TerminalJobError, type AnyJobDefinition, type StepOutcome } from "../contract";

export const PEEK_DOCUMENT_JOB_NAME = "peek-document";

export interface PeekDocumentJobPayload {
  readonly scoringHash: string;
  /** `null` means every player the product carries, which is what a whole-hash build asks for. */
  readonly playerIds: readonly string[] | null;
  /** WHY this rebuild exists and WHICH generation of its input asked for it. Half the idempotency
   *  key, and the line an operator reads on the admin page to know what moved. */
  readonly reason: string;
}

export function parsePeekDocumentJobPayload(raw: JsonObject): PeekDocumentJobPayload {
  const { scoringHash, playerIds, reason } = raw;
  if (typeof scoringHash !== "string" || scoringHash === "") {
    throw new Error(`peek-document payload: scoringHash must be a non-empty string, got ${JSON.stringify(scoringHash)}.`);
  }
  if (typeof reason !== "string" || reason === "") {
    throw new Error(`peek-document payload: reason must be a non-empty string, got ${JSON.stringify(reason)}.`);
  }
  if (playerIds !== null && playerIds !== undefined && !(Array.isArray(playerIds) && playerIds.every((id) => typeof id === "string"))) {
    throw new Error(`peek-document payload: playerIds must be null or an array of ids, got ${JSON.stringify(playerIds)}.`);
  }
  return { scoringHash, playerIds: playerIds === undefined ? null : (playerIds as readonly string[] | null), reason };
}

/**
 * WHICH RULE SET A HASH NAMES. The hash is a digest, so it cannot be inverted: the rules come back
 * from a league that is actually using it, which is the only place they honestly exist.
 *
 * A hash no league uses any more is a TERMINAL refusal rather than a silent no-op. It means the job
 * was enqueued for a rule set that has since been abandoned, and building documents nobody can be
 * served would be work with no reader.
 */
async function rulesForHash(db: Db, scoringHash: string): Promise<ScoringRules> {
  const [league] = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.scoringHash, scoringHash)).limit(1);
  if (league === undefined) {
    throw new TerminalJobError(`peek-document: no league uses scoring hash ${scoringHash}, so there are no rules to build under.`);
  }
  const [settings] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, league.id));
  const rules: ScoringSettings = settings ?? { leagueId: league.id, ...PPR_SCORING };
  return rules;
}

export async function runPeekDocumentStep(db: Db, clock: Clock, payload: PeekDocumentJobPayload): Promise<StepOutcome> {
  // The self-healing pass first: a deploy whose leagues have never had a hash computed would
  // otherwise have nothing for this job's own `rulesForHash` to find.
  const healed = await backfillLeagueScoringHashes(db);
  const rules = await rulesForHash(db, payload.scoringHash);
  // THE INJECTED CLOCK, never a wall clock: the document stamp a build writes has to be the same
  // instant every other stamp in this tick uses, so a replayed or back-dated run writes rows a reader
  // standing at that instant can actually see.
  const asOf = new Date(clock.now());

  const written = await writePeekDocuments(db, {
    season: PRODUCT_SEASON,
    scoringHash: payload.scoringHash,
    rules,
    playerIds: payload.playerIds,
    asOf,
  });

  const scope = payload.playerIds === null ? "every player" : `${payload.playerIds.length} player${payload.playerIds.length === 1 ? "" : "s"}`;
  return {
    summary:
      `peek-document ${payload.scoringHash.slice(0, 12)} (${payload.reason}): ${written.players} document${written.players === 1 ? "" : "s"} built for ${scope}, ` +
      `${written.changed} changed` +
      (healed > 0 ? `, ${healed} league scoring hash${healed === 1 ? "" : "es"} backfilled` : ""),
    detail: [],
  };
}

export const peekDocumentJob: AnyJobDefinition = defineJob<PeekDocumentJobPayload>({
  name: PEEK_DOCUMENT_JOB_NAME,
  maxAttempts: 3,
  // A whole-hash build reads the player universe, one current-season stat-line set and one
  // (position, season) set per prior season, then writes in batches. Generous headroom against a
  // cold database, and comfortably inside a serverless tick.
  timeoutMs: 300_000,
  backoff: { baseMs: 30_000, maxMs: 5 * 60_000 },
  parsePayload: parsePeekDocumentJobPayload,
  steps: [{ name: "build", run: (ctx, payload) => runPeekDocumentStep(ctx.db, ctx.clock, payload) }],
});

/** What one event asks to be rebuilt. */
export interface PeekRebuildScope {
  /** `null` means every player for the named hashes. */
  readonly playerIds: readonly string[] | null;
  /**
   * The event's own generation stamp: a facts `as_of`, a capsule's facts hash, the finalized week,
   * a capture instant, a new scoring hash. It is what makes two enqueues of the SAME work coalesce
   * and two enqueues of genuinely different work not.
   */
  readonly reason: string;
  /** Omitted for a league-agnostic event, which rebuilds every hash in use. Set by the settings
   *  path and the miss path, which each name exactly one. */
  readonly scoringHashes?: readonly string[];
}

/**
 * ENQUEUES ONE REBUILD PER HASH, and swallows its own failures.
 *
 * The swallow is `enqueueDraftGradesJobQuietly`'s discipline exactly, for the same reason: every
 * caller here is an event that has ALREADY happened and already committed. A queue insert that fails
 * must never roll back a finalized week, a written capsule or a captured harvest, and must never
 * make one of those look like it failed. The consequence of a lost enqueue is a document that stays
 * one generation behind until the next event, which the `as_of` on the document itself states
 * plainly rather than hiding.
 *
 * Returns how many jobs were actually created, which is zero when every one of them coalesced into
 * an enqueue that was already waiting.
 */
export async function enqueuePeekDocumentRebuildsQuietly(db: Db | DbTx, clock: Clock, scope: PeekRebuildScope): Promise<number> {
  try {
    const hashes = scope.scoringHashes ?? (await scoringHashesInUse(db));
    let enqueued = 0;
    for (const scoringHash of hashes) {
      const result = await enqueueJob(db, clock, {
        name: PEEK_DOCUMENT_JOB_NAME,
        idempotencyKey: `peek-document:${scoringHash}:${scope.reason}`,
        payload: { scoringHash, playerIds: scope.playerIds === null ? null : [...scope.playerIds], reason: scope.reason },
        maxAttempts: peekDocumentJob.maxAttempts,
        runAt: new Date(clock.now()),
      });
      if (result.enqueued) enqueued += 1;
    }
    return enqueued;
  } catch (error: unknown) {
    console.error("[peek-document] enqueue failed", { reason: scope.reason }, error);
    return 0;
  }
}
