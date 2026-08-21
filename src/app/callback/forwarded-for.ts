/**
 * The first hop of `X-Forwarded-For`, or `null` if the header is absent, empty, or names no
 * real address — the same caller-controlled, first-hop reading every other IP-keyed door in
 * this codebase uses (`@/app/api/reviews/_shared.ts`'s `clientKey`, `@/app/api/public/leagues/
 * _shared.ts`'s). Copied rather than imported: those siblings key a per-process rate limiter,
 * this keys a stored, hashed device/IP signal (Task 7), and `session_signals.ip_source` records
 * that the value below is `xff_unverified` — read the same way, trusted no more than they are.
 *
 * A standalone module rather than living in `route.ts` alongside it: `route.ts` re-exports
 * `GET` from `handleAuth`, which pulls in `@workos-inc/authkit-nextjs` and, transitively,
 * `next/cache` — a module Vitest's Node environment cannot resolve the way `next build`/`next
 * dev` can, so a test file that imports `route.ts` at all fails at import time regardless of
 * what it actually exercises. This file has no such import, so it is plainly unit-testable.
 */
export function firstForwardedFor(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first !== undefined && first !== "" ? first : null;
}
