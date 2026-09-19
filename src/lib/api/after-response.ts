/**
 * WORK THAT BELONGS AFTER THE RESPONSE (draft-room performance round, item 1): a pick's own
 * invocation owes the room's facts for the state it just produced, but the person who made the
 * pick must not wait on that compute, and the write it follows must never depend on it. Inside a
 * request scope this is Next's `after()`, which keeps the invocation alive past the response for
 * exactly this. Outside one (a script, a test, the local jobs runner) `after()` throws, and the
 * work simply runs now, detached: there is no response to wait for.
 *
 * Never throws into the caller, whichever scope: a failure in the deferred work is logged with
 * its detail and swallowed, because by construction nothing that matters is behind it.
 */
import { after } from "next/server";

function guarded(work: () => Promise<void>): Promise<void> {
  return work().catch((error: unknown) => {
    console.error("[after-response] deferred work failed", error);
  });
}

export function runAfterResponse(work: () => Promise<void>): void {
  try {
    after(() => guarded(work));
  } catch {
    void guarded(work);
  }
}
