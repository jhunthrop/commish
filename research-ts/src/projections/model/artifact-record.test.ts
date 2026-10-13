import { describe, expect, it } from "vitest";
import { parseModelArtifactRecord, renderModelArtifactRecord, type ModelArtifactRecord } from "./artifact-record";

const RECORD: ModelArtifactRecord = {
  name: "preseason/game-variance-skill",
  version: 1,
  fitStamp: "2026-09-04T21:14:06.000-05:00",
  fittedOn: "2023 and 2024; 2025 and 2026 held out",
  payload: { rookie: { QB: 51.1 }, veteran: { QB: 50.9 } },
};

describe("the committed artifact record", () => {
  it("accepts a well-formed record and hands back exactly its fields", () => {
    expect(parseModelArtifactRecord(RECORD)).toEqual(RECORD);
  });

  it("names the field it refuses", () => {
    expect(() => parseModelArtifactRecord({ ...RECORD, name: "" })).toThrow(/name/);
    expect(() => parseModelArtifactRecord({ ...RECORD, name: "no-slash" })).toThrow(/name/);
    expect(() => parseModelArtifactRecord({ ...RECORD, version: 0 })).toThrow(/version/);
    expect(() => parseModelArtifactRecord({ ...RECORD, version: 1.5 })).toThrow(/version/);
    expect(() => parseModelArtifactRecord({ ...RECORD, fitStamp: "yesterday" })).toThrow(/fitStamp/);
    expect(() => parseModelArtifactRecord({ ...RECORD, fittedOn: "" })).toThrow(/fittedOn/);
    const withoutPayload = Object.fromEntries(Object.entries(RECORD).filter(([field]) => field !== "payload"));
    expect(() => parseModelArtifactRecord(withoutPayload)).toThrow(/payload/);
    expect(() => parseModelArtifactRecord(null)).toThrow(/record/);
    expect(() => parseModelArtifactRecord("text")).toThrow(/record/);
  });

  it("renders as pretty JSON with a trailing newline and round-trips", () => {
    const text = renderModelArtifactRecord(RECORD);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "name": "preseason/game-variance-skill",\n');
    expect(parseModelArtifactRecord(JSON.parse(text))).toEqual(RECORD);
  });
});
