/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION_SQLSTATE = "23505";

/**
 * Walks an error's `.cause` chain, from `error` itself down to whatever no longer has one.
 * `DrizzleQueryError` (drizzle-orm's wrapper around every `db.execute` failure) carries the
 * driver's real error one level down on `.cause`, not on itself — confirmed empirically:
 * `postgres-js` puts `code`, `constraint_name` and the raw postgres message there. Exported so
 * every caller that needs something off the ACTUAL driver error walks the chain the same way
 * once: `driverErrorField` below, and `src/db/audit-append-only.test.ts`'s message assertions
 * (a bare `.rejects.toThrow(/pattern/)` only ever sees `DrizzleQueryError`'s own message, which
 * is just the SQL text it tried to run, not what postgres said back).
 */
export function unwrapCauseChain(error: unknown): readonly unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null) {
    chain.push(current);
    current = typeof current === "object" && "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return chain;
}

/** Reads one field off the driver's raw error — see `unwrapCauseChain` for why it isn't on top. */
function driverErrorField(error: unknown, key: string): unknown {
  for (const link of unwrapCauseChain(error)) {
    if (typeof link === "object" && link !== null && key in link) return (link as Record<string, unknown>)[key];
  }
  return undefined;
}

/**
 * True only for a unique violation on the NAMED index. Keying on the constraint name — not
 * just the SQLSTATE — matters because 23505 is the generic "unique violation" code: any other
 * index touched by the same statement or transaction raises it too, and treating that as the
 * one race a caller knows how to recover from would hide a real bug behind a recovery path.
 *
 * Shared by every caller that recovers from a specific index (the draft action log's
 * `(draft_id, sequence)` append, the league's `(league_id, user_id)` team backstop), so the
 * `.cause`-unwrapping above is written once rather than half-remembered per call site.
 */
export function isUniqueViolation(error: unknown, constraintName: string): boolean {
  return (
    driverErrorField(error, "code") === UNIQUE_VIOLATION_SQLSTATE &&
    driverErrorField(error, "constraint_name") === constraintName
  );
}
