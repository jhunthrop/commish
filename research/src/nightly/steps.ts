import type { Db } from "@research/db/client";
import { nflPlayers } from "@research/db/schema";
import type { Clock } from "@research/domain/timing";
import { CAPSULE_CONFIG } from "@research/capsules/config";
import { getStoredCapsulesFor, queueCapsuleRegeneration } from "@research/capsules/store";
import { describeSweep, sweepCapsules } from "@research/capsules/sweep";
import { voiceRuleHits } from "@research/capsules/voice-rules";
import { envOrUndefined } from "@research/lib/env";
import { harvestCaptures } from "@research/projections/harvest";
import { ingestAdpSnapshot } from "@research/projections/market/adp-snapshot";
import { PRODUCT_SEASON } from "@research/projections/preseason/current";
import { persistSeason } from "@research/projections/preseason/persist";
import { TANK01_CONFIG } from "@research/stats/tank01/config";
import type { StepRecord } from "./artifacts";

/** What a step needs from the run: the connection, the clock, and where its operator lines go. */
export interface StepContext {
  readonly db: Db;
  readonly clock: Clock;
  readonly log: (line: string) => void;
}

/**
 * INGEST: the provider capture the capsules read facts from (injuries, news, depth charts, inactives,
 * betting lines; `projections/harvest.ts`) and tonight's ADP in every format
 * (`projections/market/adp-snapshot.ts`). The capture needs the stats provider key; without it the
 * capture is skipped by name and the ADP capture, which needs no key, still runs.
 */
export async function ingestStep({ db, clock }: StepContext): Promise<StepRecord> {
  const parts: string[] = [];
  if (envOrUndefined(TANK01_CONFIG.envVars.apiKey) === undefined) {
    parts.push(`capture skipped, ${TANK01_CONFIG.envVars.apiKey} is not set`);
  } else {
    const harvest = await harvestCaptures(db, clock, {});
    parts.push(`${harvest.summary}, ${harvest.moved.length} player(s) moved`);
  }
  const adp = await ingestAdpSnapshot(db, { now: () => new Date(clock.now()) });
  const failed = adp.byFormat.filter((format) => format.error !== null);
  parts.push(`adp: ${adp.written} rows written over ${adp.byFormat.length} formats${failed.map((format) => `, ${format.format} failed: ${format.error}`).join("")}`);
  return { name: "ingest", status: failed.length === adp.byFormat.length ? "failed" : "ran", summary: parts.join(". ") };
}

/**
 * FIT: the product season's boards, through the one board builder the operator script uses
 * (`persistSeason`). By default it VERIFIES: each board is built and compared with what is stored,
 * and nothing is written, because retaking the product season's live board replaces what the site
 * serves and what the register freezes (`persist.ts`'s own INGESTED_SEASONS note) and is a
 * deliberate act. `--persist-board` takes it.
 */
export async function fitStep({ db, clock, log }: StepContext, persist: boolean): Promise<StepRecord> {
  const names = new Map((await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers)).map((row) => [row.id, row.name] as const));
  const take = await persistSeason(db, PRODUCT_SEASON, clock, names, { diffOnly: !persist, log });
  if (persist) {
    const written = take.written.map((leg) => `${leg.source} ${leg.counts.written} rows`).join(", ");
    return { name: "fit", status: "ran", summary: `${PRODUCT_SEASON} ${take.momentKind} board written: ${written}` };
  }
  const moved = take.diffs.map((leg) => `${leg.source} ${leg.diffs.reduce((sum, diff) => sum + diff.added + diff.removed + diff.changed, 0)} reasons would change`);
  return { name: "fit", status: "ran", summary: `${PRODUCT_SEASON} ${take.momentKind} board verified, nothing written: ${moved.join(", ")}` };
}

/**
 * CAPSULES: every capsule still carrying a set phrase or an aside is queued for a rewrite, then the
 * sweep writes every player whose facts moved, whose row is missing or whose read is the template.
 * Without the writer's key the step is skipped by name rather than run, because a sweep with no key
 * would demote every written read it touched to the template.
 */
export async function capsuleStep({ db, clock }: StepContext, playerIds: readonly string[]): Promise<StepRecord> {
  const apiKey = envOrUndefined(CAPSULE_CONFIG.gateway.envVars.apiKey);
  if (apiKey === undefined) return { name: "capsules", status: "skipped", summary: `${CAPSULE_CONFIG.gateway.envVars.apiKey} is not set, stored capsules are published as they are` };
  const stored = await getStoredCapsulesFor(db, playerIds);
  const offenders = [...stored.values()].filter((capsule) => voiceRuleHits(`${capsule.bodyFull} ${capsule.bodyCompact}`).length > 0).map((capsule) => capsule.playerId);
  const queued = await queueCapsuleRegeneration(db, offenders);
  const report = await sweepCapsules(db, clock, { apiKey });
  return { name: "capsules", status: "ran", summary: `${queued} queued for a voice-rule rewrite. ${describeSweep(report)}` };
}
