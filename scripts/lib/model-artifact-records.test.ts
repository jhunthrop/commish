import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { MODEL_ARTIFACT_CATALOG } from "@research/projections/model/artifact-catalog";
import { draftVersionOf, loadModelArtifact, readModelArtifact } from "@research/projections/model/artifacts";
import { PROPS_ANCHOR_WEIGHT_ARTIFACT } from "@research/projections/market/props-anchor-artifact";
import { VARIANCE_POSITIONS } from "@research/projections/preseason/game-variance";
import { GAME_VARIANCE_SKILL_ARTIFACT, loadShippedGameVariance } from "@research/projections/preseason/game-variance-artifacts";
import {
  listModelArtifactRecordFiles,
  MODEL_ARTIFACT_RECORDS_DIR,
  modelArtifactRecordPath,
  publishCommittedModelArtifacts,
  publishModelArtifactRecord,
  readModelArtifactRecord,
  recordAndPublishFit,
} from "./model-artifact-records";

/**
 * The file-to-table path, the way an operator runs it: every committed record parses under the
 * catalogue's own parser, lands in the store, and a second run changes nothing. The committed
 * directory itself is the last case, so the production step (`npm run artifacts:publish`) is
 * proven on the exact rows it will write.
 */
const db = createTestDb();

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), "model-artifacts-"));
}

function writeRecord(dir: string, relativePath: string, body: unknown): string {
  const path = join(dir, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(body));
  return path;
}

const SKILL_RECORD = {
  name: "preseason/game-variance-skill",
  version: 1,
  fitStamp: "2026-09-04T21:14:06.000Z",
  fittedOn: "a test window",
  payload: { rookie: { QB: 1 }, veteran: { QB: 2 } },
};

describe("the committed records", () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  it("places a record at <dir>/<name>/v<version>.json", () => {
    expect(modelArtifactRecordPath("preseason/game-variance-skill", 3, "x")).toBe("x/preseason/game-variance-skill/v3.json");
  });

  it("lists only v<n>.json files, recursively, in a stable order", () => {
    const dir = scratchDir();
    writeRecord(dir, "b/two/v1.json", SKILL_RECORD);
    writeRecord(dir, "a/one/v2.json", SKILL_RECORD);
    writeRecord(dir, "a/one/README.md", {});
    writeRecord(dir, "a/one/notes.json", {});
    expect(listModelArtifactRecordFiles(dir)).toEqual([join(dir, "a/one/v2.json"), join(dir, "b/two/v1.json")]);
  });

  it("refuses a record whose name or version disagrees with its path", () => {
    const dir = scratchDir();
    const misplaced = writeRecord(dir, "preseason/game-variance-skill/v2.json", SKILL_RECORD);
    expect(() => readModelArtifactRecord(misplaced)).toThrow(/belongs at .*v1\.json/);
  });

  it("refuses a record whose name is not in the catalogue, before anything is written", async () => {
    const dir = scratchDir();
    const unknown = writeRecord(dir, "nobody/knows/v1.json", { ...SKILL_RECORD, name: "nobody/knows" });
    await expect(publishModelArtifactRecord(db, unknown)).rejects.toThrow(/not in the model artifact catalog/);
  });

  it("refuses a record whose payload the catalogued parser refuses", async () => {
    const dir = scratchDir();
    const bad = writeRecord(dir, "preseason/game-variance-skill/v1.json", { ...SKILL_RECORD, payload: { rookie: { FB: 1 }, veteran: {} } });
    await expect(publishModelArtifactRecord(db, bad)).rejects.toThrow(/FB/);
  });

  it("publishes a directory, and a second run is unchanged", async () => {
    const dir = scratchDir();
    writeRecord(dir, "preseason/game-variance-skill/v1.json", SKILL_RECORD);
    const first = await publishCommittedModelArtifacts(db, dir);
    expect(first.map((entry) => entry.outcome)).toEqual(["inserted"]);
    const second = await publishCommittedModelArtifacts(db, dir);
    expect(second.map((entry) => entry.outcome)).toEqual(["unchanged"]);
    expect(await loadModelArtifact(db, GAME_VARIANCE_SKILL_ARTIFACT)).toEqual(SKILL_RECORD.payload);
  });

  it("recordAndPublishFit writes the next version's record and the store row together", async () => {
    const dir = scratchDir();
    const draft = draftVersionOf(PROPS_ANCHOR_WEIGHT_ARTIFACT);
    const fitStamp = new Date("2026-09-09T12:00:00.000Z");
    const result = await recordAndPublishFit(db, draft, { weight: 0.2 }, { fitStamp, fittedOn: "a re-fit" }, dir);
    expect(result).toEqual({ path: modelArtifactRecordPath(draft.name, draft.version, dir), name: draft.name, version: draft.version, outcome: "inserted" });
    expect(readModelArtifactRecord(result.path)).toEqual({ name: draft.name, version: draft.version, fitStamp: fitStamp.toISOString(), fittedOn: "a re-fit", payload: { weight: 0.2 } });
    expect((await readModelArtifact(db, draft)).payload).toEqual({ weight: 0.2 });
  });

  it("lands the committed directory under the real catalogue: every pinned artifact loads and the variance table is complete", async () => {
    const published = await publishCommittedModelArtifacts(db, MODEL_ARTIFACT_RECORDS_DIR);
    expect(published.length).toBeGreaterThanOrEqual(MODEL_ARTIFACT_CATALOG.length);
    for (const spec of MODEL_ARTIFACT_CATALOG) {
      expect(published.some((entry) => entry.name === spec.name && entry.version === spec.version)).toBe(true);
      await expect(loadModelArtifact(db, spec)).resolves.toBeDefined();
    }
    const variance = await loadShippedGameVariance(db);
    for (const playerClass of ["rookie", "veteran"] as const) {
      for (const position of VARIANCE_POSITIONS) expect(variance[playerClass][position]).toBeGreaterThan(0);
    }
  });
});
