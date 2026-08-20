import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

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
  const assignments = Object.entries(patch).map(([column, value]) => sql`${sql.identifier(column)} = ${value}`);
  await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER USER`);
  try {
    await db.execute(sql`UPDATE audit_events SET ${sql.join(assignments, sql`, `)} WHERE event_id = ${eventId}`);
  } finally {
    await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER USER`);
  }
}
