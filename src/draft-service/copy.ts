/**
 * THE DRAFT SERVICE'S OWN SENTENCES, said to a person (draft-room performance round, item 4).
 * Every one passes `copyViolations` (`@/integrity/copy-rules`): no dash, no contraction, nothing
 * accusatory. `copy.test.ts` holds them to it.
 */
export const DRAFT_SERVICE_COPY = {
  /**
   * THE FAIL-FAST PUBLISH'S OWN WORDS. A pick is committed to Postgres before the room is told
   * over Redis; when that telling fails (Redis refused inside `REALTIME_CONFIG.commandTimeoutMs`,
   * a bounded number of retries) the pick still stands, and the actions route says so in the
   * envelope's `notice` rather than pretending the room already knows: the league speaking, in
   * the room's toast. Every open stream relays a resync within one keepalive (review finding 3).
   */
  publishDelayed: "The room lost its voice for a moment, catching up.",
} as const;
