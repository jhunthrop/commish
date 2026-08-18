/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION_SQLSTATE = "23505";

/**
 * Reads one field off the driver's raw error, unwrapping the `DrizzleQueryError` that carries
 * it as `.cause` (confirmed empirically: `postgres-js` puts `code` and `constraint_name` on
 * the same object, one level under `.cause`, not on the `DrizzleQueryError` itself).
 */
function driverErrorField(error: unknown, key: string): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  if (key in error) return (error as Record<string, unknown>)[key];
  if ("cause" in error) return driverErrorField((error as { cause?: unknown }).cause, key);
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
