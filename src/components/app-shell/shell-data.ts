import type { Db } from "@/db/client";
import type { Clock } from "@/domain/timing";
import type { NextActionKind, WeekStatus } from "@/league";
import { crossLeagueHome } from "@/league-service";
import type { LiveState as HomeLiveState } from "@/league-room/contract";

/**
 * The rail's own three-way read of a league, derived from `nextAction.kind` and the current
 * week's status — nothing else (Step 3). `"needs-you"` is exactly `"fix-lineup"` or
 * `"join-draft"` (Task 10, Step 1b, F1): the two kinds that mean "you are the reason this league
 * is stalled, and the platform can say so honestly" — before `fix-lineup` existed, the rail had
 * no truthful way to say "your lineup" beyond "join-draft", so it claimed only that one kind. A
 * `needs-you` dot with no honest sentence behind it is worse than no dot at all. `"live"` is a
 * league whose current week is `in_progress`, independent of `nextAction` entirely. Everything
 * else, including "no action at all", is `"quiet"`.
 */
export type RailLeagueState = "needs-you" | "live" | "quiet";

/**
 * One league as the rail renders it: 40px tiles, never more data than a tile needs. `shortName`
 * is derived by `shortNameFor` below, never stored — a renamed league can never carry a stale
 * initial, and there is no column to migrate (ruling 10). The tile's tone is not carried here at
 * all: `Crest` (`@/components/ui/crest`) derives it deterministically from `id` itself
 * (`crestTone`, Phase 3.6, Task 3), so there is no second value that could ever disagree with it.
 */
export interface RailLeague {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly state: RailLeagueState;
}

/**
 * `LiveState` (Task 10, Step 3) lives on `@/league-room/contract` — `crossLeagueHome` computes it
 * once, from the SAME `stat_weeks` rows it reads for every league's own `weekStatus`, and this
 * module reuses that one computation rather than deriving a second, potentially-disagreeing
 * answer of its own. Re-exported here so a caller that only knows this module (`AppShellProps`,
 * `TopBarProps`) never has to reach into `@/league-room/contract` for a type this seam predates.
 */
export type { HomeLiveState as LiveState };

export interface ShellData {
  readonly rail: readonly RailLeague[];
  readonly liveState: HomeLiveState | null;
}

/**
 * The first letter of each of the first two words, uppercased — "Bay Bandits" → "BB". Falls
 * back to the first two letters of a one-word name — "Ballers" → "BA" (Step 3's own spec).
 */
export function shortNameFor(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]!.charAt(0)}${words[1]!.charAt(0)}`.toUpperCase();
}

function stateFor(kind: NextActionKind | undefined, weekStatus: WeekStatus): RailLeagueState {
  if (kind === "join-draft" || kind === "fix-lineup") return "needs-you";
  if (weekStatus === "in_progress") return "live";
  return "quiet";
}

/**
 * The rail's data, once: `{ rail, liveState }` in one round trip, built on the reads
 * `crossLeagueHome` already performs (Step 3) — this function issues no query of its own.
 * Called exactly once per navigation, by `src/app/app/(shell)/layout.tsx` (ruling 8, as
 * amended); nothing else reads the rail twice. `liveState` (Task 10, Step 3) is `home.liveState`
 * verbatim — `crossLeagueHome` is the one place that computes it, from the `stat_weeks` rows it
 * already reads, so this never derives a second, potentially-disagreeing answer. `clock` rides
 * straight through to `crossLeagueHome`'s own `CrossLeagueHomeDeps.clock` — optional, defaulting
 * to the real one, injectable only so a test can pin the weekday `liveStateFor` reads.
 */
export async function shellData(db: Db, user: { readonly id: string }, clock?: Clock): Promise<ShellData> {
  const home = await crossLeagueHome(db, user.id, { clock });
  const rail: readonly RailLeague[] = home.leagues.map((league) => ({
    id: league.id,
    name: league.name,
    shortName: shortNameFor(league.name),
    state: stateFor(league.nextAction?.kind, league.weekStatus),
  }));
  return { rail, liveState: home.liveState };
}
