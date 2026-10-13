import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import { PROPS_ANCHOR_WEIGHT_ARTIFACT } from "@research-ts/projections/market/props-anchor-artifact";
import { draftVersionOf, MissingModelArtifactError, readModelArtifact } from "@research-ts/projections/model/artifacts";
import { publishCommittedModelArtifacts, readModelArtifactRecord } from "./lib/model-artifact-records";
import { checkVerdict, publishVerdict } from "./props-anchor-fit";

/**
 * The store half of the fit script, end to end against a real database: `--check` compares a fresh
 * verdict with the PINNED artifact, and a publish writes the next version's record and store row
 * together and names the pin to bump. The grid search itself is pure and is not re-run here.
 */
const db = createTestDb();

describe("props-anchor-fit: the check and publish paths", () => {
  beforeEach(async () => {
    await truncateAll(db);
    await publishCommittedModelArtifacts(db);
  });

  it("check: no drift when this run agrees with the pinned weight, drift when it does not", async () => {
    const pinned = (await readModelArtifact(db, PROPS_ANCHOR_WEIGHT_ARTIFACT)).payload;
    expect(await checkVerdict(db, pinned)).toEqual({ pinnedWeight: pinned.weight, drift: false });
    expect(await checkVerdict(db, { weight: null })).toEqual({ pinnedWeight: pinned.weight, drift: true });
  });

  it("check: throws, never guesses, when the store lacks the pinned version", async () => {
    await truncateAll(db);
    await expect(checkVerdict(db, { weight: 0.18 })).rejects.toBeInstanceOf(MissingModelArtifactError);
  });

  it("publish: writes v2's record and store row together and prints the pin", async () => {
    const dir = mkdtempSync(join(tmpdir(), "props-anchor-fit-"));
    const draft = draftVersionOf(PROPS_ANCHOR_WEIGHT_ARTIFACT);
    const { published, pinLine } = await publishVerdict(db, { weight: 0.2 }, "a re-fit", dir);
    expect(published).toMatchObject({ name: draft.name, version: draft.version, outcome: "inserted" });
    expect(existsSync(published.path)).toBe(true);
    expect(readModelArtifactRecord(published.path)).toMatchObject({ name: draft.name, version: draft.version, fittedOn: "a re-fit", payload: { weight: 0.2 } });
    expect((await readModelArtifact(db, draft)).payload).toEqual({ weight: 0.2 });
    expect(pinLine).toBe(`Pin PROPS_ANCHOR_WEIGHT_ARTIFACT.version = ${draft.version} in src/projections/market/props-anchor-artifact.ts to serve it.`);
    // The pinned version is untouched: the code serves v1 until a reviewed commit bumps it.
    expect((await readModelArtifact(db, PROPS_ANCHOR_WEIGHT_ARTIFACT)).payload).toEqual({ weight: 0.18 });
  });

  it("publish: a second identical publish is unchanged, a different one under the same draft is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "props-anchor-fit-"));
    await publishVerdict(db, { weight: 0.2 }, "a re-fit", dir);
    expect((await publishVerdict(db, { weight: 0.2 }, "a re-fit", dir)).published.outcome).toBe("unchanged");
    await expect(publishVerdict(db, { weight: 0.3 }, "a re-fit", dir)).rejects.toThrow(/already published with a different payload/);
  });
});
