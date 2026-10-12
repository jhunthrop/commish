/**
 * THE COMMITTED ARTIFACT RECORD: one JSON file per published version, the reviewed input to
 * `npm run artifacts:publish` exactly as the coaches CSV is the reviewed input to
 * `npm run coaches:ingest`. A fit script writes the record beside the store row; the publish
 * script loads every record into whichever database it is pointed at; the server reads only the
 * table. This module is the record's SHAPE and nothing else: where the files live and how they are
 * read is build tooling (`scripts/lib/model-artifact-records.ts`), never `src`.
 */

export interface ModelArtifactRecord {
  readonly name: string;
  readonly version: number;
  /** ISO-8601, the moment the fit ran. Kept as text so the file reads as it was written. */
  readonly fitStamp: string;
  readonly fittedOn: string;
  readonly payload: unknown;
}

/** `<family>/<artifact>`: lowercase words and digits, hyphens inside a segment, one slash. */
const ARTIFACT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

function refuse(field: string, why: string): never {
  throw new Error(`artifact record: ${field} ${why}.`);
}

function nonEmptyString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || value === "") refuse(field, "must be a non-empty string");
  return value;
}

export function parseModelArtifactRecord(raw: unknown): ModelArtifactRecord {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) refuse("record", "must be a JSON object");
  const record = raw as Record<string, unknown>;
  const name = nonEmptyString(record, "name");
  if (!ARTIFACT_NAME.test(name)) refuse("name", "must be `<family>/<artifact>` in lowercase words, digits and hyphens");
  const version = record.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) refuse("version", "must be a positive integer");
  const fitStamp = nonEmptyString(record, "fitStamp");
  if (Number.isNaN(Date.parse(fitStamp))) refuse("fitStamp", "must be an ISO-8601 date");
  const fittedOn = nonEmptyString(record, "fittedOn");
  if (!("payload" in record) || record.payload === undefined) refuse("payload", "is required");
  return { name, version, fitStamp, fittedOn, payload: record.payload };
}

/** The file's text: pretty-printed, fields in declaration order, one trailing newline. */
export function renderModelArtifactRecord(record: ModelArtifactRecord): string {
  const ordered: ModelArtifactRecord = { name: record.name, version: record.version, fitStamp: record.fitStamp, fittedOn: record.fittedOn, payload: record.payload };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
