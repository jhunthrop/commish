import type { BoardRow } from "@research-ts/board/service";
import { getStoredCapsulesFor } from "@research-ts/capsules/store";
import type { Db } from "@research-ts/db/client";
import type { Clock } from "@research-ts/domain/timing";
import { BOARD_FORMATS, type BoardFormat } from "@research-ts/projections/preseason/board-formats";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import type { AdpFile, ArtifactRecord, BoardFile, GateRecord, Manifest, PlayerFile, StepRecord } from "./artifacts";
import { boardFileOf } from "./build/boards";
import { formatLabel, indexEntryOf, pageBoardsOf, pagePlayerIds, playerFileOf } from "./build/players";
import { BOARD_VARIANTS, PAGE_BOARD_VARIANT, boardKeyOf } from "./config";
import { adpGate, basisGate, boardDepthGate, capsuleGate, heldOutGate } from "./gates";
import { manifestSummary, previousHeldOut, promote, recordHeldOutBaseline, writeArtifact } from "./publish";
import { readLatestAdp, type AdpCapture } from "./reads/adp";
import { readBoards } from "./reads/boards";
import { heldOutScores } from "./reads/held-out";
import { readRecord } from "./reads/record";
import { nextRunId, runKey, STARTED_FILE } from "./run-id";
import type { RunStore } from "./run-store";
import { capsuleStep, fitStep, ingestStep, type StepContext } from "./steps";

export type NightlyStepName = "ingest" | "fit" | "capsules";
export const NIGHTLY_STEPS: readonly NightlyStepName[] = ["ingest", "fit", "capsules"];

export interface NightlyOptions {
  readonly skip: ReadonlySet<NightlyStepName>;
  /** Take the product season's board for real instead of verifying it (`fitStep`). */
  readonly persistBoard: boolean;
}

export interface NightlyDeps {
  readonly db: Db;
  readonly store: RunStore;
  readonly clock: Clock;
  readonly log: (line: string) => void;
}

/** Runs one step, recording a throw as a failed step so the run still writes what it can and says
 *  why it failed. A skipped step says it was asked to skip. */
async function runStep(name: NightlyStepName, options: NightlyOptions, log: (line: string) => void, body: () => Promise<StepRecord>): Promise<StepRecord> {
  if (options.skip.has(name)) return { name, status: "skipped", summary: "skipped by --skip" };
  log(`step ${name}: started`);
  try {
    const record = await body();
    log(`step ${name}: ${record.status}, ${record.summary}`);
    return record;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`step ${name}: FAILED, ${message}`);
    return { name, status: "failed", summary: message };
  }
}

function pageBoardKey(format: BoardFormat): string {
  return boardKeyOf({ ...PAGE_BOARD_VARIANT, format });
}

function adpFileOf(runId: string, captures: readonly AdpCapture[]): AdpFile {
  return {
    runId,
    season: PRODUCT_SEASON,
    formats: captures.map((capture) => ({
      format: capture.format,
      formatLabel: formatLabel(capture.format),
      source: capture.source,
      capturedAt: capture.capturedAt?.toISOString() ?? null,
      players: [...capture.adpByPlayerId].map(([id, adp]) => ({ id, adp })).sort((a, b) => a.adp - b.adp),
    })),
  };
}

/**
 * THE NIGHTLY RUN (spec §4): ingest, fit, capsules, then every artifact of spec §2.1 written under
 * one run id, the four validation gates, and the manifest last. A run that passes moves
 * `runs/latest.json`; a run that fails is kept for diagnosis and moves nothing.
 */
export async function runNightly(deps: NightlyDeps, options: NightlyOptions): Promise<Manifest> {
  const { db, store, clock, log } = deps;
  const startedAt = new Date(clock.now());
  const runId = await nextRunId(store, startedAt);
  await store.put(runKey(runId, STARTED_FILE), `${JSON.stringify({ runId, startedAt: startedAt.toISOString() }, null, 2)}\n`);
  log(`run ${runId}: season ${PRODUCT_SEASON}, writing to ${store.locate(`runs/${runId}`)}`);
  const context: StepContext = { db, clock, log };

  const steps: StepRecord[] = [];
  steps.push(await runStep("ingest", options, log, () => ingestStep(context)));
  steps.push(await runStep("fit", options, log, () => fitStep(context, options.persistBoard)));
  const asOf = new Date(clock.now());
  const boards = await readBoards(db, BOARD_VARIANTS, asOf);
  const pageBoards = pageBoardsOf(new Map(BOARD_FORMATS.map((format) => [format, boards.get(pageBoardKey(format)) ?? ([] as readonly BoardRow[])] as const)));
  const playerIds = pagePlayerIds(pageBoards);
  steps.push(await runStep("capsules", options, log, () => capsuleStep(context, playerIds)));

  const [adp, capsules, record, heldOut, previous] = await Promise.all([
    readLatestAdp(db),
    getStoredCapsulesFor(db, playerIds),
    readRecord(db, runId, PRODUCT_SEASON),
    heldOutScores(db),
    previousHeldOut(store),
  ]);
  const boardFiles: BoardFile[] = BOARD_VARIANTS.map((variant) => boardFileOf(runId, PRODUCT_SEASON, variant, boards.get(boardKeyOf(variant)) ?? []));
  const playerFiles: PlayerFile[] = playerIds.map((id) =>
    playerFileOf(id, { runId, season: PRODUCT_SEASON, pageVariant: PAGE_BOARD_VARIANT, boards: pageBoards, adp, capsules }),
  );
  const adpFile = adpFileOf(runId, adp);
  const backtest = heldOutGate(heldOut, previous);
  const gates: GateRecord[] = [backtest, boardDepthGate(boardFiles), capsuleGate(playerFiles), basisGate(boardFiles, playerFiles), adpGate(adpFile.formats)];
  for (const gate of gates) log(`gate ${gate.gate}: ${gate.passed ? "passed" : "FAILED"}, ${gate.summary}`);

  const artifacts: ArtifactRecord[] = [];
  for (const board of boardFiles) artifacts.push(await writeArtifact(store, runId, `boards/${board.key}.json`, board));
  for (const player of playerFiles) artifacts.push(await writeArtifact(store, runId, `players/${player.id}.json`, player));
  artifacts.push(await writeArtifact(store, runId, "adp.json", adpFile));
  artifacts.push(await writeArtifact(store, runId, "record.json", record));
  artifacts.push(await writeArtifact(store, runId, "index.json", playerFiles.map(indexEntryOf)));

  const passed = gates.every((gate) => gate.passed) && steps.every((step) => step.status !== "failed");
  const manifest: Manifest = {
    runId,
    status: passed ? "passed" : "failed",
    season: PRODUCT_SEASON,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date(clock.now()).toISOString(),
    steps,
    gates,
    heldOut,
    counts: {
      boards: boardFiles.length,
      players: playerFiles.length,
      capsules: playerFiles.filter((player) => player.capsule !== null).length,
      adpFormats: adp.filter((capture) => capture.capturedAt !== null).length,
    },
    artifacts,
  };
  await writeArtifact(store, runId, "manifest.json", manifest);
  if (backtest.passed) await recordHeldOutBaseline(store, runId, heldOut);
  if (passed) await promote(store, manifest);
  log(manifestSummary(manifest));
  return manifest;
}
