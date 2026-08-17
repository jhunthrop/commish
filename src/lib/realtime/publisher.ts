import { createPublisher, type Publisher } from "./publish";
import { getSharedRedis } from "./redis";

const systemClock = { now: () => new Date().toISOString() };

let shared: Publisher | undefined;

/** The one process-wide publisher every feature uses to broadcast an accepted write. */
export function getPublisher(): Publisher {
  if (shared === undefined) {
    shared = createPublisher({
      redis: getSharedRedis(),
      clock: systemClock,
      onError: (error, input) => {
        // Structured logging/error tracking arrives in Phase 2; until then surface it in dev output.
        console.error("[realtime] publish failed", { type: input.type, leagueId: input.leagueId, error });
      },
    });
  }
  return shared;
}
