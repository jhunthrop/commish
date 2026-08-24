import type { LiveState } from "../contract";
import { StatPill } from "@/components/ui/stat-pill";

export interface LiveStatePillProps {
  readonly liveState: LiveState | null;
}

/**
 * The top bar's one live fact (Phase 3.6, Task 10, Step 3): "SUNDAY · 7 GAMES LIVE" — the pill's
 * capitals are `StatPill`'s own CSS, never typed here. Renders NOTHING when `liveState` is
 * `null` (ruling 12: nothing live means no pill, never one that pulses on a Tuesday in July).
 *
 * Every non-live state — off-season, mid-week, pre-kickoff — is `null` by construction, computed
 * once in `liveStateFor` (`@/league-service/home.ts`) rather than branched here: this component
 * has exactly one job, rendering the one real state, and no copy of its own for the states it
 * does not render.
 */
export function LiveStatePill({ liveState }: LiveStatePillProps) {
  if (liveState === null) return null;
  const gameWord = liveState.gamesLive === 1 ? "game" : "games";
  return <StatPill label={`${liveState.weekday} · ${liveState.gamesLive} ${gameWord} live`} tone="accent" glow />;
}
