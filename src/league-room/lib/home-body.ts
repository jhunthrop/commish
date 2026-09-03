import type { HomeBody } from "../contract";

/**
 * The one runtime guard for `/api/home`'s payload, shared by every surface that background-
 * fetches it (`HomeBoard`'s refresh loop, the rail flyout's live upgrade) — deliberately
 * shallow: the route and these callers already share the `HomeBody` type at compile time, so
 * this only has to reject a non-envelope shape, not re-validate every field.
 */
export function isHomeBody(value: unknown): value is HomeBody {
  return typeof value === "object" && value !== null && Array.isArray((value as { leagues?: unknown }).leagues);
}
