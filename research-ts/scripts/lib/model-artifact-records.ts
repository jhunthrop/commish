// The committed artifact records as build tooling reads and writes them: one place that knows the
// directory, walks it, parses each file through `parseModelArtifactRecord`, and publishes what it
// finds. Shared by `scripts/artifacts-publish.ts`, every fit script that publishes a new version,
// and the tests that prove the committed records load.
//
// NOTHING UNDER `src/` IMPORTS THIS. The server reads `model_artifacts` through
// `src/projections/model/artifacts.ts`; the filesystem lives here, in tooling, where a serverless
// bundle never has to carry it.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Db } from "@research-ts/db/client";
import { catalogSpecFor } from "@research-ts/projections/model/artifact-catalog";
import { parseModelArtifactRecord, renderModelArtifactRecord, type ModelArtifactRecord } from "@research-ts/projections/model/artifact-record";
import { publishModelArtifact, type ModelArtifactSpec, type PublishOutcome } from "@research-ts/projections/model/artifacts";
import { packagePath } from "@research-ts/lib/package-path";

/** The committed records, relative to the repo root every npm script runs from. */
export const MODEL_ARTIFACT_RECORDS_DIR = packagePath("data/model-artifacts");

/** `<dir>/<family>/<artifact>/v<version>.json`. */
export function modelArtifactRecordPath(name: string, version: number, dir: string = MODEL_ARTIFACT_RECORDS_DIR): string {
  return join(dir, name, `v${version}.json`);
}

/** Every `v<n>.json` under `dir`, recursively, repo-relative, in a stable order. */
export function listModelArtifactRecordFiles(dir: string = MODEL_ARTIFACT_RECORDS_DIR): readonly string[] {
  function walk(path: string): readonly string[] {
    return readdirSync(path, { withFileTypes: true })
      .flatMap((entry) => {
        const full = join(path, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /^v\d+\.json$/.test(entry.name) ? [full] : [];
      })
      .sort();
  }
  return walk(dir);
}

/** One file, parsed, and checked against its own path: a record may not claim a name or version its path does not. */
export function readModelArtifactRecord(path: string): ModelArtifactRecord {
  const record = parseModelArtifactRecord(JSON.parse(readFileSync(path, "utf8")));
  const expected = modelArtifactRecordPath(record.name, record.version, dirname(dirname(dirname(path))));
  if (expected !== path) throw new Error(`${path}: record names ${record.name} v${record.version}, which belongs at ${expected}.`);
  return record;
}

/** Writes a record where the publish script will find it, creating the artifact's directory. */
export function writeModelArtifactRecord(record: ModelArtifactRecord, dir: string = MODEL_ARTIFACT_RECORDS_DIR): string {
  const path = modelArtifactRecordPath(record.name, record.version, dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderModelArtifactRecord(record));
  return path;
}

export interface PublishedRecord {
  readonly path: string;
  readonly name: string;
  readonly version: number;
  readonly outcome: PublishOutcome;
}

/** The spec a record publishes under: the catalogued parser at the record's own version. */
function specForRecord(path: string, record: ModelArtifactRecord): ModelArtifactSpec<unknown> {
  const spec = catalogSpecFor(record.name);
  if (spec === null) throw new Error(`${path}: ${record.name} is not in the model artifact catalog; nothing would read it.`);
  return { ...spec, version: record.version };
}

/** Publishes one record to `db` under its catalogued parser. */
export async function publishModelArtifactRecord(db: Db, path: string): Promise<PublishedRecord> {
  const record = readModelArtifactRecord(path);
  const spec = specForRecord(path, record);
  const outcome = await publishModelArtifact(db, spec, record.payload, { fitStamp: new Date(record.fitStamp), fittedOn: record.fittedOn });
  return { path, name: record.name, version: record.version, outcome };
}

/** Every committed record, published in path order. Idempotent: a re-run reports `unchanged` for each. */
export async function publishCommittedModelArtifacts(db: Db, dir: string = MODEL_ARTIFACT_RECORDS_DIR): Promise<readonly PublishedRecord[]> {
  const published: PublishedRecord[] = [];
  for (const path of listModelArtifactRecordFiles(dir)) {
    published.push(await publishModelArtifactRecord(db, path));
  }
  return published;
}

/**
 * What a fit script does with a fresh fit: write the record, publish the same payload to the store
 * it ran against, and hand back the path and outcome so the script can print the pin to bump.
 */
export async function recordAndPublishFit<T>(
  db: Db,
  spec: ModelArtifactSpec<T>,
  payload: T,
  provenance: { readonly fitStamp: Date; readonly fittedOn: string },
  dir: string = MODEL_ARTIFACT_RECORDS_DIR,
): Promise<PublishedRecord> {
  const record: ModelArtifactRecord = {
    name: spec.name,
    version: spec.version,
    fitStamp: provenance.fitStamp.toISOString(),
    fittedOn: provenance.fittedOn,
    payload: spec.parse(payload),
  };
  const outcome = await publishModelArtifact(db, spec, payload, provenance);
  const path = writeModelArtifactRecord(record, dir);
  return { path, name: spec.name, version: spec.version, outcome };
}
