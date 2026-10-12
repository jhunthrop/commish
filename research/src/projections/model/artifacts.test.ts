import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { modelArtifacts } from "@research/db/schema";
import { createTestDb, truncateAll } from "@research/db/test-db";
import { invalidateAllTtlMemosForTests } from "@research/lib/cache/ttl-memo";
import {
  draftVersionOf,
  loadModelArtifact,
  MissingModelArtifactError,
  ModelArtifactVersionConflictError,
  publishModelArtifact,
  readModelArtifact,
  type ModelArtifactSpec,
} from "./artifacts";

/**
 * The store over a REAL table: the code pins a version and gets exactly that version's payload,
 * validated by the artifact's own parser; a missing version is a loud, named failure and never a
 * default; a version is immutable once published; and the memo serves one read per instance.
 */
const db = createTestDb();

interface Knots {
  readonly knots: readonly number[];
}

function parseKnots(payload: unknown): Knots {
  if (typeof payload !== "object" || payload === null || !("knots" in payload)) throw new Error("knots: payload must carry `knots`.");
  const { knots } = payload as { knots: unknown };
  if (!Array.isArray(knots) || !knots.every((knot) => typeof knot === "number" && Number.isFinite(knot))) {
    throw new Error("knots: every knot must be a finite number.");
  }
  return { knots };
}

const SPEC: ModelArtifactSpec<Knots> = { name: "test/knots", version: 1, parse: parseKnots };
const PROVENANCE = { fitStamp: new Date("2026-09-04T21:14:06.000Z"), fittedOn: "2023 and 2024, 2025 and 2026 held out" };
const PAYLOAD: Knots = { knots: [3, 2, 1] };

describe("model artifact store", () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  it("throws a named error carrying the artifact and version when the store lacks it, never a default", async () => {
    await expect(loadModelArtifact(db, SPEC)).rejects.toBeInstanceOf(MissingModelArtifactError);
    await expect(loadModelArtifact(db, SPEC)).rejects.toThrow(/test\/knots v1[\s\S]*artifacts:publish/);
  });

  it("publishes once and reads back the parsed payload with its provenance", async () => {
    expect(await publishModelArtifact(db, SPEC, PAYLOAD, PROVENANCE)).toBe("inserted");
    const stored = await readModelArtifact(db, SPEC);
    expect(stored.payload).toEqual(PAYLOAD);
    expect(stored.fitStamp).toEqual(PROVENANCE.fitStamp);
    expect(stored.fittedOn).toBe(PROVENANCE.fittedOn);
    expect(stored.publishedAt).toBeInstanceOf(Date);
    expect(await loadModelArtifact(db, SPEC)).toEqual(PAYLOAD);
  });

  it("a second publish of the same version and payload changes nothing, whatever the key order", async () => {
    const nested: ModelArtifactSpec<{ readonly a: number; readonly b: number }> = {
      name: "test/nested",
      version: 1,
      parse: (payload) => payload as { readonly a: number; readonly b: number },
    };
    await publishModelArtifact(db, nested, { a: 1, b: 2 }, PROVENANCE);
    expect(await publishModelArtifact(db, nested, { b: 2, a: 1 }, PROVENANCE)).toBe("unchanged");
    expect(await db.select().from(modelArtifacts).where(eq(modelArtifacts.name, "test/nested"))).toHaveLength(1);
  });

  it("refuses to overwrite a published version with a different payload", async () => {
    await publishModelArtifact(db, SPEC, PAYLOAD, PROVENANCE);
    await expect(publishModelArtifact(db, SPEC, { knots: [9] }, PROVENANCE)).rejects.toBeInstanceOf(ModelArtifactVersionConflictError);
    await expect(publishModelArtifact(db, SPEC, { knots: [9] }, PROVENANCE)).rejects.toThrow(/test\/knots v1 is already published with a different payload/);
    expect(await loadModelArtifact(db, SPEC)).toEqual(PAYLOAD);
  });

  it("refuses a payload the artifact's own parser refuses, before anything is written", async () => {
    await expect(publishModelArtifact(db, SPEC, { knots: ["x"] } as unknown as Knots, PROVENANCE)).rejects.toThrow(/finite number/);
    expect(await db.select().from(modelArtifacts)).toHaveLength(0);
  });

  it("serves the pinned version, not the newest one in the store", async () => {
    await publishModelArtifact(db, SPEC, PAYLOAD, PROVENANCE);
    await publishModelArtifact(db, draftVersionOf(SPEC), { knots: [8, 7] }, PROVENANCE);
    expect(await loadModelArtifact(db, SPEC)).toEqual(PAYLOAD);
    expect(await loadModelArtifact(db, draftVersionOf(SPEC))).toEqual({ knots: [8, 7] });
  });

  it("draftVersionOf is the pinned version plus one, same name and parser", () => {
    expect(draftVersionOf(SPEC)).toEqual({ ...SPEC, version: 2 });
  });

  it("memoizes per instance: a load after the row is gone still serves the read until the memo is cleared", async () => {
    await publishModelArtifact(db, SPEC, PAYLOAD, PROVENANCE);
    const first = await loadModelArtifact(db, SPEC);
    await db.delete(modelArtifacts);
    expect(await loadModelArtifact(db, SPEC)).toBe(first);
    invalidateAllTtlMemosForTests();
    await expect(loadModelArtifact(db, SPEC)).rejects.toBeInstanceOf(MissingModelArtifactError);
  });

  it("a stored payload the parser no longer accepts throws on read rather than serving a shape nobody understands", async () => {
    await db.insert(modelArtifacts).values({ name: SPEC.name, version: SPEC.version, payload: { knots: "corrupt" }, ...PROVENANCE });
    await expect(readModelArtifact(db, SPEC)).rejects.toThrow(/test\/knots v1[\s\S]*finite number/);
  });
});
