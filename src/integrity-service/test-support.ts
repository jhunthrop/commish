import { sql } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";

/**
 * Runs `work` with one table's user triggers turned off, and turns them back on whatever happens.
 *
 * `DISABLE TRIGGER USER` needs table ownership, which is the same privilege that can `DROP TABLE`
 * — so every tamper built on this models a real adversary rather than inventing an impossible
 * one. It is the ONLY way to produce the deletions the verifier's anchor reconciliation exists to
 * catch: an append-only trigger stops the casual editor, and a tamper test that could not get past
 * it would be testing the trigger a second time instead of testing what stands behind it.
 */
async function withTriggersDisabled(db: Db, table: string, work: () => Promise<void>): Promise<void> {
  await db.execute(sql`ALTER TABLE ${sql.identifier(table)} DISABLE TRIGGER USER`);
  try {
    await work();
  } finally {
    await db.execute(sql`ALTER TABLE ${sql.identifier(table)} ENABLE TRIGGER USER`);
  }
}

/**
 * Erases a chain's tail from `fromSequence` onward — the deletion class the hash chain alone
 * cannot see, because the rows that remain still link perfectly to each other. `fromSequence: 1`
 * is the whole-chain case. Test-only, same rule as every export in this file.
 */
export async function deleteAuditEventsFrom(db: Db, scope: string, fromSequence: number): Promise<void> {
  await withTriggersDisabled(db, "audit_events", async () => {
    await db.execute(sql`DELETE FROM audit_events WHERE chain_scope = ${scope} AND sequence >= ${fromSequence}`);
  });
}

/** Erases ONE event by id — the mid-chain deletion the linked run catches on its own, as a gap. */
export async function deleteAuditEvent(db: Db, eventId: string): Promise<void> {
  await withTriggersDisabled(db, "audit_events", async () => {
    await db.execute(sql`DELETE FROM audit_events WHERE event_id = ${eventId}`);
  });
}

/**
 * Erases a chain's verification checkpoint — the adversary's last step, since after the anchor
 * reconciliation landed the checkpoint is the second detector rather than the only one. Needs the
 * trigger trick now that migration `0021` refuses this delete outright, which is exactly the point
 * of that migration.
 */
export async function deleteAuditCheckpoint(db: Db, scope: string): Promise<void> {
  await withTriggersDisabled(db, "audit_chain_checkpoints", async () => {
    await db.execute(sql`DELETE FROM audit_chain_checkpoints WHERE scope = ${scope}`);
  });
}

/**
 * Edits a stored audit row, by first turning off the triggers that exist to prevent exactly
 * this. That is the point: the trigger stops a careless or casual edit, and the hash chain is
 * what catches the person who could turn the trigger off. A tamper test that could not get past
 * the trigger would be testing the trigger a second time instead of testing the chain.
 *
 * `DISABLE TRIGGER USER` needs table ownership, which is the same privilege that can `DROP
 * TABLE` — so this models a real adversary rather than inventing an impossible one. Test-only:
 * nothing under `src/**` outside a `*.test.ts` may import this.
 */
export async function tamperWithAuditEvent(db: Db, eventId: string, patch: Readonly<Record<string, unknown>>): Promise<void> {
  // `payload` is jsonb: postgres-js binds a plain JS object as its jsonb OID directly, which the
  // wire protocol rejects (it wants a string to parse, not an object to serialize). Every other
  // column here is a scalar, which binds fine as-is — only an object/array patch value needs the
  // stringify-then-cast around it.
  const assignments = Object.entries(patch).map(([column, value]) =>
    value !== null && typeof value === "object"
      ? sql`${sql.identifier(column)} = ${JSON.stringify(value)}::jsonb`
      : sql`${sql.identifier(column)} = ${value}`,
  );
  await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER USER`);
  try {
    await db.execute(sql`UPDATE audit_events SET ${sql.join(assignments, sql`, `)} WHERE event_id = ${eventId}`);
  } finally {
    await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER USER`);
  }
}
