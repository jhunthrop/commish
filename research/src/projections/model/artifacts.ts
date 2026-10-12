import { and, eq } from "drizzle-orm";
import type { Db, ReadonlyDb } from "@research/db/client";
import { modelArtifacts } from "@research/db/schema";
import { createTtlMemo } from "@research/lib/cache/ttl-memo";

/**
 * THE MODEL ARTIFACT LOADER (file-sourced data round, 2026-09-09): the one place the engine reads a
 * fitted table from, and the one place a fit script writes one.
 *
 * THE CODE PINS THE VERSION. An artifact is declared once, beside the readers that consume it, as a
 * `ModelArtifactSpec`: its name, the version this code was written against, and the parser that
 * turns a stored payload back into the shape the readers already take. A fit script publishes the
 * NEXT version (`draftVersionOf`) as a data write with an audit row; the code starts serving it
 * when a reviewed commit bumps the pin. A store that lacks the pinned version is a loud failure
 * (`MissingModelArtifactError`), never a default and never a fallback to a module, because a board
 * built on a number nobody published is a board nobody can trace.
 *
 * A VERSION IS IMMUTABLE. Publishing the same version with the same payload is a no-op, so the
 * publish script and every fit script are safe to re-run; publishing it with a different payload
 * throws (`ModelArtifactVersionConflictError`), because the audit row of a version that quietly
 * changed underneath the code that pinned it would be worthless.
 *
 * MEMOIZED PER INSTANCE. A version never changes, so a warm instance reads each pinned artifact
 * once; the TTL only bounds how long a long-lived instance holds a payload the code stopped
 * pinning. Registered with `createTtlMemo` so `truncateAll` in a test clears it with every other
 * reference memo.
 */

export interface ModelArtifactSpec<T> {
  /** `<family>/<artifact>`, the store's key. Stable for the life of the artifact. */
  readonly name: string;
  /** The version this code was written against. Bumped in a reviewed commit after a fit publishes the next one. */
  readonly version: number;
  /** Turns a stored payload into the readers' shape, throwing on anything else. Runs on every read and before every write. */
  readonly parse: (payload: unknown) => T;
}

export interface ModelArtifactProvenance {
  /** When the fit that produced the payload ran. */
  readonly fitStamp: Date;
  /** The train window in the fit script's own words. */
  readonly fittedOn: string;
}

export interface PublishedModelArtifact<T> extends ModelArtifactProvenance {
  readonly name: string;
  readonly version: number;
  readonly payload: T;
  readonly publishedAt: Date;
}

/** What a publish did: `inserted` the first time, `unchanged` on every identical re-run. */
export type PublishOutcome = "inserted" | "unchanged";

/** A day: long enough that a warm instance never re-reads a pinned artifact, short enough that a
 *  payload the code stopped pinning does not live in memory forever. */
const MODEL_ARTIFACT_MEMO_TTL_MS = 24 * 60 * 60 * 1000;

const memo = createTtlMemo<unknown>(MODEL_ARTIFACT_MEMO_TTL_MS);

function memoKey(spec: ModelArtifactSpec<unknown>): string {
  return `${spec.name}@${spec.version}`;
}

export class MissingModelArtifactError extends Error {
  constructor(spec: ModelArtifactSpec<unknown>) {
    super(
      `model_artifacts holds no ${spec.name} v${spec.version}, which this code pins. ` +
        "Run `npm run artifacts:publish` against this database, or pin the version the store actually holds.",
    );
    this.name = "MissingModelArtifactError";
  }
}

export class ModelArtifactVersionConflictError extends Error {
  constructor(spec: ModelArtifactSpec<unknown>) {
    super(
      `${spec.name} v${spec.version} is already published with a different payload. A version is immutable: ` +
        "publish the fit as the next version and pin it in a reviewed commit.",
    );
    this.name = "ModelArtifactVersionConflictError";
  }
}

/** The version a fit script publishes: the pinned one plus one, under the same name and parser. */
export function draftVersionOf<T>(spec: ModelArtifactSpec<T>): ModelArtifactSpec<T> {
  return { ...spec, version: spec.version + 1 };
}

/**
 * JSON with every object's keys in sorted order, so two payloads compare by content. Postgres
 * stores jsonb with its own key order, which is not the order a fit script wrote.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseNaming<T>(spec: ModelArtifactSpec<T>, payload: unknown): T {
  try {
    return spec.parse(payload);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${spec.name} v${spec.version}: ${reason}`);
  }
}

async function selectRow(db: ReadonlyDb, spec: ModelArtifactSpec<unknown>): Promise<typeof modelArtifacts.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(modelArtifacts)
    .where(and(eq(modelArtifacts.name, spec.name), eq(modelArtifacts.version, spec.version)))
    .limit(1);
  return row;
}

/** The pinned version's row, parsed, unmemoized. Throws when the store lacks it or the payload no longer parses. */
export async function readModelArtifact<T>(db: ReadonlyDb, spec: ModelArtifactSpec<T>): Promise<PublishedModelArtifact<T>> {
  const row = await selectRow(db, spec);
  if (row === undefined) throw new MissingModelArtifactError(spec);
  return { name: row.name, version: row.version, payload: parseNaming(spec, row.payload), fitStamp: row.fitStamp, fittedOn: row.fittedOn, publishedAt: row.publishedAt };
}

/** The pinned version's payload, from memory after the first read on this instance. */
export function loadModelArtifact<T>(db: ReadonlyDb, spec: ModelArtifactSpec<T>): Promise<T> {
  return memo.get(memoKey(spec), async () => (await readModelArtifact(db, spec)).payload) as Promise<T>;
}

/**
 * Writes one version once. The payload runs through the artifact's own parser first, so a fit
 * script cannot publish a shape the readers would refuse; an identical re-publish is `unchanged`;
 * a different payload under a published version throws.
 */
export async function publishModelArtifact<T>(
  db: Db,
  spec: ModelArtifactSpec<T>,
  payload: T,
  provenance: ModelArtifactProvenance,
): Promise<PublishOutcome> {
  const parsed = parseNaming(spec, payload);
  const existing = await selectRow(db, spec);
  if (existing !== undefined) {
    if (stableJson(existing.payload) === stableJson(parsed)) return "unchanged";
    throw new ModelArtifactVersionConflictError(spec);
  }
  await db.insert(modelArtifacts).values({ name: spec.name, version: spec.version, payload: parsed, fitStamp: provenance.fitStamp, fittedOn: provenance.fittedOn });
  return "inserted";
}
